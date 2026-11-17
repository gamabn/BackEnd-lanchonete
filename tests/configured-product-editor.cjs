const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, Buffer, require(name) {
    assert.ok(name in mocks, `Unexpected import ${name}`);
    return mocks[name];
  } });
  return exports;
}

const productRoot = 'src/service/product';
const templateRoot = 'src/service/productTemplates';
const optionRoot = 'src/service/productOptions';
const validation = load(`${productRoot}/productValidation.ts`, {});
const { ProductInputError } = validation;
const { parseConfiguredProduct } = load(`${templateRoot}/configuredProductInput.ts`, {
  '../product/productValidation': validation,
});
const optionPrice = load(`${optionRoot}/productOptionPrice.ts`, { '../product/productValidation': validation });

const productId = '00000000-0000-4000-8000-000000000010';
const sizeId = '00000000-0000-4000-8000-000000000011';
const groupId = '00000000-0000-4000-8000-000000000012';
const optionId = '00000000-0000-4000-8000-000000000013';
const tenant = 'owner-A';

function payload() {
  return {
    name: ' Quentinha ', description: '', available: true,
    groups: [{ id: groupId, name: 'Acompanhamentos', required: true, minSelect: 1, maxSelect: 2 }],
    variants: [{
      id: sizeId, name: 'Pequena', price: '18,90', available: true,
      groupLimits: [{ groupId, minSelect: 1, maxSelect: 2 }],
    }],
  };
}

function harness(query) {
  const trace = [];
  const client = {
    async query(sql, params = []) {
      trace.push(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      return query(sql, Array.from(params));
    },
    release() { trace.push('release'); },
  };
  const pool = { connect: async () => client };
  const transaction = load(`${productRoot}/productTransaction.ts`, { '../../database': { pool } });
  const money = load('src/service/order/orderValidation.ts', {});
  const validator = load(`${templateRoot}/ValidateProductPublicationService.ts`, { '../../database': { pool }, '../order/orderValidation': money });
  const guard = load(`${templateRoot}/ensurePublishedProductValid.ts`, {
    '../product/productValidation': validation, './ValidateProductPublicationService': validator,
  });
  const common = { '../product/productTransaction': transaction, '../product/productValidation': validation };
  const { UpdateConfiguredProductService } = load(`${templateRoot}/UpdateConfiguredProductService.ts`, {
    ...common, './ensurePublishedProductValid': guard,
  });
  const { UpdateProductOptionService } = load(`${optionRoot}/UpdateProductOptionService.ts`, {
    ...common, '../productTemplates/ensurePublishedProductValid': guard, './productOptionPrice': optionPrice,
  });
  const { CreateProductOptionService } = load(`${optionRoot}/CreateProductOptionService.ts`, {
    ...common, './productOptionPrice': optionPrice,
  });
  return { trace, editor: new UpdateConfiguredProductService(), editOption: new UpdateProductOptionService(), createOption: new CreateProductOptionService() };
}

function editorQuery({ published = false, missing = '', availableOptions = 1, available = true } = {}) {
  return (sql, params) => {
    if (sql.includes('FOR UPDATE')) {
      assert.match(sql, /id = \$1 AND restaurant_id = \$2/);
      assert.deepEqual(params, [productId, tenant]);
      return { rows: missing === 'product' ? [] : [{ published, available }] };
    }
    if (sql.includes('AS variants')) return { rows: [{ variants: 1, groups: 1 }] };
    if (sql.startsWith('UPDATE public.product_option_groups')) {
      assert.match(sql, /WHERE id = \$1 AND product_id = \$2/);
      assert.deepEqual(params, [groupId, productId, 'Acompanhamentos', true, 1, 2]);
      return { rowCount: missing === 'group' ? 0 : 1 };
    }
    if (sql.startsWith('UPDATE public.product_variants')) {
      assert.match(sql, /WHERE id = \$1 AND product_id = \$2/);
      assert.deepEqual(params, [sizeId, productId, 'Pequena', '18.90', true]);
      return { rowCount: missing === 'size' ? 0 : 1 };
    }
    if (sql.startsWith('UPDATE public.product_variant_group_limits')) {
      assert.deepEqual(params, [sizeId, groupId, 1, 2]);
      return { rowCount: 0 };
    }
    if (sql.startsWith('INSERT INTO public.product_variant_group_limits')) {
      assert.deepEqual(params, [sizeId, groupId, 1, 2]);
      return { rowCount: 1 };
    }
    if (sql.startsWith('UPDATE public.products')) {
      assert.match(sql, /MIN\(price\).*available IS TRUE/);
      assert.deepEqual(params, [productId, tenant, 'Quentinha', null, true, false, null]);
      return { rows: [{ id: productId, price: '18.90' }] };
    }
    return publicationQuery(sql, availableOptions);
  };
}

function publicationQuery(sql, availableOptions) {
  if (sql.startsWith('SELECT 1 FROM public.product_variants')) return { rowCount: 1 };
  if (sql.includes('SELECT id, name, published')) return { rowCount: 1, rows: [{ id: productId, name: 'Quentinha', published: true, price: '18.90' }] };
  if (sql.includes('SELECT id, name, price')) return { rowCount: 1, rows: [{ id: sizeId, name: 'Pequena', price: '18.90' }] };
  if (sql.includes('COUNT(po.id)')) return { rowCount: 1, rows: [{ id: groupId, name: 'Acompanhamentos', required: true, min_select: 1, max_select: 2, available_options: availableOptions }] };
  if (sql.includes('SELECT po.name')) return { rows: [{ name: 'Farofa', additional_price: '0.00' }] };
  if (sql.includes('FROM public.product_variant_group_limits')) {
    return { rows: [{ variant_id: sizeId, group_id: groupId, min_select: 1, max_select: 2, variant_product_id: productId, group_product_id: productId }] };
  }
  assert.fail(`Unexpected SQL ${sql}`);
}

test('draft edit saves existing structure, inserts a missing limit, derives the base price and commits', async () => {
  const { editor, trace } = harness(editorQuery());
  const updated = await editor.execute(tenant, productId, parseConfiguredProduct(payload()));
  assert.equal(updated.price, '18.90');
  assert.deepEqual(trace.slice(-2), ['COMMIT', 'release']);
  assert.equal(trace.some(sql => sql.includes('INSERT INTO public.product_option_groups')), false);
});

test('a foreign product, group or size aborts the transaction before updating the base price', async () => {
  for (const missing of ['product', 'group', 'size']) {
    const { editor, trace } = harness(editorQuery({ missing }));
    await assert.rejects(editor.execute(tenant, productId, parseConfiguredProduct(payload())),
      error => error instanceof ProductInputError && error.status === 404);
    assert.deepEqual(trace.slice(-2), ['ROLLBACK', 'release']);
    assert.equal(trace.some(sql => sql.startsWith('UPDATE public.products')), false);
  }
});

test('published configuration only commits when it can still satisfy the required choices', async () => {
  for (const availableOptions of [0, 1]) {
    const { editor, trace } = harness(editorQuery({ published: true, availableOptions }));
    const write = editor.execute(tenant, productId, parseConfiguredProduct(payload()));
    if (availableOptions === 0) {
      await assert.rejects(write, error => error.status === 422 && error.details[0].includes('Acompanhamentos'));
    } else {
      await write;
    }
    assert.deepEqual(trace.slice(-2), [availableOptions ? 'COMMIT' : 'ROLLBACK', 'release']);
  }
});

test('rejects malformed prices, inconsistent limits, duplicate IDs and zero active sizes', () => {
  for (const mutate of [
    body => { body.variants[0].price = '18.901'; },
    body => { body.variants[0].price = '-1'; },
    body => { body.variants[0].price = '1e3'; },
    body => { body.groups[0].maxSelect = 0; },
    body => { body.variants[0].groupLimits[0].minSelect = 0; },
    body => { body.variants[0].groupLimits[0].maxSelect = 101; },
    body => { body.variants[0].groupLimits = []; },
    body => { body.groups.push(body.groups[0]); },
    body => { body.variants[0].available = false; },
  ]) {
    const input = payload();
    mutate(input);
    assert.throws(() => parseConfiguredProduct(input), ProductInputError);
  }
});

test('create option accepts free and paid amounts under the authenticated product lock', async () => {
  for (const additionalPrice of [0, 0.29]) {
    const { createOption, trace } = harness((sql, params) => {
      if (sql.includes('FOR UPDATE OF p')) {
        assert.match(sql, /g.id = \$1 AND p.restaurant_id = \$2/);
        assert.deepEqual(params, [groupId, tenant]);
        return { rowCount: 1 };
      }
      assert.match(sql, /INSERT INTO public.product_options/);
      assert.deepEqual(params, [groupId, 'Farofa', additionalPrice]);
      return { rows: [{ id: optionId }] };
    });
    assert.equal((await createOption.execute({ restaurantId: tenant, groupId, name: ' Farofa ', additionalPrice })).id, optionId);
    assert.deepEqual(trace.slice(-2), ['COMMIT', 'release']);
  }
  assert.throws(() => optionPrice.validateOptionPrice(0.291), ProductInputError);
});

test('foreign option and group IDs never lead to a write', async () => {
  const { editOption, createOption, trace } = harness((sql, params) => {
    assert.match(sql, /FOR UPDATE OF p/);
    assert.equal(params[1], tenant);
    return { rowCount: 0, rows: [] };
  });
  assert.equal(await editOption.execute({ restaurantId: tenant, optionId, available: false }), null);
  await assert.rejects(createOption.execute({ restaurantId: tenant, groupId, name: 'Farofa' }), error => error.status === 404);
  assert.equal(trace.some(sql => /^(INSERT|UPDATE)/.test(sql)), false);
});

test('deactivating the last required option of a published product rolls back', async () => {
  const { editOption, trace } = harness((sql, params) => {
    if (sql.includes('FOR UPDATE OF p')) return { rows: [{ id: productId, name: 'Quentinha', published: true, price: '18.90' }] };
    if (sql.startsWith('UPDATE public.product_options')) {
      assert.deepEqual(params, [optionId, productId, 'Farofa', 0, false]);
      return { rows: [{ id: optionId }] };
    }
    return publicationQuery(sql, 0);
  });
  await assert.rejects(editOption.execute({
    restaurantId: tenant, optionId, name: 'Farofa', additionalPrice: 0, available: false,
  }), error => error.status === 422);
  assert.deepEqual(trace.slice(-2), ['ROLLBACK', 'release']);
});

test('reactivating a published product preserves publication and validates its configuration', async () => {
  const { editor, trace } = harness(editorQuery({ published: true, available: false }));
  const result = await editor.execute(tenant, productId, parseConfiguredProduct(payload()));
  assert.equal(result.id, productId);
  assert.deepEqual(trace.slice(-2), ['COMMIT', 'release']);
  assert.equal(trace.some(sql => sql.includes('SET published')), false);
});

test('an existing draft option can be renamed, made free, deactivated and reactivated', async () => {
  for (const available of [false, true]) {
    const { editOption, trace } = harness((sql, params) => {
      if (sql.includes('FOR UPDATE OF p')) {
        assert.deepEqual(params, [optionId, tenant]);
        return { rows: [{ id: productId, published: false }] };
      }
      assert.match(sql, /UPDATE public.product_options/);
      assert.deepEqual(params, [optionId, productId, 'Farofa nova', 0, available]);
      return { rows: [{ id: optionId, available }] };
    });
    const option = await editOption.execute({
      restaurantId: tenant, optionId, name: 'Farofa nova', additionalPrice: 0, available,
    });
    assert.equal(option.available, available);
    assert.deepEqual(trace.slice(-2), ['COMMIT', 'release']);
  }
});

test('activating an option with an invalid stored price on a published product rolls back', async () => {
  const { editOption, trace } = harness((sql) => {
    if (sql.includes('FOR UPDATE OF p')) return { rows: [{ id: productId, published: true }] };
    if (sql.startsWith('UPDATE public.product_options')) return { rows: [{ id: optionId }] };
    if (sql.includes('SELECT po.name')) return { rows: [{ name: 'Farofa', additional_price: '1.001' }] };
    return publicationQuery(sql, 1);
  });
  await assert.rejects(editOption.execute({ restaurantId: tenant, optionId, available: true }),
    error => error.status === 422);
  assert.deepEqual(trace.slice(-2), ['ROLLBACK', 'release']);
});
