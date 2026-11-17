const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
// Disposable local cluster in single-user mode: no sockets, dotenv, or application database.
const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const env = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
const unavailable = [postgres, initdb].some(bin => spawnSync(bin, ['--version'], { env, encoding: 'utf8' }).status !== 0);
let cluster;
before(() => {
  if (unavailable) return;
  cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-wa-address-sql-'));
  const result = spawnSync(initdb, ['-D', cluster, '-A', 'trust', '-U', 'gama_address_test', '--no-sync', '--locale=C', '--encoding=UTF8'], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
after(() => {
  if (cluster && path.dirname(cluster) === os.tmpdir() && path.basename(cluster).startsWith('gama-wa-address-sql-')) fs.rmSync(cluster, { recursive: true });
});
function load(file, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require(name) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  return exports;
}
const literal = value => value === null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;
const sqlWithParameters = call => call.sql.replace(/\$(\d+)\b/g, (_match, index) => literal(call.params[Number(index) - 1]));

test('actual address service SQL respects tenant ownership, real varchar limits and rollback', { skip: unavailable ? 'Local PostgreSQL tools unavailable' : false }, async () => {
  const restaurant = '00000000-0000-4000-8000-000000009001';
  const otherRestaurant = '00000000-0000-4000-8000-000000009002';
  const customer = '00000000-0000-4000-8000-000000009003';
  const otherCustomer = '00000000-0000-4000-8000-000000009004';
  const original = { street: null, number: null, neighborhood: null, city: null, complement: null };
  const address = { street: "Rua d'Água", number: '25', neighborhood: " Vila  d'Água ", city: 'Cidade Teste', complement: null };
  const columns = Object.keys(address).map(column_name => ({ column_name, data_type: column_name === 'street' ? 'character varying' : 'text', character_maximum_length: column_name === 'street' ? 20 : null, is_nullable: 'YES', is_generated: 'NEVER', is_identity: 'NO' }));
  const calls = [];
  const client = { async query(sql, params = []) {
    calls.push({ sql, params: Array.from(params) });
    if (sql.includes('FROM public.customers WHERE')) return { rows: [{ id: customer, restaurant_id: restaurant, ...original }] };
    if (sql.includes('FROM customers WHERE')) return { rows: [{ id: customer, restaurant_id: restaurant, international_format: false, national_format: true }] };
    if (sql.includes('FROM bairros WHERE')) return { rows: [{ id: '00000000-0000-4000-8000-000000009010', bairro: address.neighborhood, frete: '5.00', lanchonete_id: restaurant, ...(params.length > 1 ? { matches_address: true } : {}) }] };
    if (sql.includes('information_schema.columns')) return { rows: columns };
    if (sql.startsWith('UPDATE public.customers')) return { rows: [{ id: customer, restaurant_id: restaurant, ...address }] };
    return { rows: [] };
  }, release() {} };
  const pool = { connect: async () => client };
  const security = load('src/security/customerAddress.ts', {});
  const phones = load('src/security/customerPhone.ts', {});
  const schema = load('src/service/clients/customerAddressSchema.ts', { '../../security/customerAddress': security });
  const dependencies = { '../../database': { pool }, '../../security/customerAccess': { customerColumns: 'id' }, '../../security/customerAddress': security, '../../security/customerPhone': phones, './customerAddressSchema': schema };
  const money = load('src/service/order/orderValidation.ts', {});
  dependencies['../../security/deliveryFee'] = load('src/security/deliveryFee.ts', { '../service/order/orderValidation': money });
  dependencies['../bairro/bairroService'] = load('src/service/bairro/bairroService.ts', dependencies);
  const getters = load('src/service/clients/GetClientService.ts', dependencies);
  const updates = load('src/service/clients/UpdateClientService.ts', dependencies);
  const service = load('src/service/clients/CustomerAddressService.ts', { ...dependencies, './GetClientService': getters, './UpdateClientService': updates });
  assert.equal((await new service.CustomerAddressService(pool).save({ customer_id: customer, restaurant_id: restaurant, phone: '5577999999999' }, original, address, { bairro_id: '00000000-0000-4000-8000-000000009010', fee: '5.00' })).kind, 'saved');
  const update = calls.find(call => call.sql.startsWith('UPDATE public.customers'));
  const read = calls.find(call => call.sql.includes('FROM public.customers WHERE'));
  const wrongTenantUpdate = { sql: update.sql, params: update.params.map((value, index) => index === 6 ? otherRestaurant : value) };
  const wrongTenantRead = { sql: read.sql, params: [customer, otherRestaurant] };
  const oversized = { sql: update.sql, params: update.params.map((value, index) => index === 1 ? 'X'.repeat(21) : value) };
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/runtime-role-schema.sql'), 'utf8');
  const script = `BEGIN;
${fixture}
ALTER TABLE customers ALTER COLUMN street TYPE VARCHAR(20);
INSERT INTO restaurants (id, name) VALUES (${literal(restaurant)}, 'Restaurant A'), (${literal(otherRestaurant)}, 'Restaurant B');
INSERT INTO customers (id, restaurant_id, name, phone, street, number, neighborhood, city, complement)
VALUES (${literal(customer)}, ${literal(restaurant)}, 'Customer A', '77999999999', NULL, NULL, NULL, NULL, NULL),
       (${literal(otherCustomer)}, ${literal(otherRestaurant)}, 'Customer B', '77999999999', 'Rua B', '7', 'Bairro B', 'Cidade B', NULL);
INSERT INTO bairros (id, bairro, frete, lanchonete_id) VALUES ('00000000-0000-4000-8000-000000009010', ${literal(address.neighborhood)}, 5.00, ${literal(restaurant)});
COMMIT;
${calls.map(call => sqlWithParameters(call) + ';').join('\n')}
SET exit_on_error = off;
DO $test$
DECLARE changed INTEGER; original_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = ${literal(customer)} AND restaurant_id = ${literal(restaurant)}
    AND street = ${literal(address.street)} AND number = '25' AND neighborhood = ${literal(address.neighborhood)} AND city = 'Cidade Teste' AND complement IS NULL
    AND name = 'Customer A' AND phone = '77999999999') THEN RAISE EXCEPTION 'Address or immutable fields differ'; END IF;
  SELECT count(*) INTO changed FROM (${sqlWithParameters(wrongTenantRead)}) scoped;
  IF changed <> 0 THEN RAISE EXCEPTION 'Cross-tenant address read'; END IF;
  WITH updated AS (${sqlWithParameters(wrongTenantUpdate)}) SELECT count(*) INTO changed FROM updated;
  IF changed <> 0 THEN RAISE EXCEPTION 'Cross-tenant address write'; END IF;
  BEGIN
    WITH updated AS (${sqlWithParameters(oversized)}) SELECT count(*) INTO changed FROM updated;
    RAISE EXCEPTION 'Expected varchar length error';
  EXCEPTION WHEN string_data_right_truncation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = ${literal(customer)} AND street = ${literal(address.street)}) THEN RAISE EXCEPTION 'Failed update changed original'; END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = ${literal(otherCustomer)} AND street = 'Rua B' AND name = 'Customer B') THEN RAISE EXCEPTION 'Other customer changed'; END IF;
END $test$;`;
  const inputPath = path.join(cluster, 'address.sql'); fs.writeFileSync(inputPath, script);
  const fd = fs.openSync(inputPath, 'r'); let result;
  try {
    result = spawnSync(postgres, ['--single', '-D', cluster, '-c', 'exit_on_error=true', '-c', 'log_checkpoints=off', '-c', 'log_min_messages=error', '-j', 'postgres'], { env, stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000 });
  } finally { fs.closeSync(fd); }
  assert.ifError(result.error); assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(result.stdout + result.stderr, /\b(?:ERROR|FATAL):/);
});
