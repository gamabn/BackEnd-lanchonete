const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const sqlPath = path.resolve(__dirname, '../migrations/001_restaurant_types.sql');
const migration = fs.readFileSync(sqlPath, 'utf8');
const seed = migration.match(/INSERT INTO public\.restaurant_types\b[\s\S]*?ON CONFLICT \(slug\) DO NOTHING;/)?.[0];
assert.ok(seed, 'The tested seed must be read directly from the versioned migration');
// No dotenv, application pool, connection string, host or network server is used.
const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
let cluster;
let sequence = 0;
let unavailable;
const version = spawnSync(postgres, ['--version'], { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
if (version.status !== 0) unavailable = `Local PostgreSQL unavailable: ${version.error?.code || `exit ${version.status}`}`;
const initVersion = spawnSync(initdb, ['--version'], { encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
if (initVersion.status !== 0) unavailable = `Local initdb unavailable: ${initVersion.error?.code || `exit ${initVersion.status}`}`;

function run(database, sql) {
  assert.ok(cluster && path.basename(cluster).startsWith('gama-types-test-'));
  // A regular input file guarantees EOF in single-user mode, including restricted runtimes.
  const inputPath = path.join(cluster, 'migration-test-input.sql');
  fs.writeFileSync(inputPath, sql, 'utf8');
  const input = fs.openSync(inputPath, 'r');
  let result;
  try {
    result = spawnSync(postgres, [
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
  cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-types-test-'));
  const result = spawnSync(initdb, ['-D', cluster, '-A', 'trust', '-U', 'gama_types_test', '--no-sync', '--locale=C', '--encoding=UTF8'], {
    encoding: 'utf8', env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(fs.existsSync(path.join(cluster, "PG_VERSION")), "initdb must create a real private cluster");
});
after(() => {
  // Only remove the new private temporary cluster created by this test process.
  // Every single-user backend has exited; no external database can be selected.
  if (cluster && path.basename(cluster).startsWith('gama-types-test-') && path.dirname(cluster) === os.tmpdir()) {
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
  const name = `gama_types_case_${++sequence}`;
  execute('postgres', `CREATE DATABASE ${name};`);
  return name;
}
function sqlTest(name, assertions) {
  test(name, { skip: unavailable }, t => {
    t.diagnostic(version.stdout.trim());
    const db = database();
    execute(db, fixture);
    const output = execute(db, `${migration}\n${helpers}\n${assertions}\nSELECT 'gama_migration_assertions_passed';`);
    assert.match(output, /gama_migration_assertions_passed/);
  });
}
const firstLink = `
INSERT INTO public.restaurant_type_links (restaurant_id, type_id, is_primary)
SELECT '00000000-0000-4000-8000-000000000001', id, TRUE
FROM public.restaurant_types WHERE slug = 'pizzaria';
`;

sqlTest('foreign keys reject unknown restaurant/type and preserve linked parents', `
SELECT pg_temp.expect_state($sql$
INSERT INTO public.restaurant_type_links (restaurant_id, type_id)
SELECT '00000000-0000-4000-8000-999999999999', id FROM public.restaurant_types WHERE slug = 'pizzaria'
$sql$, '23503');
SELECT pg_temp.expect_state($sql$
INSERT INTO public.restaurant_type_links (restaurant_id, type_id)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-999999999999')
$sql$, '23503');
${firstLink}
SELECT pg_temp.expect_state($sql$DELETE FROM public.restaurant_types WHERE slug = 'pizzaria'$sql$, '23503,23001');
SELECT pg_temp.expect_state($sql$DELETE FROM public.restaurants WHERE name = 'Legacy A'$sql$, '23503,23001');
`);

sqlTest('duplicate links and duplicate category slugs are rejected', `
${firstLink}
SELECT pg_temp.expect_state($sql$
INSERT INTO public.restaurant_type_links (restaurant_id, type_id, is_primary)
SELECT '00000000-0000-4000-8000-000000000001', id, FALSE FROM public.restaurant_types WHERE slug = 'pizzaria'
$sql$, '23505');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_types (name, slug) VALUES ('Duplicate', 'pizzaria')$sql$, '23505');
`);

sqlTest('partial unique index prevents a second primary on INSERT and UPDATE', `
${firstLink}
SELECT pg_temp.expect_state($sql$
INSERT INTO public.restaurant_type_links (restaurant_id, type_id, is_primary)
SELECT '00000000-0000-4000-8000-000000000001', id, TRUE FROM public.restaurant_types WHERE slug = 'lanchonete'
$sql$, '23505');
INSERT INTO public.restaurant_type_links (restaurant_id, type_id)
SELECT '00000000-0000-4000-8000-000000000001', id FROM public.restaurant_types WHERE slug = 'lanchonete';
SELECT pg_temp.expect_state($sql$
UPDATE public.restaurant_type_links SET is_primary = TRUE
WHERE type_id = (SELECT id FROM public.restaurant_types WHERE slug = 'lanchonete')
$sql$, '23505');
`);

sqlTest('additional categories and an independent primary per establishment are allowed', `
${firstLink}
INSERT INTO public.restaurant_type_links (restaurant_id, type_id)
SELECT '00000000-0000-4000-8000-000000000001', id FROM public.restaurant_types WHERE slug IN ('lanchonete', 'hamburgueria');
INSERT INTO public.restaurant_type_links (restaurant_id, type_id, is_primary)
SELECT '00000000-0000-4000-8000-000000000002', id, TRUE FROM public.restaurant_types WHERE slug = 'pizzaria';
DO $test$
BEGIN
    IF (SELECT count(*) FROM public.restaurant_type_links) <> 4 THEN RAISE EXCEPTION 'Additional links missing'; END IF;
    IF (SELECT count(*) FROM public.restaurant_type_links WHERE is_primary) <> 2 THEN RAISE EXCEPTION 'Tenant-scoped primaries missing'; END IF;
END
$test$;
`);

sqlTest('legacy establishments stay unchanged with zero categories and no forced primary', `
DO $test$
BEGIN
    IF (SELECT count(*) FROM public.restaurants) <> 2 THEN RAISE EXCEPTION 'Legacy restaurant count changed'; END IF;
    IF (SELECT name FROM public.restaurants WHERE id = '00000000-0000-4000-8000-000000000001') <> 'Legacy A' THEN RAISE EXCEPTION 'Legacy data changed'; END IF;
    IF EXISTS (SELECT 1 FROM public.restaurant_type_links) THEN RAISE EXCEPTION 'Migration classified legacy restaurants'; END IF;
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'restaurants') <> 2 THEN RAISE EXCEPTION 'Legacy schema changed'; END IF;
END
$test$;
INSERT INTO public.restaurants (id, name) VALUES ('00000000-0000-4000-8000-000000000003', 'New unclassified');
-- Exactly one primary is intentionally a future backend rule, not a database requirement.
INSERT INTO public.restaurant_type_links (restaurant_id, type_id)
SELECT '00000000-0000-4000-8000-000000000003', id FROM public.restaurant_types WHERE slug = 'outros';
`);

sqlTest('seed is idempotent and does not overwrite IDs, names, active flags or custom types', `
CREATE TEMP TABLE original_ids AS SELECT id, slug FROM public.restaurant_types;
${seed}
${seed}
DO $test$
BEGIN
    IF (SELECT count(*) FROM public.restaurant_types) <> 7 THEN RAISE EXCEPTION 'Seed duplicated categories'; END IF;
    IF EXISTS (SELECT 1 FROM original_ids o JOIN public.restaurant_types t USING (slug) WHERE o.id <> t.id) THEN RAISE EXCEPTION 'Seed changed IDs'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.restaurant_types WHERE name = 'Açaiteria' AND slug = 'acaiteria' AND active) THEN RAISE EXCEPTION 'Unicode label or slug incorrect'; END IF;
END
$test$;
-- Changes below affect only this new local fixture and test preservation on reseeding.
UPDATE public.restaurant_types SET active = FALSE, name = 'Custom name' WHERE slug = 'pizzaria';
INSERT INTO public.restaurant_types (name, slug) VALUES ('Custom type', 'custom-type');
${seed}
DO $test$
BEGIN
    IF (SELECT count(*) FROM public.restaurant_types) <> 8 THEN RAISE EXCEPTION 'Seed affected custom types'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.restaurant_types WHERE slug = 'pizzaria' AND NOT active AND name = 'Custom name') THEN RAISE EXCEPTION 'Seed overwrote existing values'; END IF;
END
$test$;
`);

sqlTest('null primary flags cannot bypass the index and category defaults are valid', `
SELECT pg_temp.expect_state($sql$
INSERT INTO public.restaurant_type_links (restaurant_id, type_id, is_primary)
SELECT '00000000-0000-4000-8000-000000000001', id, NULL FROM public.restaurant_types WHERE slug = 'outros'
$sql$, '23502');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_types (name, slug) VALUES ('Invalid', 'Açai')$sql$, '23514');
SELECT pg_temp.expect_state($sql$INSERT INTO public.restaurant_types (name, slug) VALUES (' ', 'blank')$sql$, '23514');
INSERT INTO public.restaurant_types (name, slug) VALUES ('Default active', 'default-active');
DO $test$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.restaurant_types WHERE slug = 'default-active' AND active AND pg_typeof(id) = 'uuid'::regtype) THEN RAISE EXCEPTION 'UUID/default active incorrect'; END IF;
END
$test$;
`);

test('an incompatible restaurants.id type aborts safely without converting existing data', { skip: unavailable }, () => {
  const db = database();
  execute(db, "CREATE TABLE public.restaurants (id TEXT PRIMARY KEY, name TEXT); INSERT INTO public.restaurants VALUES ('legacy-text-id', 'Untouched');");
  const result = run(db, migration);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /requires public\.restaurants\.id with type UUID/);
  execute(db, `DO $test$ BEGIN
    IF to_regclass('public.restaurant_types') IS NOT NULL OR to_regclass('public.restaurant_type_links') IS NOT NULL THEN RAISE EXCEPTION 'Failed migration left tables'; END IF;
    IF (SELECT name FROM public.restaurants WHERE id = 'legacy-text-id') <> 'Untouched' THEN RAISE EXCEPTION 'Existing data converted'; END IF;
  END $test$;`);
});

test('missing restaurants.id uniqueness rolls back all new tables without changing the parent', { skip: unavailable }, () => {
  const db = database();
  execute(db, "CREATE TABLE public.restaurants (id UUID, name TEXT); INSERT INTO public.restaurants VALUES ('00000000-0000-4000-8000-000000000001', 'Untouched');");
  const result = run(db, migration);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /no unique constraint matching|no unique constraint on referenced table/i);
  execute(db, `DO $test$ BEGIN
    IF to_regclass('public.restaurant_types') IS NOT NULL OR to_regclass('public.restaurant_type_links') IS NOT NULL THEN RAISE EXCEPTION 'FK failure left partial schema'; END IF;
    IF (SELECT count(*) FROM public.restaurants WHERE name = 'Untouched') <> 1 THEN RAISE EXCEPTION 'Existing parent changed'; END IF;
  END $test$;`);
});
