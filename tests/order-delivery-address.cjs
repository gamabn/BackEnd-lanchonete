const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');

// Only a new disposable local cluster is used. Never load dotenv or the application pool.
const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
const unavailable = [postgres, initdb].some(bin =>
  spawnSync(bin, ['--version'], { env: environment, encoding: 'utf8' }).status !== 0);
let cluster;
before(() => {
  if (unavailable) return;
  cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-address-test-'));
  const result = spawnSync(initdb, ['-D', cluster, '-A', 'trust', '-U', 'gama_address_test',
    '--no-sync', '--locale=C', '--encoding=UTF8'], { env: environment, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
after(() => {
  if (cluster && path.dirname(cluster) === os.tmpdir() && path.basename(cluster).startsWith('gama-address-test-')) {
    fs.rmSync(cluster, { recursive: true });
  }
});

test('actual order queries preserve DELIVERY history and prevent PICKUP customer-address fallback', {
  skip: unavailable ? 'Local postgres/initdb unavailable' : false,
}, async () => {
  const queries = [];
  const exports = {};
  const pool = { async query(sql) { queries.push(sql); return { rows: [] }; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(
    path.join(__dirname, '../src/service/order_item/GetOrderItemService.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require(name) { assert.equal(name, '../../database'); return { pool }; } });
  const service = new exports.GetOrderItemService();
  const id = '00000000-0000-4000-8000-000000000100';
  await service.execute(id);
  await service.findByOrderId(id);
  const literal = `'${id}'::uuid`;
  const insert = fs.readFileSync(path.join(__dirname,'../src/service/order/persistValidatedOrder.ts'),'utf8').match(/`(INSERT INTO orders[\s\S]*?)`/)[1];
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/runtime-role-schema.sql'), 'utf8')
    .replace(/^CREATE TABLE public\.orders .*$/m, fs.readFileSync(path.join(__dirname,'fixtures/orders-fulfillment-schema.sql'),'utf8'));
  const sql = `BEGIN;
${fixture}
INSERT INTO restaurants (id, name) VALUES (${literal}, 'Test restaurant');
INSERT INTO customers (id, restaurant_id, name, phone, city, street, number, neighborhood, complement)
VALUES (${literal}, ${literal}, 'Test customer', 'test-phone', 'City A', 'Street A', '10', 'Area A', NULL);
INSERT INTO orders (id, restaurant_id, customer_id, status, total_price, delivery_address)
SELECT ${literal}, ${literal}, id, 'pending', 10,
  jsonb_build_object('city', city, 'street', street, 'number', number,
    'neighborhood', neighborhood, 'complement', complement)
FROM customers;
INSERT INTO orders (id, restaurant_id, customer_id, status, total_price)
VALUES ('00000000-0000-4000-8000-000000000002', ${literal}, ${literal}, 'pending', 10);
INSERT INTO bairros(id,bairro,frete,lanchonete_id) VALUES (${literal},'Area A',2.50,${literal});
PREPARE create_order(uuid,uuid,text,text,text,text,text,text,text,uuid,text) AS ${insert};
EXECUTE create_order(${literal},${literal},'10','Pix','0',NULL,'PICKUP','10','0',NULL,'{"name":"Restaurant","street":"Restaurant street","number":"1","neighborhood":"Restaurant area","city":"Restaurant city"}');
EXECUTE create_order(${literal},${literal},'15','Pix','0','{"city":"City A","street":"New delivery street","number":"11","neighborhood":"Area A","complement":null}','DELIVERY','12.50','2.50',${literal},NULL);
CREATE TEMP VIEW listed_orders AS ${queries[0].replace(/\$1\b/g, literal)};
CREATE TEMP VIEW individual_order AS ${queries[1].replace(/\$1\b/g, literal)};
UPDATE customers SET city = 'City B', street = 'Street B', number = '20',
  neighborhood = 'Area B', complement = 'House';
DO $test$
DECLARE snapshot JSONB; listed JSONB; legacy JSONB;
BEGIN
  SELECT customer::jsonb INTO snapshot FROM individual_order;
  SELECT customer::jsonb INTO listed FROM listed_orders WHERE order_id = ${literal};
  SELECT customer::jsonb INTO legacy FROM listed_orders WHERE order_id = '00000000-0000-4000-8000-000000000002';
  IF snapshot IS DISTINCT FROM jsonb_build_object('id', ${literal}, 'name', 'Test customer',
    'phone', 'test-phone', 'city', 'City A', 'street', 'Street A', 'number', '10',
    'neighborhood', 'Area A', 'complement', NULL) THEN
    RAISE EXCEPTION 'Snapshot changed or response contract differs: %', snapshot;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM orders WHERE fulfillment_type='PICKUP' AND bairro_id IS NULL AND delivery_address IS NULL AND total_price=10 AND subtotal=10 AND delivery_fee=0 AND pickup_address->>'street'='Restaurant street') THEN
    RAISE EXCEPTION 'Current INSERT did not persist valid PICKUP';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM orders WHERE fulfillment_type='DELIVERY' AND bairro_id=${literal} AND pickup_address IS NULL AND total_price=15 AND subtotal=12.50 AND delivery_fee=2.50 AND delivery_address->>'street'='New delivery street') THEN
    RAISE EXCEPTION 'Current INSERT did not persist valid DELIVERY';
  END IF;
  IF EXISTS(SELECT 1 FROM listed_orders WHERE fulfillment_type='PICKUP' AND (customer->>'city' IS NOT NULL OR customer->>'street' IS NOT NULL OR customer->>'number' IS NOT NULL OR customer->>'neighborhood' IS NOT NULL OR customer->>'complement' IS NOT NULL OR delivery_address IS NOT NULL OR pickup_address->>'street' <> 'Restaurant street' OR subtotal <> 10 OR delivery_fee <> 0)) THEN
    RAISE EXCEPTION 'PICKUP leaked customer address or lost snapshot/amounts';
  END IF;
  IF EXISTS(SELECT 1 FROM listed_orders WHERE order_id='00000000-0000-4000-8000-000000000002' AND (fulfillment_type <> 'DELIVERY' OR subtotal IS NOT NULL OR delivery_fee IS NOT NULL OR pickup_address IS NOT NULL)) THEN
    RAISE EXCEPTION 'Historical order changed';
  END IF;
  IF listed IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'List and individual query differ'; END IF;
  IF legacy IS DISTINCT FROM jsonb_build_object('id', ${literal}, 'name', 'Test customer',
    'phone', 'test-phone', 'city', 'City B', 'street', 'Street B', 'number', '20',
    'neighborhood', 'Area B', 'complement', 'House') THEN
    RAISE EXCEPTION 'Legacy NULL fallback failed: %', legacy;
  END IF;
END $test$;
ROLLBACK;`;
  const inputPath = path.join(cluster, 'address-test.sql');
  fs.writeFileSync(inputPath, sql);
  const input = fs.openSync(inputPath, 'r');
  let result;
  try {
    result = spawnSync(postgres, ['--single', '-D', cluster, '-c', 'exit_on_error=true',
      '-c', 'log_checkpoints=off', '-c', 'log_min_messages=error', '-j', 'postgres'], {
      env: environment, stdio: [input, 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000,
    });
  } finally { fs.closeSync(input); }
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
