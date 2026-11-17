const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),ts=require('typescript');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const postgres=process.env.GAMA_TEST_POSTGRES_BIN||'postgres',initdb=process.env.GAMA_TEST_INITDB_BIN||'initdb';
const env={PATH:process.env.PATH,LANG:'C',LC_ALL:'C'};
const unavailable=[postgres,initdb].some(bin=>spawnSync(bin,['--version'],{env,stdio:['ignore','pipe','pipe']}).status!==0);
const restaurant='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',customer='00000000-0000-4000-8000-000000000003';
const literal=value=>value===null?'NULL':`'${String(value).replaceAll("'","''")}'`;
const parameters=call=>call.sql.replace(/\$(\d+)\b/g,(_,index)=>literal(call.params[Number(index)-1]));
// Actual service/validator modules, intercepted pool. Never loads dotenv or remote credentials.
function modules(calls){
  const cache=new Map();
  const pool={query:async(sql,params)=>{calls.push({sql,params:Array.from(params)});return {rows:[{id:customer,restaurant_id:restaurant}]};}};
  function load(file){
    file=path.resolve(file);
    if(file===path.join(root,'src/database.ts'))return {pool};
    if(cache.has(file))return cache.get(file);
    const exports={};cache.set(file,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
      exports,process:{env:{JWT_SECRET:'isolated-customer-test'}},require(name){
        if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ts'));
        assert.ok(['crypto','jsonwebtoken'].includes(name));return require(name);
      },
    });return exports;
  }
  return load;
}
test('actual signup persists SQL NULL despite address defaults; later scoped DELIVERY update saves only provided customer address', {skip:unavailable?'postgres/initdb unavailable':false},async()=>{
  const calls=[],load=modules(calls);
  const {readCustomerData}=load(path.join(root,'src/security/customerAccess.ts'));
  const {CreateClientService}=load(path.join(root,'src/service/clients/CreateClientService.ts'));
  const {UpdateClientService}=load(path.join(root,'src/service/clients/UpdateClientService.ts'));
  const pickup=readCustomerData({name:'Cliente',phone:'11999999999',fulfillment_type:'PICKUP'},'create');
  await new CreateClientService().execute({...pickup,restaurant_id:restaurant});
  assert.deepEqual(calls[0].params.slice(2,7),[null,null,null,null,null]);
  const delivery=readCustomerData({name:'Cliente',phone:'11999999999',city:'Cidade Cliente',street:'Rua Cliente',number:'10',neighborhood:'Bairro Cliente'},'create');
  await new UpdateClientService().execute({...delivery,id:customer,restaurant_id:restaurant});
  const wrong={sql:calls[1].sql,params:[...calls[1].params]};wrong.params[8]=other;
  const cluster=fs.mkdtempSync(path.join(os.tmpdir(),'gama-customer-null-'));
  try{
    const init=spawnSync(initdb,['-D',cluster,'-A','trust','-U','null_address_owner','--no-sync','--locale=C','--encoding=UTF8'],{env,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:30000});
    assert.ifError(init.error);assert.equal(init.status,0,init.stdout+init.stderr);
    const input=path.join(cluster,'test.sql');fs.writeFileSync(input,`
CREATE TABLE restaurants(id uuid PRIMARY KEY, city text);
CREATE TABLE customers(
 id uuid PRIMARY KEY DEFAULT '${customer}'::uuid,
 name text NOT NULL,phone text NOT NULL,restaurant_id uuid REFERENCES restaurants(id),
 city text DEFAULT 'DEFAULT MUST NOT APPLY',street text DEFAULT 'DEFAULT MUST NOT APPLY',
 number text DEFAULT 'DEFAULT MUST NOT APPLY',neighborhood text DEFAULT 'DEFAULT MUST NOT APPLY',
 complement text DEFAULT 'DEFAULT MUST NOT APPLY'
);
INSERT INTO restaurants VALUES ('${restaurant}','Cidade Restaurante'),('${other}','Outra Cidade Restaurante');
${parameters(calls[0])};
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM customers WHERE id='${customer}' AND restaurant_id='${restaurant}' AND city IS NULL AND street IS NULL AND number IS NULL AND neighborhood IS NULL AND complement IS NULL) THEN RAISE EXCEPTION 'Absent address was fabricated'; END IF; END $$;
${parameters(wrong)};
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM customers WHERE id='${customer}' AND city IS NULL AND street IS NULL) THEN RAISE EXCEPTION 'Foreign restaurant updated the address'; END IF; END $$;
${parameters(calls[1])};
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM customers WHERE id='${customer}' AND restaurant_id='${restaurant}' AND city='Cidade Cliente' AND street='Rua Cliente' AND number='10' AND neighborhood='Bairro Cliente' AND complement IS NULL) THEN RAISE EXCEPTION 'Delivery update failed'; END IF; END $$;
`);
    const fd=fs.openSync(input,'r');let result;
    try{result=spawnSync(postgres,['--single','-D',cluster,'-c','exit_on_error=true','-c','log_min_messages=error','-j','postgres'],{env,stdio:[fd,'pipe','pipe'],encoding:'utf8',timeout:30000});}finally{fs.closeSync(fd);}
    assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
  }finally{fs.rmSync(cluster,{recursive:true,force:true});}
});
