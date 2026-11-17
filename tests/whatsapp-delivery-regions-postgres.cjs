const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const env = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
const unavailable = [postgres, initdb].some(bin => spawnSync(bin, ['--version'], { env, encoding: 'utf8' }).status !== 0);
let cluster;
before(() => {
  if (unavailable) return;
  cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-regions-sql-'));
  const result = spawnSync(initdb, ['-D', cluster, '-A', 'trust', '-U', 'gama_regions_test', '--no-sync', '--locale=C', '--encoding=UTF8'], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
after(() => {
  if (cluster && path.dirname(cluster) === os.tmpdir() && path.basename(cluster).startsWith('gama-regions-sql-')) fs.rmSync(cluster, { recursive: true });
});
const literal = text => `'${String(text).replace(/'/g, "''")}'`;
const interpolate = call => call.sql.replace(/\$(\d+)\b/g, (_match, index) => literal(call.params[Number(index) - 1]));

test('getBairro preserves legacy listing and uses actual PostgreSQL lower/btrim with scoped rows', { skip: unavailable ? 'Local PostgreSQL tools unavailable' : false }, async () => {
  const calls = [], exports = {};
  const pool = { query: async (sql, params) => { calls.push({ sql, params: Array.from(params) }); return { rows: [] }; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/service/bairro/bairroService.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require(name) { assert.equal(name, '../../database'); return { pool }; } });
  const restaurant = '00000000-0000-4000-8000-000000009101';
  const other = '00000000-0000-4000-8000-000000009102';
  const service = new exports.bairroService();
  await service.getBairro(restaurant);
  await service.getBairro(restaurant, ' Santa Cruz ');
  await service.getBairro(restaurant, 'Sao Jose');
  await service.getBairro(restaurant, 'São José');
  assert.equal(calls[0].params.length, 1); assert.doesNotMatch(calls[0].sql, /matches_address/);
  assert.equal(calls[1].params[1], ' Santa Cruz ');
  assert.match(calls[1].sql, /lower\(btrim\(bairro\)\) = lower\(btrim\(\$2::text\)\)/);
  assert.ok(calls.every(call => /lanchonete_id = \$1 AND EXISTS/.test(call.sql)));
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/runtime-role-schema.sql'), 'utf8');
  const script = `BEGIN;
${fixture}
ALTER TABLE bairros ALTER COLUMN bairro TYPE VARCHAR, ALTER COLUMN bairro SET NOT NULL,
  ALTER COLUMN frete TYPE NUMERIC(10,2), ALTER COLUMN frete SET NOT NULL;
INSERT INTO restaurants (id,name) VALUES (${literal(restaurant)}, 'A'), (${literal(other)}, 'B');
INSERT INTO bairros (id,bairro,frete,lanchonete_id) VALUES
 ('00000000-0000-4000-8000-000000009201', ' Santa Cruz ', 5.00, ${literal(restaurant)}),
 ('00000000-0000-4000-8000-000000009202', 'SANTA CRUZ', 7.50, ${literal(restaurant)}),
 ('00000000-0000-4000-8000-000000009203', 'Santa  Cruz', 8.00, ${literal(restaurant)}),
 ('00000000-0000-4000-8000-000000009204', 'São José', 0.00, ${literal(restaurant)}),
 ('00000000-0000-4000-8000-000000009205', 'Santa Cruz', 1.00, ${literal(other)}),
 ('00000000-0000-4000-8000-000000009206', 'Santa Cruz', 1.00, NULL),
 ('00000000-0000-4000-8000-000000009207', E'Santa Cruz\\t', 2.00, ${literal(restaurant)});
CREATE TEMP VIEW legacy_regions AS ${interpolate(calls[0])};
CREATE TEMP VIEW matched_regions AS ${interpolate(calls[1])};
CREATE TEMP VIEW without_accent AS ${interpolate(calls[2])};
CREATE TEMP VIEW with_accent AS ${interpolate(calls[3])};
DO $test$
BEGIN
 IF (SELECT count(*) FROM legacy_regions) <> 5 THEN RAISE EXCEPTION 'Scope differs'; END IF;
 IF EXISTS (SELECT 1 FROM legacy_regions WHERE lanchonete_id IS NULL OR lanchonete_id <> ${literal(restaurant)}) THEN RAISE EXCEPTION 'Wrong tenant'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='legacy_regions' AND column_name='matches_address') THEN RAISE EXCEPTION 'Legacy API shape changed'; END IF;
 IF (SELECT count(*) FROM matched_regions WHERE matches_address) <> 2 THEN RAISE EXCEPTION 'Duplicate matches hidden'; END IF;
 IF EXISTS (SELECT 1 FROM matched_regions WHERE matches_address AND bairro IN ('Santa  Cruz', E'Santa Cruz\\t')) THEN RAISE EXCEPTION 'Trimming differs from backend'; END IF;
 IF EXISTS (SELECT 1 FROM without_accent WHERE matches_address) THEN RAISE EXCEPTION 'Accent was removed'; END IF;
 IF (SELECT count(*) FROM with_accent WHERE matches_address AND frete::text='0.00') <> 1 THEN RAISE EXCEPTION 'Zero fee or accent differs'; END IF;
END $test$;
ROLLBACK;`;
  const input = path.join(cluster, 'regions.sql'); fs.writeFileSync(input, script);
  const fd = fs.openSync(input, 'r'); let result;
  try { result = spawnSync(postgres, ['--single', '-D', cluster, '-c', 'exit_on_error=true', '-c', 'log_checkpoints=off', '-c', 'log_min_messages=error', '-j', 'postgres'], { env, stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 }); }
  finally { fs.closeSync(fd); }
  assert.ifError(result.error); assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
