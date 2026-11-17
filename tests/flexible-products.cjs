const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Buffer, require(name) { assert.ok(name in mocks, `Unexpected dependency ${name}`); return mocks[name]; } });
  return exports;
}
const root = 'src/service/productTemplates/';
const validation = load('src/service/product/productValidation.ts');
const parser = load(root+'configuredProductInput.ts', { '../product/productValidation': validation });
const product = '00000000-0000-4000-8000-000000000010';
const variant = '00000000-0000-4000-8000-000000000011';
const group = '00000000-0000-4000-8000-000000000012';
const added = '00000000-0000-4000-8000-000000000013';
const foreign = '00000000-0000-4000-8000-000000000014';
function harness(options = {}) {
  const trace = [], calls = [], validations = [];
  const client = { async query(sql, params = []) {
    trace.push(sql); calls.push({ sql, params: Array.from(params) });
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT id FROM public.restaurants')) {
      assert.deepEqual(Array.from(params), ['A']); return { rows: options.missingRestaurant ? [] : [{ id: 'A' }] };
    }
    if (sql.startsWith('INSERT INTO public.products')) {
      assert.match(sql, /TRUE, FALSE/); assert.equal(params[0], 'A');
      return { rows: [{ id: product, published: false }] };
    }
    if (sql.startsWith('SELECT published FROM public.products')) {
      assert.match(sql, /id = \$1 AND restaurant_id = \$2 FOR UPDATE/);
      assert.deepEqual(Array.from(params), [product,'A']);
      return { rows: options.foreignProduct ? [] : [{ published: Boolean(options.published) }] };
    }
    if (sql.startsWith('SELECT id, available')) return { rows: options.simple ? [] : [
      { id: variant, available: true }, ...(options.single ? [] : [{ id: added, available: true }]),
    ] };
    if (sql.startsWith('SELECT id, min_select')) return { rows: [{ id: group, min_select: 0, max_select: 2 }] };
    if (sql.startsWith('SELECT 1 FROM public.order')) return { rows: options.history ? [{}] : [] };
    if (sql.includes('IS DISTINCT FROM')) return { rows: options.cross ? [{}] : [] };
    if (sql.startsWith('SELECT 1 FROM public.product_variants')) return { rows: [{}], rowCount: 1 };
    if (sql.startsWith('INSERT INTO')) {
      if (options.insertFail) throw { code: '23505' };
      return { rows: [{ id: added }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE public.products')) {
      assert.match(sql, /MIN\(price\).*available IS TRUE/);
      assert.deepEqual(Array.from(params), [product,'A']);
    }
    return { rows: [], rowCount: 1 };
  }, release() { trace.push('release'); } };
  const transaction = load('src/service/product/productTransaction.ts', { '../../database': { pool: { connect: async () => client } } });
  const guard = load(root+'ensurePublishedProductValid.ts', {
    '../product/productValidation': validation,
    './ValidateProductPublicationService': { ValidateProductPublicationService: class { async execute(args) {
      validations.push(args);
      return { valid: !options.invalidPublished, errors: ['Configuração inválida.'] };
    } } },
  });
  const mocks = { '../product/productTransaction': transaction, '../product/productValidation': validation, './ensurePublishedProductValid': guard };
  const create = load(root+'CreateConfiguredProductService.ts', mocks);
  const structure = load(root+'ChangeConfiguredProductStructureService.ts', mocks);
  const controller = load('src/controller/productTemplates/ConfiguredProductCreationController.ts', {
    '../../service/product/productValidation': validation,
    '../../service/productTemplates/configuredProductInput': parser,
    '../../service/productTemplates/CreateConfiguredProductService': create,
    '../../service/productTemplates/ChangeConfiguredProductStructureService': structure,
  });
  return { create: new create.CreateConfiguredProductService(), structure: new structure.ChangeConfiguredProductStructureService(),
    controller: new controller.ConfiguredProductCreationController(), calls, trace, validations };
}
const initial = { name: 'Meu produto', variantName: 'Tamanho próprio', price: '12,90' };
const change = body => parser.parseStructureChange(body);
function response() { return { statusCode: 200, set() {}, status(code) { this.statusCode=code;return this; }, json(body) { this.body=body;return this; } }; }
test('creation uses only authenticated tenant and saves a draft plus first size atomically', async () => {
  const h = harness(), res = response();
  await h.controller.create({ user_id: 'A', body: { ...initial, restaurant_id: 'B', published: true } }, res);
  assert.equal(res.statusCode,201); assert.equal(res.body.product.published,false);
  const inserts = h.calls.filter(call => call.sql.startsWith('INSERT'));
  assert.deepEqual(inserts[0].params,['A','Meu produto',null,'12.90',null]);
  assert.deepEqual(inserts[1].params,[product,'Tamanho próprio','12.90']);
  assert.deepEqual(h.trace.slice(-2),['COMMIT','release']);
});
test('creation failure rolls back without a partial product', async () => {
  const h=harness({ insertFail:true });
  await assert.rejects(h.create.execute('A',parser.parseNewConfiguredProduct(initial)));
  assert.deepEqual(h.trace.slice(-2),['ROLLBACK','release']);
});
test('missing restaurant blocks creation before inserts', async () => {
  const h=harness({ missingRestaurant:true });
  await assert.rejects(h.create.execute('A',parser.parseNewConfiguredProduct(initial)),e=>e.status===404);
  assert.equal(h.trace.some(sql=>sql.startsWith('INSERT')),false);
});
for(const names of [ ['Pizza','Pequena','Média','Grande','Sabores','Bordas','Adicionais'], ['Hambúrguer','Simples','Duplo','Triplo','Ponto','Queijos','Adicionais'], ['Açaí','300 ml','500 ml','700 ml','Acompanhamentos','Coberturas','Extras'] ]) {
  test(`${names[0]} uses generic names, prices and groups without category rules`,()=>{
    assert.equal(parser.parseNewConfiguredProduct({ name:names[0],variantName:names[1],price:'0' }).price,'0');
    for(const name of names.slice(1,4)) assert.equal(change({action:'addVariant',name,price:'25.50'}).name,name);
    for(const name of names.slice(4)) assert.equal(change({action:'addGroup',name,required:false,minSelect:0,maxSelect:3}).name,name);
  });
}
test('prices, IDs and bounds reject malformed inputs',()=>{
  for(const price of ['-1','1.001','NaN','Infinity','1e3','']) assert.throws(()=>parser.parseNewConfiguredProduct({...initial,price}));
  for(const payload of [null, {action:'removeGroup',id: 'invalid'}, {action:'addGroup',name:'G',required:true,minSelect:0,maxSelect:1},
    {action:'addGroup',name:'G',required:false,minSelect:3,maxSelect:2}, {action:'addGroup',name:'G',required:false,minSelect:0,maxSelect:101}]) assert.throws(()=>change(payload));
});
test('add group creates limits for every size; add size creates limits for every group',async()=>{
  for(const payload of [{action:'addGroup',name:'Extras',required:false,minSelect:0,maxSelect:2},{action:'addVariant',name:'Maior',price:'30'}]) {
    const h=harness();await h.structure.execute('A',product,change(payload));
    const limits=h.calls.filter(call=>call.sql.includes('INSERT INTO public.product_variant_group_limits'));
    assert.equal(limits.length,payload.action==='addGroup'?2:1);
    for(const call of limits) assert.deepEqual(call.params.slice(2),[0,2]);
    assert.deepEqual(h.trace.slice(-2),['COMMIT','release']);
  }
});
test('foreign product or simple product never accepts structural writes',async()=>{
  for(const options of [{foreignProduct:true},{simple:true}]) {
    const h=harness(options);await assert.rejects(h.structure.execute('A',product,change({action:'addVariant',name:'X',price:'10'})));
    assert.equal(h.trace.some(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)),false);
  }
});
test('foreign group and variant IDs cannot be deleted or reassigned',async()=>{
  for(const action of ['removeGroup','removeVariant']) {
    const h=harness();await assert.rejects(h.structure.execute('A',product,change({action,id:foreign})),e=>e.status===404);
    assert.equal(h.trace.some(sql=>sql.startsWith('DELETE')),false);
  }
});
test('group removal deletes limits, options then group; variant removal preserves remaining sizes',async()=>{
  for(const [action,id] of [['removeGroup',group],['removeVariant',variant]]) {
    const h=harness();await h.structure.execute('A',product,change({action,id}));
    const deletes=h.calls.filter(call=>call.sql.startsWith('DELETE'));
    assert.equal(deletes.length,action==='removeGroup'?3:2);
    assert.match(deletes.at(-1).sql,/WHERE id = \$1 AND product_id = \$2/);
    assert.deepEqual(deletes.at(-1).params,[id,product]);
    assert.equal(deletes.some(call=>call.sql.includes('order_items')||call.sql.includes('order_item_options')),false);
  }
});
test('historical references, inconsistent links and last active size prevent removal',async()=>{
  for(const options of [{history:true},{cross:true},{single:true}]) for(const [action,id] of [['removeGroup',group],['removeVariant',variant]]) {
    if(options.single&&action==='removeGroup')continue;
    const h=harness(options);await assert.rejects(h.structure.execute('A',product,change({action,id})),e=>e.status===409);
    assert.equal(h.trace.some(sql=>sql.startsWith('DELETE')),false);
    assert.deepEqual(h.trace.slice(-2),['ROLLBACK','release']);
  }
});
test('published structure must pass the existing publication guard in the same transaction',async()=>{
  const h=harness({published:true,invalidPublished:true});
  await assert.rejects(h.structure.execute('A',product,change({action:'addGroup',name:'G',required:true,minSelect:1,maxSelect:1})),e=>e.status===422);
  assert.equal(h.validations.length,1);assert.equal(h.validations[0].restaurantId,'A');
  assert.deepEqual(h.trace.slice(-2),['ROLLBACK','release']);
});
test('controllers reject missing auth and invalid payload before accessing database; FK/uniqueness errors remain safe',async()=>{
  for(const action of ['create','structure']) {
    const h=harness(),res=response();await h.controller[action]({params:{productId:product},body:initial},res);
    assert.equal(res.statusCode,401);assert.equal(h.trace.length,0);
  }
  const h=harness(),res=response();await h.controller.structure({user_id:'A',params:{productId:product},body:{action:'other'}},res);
  assert.equal(res.statusCode,400);assert.equal(h.trace.length,0);
  const failed=harness({insertFail:true}),conflict=response();
  await failed.controller.structure({user_id:'A',params:{productId:product},body:{action:'addVariant',name:'P',price:'10'}},conflict);
  assert.equal(conflict.statusCode,409);
});
