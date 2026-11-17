const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require(name) { assert.ok(name in mocks, name); return mocks[name]; } });
  return exports;
}
const productId = '00000000-0000-4000-8000-000000000010';
const sizeId = '00000000-0000-4000-8000-000000000011';
const groupId = '00000000-0000-4000-8000-000000000012';
const money = load('src/service/order/orderValidation.ts', {});
function fixture() {
  return {
    product: { id: productId, name: 'Quentinha', price: '15.00', published: false, available: true, image_url: null },
    variants: [{ id: sizeId, name: 'Pequena', price: '15.00' }],
    groups: [{ id: groupId, name: 'Acompanhamentos', required: true, min_select: 1, max_select: 2, available_options: 2 }],
    options: [{ name: 'Farofa', additional_price: '0.00' }, { name: 'Bacon', additional_price: '2.50' }],
    limits: [{ variant_id: sizeId, group_id: groupId, min_select: 1, max_select: 2, variant_product_id: productId, group_product_id: productId }],
  };
}
function harness(data = fixture(), notOwned = false) {
  const trace = [];
  let writes = 0;
  const client = { release() { trace.push('release'); }, async query(sql, params = []) {
    trace.push(sql);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.includes('FROM public.products')) {
      assert.deepEqual(Array.from(params), [productId, 'owner-A']);
      assert.match(sql, /restaurant_id = \$2/);
      return { rowCount: notOwned ? 0 : 1, rows: notOwned ? [] : [data.product] };
    }
    if (sql.includes('FROM public.product_variants')) return { rows: data.variants };
    if (sql.includes('COUNT(po.id)')) return { rows: data.groups };
    if (sql.includes('SELECT po.name')) {
      assert.match(sql, /pog.product_id = \$1 AND po.available = TRUE/);
      return { rows: data.options };
    }
    if (sql.includes('FROM public.product_variant_group_limits')) {
      assert.match(sql, /WHERE v.product_id = \$1 OR g.product_id = \$1/);
      return { rows: data.limits };
    }
    if (sql.includes('UPDATE public.products')) {
      assert.match(sql, /WHERE id = \$1\s+AND restaurant_id = \$2/);
      writes++;
      data.product = { ...data.product, published: true };
      return { rows: [data.product] };
    }
    assert.fail(sql);
  } };
  const pool = { query: (...args) => client.query(...args), connect: async () => client };
  const validator = load('src/service/productTemplates/ValidateProductPublicationService.ts', {
    '../../database': { pool }, '../order/orderValidation': money,
  });
  const publisher = load('src/service/productTemplates/PublishProductService.ts', {
    '../../database': { pool }, './ValidateProductPublicationService': validator,
  });
  return {
    validate: () => new validator.ValidateProductPublicationService().execute({ restaurantId: 'owner-A', productId }),
    publish: () => new publisher.PublishProductService().execute({ restaurantId: 'owner-A', productId }),
    trace, writes: () => writes,
  };
}

test('valid configuration with free and paid options can be published without an image', async () => {
  const h = harness();
  assert.equal((await h.validate()).valid, true);
  const result = await h.publish();
  assert.equal(result.status, 200);
  assert.equal(result.data.product.published, true);
  assert.deepEqual(h.trace.slice(-2), ['COMMIT', 'release']);
  assert.ok(h.trace.some(sql => sql.includes('FOR UPDATE')));
});

for (const [name, mutate] of [
  ['no active size', data => { data.variants = []; }],
  ['invalid size price', data => { data.variants[0].price = '15.001'; }],
  ['price outside the supported finite range', data => { data.variants[0].price = '9'.repeat(400); }],
  ['null size price', data => { data.variants[0].price = null; }],
  ['invalid additional price', data => { data.options[0].additional_price = '-1'; }],
  ['inconsistent base price', data => { data.product.price = '14.00'; }],
  ['required group missing options', data => { data.groups[0].available_options = 0; }],
  ['invalid general limits', data => { data.groups[0].max_select = 0; }],
  ['noninteger limits', data => { data.limits[0].min_select = 0.5; }],
  ['inverted size limits', data => { data.limits[0].max_select = 0; }],
  ['required group with zero minimum', data => { data.limits[0].min_select = 0; }],
  ['missing size limits', data => { data.limits = []; }],
  ['foreign product relationship', data => { data.limits[0].group_product_id = 'another-product'; }],
  ['orphan group relationship', data => { data.limits[0].group_product_id = null; }],
  ['duplicate limits', data => { data.limits.push(data.limits[0]); }],
  ['minimum above the checkout limit', data => {
    data.groups.push({ ...data.groups[0], id: 'second', available_options: 100 });
    data.groups[0].available_options = 100;
    data.limits[0].min_select = 60; data.limits[0].max_select = 60;
    data.limits.push({ ...data.limits[0], group_id: 'second' });
  }],
]) {
  test(`rejects ${name} and rolls back publication`, async () => {
    const data = fixture();
    mutate(data);
    const h = harness(data);
    const validation = await h.validate();
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.length);
    const result = await h.publish();
    assert.equal(result.status, 422);
    assert.equal(h.writes(), 0);
    assert.deepEqual(h.trace.slice(-2), ['ROLLBACK', 'release']);
  });
}

test('a foreign restaurant product receives 404 before any related configuration is read', async () => {
  const h = harness(fixture(), true);
  assert.equal((await h.publish()).status, 404);
  assert.equal(h.writes(), 0);
  assert.equal(h.trace.some(sql => sql.includes('FROM public.product_variants')), false);
});

test('repeated publication revalidates the current data and does not write twice', async () => {
  const data = fixture();
  const h = harness(data);
  assert.equal((await h.publish()).status, 200);
  assert.equal((await h.publish()).status, 200);
  assert.equal(h.writes(), 1);
  data.groups[0].available_options = 0;
  assert.equal((await h.publish()).status, 422);
  assert.equal(h.writes(), 1);
});

test('publishing an unavailable product preserves its availability flag', async () => {
  const data = fixture();
  data.product.available = false;
  const result = await harness(data).publish();
  assert.equal(result.status, 200);
  assert.equal(result.data.product.published, true);
  assert.equal(result.data.product.available, false);
});


function withoutGroups() {
  const data = fixture();
  data.groups = [];
  data.options = [];
  data.limits = [];
  return data;
}

test('publishes a configurable product with one active variant and no choice groups', async () => {
  const h = harness(withoutGroups());
  assert.equal((await h.validate()).valid, true);
  const result = await h.publish();
  assert.equal(result.status, 200);
  assert.equal(result.data.product.published, true);
  assert.equal(h.writes(), 1);
});

test('publishes multiple variants without groups using the lowest active variant price', async () => {
  const data = withoutGroups();
  data.variants.push({ id: '00000000-0000-4000-8000-000000000013', name: 'Grande', price: '20.00' });
  const h = harness(data);
  assert.equal((await h.validate()).valid, true);
  assert.equal((await h.publish()).status, 200);
  assert.equal(h.writes(), 1);
});

for (const [name, mutate] of [
  ['missing product name', data => { data.product.name = ' '; }],
  ['no active variants', data => { data.variants = []; }],
  ['negative variant price', data => { data.variants[0].price = '-1.00'; }],
  ['invalid second variant', data => { data.variants.push({ id: 'invalid-price-size', name: 'Grande', price: null }); }],
  ['invalid base price', data => { data.product.price = '-1.00'; }],
  ['base price different from cheapest variant', data => { data.product.price = '20.00'; }],
]) {
  test(`no-group product still rejects ${name} without publishing`, async () => {
    const data = withoutGroups();
    mutate(data);
    const h = harness(data);
    assert.equal((await h.validate()).valid, false);
    assert.equal((await h.publish()).status, 422);
    assert.equal(h.writes(), 0);
    assert.deepEqual(h.trace.slice(-2), ['ROLLBACK', 'release']);
  });
}
