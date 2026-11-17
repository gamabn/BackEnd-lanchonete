const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Buffer, require: name => { assert.ok(name in mocks, name); return mocks[name]; }, console: { log() {}, error() {} } });
  return exports;
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } });
const validation = load('src/service/product/productValidation.ts', {});
const productFields = { name: ' Name ', description: ' Description ', price: '12,50' };
const image = { mimetype: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') };

test('simple product fields reject malformed prices, empty text and disguised images', () => {
  assert.equal(validation.validateProductFields(productFields).price, '12.50');
  for (const price of ['0', '1e3', '0xA', '1.001', 'NaN', ['10']]) {
    assert.throws(() => validation.validateProductFields({ ...productFields, price }), validation.ProductInputError);
  }
  for (const description of ['   ', 'text\0', ['text']]) {
    assert.throws(() => validation.validateProductFields({ ...productFields, description }), validation.ProductInputError);
  }
  assert.doesNotThrow(() => validation.validateProductImage(image));
  assert.throws(() => validation.validateProductImage({ ...image, buffer: Buffer.from('<svg/>') }), validation.ProductInputError);
  assert.throws(() => validation.validateProductImage({ ...image, buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }),
    error => error.status === 413);
});

test('simple create validates before upload and writes only the JWT restaurant', async () => {
  const writes = [];
  const { CreateProductService } = load('src/service/product/CreateProductService.ts', {
    './productValidation': validation,
    '../../database': { pool: { async query(sql, params) {
      assert.doesNotMatch(sql, /published|available/);
      writes.push(Array.from(params));
      return { rows: [{ id: 'created' }] };
    } } },
  });
  let uploads = 0;
  const { CreateProductController } = load('src/controller/product/CreateProductController.ts', {
    '../../service/product/CreateProductService': { CreateProductService },
    '../../service/product/productValidation': validation,
    '../../service/product/productImages': { async uploadProductImage() {
      uploads++;
      return { secure_url: 'https://image', public_id: 'created-image' };
    } },
  });
  const controller = new CreateProductController();
  const req = { user_id: 'A', body: { ...productFields, restaurant_id: 'B' } };
  const invalid = response();
  await controller.handle(req, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(uploads, 0);
  const valid = response();
  await controller.handle({ ...req, file: image }, valid);
  assert.equal(valid.body.id, 'created');
  assert.deepEqual(writes, [['Name', 'Description', '12.50', 'https://image', 'created-image', 'A', null]]);
});

function editController(service, images) {
  const { EditProductController } = load('src/controller/product/EditProductController.ts', {
    '../../service/product/EditProductService': { EditProductService: service },
    '../../service/product/productValidation': validation,
    '../../service/product/productImages': images,
  });
  return new EditProductController();
}

test('product edit denies another tenant before touching Cloudinary', async () => {
  const controller = editController(class {
    async findOwned(id, tenant) { assert.equal(id, 'product-b'); assert.equal(tenant, 'A'); }
    async execute() { assert.fail('Unauthorized update'); }
  }, { uploadProductImage: async () => assert.fail('Unauthorized upload') });
  const res = response();
  await controller.handle({ user_id: 'A', body: { ...productFields, product_id: 'product-b', restaurant_id: 'B' }, file: image }, res);
  assert.equal(res.statusCode, 404);
});

for (const conflict of [false, true]) {
  test(`image replacement cleans up ${conflict ? 'the uncommitted upload on conflict' : 'the owned old image after persistence'}`, async () => {
    const calls = [];
    const controller = editController(class {
      async findOwned() { return { public_id: 'owned-image' }; }
      async execute(data) {
        assert.equal(data.restaurant_id, 'A');
        assert.equal(data.expectedPublicId, 'owned-image');
        assert.equal(data.public_id, 'new-id');
        calls.push('write');
        return conflict ? undefined : data;
      }
    }, {
      async uploadProductImage() { calls.push('upload'); return { secure_url: 'new', public_id: 'new-id' }; },
      async removeUnreferencedProductImage(id) { calls.push(id); },
    });
    const res = response();
    await controller.handle({
      user_id: 'A',
      body: { ...productFields, product_id: 'own', restaurant_id: 'B', old_public_id: 'foreign' },
      file: image,
    }, res);
    assert.equal(res.statusCode, conflict ? 409 : 200);
    assert.deepEqual(calls, ['upload', 'write', conflict ? 'new-id' : 'owned-image']);
  });
}

test('definite database rejection cleans a new unused image and keeps referenced or uncertain images', async () => {
  const removed = [];
  const { handleFailedProductImageWrite, removeUnreferencedProductImage } = load('src/service/product/productImages.ts', {
    'node:crypto': require('node:crypto'),
    '../../database': { pool: { async query(_sql, [id]) { return { rowCount: id === 'shared' ? 1 : 0 }; } } },
    '../../lib/cloudinaryUploader': { async deleteFromCloudinary(id) { removed.push(id); } },
  });
  await handleFailedProductImageWrite('new-id', { code: '23514' });
  await handleFailedProductImageWrite('unknown', { code: 'ECONNRESET' });
  await removeUnreferencedProductImage('shared');
  assert.deepEqual(removed, ['new-id']);
});

test('product edit and delete SQL scope the product ID and authenticated tenant', async () => {
  const { DeleteProductService } = load('src/service/product/DeleteProductService.ts', {
    './productTransaction': { productTransaction: async fn => fn({ query: async (sql, params) => {
      assert.match(sql, /WHERE id = \$1 AND restaurant_id = \$2/); assert.deepEqual(Array.from(params), ['product-b', 'A']); return { rows: [] };
    } }) },
    './productValidation': { ProductInputError: class extends Error {} },
  });
  assert.equal(await new DeleteProductService().execute('product-b', 'A'), undefined);
  const { EditProductService } = load('src/service/product/EditProductService.ts', { './productValidation': validation, '../../database': { pool: { query: async (sql, params) => {
    assert.match(sql, /WHERE id = \$6 AND restaurant_id = \$7/);
    assert.match(sql, /image_url = COALESCE\(\$4, image_url\)/);
    assert.match(sql, /public_id IS NOT DISTINCT FROM \$8/);
    assert.deepEqual(Array.from(params.slice(5)), ['product-b', 'A', null]);
    return { rows: [] };
  } } } });
  assert.equal(await new EditProductService().execute({ product_id: 'product-b', restaurant_id: 'A', expectedPublicId: null }), undefined);
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
    assert.doesNotMatch(sql, /SELECT \*|public_id|password|token/); assert.match(sql, /FROM public\.products p/); assert.match(sql, /WHERE p\.restaurant_id = \$1/); assert.deepEqual(Array.from(params), ['A']); return { rows: [] };
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
  assert.match(routes, /router\.delete\(\s*"\/client\/delete",\s*isAuthentication,/);
  assert.match(routes, /"\/user\/delete",\s*isAuthentication,/);
});

test('configuration admin scopes all queries and returns draft with inactive sizes and options', async () => {
  const productId = '00000000-0000-4000-8000-000000000010';
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push(sql);
      assert.deepEqual(Array.from(params), [productId, 'owner-A']);
      assert.match(sql, /id = \$1\s+AND (?:p\.)?restaurant_id = \$2/);
      if (sql.includes('FROM public.product_variants')) {
        assert.match(sql, /g\.product_id = v\.product_id/);
        return { rows: [{ id: 'small', available: false, groupLimits: [{ groupId: 'extras', minSelect: 0, maxSelect: 2 }] }] };
      }
      if (sql.includes('LEFT JOIN public.product_options')) {
        return { rows: [
          { group_id: 'extras', group_name: 'Extras', option_id: 'bacon', available: false, additional_price: '1.50' },
          { group_id: 'other', group_name: 'Other', option_id: null },
        ] };
      }
      return { rows: [{ id: productId, published: false, available: null }] };
    },
  };
  const options = load('src/service/productOptions/ListProductOptionsService.ts', { '../../database': { pool } });
  const service = load('src/service/productTemplates/GetAdminProductConfigurationService.ts', {
    '../../database': { pool }, '../productOptions/ListProductOptionsService': options,
  });
  const { GetAdminProductConfigurationController } = load('src/controller/productTemplates/GetAdminProductConfigurationController.ts', {
    '../../service/productTemplates/GetAdminProductConfigurationService': service,
  });
  const res = response();
  await new GetAdminProductConfigurationController().handle({
    user_id: 'owner-A', params: { productId }, query: { restaurantId: 'owner-B' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.product.published, false);
  assert.equal(res.body.variants[0].available, false);
  assert.equal(res.body.variants[0].groupLimits[0].groupId, 'extras');
  assert.equal(res.body.groups[0].options[0].available, false);
  assert.equal(res.body.groups[0].options[0].additionalPrice, 1.5);
  assert.equal(res.body.groups[1].options.length, 0);
  assert.equal(calls.length, 3);
});

test('configuration admin returns 404 without reading related records for a non-owned or missing product', async () => {
  const productId = '00000000-0000-4000-8000-000000000011';
  let queries = 0;
  const service = load('src/service/productTemplates/GetAdminProductConfigurationService.ts', {
    '../../database': { pool: { async query(sql, values) {
      queries++;
      assert.match(sql, /FROM public.products/);
      assert.deepEqual(Array.from(values), [productId, 'owner-A']);
      return { rows: [] };
    } } },
    '../productOptions/ListProductOptionsService': { ListProductOptionsService: class {
      execute() { assert.fail('Read options of a missing or foreign product'); }
    } },
  });
  const { GetAdminProductConfigurationController } = load('src/controller/productTemplates/GetAdminProductConfigurationController.ts', {
    '../../service/productTemplates/GetAdminProductConfigurationService': service,
  });
  const res = response();
  await new GetAdminProductConfigurationController().handle({ user_id: 'owner-A', params: { productId } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(queries, 1);
  const routes = fs.readFileSync('src/routes.ts', 'utf8');
  assert.match(routes, /router\.get\(\s*"\/products\/:productId\/admin-configuration",\s*isAuthentication,/);
  assert.match(routes, /router\.get\(\s*"\/products\/templates",\s*isAuthentication,/);
});

test('template creation stores the authenticated restaurant and explicitly keeps the product unpublished', async () => {
  const statements = [];
  const { CreateProductFromTemplateService } = load('src/service/productTemplates/CreateProductFromTemplateService.ts', { '../product/productValidation': validation,
    '../../database': { pool: { async connect() {
      return {
        release() { statements.push('release'); },
        async query(sql, params) {
          statements.push(sql);
          if (sql.includes('FROM public.restaurants')) {
            assert.equal(params[0], 'owner-A');
            return { rowCount: 1 };
          }
          if (sql.includes('FROM public.product_templates')) {
            assert.equal(params[0], 'pizza');
            return { rowCount: 1, rows: [{ version: 1, configuration: {
              name: 'Pizza', variants: [{ name: 'P', price: 12 }],
              optionGroups: [{ name: 'Sabores', required: true, minSelect: 1, maxSelect: 1, options: [] }],
              variantGroupLimits: { P: { Sabores: { min: 1, max: 1 } } },
            } }] };
          }
          if (sql.includes('INSERT INTO public.products')) {
            assert.match(sql, /available, published, category\)\s+VALUES \(\$1, \$2, \$3, \$4, TRUE, FALSE, \$5\)/);
            assert.deepEqual(Array.from(params), ['owner-A', 'Pizza', null, 12, null]);
            return { rows: [{ id: 'draft', published: false }] };
          }
          return { rows: [{ id: 'child' }] };
        },
      };
    } } },
  });
  const result = await new CreateProductFromTemplateService().execute({ restaurantId: 'owner-A', templateSlug: 'pizza' });
  assert.equal(result.product.id, 'draft');
  assert.equal(result.product.published, false);
  assert.equal(result.variantsCreated, 1);
  assert.equal(result.groupsCreated, 1);
  assert.ok(statements.some(sql => sql.includes('INSERT INTO public.product_variant_group_limits')));
  assert.deepEqual(statements.slice(-2), ['COMMIT', 'release']);
});

test('configured image-only edits retain the Phase 1 ownership and cleanup checks without requiring a manual price', async () => {
  const calls = [];
  const controller = editController(class {
    async findOwned(id, tenant) {
      assert.equal(id, 'configured');
      assert.equal(tenant, 'A');
      return { public_id: 'old-image', has_variants: true };
    }
    async execute(data) {
      calls.push('write');
      assert.equal(data.expectedPublicId, 'old-image');
      assert.equal(data.price, undefined);
      assert.equal(data.image_url, 'https://image');
      return { id: 'configured' };
    }
  }, {
    async uploadProductImage() { calls.push('upload'); return { public_id: 'new-id', secure_url: 'https://image' }; },
    async removeUnreferencedProductImage(id) { calls.push(id); },
  });
  const res = response();
  await controller.handle({
    user_id: 'A',
    body: { product_id: 'configured', imageOnly: 'true', price: '0.01', restaurant_id: 'B' },
    file: image,
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, ['upload', 'write', 'old-image']);
});

test('simple edit controller forwards category changes but image-only edits omit it', async () => {
  const writes=[];
  const controller=editController(class {
    async findOwned(){return {public_id:null,has_variants:true};}
    async execute(input){writes.push(input);return input;}
  },{async uploadProductImage(){return {secure_url:'image',public_id:'new'};}});
  for(const category of ['  Bebidas   Frias ',null,' ']){
    const res=response();
    await controller.handle({user_id:'A',body:{...productFields,product_id:'p',restaurant_id:'B',category}},res);
    assert.equal(res.statusCode,200);assert.equal(writes.at(-1).restaurant_id,'A');
    assert.equal(writes.at(-1).category,category===null||category===' '?null:'Bebidas Frias');
  }
  const res=response();
  await controller.handle({user_id:'A',body:{product_id:'p',imageOnly:'true'},file:image},res);
  assert.equal(res.statusCode,200);assert.equal(writes.at(-1).category,undefined);
});

test('global copy controller validates category and uses the JWT tenant',async()=>{
  const calls=[];
  const {CreateProductFromTemplateController}=load('src/controller/productTemplates/CreateProductFromTemplateController.ts',{
    '../../service/product/productValidation':validation,
    '../../service/productTemplates/CreateProductFromTemplateService':{
      ProductTemplateError:class extends Error {},
      CreateProductFromTemplateService:class {async execute(input){calls.push(input);return {product:{category:input.category}};}}
    }
  });
  const controller=new CreateProductFromTemplateController(),res=response();
  await controller.handle({user_id:'A',body:{restaurantId:'B',templateSlug:' beverage ',category:' Bebidas '}},res);
  assert.equal(res.statusCode,201);assert.equal(calls[0].restaurantId,'A');assert.equal(calls[0].category,'Bebidas');
  const bad=response();await controller.handle({user_id:'A',body:{templateSlug:'beverage',category:42}},bad);
  assert.equal(bad.statusCode,400);assert.equal(calls.length,1);
});
