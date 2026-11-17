const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sql = name => fs.readFileSync(path.join(root,'migrations',name),'utf8');
const baseline = sql('007_remove_legacy_frete.sql');
const fixture = fs.readFileSync(path.join(__dirname,'fixtures/order-post-cleanup-schema.sql'),'utf8');
const env = { PATH:process.env.PATH, LANG:'C', LC_ALL:'C' };
const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const unavailable = [postgres,initdb].some(bin => spawnSync(bin,['--version'],{env,stdio:['ignore','pipe','pipe']}).status !== 0);

test('007 is a read-only baseline, never a destructive replay or recreation', () => {
  const statements = baseline.replace(/--[^\n]*/g,'');
  assert.match(statements,/BEGIN READ ONLY;/);
  assert.doesNotMatch(statements,/\b(?:DROP|ALTER|CREATE|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b/i);
  assert.doesNotMatch(fixture,/\bfrete_id\b|CREATE TABLE public\.frete\b/);
});

// No application pool/dotenv/network/Neon; only current-schema disposable fixtures.
test('current schema -> read-only 007 -> 006 -> read-only 007 on disposable PostgreSQL', {skip:unavailable ? 'postgres/initdb unavailable' : false}, async t => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(),'gama-frete-baseline-'));
  let seq = 0;
  function run(database, text, expectedFailure) {
    const file = path.join(cluster, `input-${++seq}.sql`);
    // Single-user -j treats blank lines as command boundaries inside DO too.
    fs.writeFileSync(file,text.replace(/\n(?:[ \t]*\n)+/g,'\n'));
    const fd = fs.openSync(file,'r'); let result;
    try { result=spawnSync(postgres,['--single','-D',cluster,'-c','exit_on_error=true','-c','log_min_messages=error','-j',database],{env,stdio:[fd,'pipe','pipe'],encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}); }
    finally { fs.closeSync(fd); }
    assert.ifError(result.error);
    const output=result.stdout+result.stderr;
    if(expectedFailure) { assert.notEqual(result.status,0,output); assert.match(output,expectedFailure); }
    else assert.equal(result.status,0,output);
    return output;
  }
  const snapshot = `
CREATE TABLE test_rows_before AS SELECT id,to_jsonb(o) AS original FROM orders o;
CREATE TABLE test_constraints_before AS SELECT conname,contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.orders'::regclass;
CREATE TABLE test_columns_before AS SELECT attnum,attname,atttypid,atttypmod,attnotnull,attacl FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attnum>0 AND NOT attisdropped;
CREATE TABLE test_indexes_before AS SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='orders';
`;
  const unchanged = `DO $$ BEGIN
IF EXISTS(SELECT 1 FROM test_rows_before b FULL JOIN orders o USING(id) WHERE b.original IS DISTINCT FROM to_jsonb(o)) THEN RAISE EXCEPTION 'Rows changed'; END IF;
IF EXISTS(SELECT conname,contype,definition FROM test_constraints_before EXCEPT SELECT conname,contype,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.orders'::regclass) OR (SELECT count(*) FROM test_constraints_before)<>(SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass) THEN RAISE EXCEPTION 'Constraints changed'; END IF;
IF EXISTS(SELECT attnum,attname,atttypid,atttypmod,attnotnull,attacl FROM test_columns_before EXCEPT SELECT attnum,attname,atttypid,atttypmod,attnotnull,attacl FROM pg_attribute WHERE attrelid='public.orders'::regclass AND NOT attisdropped) OR (SELECT count(*) FROM test_columns_before)<>(SELECT count(*) FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attnum>0 AND NOT attisdropped) THEN RAISE EXCEPTION 'Column/ACL changed'; END IF;
IF EXISTS(SELECT indexname,indexdef FROM test_indexes_before EXCEPT SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='orders') OR (SELECT count(*) FROM test_indexes_before)<>(SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='orders') THEN RAISE EXCEPTION 'Indexes changed'; END IF;
IF to_regclass('public.frete') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass AND attname='frete_id' AND NOT attisdropped) THEN RAISE EXCEPTION 'Freight recreated'; END IF;
END $$;`;
  try {
    const init=spawnSync(initdb,['-D',cluster,'-A','trust','-U','baseline_owner','--no-sync','--locale=C','--encoding=UTF8'],{env,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:30000});
    assert.ifError(init.error); assert.equal(init.status,0,init.stdout+init.stderr);
    await t.test('missing orders blocks baseline rather than reporting success', () => {
      run('postgres',baseline,/public.orders is missing/);
    });
    run('postgres',fixture);
    await t.test('preflight recognizes ten columns, three FKs and absent freight objects', () => {
      const output=run('postgres',sql('006_order_fulfillment_preflight.sql'));
      for(const flag of ['frete_table_present','frete_fk_present','frete_id_present','fulfillment_type_present']) assert.match(output,new RegExp(`${flag} = "f"`));
      run('postgres',`DO $$ BEGIN IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders')<>10 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND contype='f')<>3 THEN RAISE EXCEPTION 'Wrong baseline'; END IF; END $$;`);
    });
    run('postgres',snapshot);
    await t.test('007 repeated before 006 performs only state verification', () => {
      for(let i=0;i<2;i++) {
        const output=run('postgres',baseline);
        assert.match(output,/already_applied_manually_state_verified/);
        run('postgres',unchanged);
      }
      run('postgres',sql('007_remove_legacy_frete_verify.sql'));
    });
    await t.test('006 still requires independent DELIVERY history confirmation', () => {
      run('postgres',sql('006_order_fulfillment.sql'),/Confirm historical orders/);
      run('postgres',unchanged);
    });
    await t.test('006 applies after manual cleanup and preserves historical values, all FKs and existing columns', () => {
      run('postgres',"SET gama.orders_history_delivery_confirmed='true';\n"+sql('006_order_fulfillment.sql'));
      run('postgres',`DO $$ BEGIN
IF EXISTS(SELECT 1 FROM test_rows_before b FULL JOIN orders o USING(id) WHERE b.original IS DISTINCT FROM to_jsonb(o)-ARRAY['fulfillment_type','subtotal','delivery_fee','pickup_address']) THEN RAISE EXCEPTION 'Historical values changed'; END IF;
IF EXISTS(SELECT conname,contype,definition FROM test_constraints_before EXCEPT SELECT conname,contype,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.orders'::regclass) THEN RAISE EXCEPTION 'Original constraint removed'; END IF;
IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='orders')<>14 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.orders'::regclass AND contype='f')<>3 THEN RAISE EXCEPTION 'Wrong migrated schema'; END IF;
IF EXISTS(SELECT 1 FROM orders WHERE fulfillment_type<>'DELIVERY' OR subtotal IS NOT NULL OR delivery_fee IS NOT NULL OR pickup_address IS NOT NULL) THEN RAISE EXCEPTION 'Historical amounts invented'; END IF;
IF to_regclass('public.frete') IS NOT NULL THEN RAISE EXCEPTION 'Freight recreated'; END IF;
END $$;`);
    });
    await t.test('007 repeated after 006 and both verification scripts remain read-only', () => {
      const output=run('postgres',sql('006_order_fulfillment_preflight.sql'));
      assert.match(output,/fulfillment_type_present = "t"/);
      run('postgres','CREATE DATABASE migrated_snapshot TEMPLATE postgres;');
      run('migrated_snapshot','ALTER TABLE test_rows_before RENAME TO old_rows_snapshot; ALTER TABLE test_constraints_before RENAME TO old_constraints_snapshot; ALTER TABLE test_columns_before RENAME TO old_columns_snapshot; ALTER TABLE test_indexes_before RENAME TO old_indexes_snapshot;'+snapshot);
      run('migrated_snapshot',baseline); run('migrated_snapshot',baseline);
      run('migrated_snapshot',sql('006_order_fulfillment_verify.sql')); run('migrated_snapshot',sql('007_remove_legacy_frete_verify.sql')); run('migrated_snapshot',unchanged);
      run('migrated_snapshot',"SET gama.orders_history_delivery_confirmed='true';\n"+sql('006_order_fulfillment.sql'),/already exists/);
      run('migrated_snapshot',unchanged);
    });
    await t.test('actual legacy INSERT and PICKUP INSERT work without freight objects under runtime role', () => {
      const insert=fs.readFileSync(path.join(__dirname,'fixtures/legacy-order-insert.sql'),'utf8');
      run('postgres',`SET ROLE gama_app; PREPARE legacy(uuid,uuid,text,text,text,text) AS ${insert}; EXECUTE legacy('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','25','Pix','0','{}'); INSERT INTO orders(fulfillment_type,total_price,subtotal,delivery_fee) VALUES ('PICKUP',20,20,0); RESET ROLE;`);
      run('postgres',baseline);
    });
  } finally { fs.rmSync(cluster,{recursive:true,force:true}); }
});
