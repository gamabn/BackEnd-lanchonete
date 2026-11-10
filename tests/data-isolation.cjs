const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => { assert.ok(name in mocks, name); return mocks[name]; }, console: { log() {}, error() {} } });
  return exports;
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } });
test('product edit uses JWT owner, denies another tenant before touching Cloudinary', async () => {
  let uploads = 0;
  const { EditProductController } = load('src/controller/product/EditProductController.ts', {
    '../../service/product/EditProductService': { EditProductService: class {
      async findOwned(id, tenant) { assert.equal(id, 'product-b'); assert.equal(tenant, 'A'); return undefined; }
      async execute() { assert.fail('Unauthorized update'); }
    } }, '../../lib/cloudinaryUploader': { updateCloudinaryImage: async () => { uploads++; } },
  });
  const res = response();
  await new EditProductController().handle({ user_id: 'A', body: { product_id: 'product-b', restaurant_id: 'B', old_public_id: 'image-b', name: 'Name', description: 'Description', price: '10' }, file: { buffer: 'file' } }, res);
  assert.equal(res.statusCode, 404); assert.equal(uploads, 0);
});
test('product image ID comes from the owned persisted record instead of the request', async () => {
  const { EditProductController } = load('src/controller/product/EditProductController.ts', {
    '../../service/product/EditProductService': { EditProductService: class {
      async findOwned(id, tenant) { assert.equal(tenant, 'A'); return { public_id: 'owned-image' }; }
      async execute(data) { assert.equal(data.restaurant_id, 'A'); return data; }
    } }, '../../lib/cloudinaryUploader': { updateCloudinaryImage: async id => { assert.equal(id, 'owned-image'); return { url: 'new', public_id: 'new-id' }; } },
  });
  const res = response();
  await new EditProductController().handle({ user_id: 'A', body: { product_id: 'own', restaurant_id: 'B', old_public_id: 'foreign', name: 'N', description: 'D', price: '5' }, file: { buffer: 'file' } }, res);
  assert.equal(res.statusCode, 200);
});
test('product edit and delete SQL scope the product ID and authenticated tenant', async () => {
  const { DeleteProductService } = load('src/service/product/DeleteProductService.ts', { '../../database': { pool: { query: async (sql, params) => {
    assert.match(sql, /WHERE id = \$1 AND restaurant_id = \$2/); assert.deepEqual(Array.from(params), ['product-b', 'A']); return { rowCount: 0 };
  } } } });
  assert.equal(await new DeleteProductService().execute('product-b', 'A'), undefined);
  let calls = 0;
  const { EditProductService } = load('src/service/product/EditProductService.ts', { '../../database': { pool: { query: async (sql, params) => {
    calls++;
    if (/^SELECT/.test(sql)) {
      assert.match(sql, /WHERE id = \$1 AND restaurant_id = \$2/); assert.equal(params[1], 'A');
      return { rows: [{ name: 'N', description: 'D', price: 10 }] };
    }
    assert.match(sql, /WHERE id = \$6 AND restaurant_id = \$7/); assert.equal(params[6], 'A'); return { rows: [] };
  } } } });
  assert.equal(await new EditProductService().execute({ product_id: 'product-b', restaurant_id: 'A' }), undefined); assert.equal(calls, 2);
});
test('bairro edit/delete enforce lanchonete_id; public list excludes orphaned establishments', async () => {
  const { bairroService } = load('src/service/bairro/bairroService.ts', { '../../database': { pool: { query: async (sql, params) => {
    if (/UPDATE/.test(sql)) { assert.match(sql, /lanchonete_id = \$4/); assert.equal(params[3], 'A'); }
    if (/DELETE/.test(sql)) { assert.match(sql, /lanchonete_id = \$2/); assert.equal(params[1], 'A'); }
    if (/SELECT id, bairro/.test(sql)) { assert.match(sql, /lanchonete_id = \$1 AND EXISTS/); assert.equal(params[0], 'A'); }
    return { rows: [] };
  } } } });
  const service = new bairroService();
  assert.equal(await service.edit('bairro-b', 'X', 1, 'A'), undefined);
  assert.equal(await service.DeletarBairro('bairro-b', 'A'), undefined);
  assert.equal((await service.getBairro('A')).length, 0);
});
test('image upload cannot target another establishment before external upload', async () => {
  const { ImageStoreController } = load('src/controller/user/ImageStoreController.ts', {
    '../../service/user/ImageStoreService': { ImageStorageService: class { async execute() { assert.fail('Foreign update'); } } },
    '../../lib/cloudinaryUploader': { uploadToCloudinary: async () => assert.fail('Foreign upload') },
  });
  const res = response();
  await new ImageStoreController().handle({ user_id: 'A', params: { id: 'B' }, file: { buffer: 'file' } }, res);
  assert.equal(res.statusCode, 403);
});
test('profile and status SQL return explicit safe fields scoped to the authenticated ID', async () => {
  for (const [file, name] of [['EditStoreService.ts', 'EditStoreService'], [' EditStatusService.ts', 'EditStatusService']]) {
    const { [name]: Service } = load(`src/service/user/${file}`, { '../../database': { pool: { query: async (sql, params) => {
      assert.match(sql, /WHERE id = \$\d/); assert.equal(params.at(-1), 'A');
      const returning = sql.split('RETURNING')[1]; assert.ok(returning); assert.doesNotMatch(returning, /\*|password|token|credential/);
      return { rows: [{ id: 'A', status: true }] };
    } } } });
    assert.equal((await new Service().execute({ id: 'A', status: true })).id, 'A');
  }
});
test('public product SQL returns only explicit menu fields for the requested establishment', async () => {
  const { GetProductIdService } = load('src/service/product/GetProductIdService.ts', { '../../database': { pool: { query: async (sql, params) => {
    assert.doesNotMatch(sql, /SELECT \*|public_id|password|token/); assert.match(sql, /WHERE restaurant_id = \$1/); assert.equal(params[0], 'A'); return { rows: [] };
  } } } });
  assert.equal((await new GetProductIdService().execute('A')).length, 0);
});
test('signup image targets only the newly created establishment and preserves JSON signup', async () => {
  const updated = [];
  const { CreateUserController } = load('src/controller/user/CreateStoreController.ts', {
    '../../service/user/CreateStoreService': { CreateStoreService: class { async execute() { return { id: 'new-store' }; } } },
    '../../service/user/ImageStoreService': { ImageStorageService: class { async execute(id, url) { updated.push({ id, url }); return { id, image_url: url }; } } },
    '../../lib/cloudinaryUploader': { uploadToCloudinary: async () => ({ url: 'uploaded-image' }) },
  });
  const imageResponse = response();
  await new CreateUserController().handle({ body: { id: 'foreign-store' }, file: { buffer: 'image' } }, imageResponse);
  assert.equal(updated[0].id, 'new-store'); assert.equal(imageResponse.body.id, 'new-store');
  const jsonResponse = response();
  await new CreateUserController().handle({ body: {} }, jsonResponse);
  assert.equal(jsonResponse.body.id, 'new-store'); assert.equal(updated.length, 1);
});
test('customer deletion is scoped to the authenticated establishment, including the legacy alias', async () => {
  const { DeleteClientService } = load('src/service/clients/DeleteClientService.ts', { '../../database': { pool: { query: async (sql, params) => {
    assert.match(sql, /WHERE id = \$1 AND restaurant_id = \$2/); assert.deepEqual(Array.from(params), ['customer-b', 'A']); return { rows: [] };
  } } } });
  assert.equal(await new DeleteClientService().execute('customer-b', 'A'), undefined);
  const routes = fs.readFileSync('src/routes.ts', 'utf8');
  assert.match(routes, /router.delete\("\/client\/delete", isAuthentication,/);
  assert.match(routes, /"\/user\/delete",\s*isAuthentication,/);
});
