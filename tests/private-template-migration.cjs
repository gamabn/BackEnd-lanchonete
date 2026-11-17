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
  assert.ok(cluster && path.basename(cluster).startsWith('gama-private-templates-test-'));
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
  cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-private-templates-test-'));
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
  if (cluster && path.basename(cluster).startsWith('gama-private-templates-test-') && path.dirname(cluster) === os.tmpdir()) {
    if (serverMode) {
      const stopped = spawnSync(pgCtl, ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { env: environment, encoding: 'utf8', timeout: 10000 });
      assert.equal(stopped.status, 0, `${stopped.stdout}\n${stopped.stderr}`);
    }
    fs.rmSync(cluster, { recursive: true });
  }
});
const fixture = `
CREATE TABLE public.restaurants (id UUID PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO public.restaurants (id, name) VALUES
('00000000-0000-4000-8000-000000000001', 'Legacy A'),
('00000000-0000-4000-8000-000000000002', 'Legacy B');
`;
const helpers = `
CREATE FUNCTION pg_temp.expect_state(statement TEXT, expected TEXT) RETURNS VOID
LANGUAGE plpgsql AS $test$
DECLARE observed TEXT;
BEGIN
    -- Expected violations must remain catchable inside this test-only subtransaction.
    -- Restore fail-fast behavior before asserting the observed SQLSTATE.
    PERFORM set_config('exit_on_error', 'off', TRUE);
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS observed = RETURNED_SQLSTATE;
    END;
    PERFORM set_config('exit_on_error', 'on', TRUE);
    IF observed IS NULL OR NOT (observed = ANY(string_to_array(expected, ','))) THEN
        RAISE EXCEPTION 'Expected SQLSTATE %, observed % for %', expected, observed, statement;
    END IF;
END
$test$;
`;
function database() {
  const name = `gama_private_template_case_${++sequence}`;
  execute('postgres', `CREATE DATABASE ${name};`);
  return name;
}
function sqlTest(name, assertions, requiresServer = false) {
  test(name, { skip: unavailable }, t => {
    if (requiresServer && !serverMode) { t.skip(rlsUnavailable); return; }
    t.diagnostic(version.stdout.trim());
    const db = database();
    execute(db, fixture);
    const output = execute(db, `${migration}\n${helpers}\n${assertions}\nSELECT 'gama_migration_assertions_passed';`);
    assert.match(output, /gama_migration_assertions_passed/);
  });
}
const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';
const templateA = '00000000-0000-4000-8000-000000000010';
const templateB = '00000000-0000-4000-8000-000000000020';
const snapshot = JSON.stringify({ schemaVersion: 1, product: { name: 'Quentinha', description: '' },
  variants: [{ key: 'size-1', name: 'P', price: '20.00', available: true }],
  groups: [{ key: 'group-1', name: 'Extras', required: false, minSelect: 0, maxSelect: 1,
    options: [{ key: 'option-1', name: 'Molho', additionalPrice: '0.00', available: true }] }],
  variantGroupLimits: [{ variantKey: 'size-1', groupKey: 'group-1', minSelect: 0, maxSelect: 1 }],
});
const parents = `INSERT INTO public.restaurant_product_templates (id, restaurant_id, name) VALUES
('${templateA}', '${ownerA}', 'Meu modelo'), ('${templateB}', '${ownerB}', 'Meu modelo');`;
const versionOne = `INSERT INTO public.restaurant_product_template_versions (template_id, restaurant_id, version, configuration)
VALUES ('${templateA}', '${ownerA}', 1, '${snapshot}');`;

sqlTest('owner-scoped names, defaults and indexes preserve equal names across restaurants', `
${parents}
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_templates (restaurant_id,name)
VALUES ('${ownerA}',' MEU MODELO ')$sql$,'23505');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_templates (restaurant_id,name)
VALUES ('${ownerA}',' ')$sql$,'23514');
DO $test$ BEGIN
IF NOT EXISTS (SELECT 1 FROM public.restaurant_product_templates WHERE id='${templateA}' AND active AND description='' AND created_at IS NOT NULL AND updated_at IS NOT NULL) THEN RAISE EXCEPTION 'Defaults missing'; END IF;
IF (SELECT count(*) FROM public.restaurant_product_templates) <> 2 THEN RAISE EXCEPTION 'Owner-scoped names failed'; END IF;
END $test$;
`);

sqlTest('composite foreign key blocks a version attached to another restaurant template', `
${parents}
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration)
VALUES ('${templateA}','${ownerB}',1,'${snapshot}')$sql$,'23503');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_templates (restaurant_id,name)
VALUES ('00000000-0000-4000-8000-999999999999','Unknown owner')$sql$,'23503');
${versionOne}
SELECT pg_temp.expect_state($sql$DELETE FROM public.restaurants WHERE id='${ownerA}'$sql$,'23503,23001');
SELECT pg_temp.expect_state($sql$DELETE FROM public.restaurant_product_templates WHERE id='${templateA}'$sql$,'23503,23001');
`);

sqlTest('version number and single-current-version constraints reject duplicates', `
${parents}
${versionOne}
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration,active)
VALUES ('${templateA}','${ownerA}',1,'${snapshot}',FALSE)$sql$,'23505');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration)
VALUES ('${templateA}','${ownerA}',2,'${snapshot}')$sql$,'23505');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration,active)
VALUES ('${templateA}','${ownerA}',0,'${snapshot}',FALSE)$sql$,'23514');
`);

sqlTest('snapshot envelope rejects missing fields, null fields, wrong shapes and schema versions', `
${parents}
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration)
VALUES ('${templateA}','${ownerA}',1,'{}')$sql$,'23514');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration)
VALUES ('${templateA}','${ownerA}',1,'${snapshot}'::jsonb || '{"schemaVersion":2}')$sql$,'23514');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration)
VALUES ('${templateA}','${ownerA}',1,'${snapshot}'::jsonb || '{"groups":null}')$sql$,'23514');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration)
VALUES ('${templateA}','${ownerA}',1,'[]')$sql$,'23514');
`);

sqlTest('version switch retains previous snapshot and metadata can be renamed independently', `
${parents}
${versionOne}
BEGIN;
SELECT id FROM public.restaurant_product_templates WHERE id='${templateA}' FOR UPDATE;
UPDATE public.restaurant_product_template_versions SET active=FALSE WHERE template_id='${templateA}' AND active;
INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration)
VALUES ('${templateA}','${ownerA}',2,jsonb_set('${snapshot}'::jsonb,'{variants,0,price}','"25.00"'));
UPDATE public.restaurant_product_templates SET name='Renamed', description='Private description', updated_at=CURRENT_TIMESTAMP WHERE id='${templateA}';
COMMIT;
DO $test$ BEGIN
IF (SELECT configuration#>>'{variants,0,price}' FROM public.restaurant_product_template_versions WHERE template_id='${templateA}' AND version=1) <> '20.00' THEN RAISE EXCEPTION 'Previous snapshot changed'; END IF;
IF NOT EXISTS (SELECT 1 FROM public.restaurant_product_template_versions WHERE template_id='${templateA}' AND version=2 AND active) THEN RAISE EXCEPTION 'Current version missing'; END IF;
END $test$;
`);

sqlTest('RLS hides other owners, blocks forged ownership and resets transaction-local tenant', `
${parents}
${versionOne}
INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration) VALUES ('${templateB}','${ownerB}',1,'${snapshot}');
CREATE ROLE gama_private_template_runtime NOSUPERUSER NOBYPASSRLS NOLOGIN;
GRANT USAGE ON SCHEMA public TO gama_private_template_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.restaurant_product_templates,public.restaurant_product_template_versions TO gama_private_template_runtime;
BEGIN;
SET LOCAL ROLE gama_private_template_runtime;
DO $test$ BEGIN
IF EXISTS (SELECT 1 FROM public.restaurant_product_templates) OR EXISTS (SELECT 1 FROM public.restaurant_product_template_versions) THEN RAISE EXCEPTION 'Missing tenant exposed data'; END IF;
END $test$;
SELECT set_config('gama.restaurant_id','${ownerA}',true);
DO $test$ BEGIN
IF (SELECT count(*) FROM public.restaurant_product_templates) <> 1 OR (SELECT count(*) FROM public.restaurant_product_template_versions) <> 1 THEN RAISE EXCEPTION 'Tenant isolation failed'; END IF;
IF EXISTS (SELECT 1 FROM public.restaurant_product_templates WHERE id='${templateB}') THEN RAISE EXCEPTION 'Foreign ID exposed'; END IF;
UPDATE public.restaurant_product_templates SET name='Forbidden' WHERE id='${templateB}';
IF FOUND THEN RAISE EXCEPTION 'Foreign update allowed'; END IF;
DELETE FROM public.restaurant_product_templates WHERE id='${templateB}';
IF FOUND THEN RAISE EXCEPTION 'Foreign delete allowed'; END IF;
END $test$;
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_templates (restaurant_id,name) VALUES ('${ownerB}','Forged')$sql$,'42501');
SELECT pg_temp.expect_state($sql$UPDATE public.restaurant_product_templates SET restaurant_id='${ownerB}' WHERE id='${templateA}'$sql$,'42501');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_product_template_versions (template_id,restaurant_id,version,configuration,active)
VALUES ('${templateB}','${ownerB}',2,'${snapshot}',FALSE)$sql$,'42501');
COMMIT;
SET ROLE gama_private_template_runtime;
DO $test$ BEGIN
IF EXISTS (SELECT 1 FROM public.restaurant_product_templates) OR EXISTS (SELECT 1 FROM public.restaurant_product_template_versions) THEN RAISE EXCEPTION 'Transaction tenant leaked'; END IF;
END $test$;
RESET ROLE;
DO $test$ BEGIN
IF (SELECT name FROM public.restaurant_product_templates WHERE id='${templateB}') <> 'Meu modelo' THEN RAISE EXCEPTION 'Foreign template changed'; END IF;
IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.restaurant_product_templates'::regclass,'public.restaurant_product_template_versions'::regclass) AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN RAISE EXCEPTION 'RLS not forced'; END IF;
END $test$;
`, true);

sqlTest('RLS policies and forced flags are present on both private tables', `
DO $test$ BEGIN
IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('restaurant_product_templates','restaurant_product_template_versions') AND cmd='ALL' AND qual LIKE '%gama.restaurant_id%' AND with_check LIKE '%gama.restaurant_id%') <> 2 THEN RAISE EXCEPTION 'Missing owner policies'; END IF;
IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.restaurant_product_templates'::regclass,'public.restaurant_product_template_versions'::regclass) AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN RAISE EXCEPTION 'RLS flags missing'; END IF;
END $test$;
`);

sqlTest('private template deletion preserves global templates and independent products/orders', `
-- Artificial legacy fixtures: no real application data or authoritative schema is imported.
CREATE TABLE public.product_templates (id UUID PRIMARY KEY, name TEXT);
CREATE TABLE public.product_template_versions (template_id UUID REFERENCES public.product_templates(id), version INTEGER, configuration JSONB);
CREATE TABLE public.products (id UUID PRIMARY KEY, name TEXT);
CREATE TABLE public.orders (id UUID PRIMARY KEY, total_price NUMERIC);
INSERT INTO public.product_templates VALUES ('${templateA}','Quentinha global');
INSERT INTO public.product_template_versions VALUES ('${templateA}',1,'${snapshot}');
INSERT INTO public.products VALUES ('${templateA}','Independent product');
INSERT INTO public.orders VALUES ('${templateA}',25.00);
${parents}
${versionOne}
BEGIN;
DELETE FROM public.restaurant_product_template_versions WHERE template_id='${templateA}' AND restaurant_id='${ownerA}';
DELETE FROM public.restaurant_product_templates WHERE id='${templateA}' AND restaurant_id='${ownerA}';
COMMIT;
DO $test$ BEGIN
IF (SELECT count(*) FROM public.products) <> 1 OR (SELECT count(*) FROM public.orders) <> 1 OR (SELECT count(*) FROM public.product_templates) <> 1 OR (SELECT count(*) FROM public.product_template_versions) <> 1 THEN RAISE EXCEPTION 'Unrelated rows changed'; END IF;
IF (SELECT total_price FROM public.orders) <> 25.00 THEN RAISE EXCEPTION 'Order price changed'; END IF;
END $test$;
`);

test('migration fails closed on incompatible restaurants ID and rolls back', { skip: unavailable }, () => {
  const db=database();
  execute(db,'CREATE TABLE public.restaurants (id TEXT PRIMARY KEY);');
  const result=run(db,migration);
  assert.notEqual(result.status,0);
  assert.match(result.output,/requires public.restaurants.id as UUID/);
  const checked=execute(db,`DO $test$ BEGIN IF to_regclass('public.restaurant_product_templates') IS NOT NULL THEN RAISE EXCEPTION 'Partial migration survived'; END IF; END $test$; SELECT 'rollback_ok';`);
  assert.match(checked,/rollback_ok/);
});

test('migration requires unique restaurant identity and rolls back on reapplication', { skip: unavailable }, () => {
  const incompatible=database();
  execute(incompatible,'CREATE TABLE public.restaurants (id UUID);');
  assert.notEqual(run(incompatible,migration).status,0);
  assert.match(execute(incompatible,"DO $test$ BEGIN IF to_regclass('public.restaurant_product_templates') IS NOT NULL THEN RAISE EXCEPTION 'Partial table survived'; END IF; END $test$; SELECT 'no_partial_table';"),/no_partial_table/);
  const db=database();execute(db,fixture);execute(db,migration);execute(db,parents);
  assert.notEqual(run(db,migration).status,0);
  assert.match(execute(db,`DO $test$ BEGIN IF (SELECT count(*) FROM public.restaurant_product_templates) <> 2 THEN RAISE EXCEPTION 'Reapply changed data'; END IF; END $test$; SELECT 'unchanged';`),/unchanged/);
});

test('application services and pooled tenant context enforce real PostgreSQL RLS', { skip: unavailable }, async t => {
  if (!serverMode) { t.skip(rlsUnavailable); return; }
  const db = database();
  execute(db, fixture);
  execute(db, migration);
  execute(db, `
CREATE TABLE public.products (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), restaurant_id UUID NOT NULL REFERENCES public.restaurants(id), name TEXT NOT NULL, description TEXT, price NUMERIC NOT NULL, image_url TEXT, available BOOLEAN NOT NULL DEFAULT TRUE, published BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE public.product_variants (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES public.products(id), name TEXT NOT NULL, price NUMERIC NOT NULL, available BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE public.product_option_groups (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES public.products(id), name TEXT NOT NULL, required BOOLEAN NOT NULL, min_select INTEGER NOT NULL, max_select INTEGER NOT NULL);
CREATE TABLE public.product_options (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), group_id UUID NOT NULL REFERENCES public.product_option_groups(id), name TEXT NOT NULL, additional_price NUMERIC NOT NULL, available BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE public.product_variant_group_limits (variant_id UUID NOT NULL REFERENCES public.product_variants(id), group_id UUID NOT NULL REFERENCES public.product_option_groups(id), min_select INTEGER NOT NULL, max_select INTEGER NOT NULL, PRIMARY KEY(variant_id,group_id));
INSERT INTO public.products (id,restaurant_id,name,price) VALUES ('${templateA}','${ownerA}','Local source',20.00);
INSERT INTO public.product_variants (id,product_id,name,price) VALUES ('00000000-0000-4000-8000-000000000030','${templateA}','P',20.00);
INSERT INTO public.product_option_groups (id,product_id,name,required,min_select,max_select) VALUES ('00000000-0000-4000-8000-000000000040','${templateA}','Extras',FALSE,0,2);
INSERT INTO public.product_options (group_id,name,additional_price) VALUES ('00000000-0000-4000-8000-000000000040','Molho',0),('00000000-0000-4000-8000-000000000040','Ovo',2.50);
INSERT INTO public.product_variant_group_limits VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000040',0,2);
CREATE ROLE gama_private_api_runtime LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO gama_private_api_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO gama_private_api_runtime;
`);
  // Load the real services while substituting only the application pool. Never load dotenv/database.ts.
  const vm = require('node:vm'), ts = require('typescript'), { Pool } = require('pg');
  const pool = new Pool({ host: cluster, port: 55439, database: db, user: 'gama_private_api_runtime', ssl: false, max: 1 });
  const cache = new Map();
  function localModule(filename) {
    const resolved = path.resolve(filename);
    if (resolved === path.resolve(__dirname, '../src/database.ts')) return { pool };
    if (cache.has(resolved)) return cache.get(resolved);
    const exports = {}; cache.set(resolved, exports);
    const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(code, { exports, Buffer, require(name) {
      assert.ok(name.startsWith('.'), `Unexpected application dependency ${name}`);
      return localModule(path.resolve(path.dirname(resolved), name + '.ts'));
    } });
    return exports;
  }
  try {
    const { PrivateTemplateService } = localModule(path.resolve(__dirname, '../src/service/privateTemplates/PrivateTemplateService.ts'));
    const service = new PrivateTemplateService();
    const saved = await service.create(ownerA, templateA, { name: 'Private runtime', description: 'Local only' });
    assert.equal((await service.list(ownerA)).length, 1);
    assert.equal((await service.list(ownerB)).length, 0);
    await assert.rejects(service.copy(ownerB, saved.template.id, 1), error => error.status === 404);
    await assert.rejects(service.remove(ownerB, saved.template.id), error => error.status === 404);
    const copied = await service.copy(ownerA, saved.template.id, 1);
    assert.notEqual(copied.product.id, templateA);
    assert.equal(copied.product.published, false);
    await service.version(ownerA, saved.template.id, templateA, 1);
    const detail = await service.get(ownerA, saved.template.id);
    assert.equal(detail.versions.length, 2);
    // Same pooled connection, no tenant transaction: RLS itself must hide the private rows.
    assert.equal((await pool.query('SELECT id FROM public.restaurant_product_templates')).rowCount, 0);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('gama.restaurant_id', $1, true)", [ownerB]);
      assert.equal((await client.query('SELECT id FROM public.restaurant_product_templates WHERE id = $1', [saved.template.id])).rowCount, 0);
      assert.equal((await client.query('UPDATE public.restaurant_product_templates SET name = $2 WHERE id = $1', [saved.template.id, 'Foreign rename'])).rowCount, 0);
      await assert.rejects(client.query('INSERT INTO public.restaurant_product_templates (restaurant_id,name) VALUES ($1,$2)', [ownerA, 'Forged owner']), error => error.code === '42501');
    } finally { await client.query('ROLLBACK'); client.release(); }
    await service.remove(ownerA, saved.template.id);
    assert.equal((await pool.query('SELECT id FROM public.products WHERE id = $1', [copied.product.id])).rowCount, 1);
  } finally { await pool.end(); }
});
