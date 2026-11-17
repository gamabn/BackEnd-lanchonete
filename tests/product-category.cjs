const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
// All database calls are intercepted. Never loads dotenv or connects to any database.
function modules(query) {
  const cache=new Map();
  const client={query,release(){}};
  function load(file){
    file=path.resolve(file);
    if(file===path.resolve('src/database.ts')) return {pool:{query,connect:async()=>client}};
    if(cache.has(file))return cache.get(file);
    const exports={};cache.set(file,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Buffer,console,require(name){assert.ok(name.startsWith('.'));return load(path.resolve(path.dirname(file),name+'.ts'));}});
    return exports;
  }
  return load;
}
const validation=modules(()=>assert.fail('No SQL expected'))('src/service/product/productValidation.ts');
const {normalizeProductCategory:normalize}=validation;
test('category contract, NFC, spaces, Unicode code points and invalid inputs',()=>{
  assert.equal(normalize(undefined),undefined);assert.equal(normalize(null),null);
  assert.equal(normalize('  '),null);assert.equal(normalize('  A\u0301guas   Minerais  '),'Águas Minerais');
  assert.equal(normalize('🍔'.repeat(80)),'🍔'.repeat(80));
  assert.equal(normalize('a\u0301'.repeat(80)),'á'.repeat(80));
  for(const value of [42,false,{},[], 'a\n b','a\t b','x\0','x\u007f','x\u0085','\ud800','a'.repeat(81),'🍔'.repeat(81)]) {
    assert.throws(()=>normalize(value),e=>e.status===400);
  }
});
test('simple create persists normalized category or NULL and returns it',async()=>{
  const load=modules(async(sql,p)=>{
    assert.match(sql,/restaurant_id, category/);assert.equal(p[5],'A');
    return {rows:[{category:p[6]}]};
  });
  const {CreateProductService}=load('src/service/product/CreateProductService.ts');
  const service=new CreateProductService(),base={name:'Produto',description:'Descrição',price:'12',restaurant_id:'A',image_url:'url',public_id:'image'};
  for(const [input,expected] of [[undefined,null],[null,null],[' ',null],['  Bebidas   Frias ','Bebidas Frias']]){
    assert.equal((await service.execute({...base,category:input})).category,expected);
  }
});
test('simple edits preserve omitted category, remove explicitly, parameterize SQL and deny another tenant',async()=>{
  const row={id:'p',restaurant_id:'A',category:'Original'};
  const load=modules(async(sql,p)=>{
    assert.match(sql,/WHERE id = \$6 AND restaurant_id = \$7/);
    assert.doesNotMatch(sql,/SET restaurant_id/);
    if(p[5]!==row.id||p[6]!==row.restaurant_id)return {rows:[]};
    const match=sql.match(/, category = \$(\d+)/);
    if(match)row.category=p[Number(match[1])-1];
    return {rows:[{...row}]};
  });
  const {EditProductService}=load('src/service/product/EditProductService.ts');
  const service=new EditProductService(),base={product_id:'p',restaurant_id:'A'};
  assert.equal((await service.execute({...base,name:'Novo'})).category,'Original');
  assert.equal((await service.execute({...base,image_url:'new',public_id:'new',expectedPublicId:'old'})).category,'Original');
  assert.equal((await service.execute({...base,category:"  D'água  "})).category,"D'água");
  assert.equal(await service.execute({...base,restaurant_id:'B',category:'Foreign'}),undefined);
  assert.equal(row.category,"D'água");
  assert.equal((await service.execute({...base,category:null})).category,null);
});
test('configured parser retains omission and normalizes explicit removal',()=>{
  const {parseNewConfiguredProduct,parseConfiguredProduct}=modules(()=>{})('src/service/productTemplates/configuredProductInput.ts');
  const base={name:'Produto',description:null,variantName:'Único',price:'10',available:true,groups:[],variants:[{id:'00000000-0000-4000-8000-000000000001',name:'Único',price:'10',available:true,groupLimits:[]}]};
  for(const parse of [parseNewConfiguredProduct,parseConfiguredProduct]){
    assert.equal(parse(base).category,undefined);
    assert.equal(parse({...base,category:'  Bebidas '}).category,'Bebidas');
    assert.equal(parse({...base,category:null}).category,null);
    assert.equal(parse({...base,category:' '}).category,null);
    assert.throws(()=>parse({...base,category:[]}),e=>e.status===400);
  }
});
test('configured create and edit return category and preserve tenant checks',async()=>{
  const row={id:'p',category:'Original',published:false};
  const load=modules(async(sql,p=[])=>{
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.includes('FROM public.restaurants'))return {rows:[{id:'A'}]};
    if(sql.includes('INSERT INTO public.products')){assert.match(sql,/RETURNING.*category/);return {rows:[{...row,category:p[4]}]};}
    if(sql.includes('INSERT INTO public.product_variants'))return {rows:[]};
    if(sql.includes('FOR UPDATE')){assert.match(sql,/id = \$1 AND restaurant_id = \$2/);return {rows:p[1]==='A'?[row]:[]};}
    if(sql.includes('count(*)'))return {rows:[{variants:1,groups:0}]};
    if(sql.includes('UPDATE public.product_variants'))return {rowCount:1};
    if(sql.includes('UPDATE public.products')){
      assert.match(sql,/category = CASE WHEN \$6::boolean THEN \$7::varchar\(80\) ELSE category END/);
      assert.match(sql,/WHERE id = \$1 AND restaurant_id = \$2/);
      if(p[5])row.category=p[6];return {rows:[{...row}]};
    }
    assert.fail(sql);
  });
  const {CreateConfiguredProductService}=load('src/service/productTemplates/CreateConfiguredProductService.ts');
  const creator=new CreateConfiguredProductService();
  assert.equal((await creator.execute('A',{name:'Novo',description:null,price:'10',variantName:'Único'})).product.category,null);
  assert.equal((await creator.execute('A',{name:'Novo',description:null,price:'10',variantName:'Único',category:' Bebidas '})).product.category,'Bebidas');
  const {UpdateConfiguredProductService}=load('src/service/productTemplates/UpdateConfiguredProductService.ts');
  const editor=new UpdateConfiguredProductService(),input={name:'Nome',description:null,available:true,groups:[],variants:[{id:'v',name:'Único',price:'10',available:true,groupLimits:[]}]};
  assert.equal((await editor.execute('A','p',input)).category,'Original');
  assert.equal((await editor.execute('A','p',{...input,category:' Nova '})).category,'Nova');
  await assert.rejects(editor.execute('B','p',{...input,category:'Foreign'}),e=>e.status===404);
  assert.equal(row.category,'Nova');
  assert.equal((await editor.execute('A','p',{...input,category:null})).category,null);
});
test('public/admin lists and configurations select category; legacy NULL passes through',async()=>{
  for(const [file,klass,args,explicit] of [
    ['product/GetProductService','GetProductService',['A'],false],
    ['product/GetProductIdService','GetProductIdService',['A'],true],
    ['productTemplates/GetAdminProductConfigurationService','GetAdminProductConfigurationService',[{productId:'p',restaurantId:'A'}],true],
    ['productTemplates/GetPublicProductConfigurationService','GetPublicProductConfigurationService',[{productId:'p'}],true],
  ]){
    let main=false;
    const load=modules(async(sql,p)=>{
      if(/FROM (public\.)?products\b/.test(sql)&&!main){
        main=true;assert.match(sql,explicit?/\bcategory\b/:/p\.\*/);
        if(klass.includes('Public')||klass==='GetProductIdService')assert.match(sql,/published = TRUE/);
        if(klass==='GetProductService'||klass==='GetProductIdService')assert.equal(p[0],'A');
        return {rows:[{id:'p',category:null}],rowCount:1};
      }
      return {rows:[],rowCount:0};
    });
    const result=await new (load('src/service/'+file+'.ts')[klass])().execute(...args);
    assert.equal((Array.isArray(result)?result[0]:result.product).category,null);
  }
});
