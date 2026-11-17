const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, mocks={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
  }).outputText,{exports,Buffer,require(name){assert.ok(name in mocks,`Unexpected dependency ${name}`);return mocks[name];}});
  return exports;
}
const A='00000000-0000-4000-8000-000000000001', B='00000000-0000-4000-8000-000000000002';
const productId='00000000-0000-4000-8000-000000000010';
const variantId='00000000-0000-4000-8000-000000000011', groupId='00000000-0000-4000-8000-000000000012';
const root='src/service/privateTemplates/';
const validation=load('src/service/product/productValidation.ts');
const configured=load('src/service/productTemplates/configuredProductInput.ts',{'../product/productValidation':validation});
const money=load('src/service/order/orderValidation.ts');
function source(published=false) {return {
  product:{id:productId,restaurant_id:A,name:'Quentinha',description:'Produto',published,price:'20.00'},
  variants:[{id:variantId,name:'P',price:'20.00',available:true,groupLimits:[{groupId,minSelect:0,maxSelect:2}]}],
  groups:[{id:groupId,name:'Extras',required:false,minSelect:0,maxSelect:2,options:[
    {id:'source-option-1',name:'Molho',additionalPrice:0,available:true},
    {id:'source-option-2',name:'Ovo',additionalPrice:2.5,available:true},
  ]}],
};}
function harness(options={}) {
  let state={templates:[],versions:[],products:[source(Boolean(options.published))],children:[],orders:[{id:'old-order',price:'20.00'}]};
  let backup,tenant,sequence=100;
  const trace=[];
  const fresh=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
  const client={async query(sql,params=[]) {
    const p=Array.from(params);trace.push({sql,params:p});
    if(sql==='BEGIN'){backup=structuredClone(state);tenant=undefined;return {rows:[]};}
    if(sql==='ROLLBACK'){state=backup;tenant=undefined;return {rows:[]};}
    if(sql==='COMMIT'){tenant=undefined;return {rows:[]};}
    if(sql.startsWith('SELECT set_config')){assert.equal(p.length,1);tenant=p[0];return {rows:[]};}
    if(sql.includes('pg_catalog.pg_roles')) {
      assert.ok(tenant,'Tenant must be set before role/table checks');
      if(options.missingSchema)throw {code:'42P01'};
      return {rows:[{rolsuper:false,rolbypassrls:false,templates_rls:true,versions_rls:true,...options.security}]};
    }
    assert.ok(tenant,'Private SQL outside tenant transaction');
    if(sql.startsWith('SELECT id FROM public.products')) {
      assert.match(sql,/id = \$1 AND restaurant_id = \$2 FOR UPDATE/);
      return {rows:state.products.filter(row=>row.product.id===p[0]&&row.product.restaurant_id===p[1]).map(row=>({id:row.product.id}))};
    }
    if(sql.startsWith('SELECT t.id')) {
      assert.match(sql,/t.restaurant_id = \$1/);
      return {rows:state.templates.filter(t=>t.restaurant_id===p[0]&&t.restaurant_id===tenant).map(t=>({...t,version:state.versions.find(v=>v.template_id===t.id&&v.active)?.version??null}))};
    }
    if(sql.startsWith('SELECT id, name, description')) {
      assert.match(sql,/id = \$1 AND restaurant_id = \$2 FOR UPDATE/);
      return {rows:state.templates.filter(t=>t.id===p[0]&&t.restaurant_id===p[1]&&t.restaurant_id===tenant)};
    }
    if(sql.startsWith('SELECT version')) {
      assert.match(sql,/template_id = \$1 AND restaurant_id = \$2/);
      return {rows:state.versions.filter(v=>v.template_id===p[0]&&v.restaurant_id===p[1]&&v.restaurant_id===tenant&&(!sql.includes('active = TRUE')||v.active))};
    }
    if(sql.startsWith('INSERT INTO public.restaurant_product_templates')) {
      assert.equal(p[0],tenant);
      const row={id:fresh(),restaurant_id:p[0],name:p[1],description:p[2],active:true};state.templates.push(row);return {rows:[row]};
    }
    if(sql.startsWith('INSERT INTO public.restaurant_product_template_versions')) {
      assert.equal(p[1],tenant);
      if(options.failVersionTwo && p[2]===2) throw {code:'23505'};
      state.versions.push({template_id:p[0],restaurant_id:p[1],version:p[2],configuration:JSON.parse(p[3]),active:true});return {rows:[]};
    }
    if(sql.startsWith('UPDATE public.restaurant_product_template_versions')) {
      assert.match(sql,/template_id = \$1 AND restaurant_id = \$2/);
      for(const v of state.versions)if(v.template_id===p[0]&&v.restaurant_id===p[1]&&v.active)v.active=false;
      return {rows:[]};
    }
    if(sql.startsWith('UPDATE public.restaurant_product_templates')) {
      assert.match(sql,/id = \$1 AND restaurant_id = \$2/);
      const t=state.templates.find(t=>t.id===p[0]&&t.restaurant_id===p[1]);
      if(p.length>2){t.name=p[2];t.description=p[3];}return {rows:t?[t]:[]};
    }
    if(sql.startsWith('DELETE FROM public.restaurant_product_template_versions')) {
      assert.match(sql,/template_id = \$1 AND restaurant_id = \$2/);
      state.versions=state.versions.filter(v=>v.template_id!==p[0]||v.restaurant_id!==p[1]);return {rows:[]};
    }
    if(sql.startsWith('DELETE FROM public.restaurant_product_templates')) {
      assert.match(sql,/id = \$1 AND restaurant_id = \$2/);
      state.templates=state.templates.filter(t=>t.id!==p[0]||t.restaurant_id!==p[1]);return {rows:[]};
    }
    if(sql.startsWith('INSERT INTO public.products')) {
      assert.match(sql,/TRUE, FALSE/);assert.equal(p[0],tenant);
      const product={id:fresh(),restaurant_id:p[0],name:p[1],description:p[2],price:p[3],published:false,available:true};
      state.products.push({product,variants:[],groups:[]});return {rows:[product]};
    }
    if(sql.startsWith('INSERT INTO public.product_')) {
      if(options.failOptions&&sql.includes('product_options'))throw {code:'23503'};
      const row={id:fresh(),sql,params:p};state.children.push(row);return {rows:[row]};
    }
    assert.fail(`Unexpected SQL ${sql}`);
  },release(){trace.push({sql:'release'});}};
  const transaction=load('src/service/product/productTransaction.ts',{'../../database':{pool:{connect:async()=>client}}});
  const privateTx=load(root+'privateTemplateTransaction.ts',{
    '../product/productTransaction':transaction,'../product/productValidation':validation,'../productTemplates/configuredProductInput':configured,
  });
  const snapshots=load(root+'privateTemplateSnapshot.ts',{
    '../product/productValidation':validation,'../productTemplates/configuredProductInput':configured,'../order/orderValidation':money,
    '../productTemplates/GetAdminProductConfigurationService':{GetAdminProductConfigurationService:class {async execute(args,db,exactPrices){
      assert.equal(db,client);assert.equal(exactPrices,true);return plain(state.products.find(row=>row.product.id===args.productId&&row.product.restaurant_id===args.restaurantId));
    }}},
  });
  const services=load(root+'PrivateTemplateService.ts',{'../product/productValidation':validation,'./privateTemplateTransaction':privateTx,'./privateTemplateSnapshot':snapshots});
  const controllers=load('src/controller/privateTemplates/PrivateTemplateController.ts',{
    '../../service/product/productValidation':validation,'../../service/productTemplates/configuredProductInput':configured,'../../service/privateTemplates/PrivateTemplateService':services,
  });
  return {service:new services.PrivateTemplateService(),controller:new controllers.PrivateTemplateController(),trace,snapshots,
    state:()=>state,context:()=>tenant};
}
const metadata={name:'Meu modelo',description:'Privado'};
const res=()=>({statusCode:200,set(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});

test('draft/published products save independent snapshots with options, prices, bounds and no source IDs',async()=>{
  for(const published of [false,true]) {
    const h=harness({published});const saved=await h.service.create(A,productId,metadata);
    const snap=h.state().versions[0].configuration;
    assert.equal(saved.template.version,1);assert.equal(h.state().products[0].product.published,published);
    assert.equal(snap.groups[0].options[0].additionalPrice,'0.00');assert.equal(snap.groups[0].options[1].additionalPrice,'2.50');
    assert.deepEqual(snap.variantGroupLimits,[{variantKey:'v1',groupKey:'g1',minSelect:0,maxSelect:2}]);
    assert.equal(JSON.stringify(snap).includes(productId),false);assert.equal(JSON.stringify(snap).includes(groupId),false);
    h.state().products[0].variants[0].price='50.00';assert.equal(snap.variants[0].price,'20.00');
    assert.equal(h.context(),undefined);
    assert.equal(h.trace[1].sql.includes('set_config'),true);assert.equal(h.trace[2].sql.includes('row_security_active'),true);
  }
});
test('list/get return only owned templates and all foreign operations fail 404 without writes',async()=>{
  const h=harness();const saved=await h.service.create(A,productId,metadata);const id=saved.template.id;
  assert.equal((await h.service.list(A)).length,1);assert.equal((await h.service.list(B)).length,0);
  assert.equal((await h.service.get(A,id)).versions.length,1);
  for(const action of [()=>h.service.get(B,id),()=>h.service.rename(B,id,metadata),()=>h.service.remove(B,id),()=>h.service.copy(B,id,1),()=>h.service.version(B,id,productId,1)]) {
    const before=h.trace.length;await assert.rejects(action(),e=>e.status===404);
    assert.equal(h.trace.slice(before).some(call=>/^(INSERT|UPDATE|DELETE)/.test(call.sql)),false);
  }
});
test('copy materializes entirely fresh IDs and preserves free/paid options and limits',async()=>{
  const h=harness();const saved=await h.service.create(A,productId,metadata);
  const snapshot=plain(h.state().versions[0].configuration);const copied=await h.service.copy(A,saved.template.id,1);
  assert.notEqual(copied.product.id,productId);assert.equal(copied.product.published,false);assert.equal(copied.product.price,'20.00');
  const children=h.state().children;
  assert.equal(children.length,5); // variant, group, 2 options, limit
  assert.ok(children.every(row=>row.id!==variantId&&row.id!==groupId));
  const options=children.filter(row=>row.sql.includes('product_options'));
  assert.deepEqual(options.map(row=>row.params[2]),['0.00','2.50']);
  assert.deepEqual(h.state().versions[0].configuration,snapshot);
});
test('rename and explicit version update preserve old snapshots, product copies and order prices',async()=>{
  const h=harness();const saved=await h.service.create(A,productId,metadata);const id=saved.template.id;
  const copied=await h.service.copy(A,id,1);const before=plain(h.state().versions[0].configuration);
  await h.service.rename(A,id,{name:'Novo nome',description:'Descrição'});
  assert.equal(h.state().products[0].product.name,'Quentinha');assert.equal(h.state().products[1].product.name,'Quentinha');
  h.state().products[0].variants[0].price='30.00';await h.service.version(A,id,productId,1);
  assert.deepEqual(h.state().versions[0].configuration,before);assert.equal(h.state().versions[0].active,false);
  assert.equal(h.state().versions[1].version,2);assert.equal(h.state().versions[1].configuration.variants[0].price,'30.00');
  assert.equal(copied.product.price,'20.00');assert.equal(h.state().orders[0].price,'20.00');
  await assert.rejects(h.service.version(A,id,productId,1),e=>e.status===409);
  await assert.rejects(h.service.copy(A,id,1),e=>e.status===409);
  assert.equal(h.state().versions.length,2);
});
test('template deletion removes only its versions and preserves existing products and orders',async()=>{
  const h=harness();const saved=await h.service.create(A,productId,metadata);await h.service.copy(A,saved.template.id,1);
  const products=plain(h.state().products),orders=plain(h.state().orders);await h.service.remove(A,saved.template.id);
  assert.equal(h.state().templates.length,0);assert.equal(h.state().versions.length,0);
  assert.deepEqual(h.state().products,products);assert.deepEqual(h.state().orders,orders);
});
test('failed version insertion rolls back deactivation of the previous version',async()=>{
  const h=harness({failVersionTwo:true});const saved=await h.service.create(A,productId,metadata);
  const before=plain(h.state());await assert.rejects(h.service.version(A,saved.template.id,productId,1));
  assert.deepEqual(h.state(),before);assert.equal(h.state().versions[0].active,true);
});
test('snapshot capture preserves exact decimal option prices without floating-point conversion',async()=>{
  const h=harness();h.state().products[0].groups[0].options[1].additionalPrice='9007199254740993.99';
  await h.service.create(A,productId,metadata);
  assert.equal(h.state().versions[0].configuration.groups[0].options[1].additionalPrice,'9007199254740993.99');
});
test('copy failure rolls back all newly inserted dependencies',async()=>{
  const h=harness({failOptions:true});const saved=await h.service.create(A,productId,metadata);const before=plain(h.state());
  await assert.rejects(h.service.copy(A,saved.template.id,1));assert.deepEqual(h.state(),before);
  assert.deepEqual(h.trace.slice(-2).map(x=>x.sql),['ROLLBACK','release']);
});
test('private operations fail closed for missing migration, bypass roles and inactive RLS',async()=>{
  for(const options of [{missingSchema:true},{security:{rolsuper:true}},{security:{rolbypassrls:true}},{security:{templates_rls:false}},{security:{versions_rls:false}}]) {
    const h=harness(options);await assert.rejects(h.service.list(A),e=>e.status===503);
    assert.equal(h.trace.some(call=>call.sql.startsWith('SELECT t.id')),false);assert.equal(h.context(),undefined);
  }
});
test('snapshot validation rejects foreign keys, duplicate local keys, invalid limits and prices',async()=>{
  const h=harness();await h.service.create(A,productId,metadata);const valid=h.state().versions[0].configuration;
  for(const mutate of [x=>{x.schemaVersion=2;},x=>{x.variantGroupLimits[0].groupKey='foreign';},x=>{x.variants.push(x.variants[0]);},
    x=>{x.groups[0].options[0].additionalPrice='-1';},x=>{x.variantGroupLimits[0].minSelect=3;},x=>{x.variants[0].available=false;}]) {
    const invalid=plain(valid);mutate(invalid);assert.throws(()=>h.snapshots.parsePrivateSnapshot(invalid));
  }
});
test('controllers require admin identity, validate payload and ignore spoofed restaurant IDs',async()=>{
  const h=harness();for(const method of ['list','get','create','rename','version','remove','copy']) {
    const result=res();await h.controller[method]({params:{},body:{}},result);assert.equal(result.statusCode,401);
  }
  const invalid=res();await h.controller.create({user_id:A,body:{productId:'bad',...metadata}},invalid);assert.equal(invalid.statusCode,400);
  const created=res();await h.controller.create({user_id:A,body:{productId,...metadata,restaurantId:B}},created);
  assert.equal(created.statusCode,201);assert.equal(h.state().templates[0].restaurant_id,A);
  const badVersion=res();await h.controller.copy({user_id:A,body:{templateId:created.body.template.id,expectedVersion:0}},badVersion);assert.equal(badVersion.statusCode,400);
});
test('all private Express routes require administrative middleware and globals remain registered',()=>{
  const routes=fs.readFileSync('src/routes.ts','utf8');
  for(const method of ['get','post','patch','delete'])assert.match(routes,new RegExp(`router\\.${method}\\("/products/templates/private(?:/:templateId)?", isAuthentication,`));
  assert.match(routes,/router.post\("\/products\/templates\/private\/:templateId\/versions", isAuthentication,/);
  assert.match(routes,/router.post\("\/products\/from-private-template", isAuthentication,/);
  assert.match(routes,/"\/products\/templates",\s*isAuthentication,/);
});

test('shared option getter exposes exact decimals only when snapshot capture requests them',async()=>{
  const client={async query(sql,params){
    assert.match(sql,/p.restaurant_id = \$2/);assert.deepEqual(Array.from(params),[productId,A]);
    return {rows:[{group_id:groupId,group_name:'Extras',required:false,min_select:0,max_select:2,
      option_id:'option-id',option_name:'Ovo',additional_price:'9007199254740993.99',available:true}]};
  }};
  const {ListProductOptionsService}=load('src/service/productOptions/ListProductOptionsService.ts',{'../../database':{pool:{query(){assert.fail('Snapshot escaped its transaction');}}}});
  const exact=await new ListProductOptionsService().execute({productId,restaurantId:A},client,true);
  assert.equal(exact[0].options[0].additionalPrice,'9007199254740993.99');
  const legacy=await new ListProductOptionsService().execute({productId,restaurantId:A},client);
  assert.equal(typeof legacy[0].options[0].additionalPrice,'number');
});
