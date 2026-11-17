const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const sqlPath = path.resolve(__dirname, '../migrations/002_restaurant_product_templates.sql');
const migration = fs.readFileSync(sqlPath, 'utf8');
// No dotenv, application pool, connection string, remote host or TCP listener is used.
const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const pgCtl = process.env.GAMA_TEST_PG_CTL_BIN || 'pg_ctl';
const psql = process.env.GAMA_TEST_PSQL_BIN || 'psql';
const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
let cluster;
let sequence = 0;
let unavailable;
let serverMode = false;
let rlsUnavailable;
const version = spawnSync(postgres, ['--version'], { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
if (version.status !== 0) unavailable = `Local PostgreSQL unavailable: ${version.error?.code || `exit ${version.status}`}`;
const initVersion = spawnSync(initdb, ['--version'], { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
if (initVersion.status !== 0) unavailable = `Local initdb unavailable: ${initVersion.error?.code || `exit ${initVersion.status}`}`;

function run(database, sql) {
  assert.ok(cluster && path.basename(cluster).startsWith('gama-runtime-role-test-'));
  // A regular input file guarantees EOF in single-user mode, including restricted runtimes.
  const inputPath = path.join(cluster, 'migration-test-input.sql');
  fs.writeFileSync(inputPath, sql, 'utf8');
  const input = fs.openSync(inputPath, 'r');
  let result;
  try {
    result = serverMode ? spawnSync(psql, [
      '-X', '-h', cluster, '-p', '55439', '-U', 'gama_private_templates_test', '-d', database,
      '--set=ON_ERROR_STOP=1', '--file', inputPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: environment, timeout: 30000, maxBuffer: 2 * 1024 * 1024 }) : spawnSync(postgres, [
      '--single', '-D', cluster, '-c', 'exit_on_error=true',
      '-c', 'log_checkpoints=off', '-c', 'log_min_messages=error', '-j', database,
    ], { stdio: [input, 'pipe', 'pipe'], encoding: 'utf8', env: environment, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  } finally { fs.closeSync(input); }
  assert.ifError(result.error);
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
}
function execute(database, sql) {
  const result = run(database, sql);
  assert.equal(result.status, 0, result.output);
  return result.output;
}
before(() => {
  if (unavailable) return;
  cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-runtime-role-test-'));
  const result = spawnSync(initdb, ['-D', cluster, '-A', 'trust', '-U', 'gama_private_templates_test', '--no-sync', '--locale=C', '--encoding=UTF8'], {
    encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(fs.existsSync(path.join(cluster, "PG_VERSION")), "initdb must create a real private cluster");
  const hasTools = [pgCtl, psql].every(bin => spawnSync(bin, ['--version'], { env: environment, encoding: 'utf8' }).status === 0);
  if (!hasTools) { rlsUnavailable = 'pg_ctl/psql unavailable; RLS behavior requires a normal local server'; return; }
  const started = spawnSync(pgCtl, ['-D', cluster, '-l', path.join(cluster, 'server.log'), '-w', '-t', '5',
    '-o', `-c logging_collector=off -c listen_addresses='' -k ${cluster} -p 55439`, 'start'], {
    env: environment, encoding: 'utf8', timeout: 10000,
  });
  if (started.status === 0) { serverMode = true; return; }
  const log = fs.existsSync(path.join(cluster, 'server.log')) ? fs.readFileSync(path.join(cluster, 'server.log'), 'utf8') : '';
  assert.match(log, /Operation not permitted|Permission denied/, `${started.stdout}\n${started.stderr}\n${log}`);
  rlsUnavailable = 'Local Unix socket denied (EPERM); single-user PostgreSQL bypasses RLS';
});
after(() => {
  // Only stop/remove this test process's new private cluster. No external destination is accepted.
  if (cluster && path.basename(cluster).startsWith('gama-runtime-role-test-') && path.dirname(cluster) === os.tmpdir()) {
    if (serverMode) {
      const stopped = spawnSync(pgCtl, ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env: environment, encoding: 'utf8', timeout: 10000 });
      assert.equal(stopped.status, 0, `${stopped.stdout}\n${stopped.stderr}`);
    }
    fs.rmSync(cluster, { recursive: true });
  }
});
const kit = path.resolve(__dirname,'../ops/runtime-role');
const read = name => fs.readFileSync(path.join(kit,name),'utf8');
const manifest = JSON.parse(read('permissions.json'));
before(() => {
  if(unavailable)return;
  execute('postgres','CREATE DATABASE neondb;');
  execute('neondb',fs.readFileSync(path.join(__dirname,'fixtures/runtime-role-schema.sql'),'utf8'));
  // Match the existing nullable delivery columns confirmed in the real schema.
  execute('neondb', 'ALTER TABLE public.orders ADD COLUMN delivery_address JSONB, ADD COLUMN bairro_id UUID REFERENCES public.bairros(id);');
  execute('neondb',read('00_inventory.sql'));
  execute('neondb',read('01_create_gama_app.sql'));
  execute('neondb',read('02_grants_existing.sql'));
  execute('neondb',migration);
  execute('neondb',read('03_grants_private.sql'));
  execute('neondb', `CREATE TABLE category_before AS SELECT to_jsonb(p) AS row FROM public.products p; CREATE TABLE category_acl_before AS SELECT attnum, attacl FROM pg_attribute WHERE attrelid = 'public.products'::regclass AND attnum > 0;`);
  execute('neondb',fs.readFileSync(path.join(__dirname,'../migrations/005_product_category.sql'),'utf8'));
  execute('neondb',fs.readFileSync(path.join(__dirname,'../migrations/006_order_fulfillment.sql'),'utf8'));
});

test('category schema, old rows and ACLs are preserved', {skip:unavailable}, () => {
  const output = execute('neondb', `DO $test$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='products' AND column_name='category' AND data_type='character varying' AND character_maximum_length=80 AND is_nullable='YES' AND column_default IS NULL) THEN RAISE EXCEPTION 'Wrong category definition'; END IF;
IF EXISTS (SELECT 1 FROM public.products WHERE category IS NOT NULL) THEN RAISE EXCEPTION 'Old products categorized'; END IF;
IF EXISTS (SELECT row FROM category_before EXCEPT ALL SELECT to_jsonb(p)-'category' FROM public.products p) OR EXISTS (SELECT to_jsonb(p)-'category' FROM public.products p EXCEPT ALL SELECT row FROM category_before) THEN RAISE EXCEPTION 'Existing rows changed'; END IF;
IF EXISTS (SELECT 1 FROM category_acl_before b JOIN pg_attribute a ON a.attrelid='public.products'::regclass AND a.attnum=b.attnum WHERE a.attacl IS DISTINCT FROM b.attacl) THEN RAISE EXCEPTION 'Existing column ACL changed'; END IF;
IF has_column_privilege('gama_app','public.products','restaurant_id','UPDATE') THEN RAISE EXCEPTION 'Tenant mutable'; END IF;
IF EXISTS (SELECT 1 FROM pg_class WHERE oid='public.products'::regclass AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION 'Products RLS changed'; END IF;
END $test$; SELECT 'category_ok';`);
  assert.match(output, /category_ok/);
  execute('neondb', fs.readFileSync(path.join(__dirname,'../migrations/005_product_category_verify.sql'),'utf8'));
});

test('category accepts NULL and 80 Unicode characters, rejects 81', {skip:unavailable}, () => {
  execute('neondb', `BEGIN;
INSERT INTO public.products(restaurant_id,name,price) VALUES ('00000000-0000-4000-8000-000000000001','Without category',1);
DO $test$ BEGIN
IF EXISTS (SELECT 1 FROM public.products WHERE name='Without category' AND category IS NOT NULL) THEN RAISE EXCEPTION 'Omitted category must be NULL'; END IF;
END $test$;
UPDATE public.products SET category=repeat('á',80);
UPDATE public.products SET category=NULL;
DO $test$ DECLARE rejected BOOLEAN := FALSE; BEGIN
PERFORM set_config('exit_on_error','off',true);
BEGIN
UPDATE public.products SET category=repeat('á',81);
EXCEPTION WHEN string_data_right_truncation THEN rejected := TRUE;
END;
IF NOT rejected THEN RAISE EXCEPTION '81 characters accepted'; END IF;
PERFORM set_config('exit_on_error','on',true);
END $test$;
ROLLBACK;`);
});

test('repeated category migration fails without changing schema or grants', {skip:unavailable}, () => {
  const result = run('neondb', fs.readFileSync(path.join(__dirname,'../migrations/005_product_category.sql'),'utf8'));
  assert.notEqual(result.status, 0);
  assert.match(result.output, /already exists/);
  execute('neondb', fs.readFileSync(path.join(__dirname,'../migrations/005_product_category_verify.sql'),'utf8'));
});

test('prepared scripts create exact non-privileged role and minimum column/table ACLs in real PostgreSQL catalogs',{skip:unavailable},()=>{
  const assertions=Object.entries(manifest).map(([table,rule])=>`
IF NOT has_table_privilege('gama_app','public.${table}','SELECT') THEN RAISE EXCEPTION 'Missing SELECT ${table}'; END IF;
IF has_table_privilege('gama_app','public.${table}','INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'Excess table grants ${table}'; END IF;
IF has_table_privilege('gama_app','public.${table}','DELETE') IS DISTINCT FROM ${rule.delete} THEN RAISE EXCEPTION 'DELETE mismatch ${table}'; END IF;
${['insert','update'].flatMap(op=>rule[op].map(col=>`IF NOT has_column_privilege('gama_app','public.${table}','${col}','${op.toUpperCase()}') THEN RAISE EXCEPTION 'Missing ${op} ${table}.${col}'; END IF;`)).join('\n')}`).join('\n');
  const output=execute('neondb',`DO $test$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gama_app' AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit) THEN RAISE EXCEPTION 'Incorrect role flags'; END IF;
IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='gama_app')) THEN RAISE EXCEPTION 'Unexpected role memberships'; END IF;
${assertions.replace(/\n\s*\n/g,'\n').trim()}
IF has_column_privilege('gama_app','public.orders','total_price','UPDATE') OR has_column_privilege('gama_app','public.restaurant_product_template_versions','configuration','UPDATE') THEN RAISE EXCEPTION 'Historical values mutable'; END IF;
END $test$; SELECT 'acl_ok';`);
  assert.match(output,/acl_ok/);
});
test('sequence discovery grants only USAGE on owned/direct-default sequences, excluding unrelated sequence',{skip:unavailable},()=>{
  const output=execute('neondb',`DO $test$ DECLARE s TEXT; BEGIN
FOREACH s IN ARRAY ARRAY['chat_messages_id_seq','password_tokens_id_seq','runtime_fixture_default_sequence'] LOOP
IF NOT has_sequence_privilege('gama_app','public.'||s,'USAGE') OR has_sequence_privilege('gama_app','public.'||s,'SELECT,UPDATE') THEN RAISE EXCEPTION 'Incorrect sequence privileges %',s; END IF;
END LOOP;
IF has_sequence_privilege('gama_app','public.unrelated_sequence','USAGE,SELECT,UPDATE') THEN RAISE EXCEPTION 'Unrelated sequence exposed'; END IF;
END $test$; SELECT 'sequences_ok';`);assert.match(output,/sequences_ok/);
});
test('read-only inventory runs and role creation refuses to overwrite an existing role',{skip:unavailable},()=>{
  assert.match(execute('neondb',read('00_inventory.sql')),/gama_app/);
  assert.notEqual(run('neondb',read('01_create_gama_app.sql')).status,0);
});
test('grants can be re-applied without granting global template writes or changing data',{skip:unavailable},()=>{
  execute('neondb',read('02_grants_existing.sql'));execute('neondb',read('03_grants_private.sql'));
  const output=execute('neondb',`DO $test$ BEGIN
IF (SELECT count(*) FROM public.restaurants)<>2 OR (SELECT count(*) FROM public.products)<>1 THEN RAISE EXCEPTION 'Application data changed'; END IF;
IF has_any_column_privilege('gama_app','public.product_templates','INSERT,UPDATE') OR has_table_privilege('gama_app','public.product_templates','DELETE') THEN RAISE EXCEPTION 'Global templates writable'; END IF;
END $test$; SELECT 'regrant_ok';`);assert.match(output,/regrant_ok/);
});

test('real gama_app login enforces RLS, pooled isolation and services with the exact prepared grants',{skip:unavailable},async t=>{
  if(!serverMode){t.skip(rlsUnavailable);return;}
  const {Pool}=require('pg'),vm=require('node:vm'),ts=require('typescript');
  const pool=new Pool({host:cluster,port:55439,database:'neondb',user:'gama_app',ssl:false,max:1});
  const cache=new Map();
  function moduleFile(filename){
    const resolved=path.resolve(filename);
    if(resolved===path.resolve(__dirname,'../src/database.ts'))return {pool};
    if(cache.has(resolved))return cache.get(resolved);
    const exports={};cache.set(resolved,exports);
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(resolved,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,Buffer,require(name){assert.ok(name.startsWith('.'),name);return moduleFile(path.resolve(path.dirname(resolved),name+'.ts'));}});return exports;
  }
  const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002',productId='00000000-0000-4000-8000-000000000010';
  try{
    await pool.query(read('04_verify_runtime.sql'));
    const {PrivateTemplateService}=moduleFile(path.resolve(__dirname,'../src/service/privateTemplates/PrivateTemplateService.ts'));
    const service=new PrivateTemplateService();
    const saved=await service.create(A,productId,{name:'Local runtime model',description:'Local only'});
    assert.equal((await service.list(A)).length,1);assert.equal((await service.list(B)).length,0);
    await assert.rejects(service.copy(B,saved.template.id,1),e=>e.status===404);
    const copy=await service.copy(A,saved.template.id,1);assert.equal(copy.product.published,false);
    await service.version(A,saved.template.id,productId,1);
    assert.equal((await service.get(A,saved.template.id)).versions.length,2);
    const {rows:[otherProduct]}=await pool.query('INSERT INTO public.products(restaurant_id,name,price) VALUES($1,$2,$3) RETURNING id',[B,'Local B source','10.00']);
    await pool.query('INSERT INTO public.product_variants(product_id,name,price,available) VALUES($1,$2,$3,TRUE)',[otherProduct.id,'P','10.00']);
    const otherModel=await service.create(B,otherProduct.id,{name:'Local B model',description:'Local only'});
    const probe=spawnSync(psql,['-X','-h',cluster,'-p','55439','-U','gama_app','-d','neondb',
      '--set=ON_ERROR_STOP=1',`--set=restaurant_a=${A}`,`--set=restaurant_b=${B}`,
      `--set=template_a=${saved.template.id}`,`--set=template_b=${otherModel.template.id}`,
      '--file',path.join(kit,'05_rls_readonly_probe.psql')],{env:environment,encoding:'utf8',timeout:30000});
    assert.equal(probe.status,0,`${probe.stdout}\n${probe.stderr}`);
    assert.equal((await pool.query('SELECT id FROM public.restaurant_product_templates')).rowCount,0);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');await client.query("SELECT set_config('gama.restaurant_id',$1,true)",[B]);
      assert.equal((await client.query('SELECT id FROM public.restaurant_product_templates WHERE id=$1',[saved.template.id])).rowCount,0);
      assert.equal((await client.query('DELETE FROM public.restaurant_product_templates WHERE id=$1',[saved.template.id])).rowCount,0);
      await assert.rejects(client.query('INSERT INTO public.restaurant_product_templates(restaurant_id,name) VALUES($1,$2)',[A,'forged']),e=>e.code==='42501');
    }finally{await client.query('ROLLBACK');client.release();}
    assert.equal((await pool.query('SELECT id FROM public.restaurant_product_templates')).rowCount,0);
    await service.remove(A,saved.template.id);
    assert.equal((await pool.query('SELECT id FROM public.products WHERE id=$1',[copy.product.id])).rowCount,1);
    // Exercise sequence defaults, ON CONFLICT UPDATE and row locks with column-scoped UPDATE grants.
    await pool.query("INSERT INTO password_tokens(email,token,expires_at) VALUES('local@example.invalid','fixture',now()) ON CONFLICT(email) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at");
    await pool.query("INSERT INTO password_tokens(email,token,expires_at) VALUES('local@example.invalid','fixture2',now()) ON CONFLICT(email) DO UPDATE SET token=EXCLUDED.token,expires_at=EXCLUDED.expires_at");
    await pool.query('BEGIN');await pool.query('SELECT id FROM public.restaurants WHERE id=$1 FOR SHARE',[A]);await pool.query('ROLLBACK');
    await assert.rejects(pool.query('UPDATE public.orders SET total_price=0'),e=>e.code==='42501');
  }finally{await pool.end();}
});

test('optional rollback suspends new runtime logins without deleting data or grants',{skip:unavailable},()=>{
  execute('neondb',read('90_suspend_gama_app.sql'));
  const output=execute('neondb',`DO $test$ BEGIN
IF (SELECT rolcanlogin FROM pg_roles WHERE rolname='gama_app') THEN RAISE EXCEPTION 'NOLOGIN not applied'; END IF;
IF NOT has_table_privilege('gama_app','public.products','SELECT') THEN RAISE EXCEPTION 'Rollback revoked grants'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.products) THEN RAISE EXCEPTION 'Rollback changed data'; END IF;
END $test$; ALTER ROLE gama_app LOGIN; SELECT 'rollback_ok';`);assert.match(output,/rollback_ok/);
});

test('audit: actual gama_app RLS denies cross-tenant writes and rolls all fixtures back',{skip:unavailable},async t=>{
  if(!serverMode){t.skip(rlsUnavailable);return;}
  const {Pool}=require('pg');
  const pool=new Pool({host:cluster,port:55439,database:'neondb',user:'gama_app',ssl:false,max:1});
  const client=await pool.connect();
  const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
  const snapshot=JSON.stringify({schemaVersion:1,product:{name:'Local audit',description:null},variants:[{key:'v1',name:'P',price:'10.00',available:true}],groups:[],variantGroupLimits:[]});
  let ta,tb;
  async function denied(sql,params,code){
    await client.query('SAVEPOINT audit_denied');
    try{await assert.rejects(client.query(sql,params),error=>error.code===code);}
    finally{await client.query('ROLLBACK TO SAVEPOINT audit_denied');await client.query('RELEASE SAVEPOINT audit_denied');}
  }
  try{
    assert.equal((await client.query('SELECT current_user AS role,session_user AS login')).rows[0].role,'gama_app');
    assert.equal((await client.query('SELECT current_user AS role,session_user AS login')).rows[0].login,'gama_app');
    await client.query('BEGIN');
    for(const tenant of [A,B]){
      await client.query("SELECT set_config('gama.restaurant_id',$1,true)",[tenant]);
      const {rows:[template]}=await client.query('INSERT INTO public.restaurant_product_templates(restaurant_id,name,description) VALUES($1,$2,$3) RETURNING id',[tenant,'Audit '+tenant,'Temporary local fixture']);
      await client.query('INSERT INTO public.restaurant_product_template_versions(template_id,restaurant_id,version,configuration,active) VALUES($1,$2,1,$3::jsonb,TRUE)',[template.id,tenant,snapshot]);
      if(tenant===A)ta=template.id;else tb=template.id;
    }
    // Genuine B context. SQL deliberately has no restaurant filter: the database must enforce isolation.
    assert.equal((await client.query('SELECT id FROM public.restaurant_product_templates WHERE id=$1',[tb])).rowCount,1);
    assert.equal((await client.query('SELECT id FROM public.restaurant_product_templates WHERE id=$1',[ta])).rowCount,0);
    assert.equal((await client.query('UPDATE public.restaurant_product_templates SET name=$2 WHERE id=$1',[ta,'Foreign rename'])).rowCount,0);
    assert.equal((await client.query('UPDATE public.restaurant_product_template_versions SET active=FALSE WHERE template_id=$1',[ta])).rowCount,0);
    assert.equal((await client.query('DELETE FROM public.restaurant_product_template_versions WHERE template_id=$1',[ta])).rowCount,0);
    assert.equal((await client.query('DELETE FROM public.restaurant_product_templates WHERE id=$1',[ta])).rowCount,0);
    await denied('INSERT INTO public.restaurant_product_templates(restaurant_id,name) VALUES($1,$2)',[A,'Forged owner'],'42501');
    await denied('INSERT INTO public.restaurant_product_template_versions(template_id,restaurant_id,version,configuration,active) VALUES($1,$2,2,$3::jsonb,FALSE)',[ta,A,snapshot],'42501');
    await denied('INSERT INTO public.restaurant_product_template_versions(template_id,restaurant_id,version,configuration,active) VALUES($1,$2,2,$3::jsonb,FALSE)',[ta,B,snapshot],'23503');
    await denied('UPDATE public.restaurant_product_templates SET restaurant_id=$2 WHERE id=$1',[tb,A],'42501');
    await denied('UPDATE public.restaurant_product_template_versions SET configuration=$2::jsonb WHERE template_id=$1',[tb,snapshot],'42501');
    await client.query("SELECT set_config('gama.restaurant_id',$1,true)",[A]);
    assert.equal((await client.query('SELECT name FROM public.restaurant_product_templates WHERE id=$1',[ta])).rows[0].name,'Audit '+A);
    assert.equal((await client.query('SELECT version,active FROM public.restaurant_product_template_versions WHERE template_id=$1',[ta])).rows[0].active,true);
    // Positive own writes avoid vacuous success caused by a role lacking all write privileges.
    assert.equal((await client.query('UPDATE public.restaurant_product_templates SET name=$2 WHERE id=$1',[ta,'Own rename'])).rowCount,1);
    assert.equal((await client.query('UPDATE public.restaurant_product_template_versions SET active=FALSE WHERE template_id=$1',[ta])).rowCount,1);
    await client.query('INSERT INTO public.restaurant_product_template_versions(template_id,restaurant_id,version,configuration,active) VALUES($1,$2,2,$3::jsonb,TRUE)',[ta,A,snapshot]);
    assert.equal((await client.query('DELETE FROM public.restaurant_product_template_versions WHERE template_id=$1',[ta])).rowCount,2);
    assert.equal((await client.query('DELETE FROM public.restaurant_product_templates WHERE id=$1',[ta])).rowCount,1);
  }finally{
    try{await client.query('ROLLBACK');}finally{client.release();}
    try{
      assert.equal((await pool.query("SELECT NULLIF(current_setting('gama.restaurant_id',true),'') AS tenant")).rows[0].tenant,null);
      await pool.query('BEGIN');await pool.query("SELECT set_config('gama.restaurant_id',$1,true)",[B]);
      assert.equal((await pool.query('SELECT id FROM public.restaurant_product_templates WHERE id=$1',[tb])).rowCount,0);
      await pool.query('ROLLBACK');
    }finally{await pool.end();}
  }
});
