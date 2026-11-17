const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { id, request, session } = require('./fixtures/whatsapp-idempotency.cjs');
const api = require('../src/messaging/checkout/checkoutIdempotency');
const env = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
const bin = name => ({ postgres: process.env.GAMA_TEST_POSTGRES_BIN, initdb: process.env.GAMA_TEST_INITDB_BIN, pg_ctl: process.env.GAMA_TEST_PG_CTL_BIN }[name] || name);
const unavailable = ['postgres','initdb','pg_ctl'].some(name => spawnSync(bin(name), ['--version'], { env }).status !== 0);
function command(name,args) { const r = spawnSync(bin(name),args,{env,encoding:'utf8',timeout:30000}); assert.equal(r.status,0,`${name}: ${r.stdout}\n${r.stderr}`); }
async function transaction(pool, fn, isolation = 'READ COMMITTED') {
  const client = await pool.connect();
  try { await client.query(`BEGIN ISOLATION LEVEL ${isolation}`); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
test('durable checkout idempotency in a new private PostgreSQL cluster (no production connection)', { skip: unavailable ? 'Local postgres/initdb/pg_ctl unavailable; real concurrency not verified' : false, timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'gama-idempotency-'));
  const data = path.join(root,'data'), socket = path.join(root,'socket'); fs.mkdirSync(socket,{mode:0o700});
  let started = false, pool;
  try {
    command('initdb',['-D',data,'-A','trust','-U','gama_idempotency_test','--no-sync','--locale=C','--encoding=UTF8']);
    command('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h '' -k ${socket} -p 55439`,'-w','start']); started = true;
    pool = new Pool({ host:socket, port:55439, user:'gama_idempotency_test', database:'postgres', password:'', ssl:false, max:5, connectionTimeoutMillis:3000 });
    assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,data);
    assert.equal((await pool.query('SHOW listen_addresses')).rows[0].listen_addresses,'');
    assert.equal((await pool.query('SHOW fsync')).rows[0].fsync,'on');
    assert.equal((await pool.query('SHOW synchronous_commit')).rows[0].synchronous_commit,'on');
    await pool.query(`CREATE ROLE gama_app NOLOGIN;
      CREATE TABLE restaurants(id uuid PRIMARY KEY);
      CREATE TABLE customers(id uuid PRIMARY KEY, restaurant_id uuid NOT NULL REFERENCES restaurants(id));
      CREATE TABLE orders(id uuid PRIMARY KEY, restaurant_id uuid NOT NULL REFERENCES restaurants(id), customer_id uuid NOT NULL REFERENCES customers(id));
      INSERT INTO restaurants VALUES ('${id(1)}'),('${id(9)}');
      INSERT INTO customers VALUES ('${id(4)}','${id(1)}'),('${id(14)}','${id(9)}');
      -- Synthetic parent rows only; no commercial order service, items, prices or events.
      INSERT INTO orders VALUES ('${id(900)}','${id(1)}','${id(4)}'),('${id(901)}','${id(1)}','${id(4)}'),('${id(902)}','${id(9)}','${id(14)}'),('${id(903)}','${id(1)}','${id(4)}'),('${id(904)}','${id(1)}','${id(4)}'),('${id(905)}','${id(1)}','${id(4)}');`);
    await t.test('missing migration 003 key rejects 008 atomically before index/table creation', async () => {
      const c=await pool.connect();
      try { await assert.rejects(()=>c.query(fs.readFileSync(path.join(__dirname,'../migrations/008_whatsapp_checkout_idempotency.sql'),'utf8')),/customers_email_owner_key/); }
      finally { await c.query('ROLLBACK'); c.release(); }
      assert.equal((await pool.query("SELECT to_regclass('public.whatsapp_checkout_intents') t, to_regclass('public.orders_checkout_owner_idx') i")).rows[0].t,null);
      assert.equal((await pool.query("SELECT to_regclass('public.orders_checkout_owner_idx') i")).rows[0].i,null);
    });
    // Apply the unchanged 003 only to this throwaway schema, proving reuse of its actual key.
    await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/003_customer_email_verification.sql'),'utf8'));
    await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/008_whatsapp_checkout_idempotency.sql'),'utf8'));
    await t.test('008 reuses the exact migration 003 owner index without creating a redundant index', async () => {
      const r=(await pool.query(`SELECT conindid FROM pg_constraint WHERE conrelid='public.customers'::regclass AND conname='customers_email_owner_key'`)).rows[0];
      const fk=(await pool.query(`SELECT conindid FROM pg_constraint WHERE conrelid='public.whatsapp_checkout_intents'::regclass AND confrelid='public.customers'::regclass`)).rows[0];
      assert.equal(fk.conindid,r.conindid);
      assert.equal((await pool.query("SELECT to_regclass('public.customers_checkout_owner_idx') i")).rows[0].i,null);
    });
    await t.test('migration adds only intent infrastructure and preserves parent fixture rows', async () => {
      assert.equal((await pool.query('SELECT count(*)::int n FROM orders')).rows[0].n,6);
      assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='orders'")).rows[0].n,3);
    });
    await t.test('repeated registration and completed replay survive a fresh connection', async () => {
      const r = request(); await api.prepareCheckoutIntent(pool,r); await api.prepareCheckoutIntent(pool,r);
      await transaction(pool,async c => { const row = await api.lockCheckoutIntent(c,r); assert.equal(row.state,'PENDING'); await api.completeCheckoutIntent(c,r,id(900)); });
      const fresh = new Pool({host:socket,port:55439,user:'gama_idempotency_test',database:'postgres',password:'',ssl:false});
      try { assert.equal((await api.lookupCheckoutIntent(fresh,r.scope,r.intentId)).order_id,id(900)); assert.equal((await api.prepareCheckoutIntent(fresh,r)).state,'COMPLETED'); }
      finally { await fresh.end(); }
    });
    await t.test('same key with different payload or owner is refused', async () => {
      const r = request(); await api.prepareCheckoutIntent(pool,r); const s = session(); s.checkout.paymentMethod='DEBITO';
      await assert.rejects(()=>api.prepareCheckoutIntent(pool,api.createCheckoutIntentRequest(s,r.intentId)),api.CheckoutIntentConflict);
      assert.equal(await api.lookupCheckoutIntent(pool,{...r.scope,customerId:id(14)},r.intentId),null);
    });
    await t.test('concurrent confirmations serialize on the durable row and only one proceeds', async () => {
      const r = request(); await api.prepareCheckoutIntent(pool,r); let release, locked;
      const gate = new Promise(resolve=>{release=resolve;}); const acquired = new Promise(resolve=>{locked=resolve;}); let actions=0;
      const first = transaction(pool,async c => { assert.equal((await api.lockCheckoutIntent(c,r)).state,'PENDING'); actions++; locked(); await gate; return api.completeCheckoutIntent(c,r,id(901)); });
      await acquired; let secondFinished=false;
      const second = transaction(pool,async c => { const row=await api.lockCheckoutIntent(c,r); if(row.state!=='COMPLETED') actions++; secondFinished=true; return row; });
      await new Promise(resolve=>setTimeout(resolve,50)); const completedBeforeRelease=secondFinished; release();
      assert.equal(completedBeforeRelease,false);
      assert.equal((await first).order_id,id(901)); assert.equal((await second).order_id,id(901)); assert.equal(actions,1);
    });
    await t.test('rollback preserves PENDING; recoverable failure can be retried', async () => {
      const r=request(); await api.prepareCheckoutIntent(pool,r);
      await assert.rejects(()=>transaction(pool,async c=>{await api.lockCheckoutIntent(c,r); throw Error('simulated failure');}));
      assert.equal((await api.lookupCheckoutIntent(pool,r.scope,r.intentId)).state,'PENDING');
      await transaction(pool,c=>api.markCheckoutIntentRecoverable(c,r,'TRANSACTION_ABORTED'));
      assert.equal((await api.lookupCheckoutIntent(pool,r.scope,r.intentId)).state,'RECOVERABLE_FAILURE');
      await transaction(pool,async c=>assert.equal((await api.lockCheckoutIntent(c,r)).state,'PENDING'));
    });
    await t.test('completion cannot link another restaurant/customer order; rollback is atomic', async () => {
      const r=request(); await api.prepareCheckoutIntent(pool,r);
      await assert.rejects(()=>transaction(pool,c=>api.completeCheckoutIntent(c,r,id(902))),e=>e.code==='23503');
      assert.equal((await api.lookupCheckoutIntent(pool,r.scope,r.intentId)).state,'PENDING');
    });
    await t.test('completed state and immutable hash/binding cannot be overwritten, even by SQL', async () => {
      const r=request(); await api.prepareCheckoutIntent(pool,r);
      await assert.rejects(()=>pool.query("UPDATE whatsapp_checkout_intents SET session_id=$2 WHERE intent_id=$1",[r.intentId,id(99)]),e=>e.code==='23514');
      await assert.rejects(()=>pool.query("UPDATE whatsapp_checkout_intents SET checkout_hash=$2 WHERE intent_id=$1",[r.intentId,'0'.repeat(64)]),e=>e.code==='23514');
      const completed=(await pool.query("SELECT intent_id FROM whatsapp_checkout_intents WHERE state='COMPLETED' LIMIT 1")).rows[0];
      await assert.rejects(()=>pool.query("UPDATE whatsapp_checkout_intents SET state='PENDING',order_id=NULL WHERE intent_id=$1",[completed.intent_id]),e=>e.code==='23514');
    });
    await t.test('runtime role has narrow grants and can register/read/retry without parent writes', async () => {
      const r=request(); await transaction(pool,async c=>{await c.query('SET LOCAL ROLE gama_app'); await api.prepareCheckoutIntent(c,r); await api.lockCheckoutIntent(c,r); await api.completeCheckoutIntent(c,r,id(904));});
      assert.equal((await api.lookupCheckoutIntent(pool,r.scope,r.intentId)).state,'COMPLETED');
      await assert.rejects(()=>transaction(pool,async c=>{await c.query('SET LOCAL ROLE gama_app'); await c.query('DELETE FROM whatsapp_checkout_intents');}),e=>e.code==='42501');
    });
    await t.test('simultaneous registration keeps one durable key; divergent registration has one winner', async () => {
      const r=request(); await Promise.all([api.prepareCheckoutIntent(pool,r),api.prepareCheckoutIntent(pool,r)]);
      assert.equal((await pool.query('SELECT count(*)::int n FROM whatsapp_checkout_intents WHERE intent_id=$1',[r.intentId])).rows[0].n,1);
      const a=request(), changed=session(); changed.checkout.paymentMethod='CREDITO'; const b=api.createCheckoutIntentRequest(changed,a.intentId);
      const results=await Promise.allSettled([api.prepareCheckoutIntent(pool,a),api.prepareCheckoutIntent(pool,b)]);
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      assert.ok(results.find(x=>x.status==='rejected').reason instanceof api.CheckoutIntentConflict);
    });
    await t.test('SERIALIZABLE waiter retries the same key and recovers completion', async () => {
      const r=request(); await api.prepareCheckoutIntent(pool,r);
      const first=await pool.connect(), second=await pool.connect();
      try {
        await first.query('BEGIN ISOLATION LEVEL SERIALIZABLE'); await second.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        await api.lockCheckoutIntent(first,r);
        const waiting=api.lockCheckoutIntent(second,r).then(value=>({value}),error=>({error}));
        await new Promise(resolve=>setTimeout(resolve,50));
        await api.completeCheckoutIntent(first,r,id(903)); await first.query('COMMIT');
        const result=await waiting; assert.equal(result.error?.code,'40001'); await second.query('ROLLBACK');
        assert.equal((await transaction(pool,c=>api.lockCheckoutIntent(c,r),'SERIALIZABLE')).order_id,id(903));
      } finally { await first.query('ROLLBACK'); await second.query('ROLLBACK'); first.release(); second.release(); }
    });
    await t.test('completion link rolls back with its transaction; lost COMMIT reply recovers the same order', async () => {
      const r=request(); await api.prepareCheckoutIntent(pool,r);
      await assert.rejects(()=>transaction(pool,async c=>{await api.completeCheckoutIntent(c,r,id(905)); throw Error('fail before commit');}));
      assert.equal((await api.lookupCheckoutIntent(pool,r.scope,r.intentId)).state,'PENDING');
      // Server committed, but the caller loses the reply. No new key or order on recovery.
      await transaction(pool,c=>api.completeCheckoutIntent(c,r,id(905)));
      const recovered=await transaction(pool,c=>api.markCheckoutIntentRecoverable(c,r,'TRANSACTION_ABORTED'));
      assert.equal(recovered.state,'COMPLETED'); assert.equal(recovered.order_id,id(905));
      const another=request(); await api.prepareCheckoutIntent(pool,another);
      await assert.rejects(()=>transaction(pool,c=>api.completeCheckoutIntent(c,another,id(905))),e=>e.code==='23505');
    });
    await t.test('database rejects a forged checksum before storing a new intent', async () => {
      const r=request();
      await assert.rejects(()=>pool.query(`INSERT INTO whatsapp_checkout_intents
        (intent_id,restaurant_id,customer_id,session_id,account_id,sender_id,whatsapp_phone,canonical_checkout,checkout_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[r.intentId,id(1),id(4),id(2),'account','opaque@lid','5577999999999',r.canonicalCheckout,'0'.repeat(64)]),e=>e.code==='23514');
      assert.equal(await api.lookupCheckoutIntent(pool,r.scope,r.intentId),null);
    });
    await t.test('database rejects a canonical scope inconsistent with row ownership', async () => {
      const r=request();
      await assert.rejects(()=>pool.query(`INSERT INTO whatsapp_checkout_intents
        (intent_id,restaurant_id,customer_id,session_id,account_id,sender_id,whatsapp_phone,canonical_checkout,checkout_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[r.intentId,id(1),id(4),id(99),'account','opaque@lid','5577999999999',r.canonicalCheckout,r.checkoutHash]),e=>e.code==='23514');
    });
    await t.test('durable recovery after PostgreSQL restart uses the original stored keys', async () => {
      const scope=request().scope, before=await api.listCheckoutIntents(pool,scope);
      const completed=before.find(row=>row.state==='COMPLETED'); assert.ok(completed);
      await pool.end(); pool=undefined;
      command('pg_ctl',['-D',data,'-m','fast','-w','stop']); started=false;
      command('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h '' -k ${socket} -p 55439`,'-w','start']); started=true;
      pool=new Pool({host:socket,port:55439,user:'gama_idempotency_test',database:'postgres',password:'',ssl:false});
      const recovered=await api.lookupCheckoutIntent(pool,scope,completed.intent_id);
      assert.equal(recovered.order_id,completed.order_id); assert.equal(recovered.checkout_hash,completed.checkout_hash);
    });
  } finally {
    if(pool) await pool.end();
    if(started) command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
    if(path.dirname(root)===os.tmpdir() && path.basename(root).startsWith('gama-idempotency-')) fs.rmSync(root,{recursive:true,force:true});
  }
});
