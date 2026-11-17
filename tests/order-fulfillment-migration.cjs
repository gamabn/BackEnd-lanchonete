const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
// No dotenv, application pool, network listener or external database credentials.
const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
const unavailable = [postgres, initdb].some(bin => spawnSync(bin, ['--version'], { env: environment }).status !== 0);
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/006_order_fulfillment.sql'), 'utf8');
const restaurant = '00000000-0000-4000-8000-000000000001';
const customer = '00000000-0000-4000-8000-000000000002';
const bairro = '00000000-0000-4000-8000-000000000003';
const historical = '00000000-0000-4000-8000-000000000004';
const fixture = `
CREATE ROLE gama_app NOLOGIN;
CREATE TABLE public.restaurants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY);
CREATE TABLE public.bairros(id uuid PRIMARY KEY);
CREATE TABLE public.orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 restaurant_id uuid REFERENCES public.restaurants(id),
 customer_id uuid REFERENCES public.customers(id),
 status text, total_price numeric, created_at timestamptz DEFAULT now(),
 payment_method text, change_for numeric,
 bairro_id uuid REFERENCES public.bairros(id), delivery_address jsonb
);
INSERT INTO restaurants VALUES ('${restaurant}');
INSERT INTO customers VALUES ('${customer}');
INSERT INTO bairros VALUES ('${bairro}');
INSERT INTO orders(id,restaurant_id,customer_id,status,total_price,payment_method,change_for,bairro_id,delivery_address)
VALUES ('${historical}','${restaurant}','${customer}','completed',37.50,'Pix',0,'${bairro}','{"street":"Historical Street"}');
-- Preserve both a populated row and a legacy row without address/amount evidence.
INSERT INTO orders(restaurant_id,customer_id,status,total_price) VALUES ('${restaurant}','${customer}','pending',NULL);
CREATE TABLE migration_test_before AS SELECT id,to_jsonb(o) AS original FROM orders o;
CREATE TABLE migration_test_constraints AS SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.orders'::regclass;
GRANT USAGE ON SCHEMA public TO gama_app;
GRANT SELECT ON public.orders TO gama_app;
GRANT INSERT(restaurant_id,customer_id,status,total_price,payment_method,change_for) ON public.orders TO gama_app;
GRANT UPDATE(status) ON public.orders TO gama_app;
`;
const expectRejected = `
CREATE FUNCTION pg_temp.expect_rejected(command text, expected text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Unexpected success: %', command;
END $fn$;
`;

test('006 migration on disposable PostgreSQL', { skip: unavailable ? 'postgres/initdb unavailable' : false }, async t => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-order-migration-'));
  let sequence = 0;
  function run(sql, succeeds = true, allowCaught = false) {
    const file = path.join(cluster, `case-${++sequence}.sql`);
    fs.writeFileSync(file, sql);
    const input = fs.openSync(file, 'r');
    let result;
    try {
      result = spawnSync(postgres, ['--single', '-D', cluster, '-c', `exit_on_error=${allowCaught ? 'false' : 'true'}`, '-c', 'log_min_messages=error', '-j', 'postgres'], {
        env: environment, stdio: [input, 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
      });
    } finally { fs.closeSync(input); }
    assert.ifError(result.error);
    if (succeeds) assert.equal(result.status, 0, result.stdout + result.stderr);
    else assert.notEqual(result.status, 0, 'Expected migration failure');
    if (allowCaught) assert.doesNotMatch(result.stdout + result.stderr, /(?:ERROR|FATAL):/, 'Unexpected uncaught SQL error');
    return result.stdout + result.stderr;
  }
  try {
    const initialized = spawnSync(initdb, ['-D', cluster, '-A', 'trust', '-U', 'migration_owner', '--no-sync', '--locale=C', '--encoding=UTF8'], { env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    assert.ifError(initialized.error);
    assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
    run(fixture);
    run(fs.readFileSync(path.join(root,'migrations/007_remove_legacy_frete.sql'),'utf8'));
    run(fs.readFileSync(path.join(root,'migrations/006_order_fulfillment_preflight.sql'),'utf8'));
    await t.test('preflight safely reports an absent runtime role', () => {
      run('ALTER ROLE gama_app RENAME TO migration_test_app;');
      try {
        const output = run(fs.readFileSync(path.join(root,'migrations/006_order_fulfillment_preflight.sql'),'utf8'));
        assert.match(output, /gama_app_exists = "f"/);
      } finally { run('ALTER ROLE migration_test_app RENAME TO gama_app;'); }
    });
    await t.test('history confirmation is mandatory; failed migration leaves original schema intact', () => {
      for (const setting of ['', "SET gama.orders_history_delivery_confirmed='false';\n", "SET gama.orders_history_delivery_confirmed='';\n"]) {
        assert.match(run(setting + migration, false), /Confirm historical orders/);
      }
      run(`DO $$ BEGIN IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders') <> 10 THEN RAISE EXCEPTION 'Schema changed'; END IF; END $$;`);
    });
    await t.test('migration preserves every old value, all three FKs and primary key; validates checks and exact types', () => {
      run(`SET gama.orders_history_delivery_confirmed='true';\n${migration}`);
      run(fs.readFileSync(path.join(root,'migrations/007_remove_legacy_frete.sql'),'utf8'));
      run(`DO $$ BEGIN
        IF (SELECT count(*) FROM orders) <> 2 THEN RAISE EXCEPTION 'Rows changed'; END IF;
        IF EXISTS(SELECT 1 FROM orders o JOIN migration_test_before b USING(id)
          WHERE to_jsonb(o) - ARRAY['fulfillment_type','subtotal','delivery_fee','pickup_address'] IS DISTINCT FROM b.original
          OR o.fulfillment_type <> 'DELIVERY' OR o.subtotal IS NOT NULL OR o.delivery_fee IS NOT NULL OR o.pickup_address IS NOT NULL) THEN RAISE EXCEPTION 'History changed'; END IF;
        IF EXISTS(SELECT conname,contype,definition FROM migration_test_constraints EXCEPT
          SELECT conname,contype,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.orders'::regclass) THEN RAISE EXCEPTION 'Original constraints changed'; END IF;
        IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND contype='f') <> 3 THEN RAISE EXCEPTION 'FK count changed'; END IF;
        IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND contype='c' AND convalidated) <> 6 THEN RAISE EXCEPTION 'Checks not validated'; END IF;
        IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name IN ('subtotal','delivery_fee') AND numeric_precision=12 AND numeric_scale=2 AND is_nullable='YES' AND column_default IS NULL) <> 2 THEN RAISE EXCEPTION 'Wrong amounts'; END IF;
        IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='fulfillment_type' AND character_maximum_length=10 AND is_nullable='NO' AND column_default LIKE '%DELIVERY%') THEN RAISE EXCEPTION 'Wrong fulfillment definition'; END IF;
        IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='pickup_address' AND data_type='jsonb' AND is_nullable='YES' AND column_default IS NULL) THEN RAISE EXCEPTION 'Wrong pickup snapshot'; END IF;
        IF (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='orders') <> 2 THEN RAISE EXCEPTION 'Unexpected indexes'; END IF;
        IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='orders_restaurant_created_at_idx' AND indexdef LIKE '%(restaurant_id, created_at DESC)%') THEN RAISE EXCEPTION 'Wrong index'; END IF;
      END $$;`);
    });
    await t.test('DELIVERY, PICKUP and unknown historical components remain compatible', () => {
      run(`INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee,bairro_id,delivery_address)
          VALUES ('DELIVERY',25,20,5,'${bairro}','{"city":"Test"}'),('PICKUP',20,20,0,NULL,NULL),('DELIVERY',99,NULL,5,NULL,NULL),('DELIVERY',99,20,NULL,NULL,NULL);
        INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee,pickup_address)
          VALUES ('PICKUP',20,20,0,'{"street":"Restaurant Street"}'),('PICKUP',0,0,0,NULL);
        UPDATE orders SET status='pending' WHERE id='${historical}';`);
    });
    await t.test('invalid modality, explicit NULL, negative/NaN amounts and mismatched totals are rejected', () => {
      const cases = [
        ["INSERT INTO orders(fulfillment_type) VALUES ('PICKUP')", '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',20,20,NULL)", '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',20,NULL,0)", '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',NULL,20,0)", '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',NULL,NULL,0)", '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',NULL,NULL,NULL)", '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',21,20,0)", '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES (NULL,20,20,0)", '23502'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',0,-1,0)", '23514'],
        ["UPDATE orders SET delivery_fee=NULL WHERE fulfillment_type='PICKUP'", '23514'],
        ["UPDATE orders SET subtotal=NULL WHERE fulfillment_type='PICKUP'", '23514'],
        ["UPDATE orders SET total_price=NULL WHERE fulfillment_type='PICKUP'", '23514'],
        ["UPDATE orders SET fulfillment_type=NULL WHERE fulfillment_type='PICKUP'", '23502'],
        ["INSERT INTO orders(fulfillment_type) VALUES ('OTHER')", '23514'],
        ["INSERT INTO orders(fulfillment_type) VALUES (NULL)", '23502'],
        ["INSERT INTO orders(subtotal) VALUES (-0.01)", '23514'],
        ["INSERT INTO orders(delivery_fee) VALUES (-0.01)", '23514'],
        ["INSERT INTO orders(subtotal) VALUES ('NaN')", '23514'],
        ["INSERT INTO orders(delivery_fee) VALUES ('NaN')", '23514'],
        ["INSERT INTO orders(total_price,subtotal,delivery_fee) VALUES (26,20,5)", '23514'],
        ["INSERT INTO orders(total_price,subtotal,delivery_fee) VALUES (NULL,20,5)", '23514'],
        ["INSERT INTO orders(total_price,subtotal,delivery_fee) VALUES (25.01,20,5)", '23514'],
        ["INSERT INTO orders(fulfillment_type,delivery_fee) VALUES ('PICKUP',1)", '23514'],
        [`INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee,bairro_id) VALUES ('PICKUP',20,20,0,'${bairro}')`, '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee,delivery_address) VALUES ('PICKUP',20,20,0,'{}')", '23514'],
        ["INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee,delivery_address) VALUES ('PICKUP',20,20,0,'null'::jsonb)", '23514'],
        ["UPDATE orders SET fulfillment_type='PICKUP' WHERE id='" + historical + "'", '23514'],
        ["INSERT INTO orders(restaurant_id) VALUES ('00000000-0000-4000-8000-000000000099')", '23503'],
        ["INSERT INTO orders(customer_id) VALUES ('00000000-0000-4000-8000-000000000099')", '23503'],
        ["INSERT INTO orders(bairro_id) VALUES ('00000000-0000-4000-8000-000000000099')", '23503'],
      ];
      run(expectRejected + cases.map(([sql, state]) => `SELECT pg_temp.expect_rejected('${sql.replaceAll("'", "''")}','${state}');`).join('\n'), true, true);
    });
    await t.test('every PICKUP amount NULL combination is rejected on INSERT', () => {
      const statements = [];
      for (let mask = 1; mask < 8; mask++) {
        const subtotal = mask & 1 ? 'NULL' : '20';
        const fee = mask & 2 ? 'NULL' : '0';
        const total = mask & 4 ? 'NULL' : '20';
        const sql = `INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',${total},${subtotal},${fee})`;
        statements.push(`SELECT pg_temp.expect_rejected('${sql.replaceAll("'", "''")}','23514');`);
      }
      run(expectRejected + statements.join('\n'), true, true);
    });
    await t.test('runtime can execute actual legacy INSERT and new inserts; UPDATE remains status-only', () => {
      const insert = fs.readFileSync(path.join(__dirname,'fixtures/legacy-order-insert.sql'),'utf8');
      run(expectRejected + `SET ROLE gama_app;
        PREPARE legacy(uuid,uuid,text,text,text,text) AS ${insert};
        EXECUTE legacy('${restaurant}','${customer}','25.00','Pix','0','{"city":"Test"}');
        INSERT INTO orders(restaurant_id,customer_id,fulfillment_type,total_price,subtotal,delivery_fee,bairro_id,delivery_address)
        VALUES ('${restaurant}','${customer}','DELIVERY',25,20,5,'${bairro}','{}');
        INSERT INTO orders(restaurant_id,customer_id,fulfillment_type,total_price,subtotal,delivery_fee,pickup_address)
        VALUES ('${restaurant}','${customer}','PICKUP',20,20,0,'{}');
        UPDATE orders SET status='pending' WHERE id='${historical}';
        RESET ROLE;
        DO $$ DECLARE col text; BEGIN
          IF has_table_privilege('gama_app','public.orders','INSERT') OR has_table_privilege('gama_app','public.orders','UPDATE') THEN RAISE EXCEPTION 'Table-wide write privilege'; END IF;
          FOREACH col IN ARRAY ARRAY['fulfillment_type','subtotal','delivery_fee','pickup_address','delivery_address','bairro_id','total_price','restaurant_id','customer_id'] LOOP
            IF has_column_privilege('gama_app','public.orders',col,'UPDATE') THEN RAISE EXCEPTION 'Unexpected UPDATE privilege: %',col; END IF;
          END LOOP;
          IF to_regclass('public.frete') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='frete_id' AND NOT attisdropped) THEN RAISE EXCEPTION 'Legacy freight recreated'; END IF;
          IF EXISTS(SELECT 1 FROM orders WHERE payment_method='Pix' AND delivery_address->>'city'='Test' AND (fulfillment_type <> 'DELIVERY' OR subtotal IS NOT NULL OR delivery_fee IS NOT NULL)) THEN RAISE EXCEPTION 'Legacy defaults wrong'; END IF;
        END $$;
        SET ROLE gama_app;
        SELECT pg_temp.expect_rejected('UPDATE orders SET total_price=0','42501');
        SELECT pg_temp.expect_rejected('UPDATE orders SET fulfillment_type=''PICKUP''','42501');
        RESET ROLE;`, true, true);
    });
    await t.test('read-only review scripts execute against baseline and migrated schema', () => {
      // Preflight intentionally supports both baseline and migrated columns.
      for (const file of ['006_order_fulfillment_preflight.sql','006_order_fulfillment_verify.sql']) run(fs.readFileSync(path.join(root,'migrations',file),'utf8'));
    });
    await t.test('reapplication fails atomically without removing constraints or data', () => {
      assert.match(run(`SET gama.orders_history_delivery_confirmed='true';\n${migration}`, false), /already exists/);
      run(`DO $$ BEGIN IF (SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND contype='f') <> 3 THEN RAISE EXCEPTION 'FK lost'; END IF; IF NOT EXISTS(SELECT 1 FROM orders WHERE id='${historical}') THEN RAISE EXCEPTION 'History lost'; END IF; END $$;`);
    });
  } finally {
    if (path.dirname(cluster) === os.tmpdir() && path.basename(cluster).startsWith('gama-order-migration-')) fs.rmSync(cluster, { recursive: true, force: true });
  }
});
