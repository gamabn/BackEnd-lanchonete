const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const express = require('express');
const jwt = require('jsonwebtoken');
function load(file, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports, console, Buffer, require: name => {
    assert.ok(name in mocks, `Unexpected import ${name}`); return mocks[name];
  }, ...globals });
  return exports;
}
const id = '00000000-0000-4000-8000-000000000010';
const foreign = '00000000-0000-4000-8000-000000000020';
const missing = '00000000-0000-4000-8000-000000000030';
const secret = 'isolated-test-secret';
const validation = load('src/service/product/productValidation.ts', {});
const input = load('src/service/productTemplates/configuredProductInput.ts', { '../product/productValidation': validation });
const body = {
  name: 'Produto', available: true, description: '',
  groups: [{ id, name: 'Grupo', required: true, minSelect: 1, maxSelect: 2 }],
  variants: [{ id, name: 'P', price: '20.00', available: true,
    groupLimits: [{ groupId: id, minSelect: 1, maxSelect: 2 }] }],
};
function harness() {
  const calls = [];
  const getService = load('src/service/productTemplates/GetAdminProductConfigurationService.ts', {
    '../../database': { pool: { async query(sql, params) {
      calls.push({ sql, params: Array.from(params) });
      assert.equal(params[1], 'restaurant-A');
      if (sql.includes('FROM public.products')) {
        assert.match(sql, /WHERE id = \$1 AND restaurant_id = \$2/);
        return { rows: params[0] === id ? [{ id, restaurant_id: 'restaurant-A' }] : [] };
      }
      assert.match(sql, /p.id = \$1 AND p.restaurant_id = \$2/);
      return { rows: [{ id, groupLimits: [] }] };
    } } },
    '../productOptions/ListProductOptionsService': { ListProductOptionsService: class { async execute(args) {
      assert.equal(args.restaurantId, 'restaurant-A'); return [];
    } } },
  });
  const get = load('src/controller/productTemplates/GetAdminProductConfigurationController.ts', {
    '../../service/productTemplates/GetAdminProductConfigurationService': getService,
  });
  const patch = load('src/controller/productTemplates/UpdateConfiguredProductController.ts', {
    '../../service/product/productValidation': validation,
    '../../service/productTemplates/configuredProductInput': input,
    // The existing configured-product-editor suite exercises the real PATCH transaction and ownership SQL.
    '../../service/productTemplates/UpdateConfiguredProductService': { UpdateConfiguredProductService: class {
      async execute(restaurantId, productId, parsed) {
        calls.push({ restaurantId, productId, parsed });
        assert.equal(restaurantId, 'restaurant-A');
        if (productId !== id) throw new validation.ProductInputError('Produto não encontrado.', 404);
        return { id, name: parsed.name };
      }
    } },
  });
  const auth = load('src/middlewares/isAuthentication.ts', { jsonwebtoken: jwt }, { process: { env: { JWT_SECRET: secret } } });
  const mocks = {
    express, multer: Object.assign(() => ({ single: () => (_req, _res, next) => next() }), { memoryStorage: () => ({}) }),
    './middlewares/isAuthentication': auth,
    './controller/productTemplates/GetAdminProductConfigurationController': get,
    './controller/productTemplates/UpdateConfiguredProductController': patch,
  };
  // Inert unrelated imports prevent loading the server, dotenv, or a real database.
  const source = fs.readFileSync('src/routes.ts', 'utf8');
  for (const [, name] of source.matchAll(/from "([^"]+)"/g)) {
    if (!(name in mocks)) mocks[name] = new Proxy({}, { get: () => class {
      constructor() { return new Proxy(this, { get: () => (_req, _res, next) => next() }); }
    } });
  }
  const { router } = load('src/routes.ts', mocks);
  async function request(method, productId = id, token = jwt.sign({}, secret, { subject: 'restaurant-A' }), data = body) {
    const req = { method, url: `/products/${productId}/admin-configuration`, headers: token ? { authorization: `Bearer ${token}` } : {}, body: data };
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(data) { this.body = data; this.finish(); return this; }, end() { this.finish(); return this; } };
    await new Promise((resolve, reject) => {
      res.finish = resolve;
      router.handle(req, res, error => reject(error || new Error('Route not matched')));
    });
    return res;
  }
  return { router, request, calls };
}
test('GET/PATCH are registered once with authentication first', () => {
  const { router } = harness();
  const routes = router.stack.filter(layer => layer.route?.path === '/products/:productId/admin-configuration');
  assert.equal(routes.length, 2);
  assert.deepEqual(routes.map(layer => Object.keys(layer.route.methods)[0]).sort(), ['get', 'patch']);
  for (const layer of routes) assert.equal(layer.route.stack[0].handle.name, 'isAuthentication');
});
test('GET returns the editor contract with restaurant-scoped reads', async () => {
  const h = harness();
  const response = await h.request('GET');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.product.id, id);
  assert.ok(Array.isArray(response.body.variants));
  assert.ok(Array.isArray(response.body.groups));
  assert.equal(h.calls.length, 2);
});
test('PATCH parses editor data and uses the JWT restaurant despite a body override', async () => {
  const h = harness();
  const response = await h.request('PATCH', id, undefined, { ...body, restaurant_id: 'restaurant-B' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.product.id, id);
  assert.equal(h.calls[0].restaurantId, 'restaurant-A');
});
for (const method of ['GET', 'PATCH']) {
  test(`${method} rejects missing/invalid authentication before service access`, async () => {
    const h = harness();
    for (const token of [null, 'invalid']) assert.equal((await h.request(method, id, token)).statusCode, 401);
    assert.equal(h.calls.length, 0);
  });
  test(`${method} returns 404 for foreign and nonexistent products`, async () => {
    const h = harness();
    for (const productId of [foreign, missing]) assert.equal((await h.request(method, productId)).statusCode, 404);
  });
  test(`${method} rejects malformed IDs without service access`, async () => {
    const h = harness();
    assert.equal((await h.request(method, 'invalid')).statusCode, 400);
    assert.equal(h.calls.length, 0);
  });
}
test('PATCH rejects invalid editor data without service access', async () => {
  const h = harness();
  assert.equal((await h.request('PATCH', id, undefined, { ...body, variants: [] })).statusCode, 400);
  assert.equal(h.calls.length, 0);
});
