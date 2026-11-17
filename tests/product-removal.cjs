const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, Buffer, require(name) { assert.ok(name in mocks, name); return mocks[name]; } });
  return exports;
}
const validation = load('src/service/product/productValidation.ts', {});
const id = '00000000-0000-4000-8000-000000000010';
function harness(options = {}) {
  const trace = [];
  const client = { async query(sql, params) {
    trace.push(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (/SELECT id, published|UPDATE public.products|DELETE FROM public.products/.test(sql)) {
      assert.match(sql, /WHERE id = \$1 AND restaurant_id = \$2/);
      assert.deepEqual(Array.from(params), [id, 'A']);
    } else assert.deepEqual(Array.from(params), [id]);
    if (options.fk && sql.startsWith('DELETE FROM public.product_options')) throw { code: '23503' };
    if (sql.startsWith('SELECT id, published')) return { rows: options.foreign ? [] : [{ id, published: Boolean(options.published) }] };
    if (sql.startsWith('SELECT 1 FROM public.order_items')) {
      assert.match(sql, /i.variant_id/); assert.match(sql, /public.order_item_options/);
      return { rows: options.history ? [{}] : [] };
    }
    if (sql.startsWith('SELECT 1 FROM public.product_variant_group_limits')) return { rows: options.crossLink ? [{}] : [] };
    if (sql.startsWith('UPDATE public.products')) {
      assert.match(sql, /SET available = FALSE/);
      assert.doesNotMatch(sql, /SET.*name|SET.*published|SET.*price/);
      return { rows: options.foreign ? [] : [{ id, available: false, published: true }] };
    }
    return { rows: [], rowCount: 1 };
  }, release() { trace.push('release'); } };
  const transaction = load('src/service/product/productTransaction.ts', { '../../database': { pool: { connect: async () => client } } });
  const service = load('src/service/product/DeleteProductService.ts', { './productTransaction': transaction, './productValidation': validation });
  const controller = load('src/controller/product/DeleteProductController.ts', {
    '../../service/product/DeleteProductService': service,
    '../../service/product/productValidation': validation,
  });
  return { service: new service.DeleteProductService(), controller: new controller.DeleteProductController(), trace };
}
function response() { return { statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } }; }
test('draft without orders deletes dependencies in order in one transaction', async () => {
  const h = harness();
  await h.service.execute(id, 'A');
  const deletes = h.trace.filter(sql => sql.startsWith('DELETE'));
  assert.equal(deletes.length, 5);
  for (const [index, name] of ['product_variant_group_limits','product_options','product_option_groups','product_variants','products'].entries()) assert.match(deletes[index], new RegExp(`DELETE FROM public.${name}\\b`));
  assert.deepEqual(h.trace.slice(-2), ['COMMIT','release']);
  assert.equal(h.trace.some(sql => /^(DELETE|UPDATE).*public.order/.test(sql)), false);
});
for (const [name, options] of Object.entries({ published: { published: true }, history: { history: true }, inconsistent: { crossLink: true } })) {
  test(`${name} blocks permanent deletion and rolls back`, async () => {
    const h = harness(options);
    await assert.rejects(h.service.execute(id, 'A'), error => error.status === 409);
    assert.equal(h.trace.some(sql => sql.startsWith('DELETE')), false);
    assert.deepEqual(h.trace.slice(-2), ['ROLLBACK','release']);
  });
}
test('foreign or missing product causes no writes for deletion and no matching deactivation', async () => {
  const h = harness({ foreign: true });
  assert.equal(await h.service.execute(id, 'A'), undefined);
  assert.equal(h.trace.some(sql => sql.startsWith('DELETE')), false);
  assert.equal(await h.service.deactivate(id, 'A'), undefined);
});
test('deactivation preserves product and historical records, even when published with orders', async () => {
  const h = harness({ published: true, history: true });
  assert.equal((await h.service.deactivate(id, 'A')).available, false);
  assert.equal(h.trace.some(sql => sql.startsWith('DELETE')), false);
  assert.deepEqual(h.trace.slice(-2), ['COMMIT','release']);
});
test('FK failure rolls back every dependency deletion and returns 409', async () => {
  const h = harness({ fk: true });
  const res = response();
  await h.controller.handle({ user_id: 'A', body: { product_id: id, restaurant_id: 'B' } }, res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(h.trace.slice(-2), ['ROLLBACK','release']);
  assert.equal(h.trace.includes('COMMIT'), false);
});
test('controllers use authenticated restaurant and reject anonymous or malformed IDs', async () => {
  for (const action of ['handle','deactivate']) {
    const h = harness();
    for (const [user_id, productId, code] of [[undefined,id,401],['A','bad',400]]) {
      const res = response();
      await h.controller[action]({ user_id, params: { productId }, body: { product_id: productId } }, res);
      assert.equal(res.statusCode, code);
    }
    assert.equal(h.trace.length, 0);
    const res = response();
    // Detached callback matches Express invocation; body identity cannot override JWT identity.
    const handler = h.controller[action];
    await handler({ user_id: 'A', params: { productId: id }, body: { product_id: id, restaurant_id: 'B' } }, res);
    assert.equal(res.statusCode, 200);
    const absent = harness({ foreign: true }), notFound = response();
    await absent.controller[action]({ user_id: 'A', params: { productId: id }, body: { product_id: id } }, notFound);
    assert.equal(notFound.statusCode, 404);
  }
});
test('public catalog and order validation still filter unavailable products', () => {
  assert.match(fs.readFileSync('src/service/product/GetProductIdService.ts','utf8'), /available = TRUE/);
  assert.match(fs.readFileSync('src/service/order/validateOrderCheckout.ts','utf8'), /product.available !== true/);
  assert.match(fs.readFileSync('src/routes.ts','utf8'), /"\/products\/:productId\/deactivate",\s*isAuthentication,/);
});
