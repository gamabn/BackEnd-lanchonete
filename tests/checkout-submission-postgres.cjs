const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {Pool}=require('pg');
require('ts-node/register');
// Reject every application pool access: only the explicit, verified /tmp pool is permitted.
const databasePath=require.resolve('../src/database');
require.cache[databasePath]={id:databasePath,filename:databasePath,loaded:true,exports:{pool:new Proxy({}, {get:()=>()=>{throw Error('Production pool forbidden');}})}};
const {id,session}=require('./fixtures/whatsapp-idempotency.cjs');
const intents=require('../src/messaging/checkout/checkoutIdempotency');
const {captureCheckoutReview}=require('../src/messaging/checkout/checkoutRevalidation');
const {checkoutPaymentSnapshot}=require('../src/messaging/core/checkoutSnapshot');
const {WhatsAppCheckoutAuthorizer}=require('../src/messaging/checkout/checkoutAuthorization');
const {GetClientService}=require('../src/service/clients/GetClientService');
const {WhatsAppCheckoutSubmission}=require('../src/messaging/checkout/checkoutSubmission');
const {LiveCheckoutSession}=require('../src/messaging/checkout/checkoutSession');
const {ActiveCheckoutSessions}=require('../src/messaging/checkout/activeCheckoutSession');
const {CheckoutIdentityBootstrap}=require('../src/messaging/checkout/checkoutIdentityBootstrap');
const {DurableCheckoutSessions}=require('../src/messaging/checkout/checkoutRecovery');
const env={PATH:process.env.PATH,LANG:'C',LC_ALL:'C'};
const bin=name=>({postgres:process.env.GAMA_TEST_POSTGRES_BIN,initdb:process.env.GAMA_TEST_INITDB_BIN,pg_ctl:process.env.GAMA_TEST_PG_CTL_BIN}[name]||name);
const unavailable=['postgres','initdb','pg_ctl'].some(name=>spawnSync(bin(name),['--version'],{env}).status!==0);
function command(name,args){const r=spawnSync(bin(name),args,{env,encoding:'utf8',timeout:30000});assert.equal(r.status,0,`${name}: ${r.stdout}\n${r.stderr}`);}
test('internal checkout integration on private disposable PostgreSQL only',{skip:unavailable?'Local PostgreSQL unavailable: real transaction integration not verified':false,timeout:90000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gama-submission-')),data=path.join(root,'data'),socket=path.join(root,'socket');fs.mkdirSync(socket,{mode:0o700});
  let pool,admin,started=false;
  const config={host:socket,port:55441,user:'gama_submit_test',database:'neondb',password:'',ssl:false,max:6,connectionTimeoutMillis:3000};
  try{
    command('initdb',['-D',data,'-A','trust','-U','gama_submit_test','--no-sync','--locale=C','--encoding=UTF8']);
    const start=()=>{command('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-o',`-h '' -k ${socket} -p 55441`,'-w','start']);started=true;};start();
    const bootstrap=new Pool({...config,database:'postgres'});
    try{
      assert.equal((await bootstrap.query('SHOW data_directory')).rows[0].data_directory,data);
      assert.equal((await bootstrap.query('SHOW listen_addresses')).rows[0].listen_addresses,'');
      await bootstrap.query('CREATE DATABASE neondb');
    }finally{await bootstrap.end();}
    pool=new Pool(config);
    assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,data);assert.equal((await pool.query('SHOW listen_addresses')).rows[0].listen_addresses,'');
    await pool.query('CREATE ROLE gama_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT');
    const schema=fs.readFileSync(path.join(__dirname,'fixtures/runtime-role-schema.sql'),'utf8');
    await pool.query(schema);
    // Fixture the legacy baseline, then apply unchanged 003/006/007 in this private database only.
    await pool.query('ALTER TABLE orders ADD COLUMN delivery_address jsonb, ADD COLUMN bairro_id uuid REFERENCES bairros(id)');
    for(const filename of ['003_customer_email_verification.sql','006_order_fulfillment.sql','007_remove_legacy_frete.sql']){
      await pool.query(fs.readFileSync(path.join(__dirname,'../migrations',filename),'utf8'));
    }
    await pool.query(fs.readFileSync(path.join(__dirname,'../ops/runtime-role/02_grants_existing.sql'),'utf8'));
    await pool.query(`UPDATE restaurants SET name='Loja',street='Rua A',number='10',neighborhood='Centro',city='Cidade',status=true WHERE id='${id(1)}';
      INSERT INTO restaurants(id,name,street,number,neighborhood,city,status)VALUES('${id(9)}','Outra','Rua A','10','Centro','Cidade',true);
      INSERT INTO customers(id,restaurant_id,name,phone,city,street,number,neighborhood)VALUES('${id(4)}','${id(1)}','Ana','+5577999999999','Cidade','Rua A','10','Centro'),('${id(14)}','${id(9)}','Bia','+5577999999999','Cidade','Rua A','10','Centro');
      INSERT INTO products(id,restaurant_id,name,price,available,published)VALUES('${id(3)}','${id(1)}','Pizza',10.01,true,true);
      INSERT INTO product_variants(id,product_id,name,price,available)VALUES('${id(5)}','${id(3)}','Grande',8.01,true);
      INSERT INTO product_option_groups(id,product_id,name,required,min_select,max_select)VALUES('${id(8)}','${id(3)}','Extras',true,2,2);
      INSERT INTO product_variant_group_limits VALUES('${id(5)}','${id(8)}',2,2);
      INSERT INTO product_options(id,group_id,name,additional_price,available)VALUES('${id(6)}','${id(8)}','Extra A',1,true),('${id(7)}','${id(8)}','Extra B',1,true);
      INSERT INTO bairros(id,bairro,frete,lanchonete_id)VALUES('${id(17)}','Centro',2.03,'${id(1)}');`);
    await pool.query(fs.readFileSync(path.join(__dirname,'../migrations/008_whatsapp_checkout_idempotency.sql'),'utf8'));
    admin=pool;const appConfig={...config,user:'gama_app'};pool=new Pool(appConfig);
    await t.test('the runtime connection is gama_app, not owner/superuser, and 003 key is reused',async()=>{
      const role=(await pool.query(`SELECT current_user AS name, rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=current_user`)).rows[0];
      assert.equal(role.name,'gama_app');for(const flag of ['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole','rolinherit'])assert.equal(role[flag],false);
      assert.equal((await pool.query("SELECT has_schema_privilege(current_user,'public','CREATE') allowed")).rows[0].allowed,false);
      assert.equal((await pool.query('SELECT count(*)::int n FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)')).rows[0].n,0);
      const r=(await admin.query(`SELECT conindid FROM pg_constraint WHERE conrelid='public.customers'::regclass AND conname='customers_email_owner_key'`)).rows[0];
      const fk=(await admin.query(`SELECT conindid FROM pg_constraint WHERE conrelid='public.whatsapp_checkout_intents'::regclass AND confrelid='public.customers'::regclass`)).rows[0];assert.equal(r.conindid,fk.conindid);
      assert.equal((await admin.query("SELECT to_regclass('public.customers_checkout_owner_idx') i")).rows[0].i,null);
    });
    await t.test('runtime cannot create schema objects, delete intents or overwrite order totals',async()=>{
      for(const sql of ['SET ROLE gama_submit_test','CREATE TABLE public.forbidden_table(id int)','DELETE FROM whatsapp_checkout_intents','UPDATE orders SET total_price=0',"UPDATE whatsapp_checkout_intents SET checkout_hash=repeat('0',64)"]){
        await assert.rejects(()=>pool.query(sql),error=>error.code==='42501');
      }
    });
    async function prepared(mode='PICKUP'){
      const live=session();
      if(mode==='DELIVERY'){
        const address={street:'Rua A',number:'10',neighborhood:'Centro',city:'Cidade',complement:null};
        Object.assign(live.checkout,{fulfillmentMode:'DELIVERY',addressConfirmed:true,addressOriginal:{...address},confirmedAddress:{...address},addressCustomerId:id(4),addressPhone:live.transportIdentity.phone,deliveryRegion:{restaurant_id:id(1),customer_id:id(4),bairro_id:id(17),bairro:'Centro',fee:'2.03',fulfillment_mode:'DELIVERY',confirmed:true,address:{...address}}});
        live.checkout.paymentContext=checkoutPaymentSnapshot(live.checkout,id(1));
      }
      const intent=intents.createCheckoutIntentRequest(live,intents.newCheckoutIntentId()),snapshot=captureCheckoutReview(live.context,live.checkout);
      await intents.prepareCheckoutIntent(pool,intent);return{live,intent,snapshot};
    }
    async function attempt(f,fault={}){
      const trace=[];let connections=0;
      const db={connect:async()=>{connections++;const raw=await pool.connect();return{query:async(sql,...args)=>{
        trace.push(sql);
        if(fault.beforeCommit&&sql.startsWith('INSERT INTO chats'))throw Error('injected chat failure');
        if(fault.authorizationSerialization&&sql.startsWith('SELECT id, restaurant_id,'))throw Object.assign(Error('authorization serialization'),{code:'40001'});
        if(fault.commitAbort&&sql==='COMMIT')throw Object.assign(Error('serialization at commit'),{code:'40001'});
        if(fault.commitBefore&&sql==='COMMIT')throw Object.assign(Error('lost before commit'),{code:'ECONNRESET'});
        const result=await raw.query(sql,...args);
        if(fault.identityChange&&sql.startsWith('INSERT INTO chats'))f.live.identityRevision++;
        if(fault.commitAfter&&sql==='COMMIT')throw Object.assign(Error('lost commit reply'),{code:'ECONNRESET'});
        return result;
      },release:error=>raw.release(error)};}};
      const authorizer=new WhatsAppCheckoutAuthorizer(new GetClientService(pool),db);
      const authorization=await authorizer.authorize(()=>f.live);
      const result=await new WhatsAppCheckoutSubmission(authorizer).submit({context:f.contextOverride??f.live.context,authorization,snapshot:f.snapshot,intent:f.intent});
      return{result,trace,connections};
    }
    const count=async()=>Number((await pool.query('SELECT count(*) n FROM orders')).rows[0].n);
    function durableFixture(revision=0,fault={}){
      const live=session();live.identityRevision=revision;
      const coordinator=new LiveCheckoutSession(()=>live);coordinator.presentReview();
      const db={connect:async()=>{const raw=await pool.connect();return{query:async(sql,...args)=>{
        if(fault.abortInsert&&sql.startsWith('INSERT INTO public.whatsapp_checkout_intents'))throw Object.assign(Error('serialization'),{code:'40001'});
        if(fault.commitBefore&&sql==='COMMIT')throw Error('lost commit request');
        const result=await raw.query(sql,...args);if(fault.commitAfter&&sql==='COMMIT')throw Error('lost commit reply');return result;
      },release:e=>raw.release(e)};}};
      const authorizer=new WhatsAppCheckoutAuthorizer(new GetClientService(pool),db),store=new DurableCheckoutSessions(authorizer,db);
      return{live,coordinator,store,authorizer,identity:()=>live,register:async()=>store.register(coordinator,await authorizer.authorize(coordinator.readCurrentSession))};
    }
    let activeSequence=300;
    function activeFixture(revision=0,fault={}){
      const f=durableFixture(revision,fault);f.live.context={...f.live.context,session_id:id(activeSequence++)};
      f.coordinator.invalidate();f.coordinator.presentReview();
      f.store=new ActiveCheckoutSessions(f.authorizer,pool);
      f.register=async()=>f.store.registerActive(f.coordinator,await f.authorizer.authorize(f.coordinator.readCurrentSession));
      return f;
    }
    await t.test('active recovery without UUID after fresh service/reconnection requires new review',async()=>{
      const f=activeFixture(5),before=await count();assert.equal((await f.register()).kind,'registered');
      const fresh=new ActiveCheckoutSessions(new WhatsAppCheckoutAuthorizer(new GetClientService(pool),pool),pool);
      for(let i=0;i<2;i++){
        const recovered=await fresh.recoverActive(f.identity);assert.equal(recovered.kind,'review_required');
        assert.equal(recovered.intent.intentId,f.coordinator.review.intent.intentId);assert.ok(recovered.session);
      }
      assert.equal(await count(),before);
    });
    await t.test('concurrent incompatible active intentions have one winner under gama_app',async()=>{
      const f=activeFixture(),other=new LiveCheckoutSession(f.identity);other.presentReview();
      const a=await f.authorizer.authorize(f.coordinator.readCurrentSession);
      const authorizer=new WhatsAppCheckoutAuthorizer(new GetClientService(pool),pool),store=new ActiveCheckoutSessions(authorizer,pool);
      const b=await authorizer.authorize(other.readCurrentSession);
      const results=await Promise.all([f.store.registerActive(f.coordinator,a),store.registerActive(other,b)]);
      assert.equal(results.filter(r=>r.kind==='registered').length,1);
      const rows=await pool.query('SELECT count(*) n FROM whatsapp_checkout_intents WHERE session_id=$1 AND active',[f.live.context.session_id]);assert.equal(Number(rows.rows[0].n),1);
      // The database unique index, independently of advisory coordination, rejects another generation.
      const changed={...f.live,identityRevision:1},request=intents.createCheckoutIntentRequest(changed,id(996));
      const c=await pool.connect();try{await c.query('BEGIN');await intents.prepareCheckoutIntent(c,request);
        await assert.rejects(c.query('UPDATE whatsapp_checkout_intents SET active=true WHERE intent_id=$1',[request.intentId]),{code:'23505'});
        await c.query('ROLLBACK');}finally{c.release();}
    });
    await t.test('explicit cart replacement retires history and prevents stale submission',async()=>{
      const f=activeFixture();await f.register();const previous=f.coordinator.review.intent;
      f.live.checkout.cart.add({productId:id(3),productName:'Pizza',quantity:1,unitPrice:'10.01',variantId:id(5),variantName:'Grande',optionIds:[id(6),id(7)]});
      f.live.checkout.paymentContext=checkoutPaymentSnapshot(f.live.checkout,id(1));
      f.live.identityRevision=1;
      const next=new LiveCheckoutSession(f.identity);next.presentReview();const auth=await f.authorizer.authorize(next.readCurrentSession);
      const result=await f.store.replaceActive(next,auth,{intentId:previous.intentId,identityRevision:0});assert.equal(result.kind,'registered');
      const retry=new LiveCheckoutSession(f.identity);retry.presentRecoveredReview(result.intent,'PENDING');
      const retryResult=await f.store.replaceActive(retry,await f.authorizer.authorize(retry.readCurrentSession),{intentId:previous.intentId,identityRevision:0});assert.equal(retryResult.kind,'registered');
      const old=await intents.lookupCheckoutIntent(pool,previous.scope,previous.intentId);assert.equal(old.active,false);assert.ok(old.retired_at);
      const c=await pool.connect();try{await c.query('BEGIN');await assert.rejects(intents.lockCheckoutIntent(c,previous));await c.query('ROLLBACK');}finally{c.release();}
      assert.equal((await f.store.recoverActive(f.identity)).intent.intentId,result.intent.intentId);
    });
    await t.test('identity epoch reconciliation is explicit, one-use and before messages only',async()=>{
      const empty=activeFixture();assert.equal((await empty.store.inspectBootstrap(()=>({...empty.live,identityRevision:null}))).kind,'no_durable_generation');
      const f=activeFixture(7);await f.register();
      const unknown=()=>({...f.live,identityRevision:null});
      const inspection=await f.store.inspectBootstrap(unknown);assert.equal(inspection.kind,'reconciliation_required');
      const r=await f.store.reconcileBootstrap(inspection.challenge,unknown);assert.equal(r.kind,'generation_reconciled');assert.equal(r.identityRevision,7);
      assert.equal((await f.store.reconcileBootstrap(inspection.challenge,unknown)).kind,'rejected');
      assert.equal((await f.store.inspectBootstrap(()=>({...f.live,identityRevision:0}))).kind,'rejected');
      const transport=()=>{const {identityRevision,...frame}=f.live;return frame;};
      const gate=new CheckoutIdentityBootstrap(transport);assert.equal(await gate.reconcile(f.store),true);assert.equal(gate.identityRevision,7);
      const started=new CheckoutIdentityBootstrap(transport);started.markMessageObserved();assert.equal(await started.reconcile(f.store),false);assert.equal(started.identityRevision,null);
      f.live.identityRevision=8;assert.equal((await f.store.recoverActive(f.identity)).kind,'rejected');
    });
    await t.test('active scope isolates restaurant, account, sender, session and phone',async()=>{
      const f=activeFixture();await f.register();
      for(const mutate of [x=>x.context={...x.context,restaurant_id:id(9)},x=>x.context={...x.context,session_id:id(999)},x=>x.sender={...x.sender,account_id:'other'},x=>x.sender={...x.sender,subject_id:'other@lid'}]){
        const live={...f.live};mutate(live);assert.equal((await f.store.recoverActive(()=>live)).kind,'no_active_intent');
      }
      const changed={...f.live,transportIdentity:{...f.live.transportIdentity,phone:'5577888888888'}};assert.equal((await f.store.recoverActive(()=>changed)).kind,'rejected');
    });
    await t.test('active registration rollback and uncertain COMMIT recover without UUID',async()=>{
      for(const mode of ['abortInsert','commitBefore','commitAfter']){
        const f=activeFixture(0,{[mode]:true}),result=await f.register();assert.equal(result.kind,'recoverable_failure');
        const recovered=await f.store.recoverActive(f.identity);assert.equal(recovered.kind,mode==='commitAfter'?'review_required':'no_active_intent');
        if(mode==='commitAfter')assert.equal(recovered.intent.intentId,result.intentId);
      }
    });
    await t.test('retirement rolls back atomically and recoverable state stays active',async()=>{
      const f=activeFixture();await f.register();const intent=f.coordinator.review.intent,c=await pool.connect();
      try{await c.query('BEGIN');await intents.retireActiveCheckoutIntent(c,intent.scope,{intentId:intent.intentId,identityRevision:0});await c.query('ROLLBACK');
        await c.query('BEGIN');await intents.markCheckoutIntentRecoverable(c,intent,'TRANSACTION_ABORTED');await c.query('COMMIT');}finally{c.release();}
      assert.equal((await f.store.recoverActive(f.identity)).state,'RECOVERABLE_FAILURE');
      assert.equal((await f.store.invalidateActive(f.identity,{intentId:intent.intentId,identityRevision:0})).kind,'invalidated');
      assert.equal((await f.store.recoverActive(f.identity)).kind,'no_active_intent');
    });
    await t.test('durable registration reuses H.4 and stores generation without creating orders',async()=>{
      const f=durableFixture(7),key=f.coordinator.review.intent.intentId,before=await count();const r=await f.register();assert.equal(r.kind,'registered');assert.equal(r.current,true);assert.equal(f.coordinator.review.registration,'DURABLE');
      const row=await intents.lookupCheckoutIntent(pool,r.intent.scope,key);assert.equal(row.state,'PENDING');assert.equal(JSON.parse(row.canonical_checkout).identityRevision,7);assert.equal(await count(),before);
    });
    await t.test('a fresh service after worker/reconnection recovers the same pending key with no memory snapshot',async()=>{
      const f=durableFixture(),original=f.coordinator.review;await f.register();
      const fresh=durableFixture(),r=await fresh.store.recover(fresh.identity,original.intent.intentId);assert.equal(r.kind,'review_required');assert.equal(r.reason,'NEW_REVIEW_REQUIRED');assert.ok(r.session);
      const restored=new LiveCheckoutSession(()=>r.session),shown=restored.presentRecoveredReview(r.intent,r.state);assert.equal(shown.intent.intentId,original.intent.intentId);assert.notEqual(shown.snapshot,original.snapshot);
      const repeated=await fresh.store.recover(fresh.identity,r.intent.intentId);assert.equal(repeated.intent.intentId,r.intent.intentId);
    });
    await t.test('delivery and cash recovery restores address, fee, options and change from the same canonical payload',async()=>{
      const f=durableFixture(),address={street:'Rua A',number:'10',neighborhood:'Centro',city:'Cidade',complement:null};
      Object.assign(f.live.checkout,{fulfillmentMode:'DELIVERY',paymentMethod:'DINHEIRO',changeFor:'50.00',addressConfirmed:true,addressOriginal:{...address},confirmedAddress:{...address},addressCustomerId:id(4),addressPhone:f.live.transportIdentity.phone,deliveryRegion:{restaurant_id:id(1),customer_id:id(4),bairro_id:id(17),bairro:'Centro',fee:'2.03',fulfillment_mode:'DELIVERY',confirmed:true,address:{...address}}});
      f.live.checkout.paymentContext=checkoutPaymentSnapshot(f.live.checkout,id(1));f.coordinator.invalidate();f.coordinator.presentReview();
      const before=await count();await f.register();const r=await f.store.recover(f.identity,f.coordinator.review.intent.intentId);assert.equal(r.reason,'NEW_REVIEW_REQUIRED');assert.equal(r.session.checkout.fulfillmentMode,'DELIVERY');assert.equal(r.session.checkout.changeFor,'50.00');assert.equal(r.session.checkout.deliveryRegion.fee,'2.03');assert.deepEqual(r.session.checkout.confirmedAddress,address);
      assert.deepEqual(r.session.checkout.cart.list()[0].optionIds,[id(6),id(7)]);assert.equal(await count(),before);
    });
    await t.test('recovery refuses another restaurant and changed transport identity/generation',async()=>{
      const f=durableFixture();await f.register();const key=f.coordinator.review.intent.intentId;
      const other=durableFixture();other.live.context={...other.live.context,restaurant_id:id(9)};assert.equal((await other.store.recover(other.identity,key)).kind,'not_found');
      other.live.context={...f.live.context};other.live.transportIdentity={phone:'5511999999999',source:'senderPn'};assert.equal((await other.store.recover(other.identity,key)).kind,'rejected');
      other.live.transportIdentity={...f.live.transportIdentity};other.live.identityRevision=1;const changed=await other.store.recover(other.identity,key);assert.equal(changed.reason,'IDENTITY_GENERATION_CHANGED');assert.equal(changed.session,undefined);
    });
    await t.test('registered checkout changes cannot reuse or silently replace the durable intent',async()=>{
      const f=durableFixture();await f.register();const intent=f.coordinator.review.intent;f.live.checkout.paymentMethod='CREDITO';assert.throws(()=>f.coordinator.presentReview());assert.equal(f.coordinator.recoveryReference.intent.intentId,intent.intentId);
      const recovered=await f.store.recover(f.identity,intent.intentId);assert.equal(recovered.kind,'review_required');assert.throws(()=>f.coordinator.presentRecoveredReview(recovered.intent,recovered.state));
    });
    await t.test('duplicate and concurrent registrations keep one durable key',async()=>{
      const f=durableFixture(),intent=f.coordinator.review.intent;
      const [a,b]=await Promise.all([f.authorizer.authorize(f.coordinator.readCurrentSession),f.authorizer.authorize(f.coordinator.readCurrentSession)]);
      const results=await Promise.all([f.store.register(f.coordinator,a),f.store.register(f.coordinator,b)]);assert.ok(results.some(r=>r.kind==='registered'));assert.ok(results.some(r=>r.reason==='REGISTRATION_BUSY'));
      const fresh=await f.store.recover(f.identity,intent.intentId);const other=new LiveCheckoutSession(()=>fresh.session);other.presentRecoveredReview(fresh.intent,fresh.state);
      const authorizer=new WhatsAppCheckoutAuthorizer(new GetClientService(pool),pool),store=new DurableCheckoutSessions(authorizer,pool);
      const [first,second]=await Promise.all([f.register(),authorizer.authorize(other.readCurrentSession).then(token=>store.register(other,token))]);assert.equal(first.kind,'registered');assert.equal(second.kind,'registered');
      assert.equal((await pool.query('SELECT count(*)::int n FROM whatsapp_checkout_intents WHERE intent_id=$1',[intent.intentId])).rows[0].n,1);
    });
    await t.test('registration rollback and uncertain COMMIT recover using the original key',async()=>{
      for(const mode of ['abortInsert','commitBefore','commitAfter']){
        const fault={[mode]:true},f=durableFixture(0,fault),intent=f.coordinator.review.intent,before=await count(),r=await f.register();assert.equal(r.kind,'recoverable_failure');assert.equal(r.intentId,intent.intentId);
        delete fault[mode];const recovered=await f.store.recover(f.identity,intent.intentId);assert.equal(recovered.kind,mode==='commitAfter'?'review_required':'not_found');
        if(mode!=='abortInsert')assert.equal(f.coordinator.recoveryReference.registration,'COMMIT_UNKNOWN');
        assert.equal((await f.register()).kind,'registered');assert.equal(f.coordinator.review.intent.intentId,intent.intentId);assert.equal(await count(),before);
      }
    });
    await t.test('recoverable persistent state is read without promotion and candidate discovery never selects',async()=>{
      const f=durableFixture();await f.register();const intent=f.coordinator.review.intent,c=await pool.connect();try{await c.query('BEGIN');await intents.markCheckoutIntentRecoverable(c,intent,'TRANSACTION_ABORTED');await c.query('COMMIT');}finally{c.release();}
      const r=await f.store.recover(f.identity,intent.intentId);assert.equal(r.state,'RECOVERABLE_FAILURE');assert.equal((await intents.lookupCheckoutIntent(pool,intent.scope,intent.intentId)).state,'RECOVERABLE_FAILURE');
      const list=await f.store.candidates(f.identity);assert.ok(list.intents.length>1);assert.equal(list.selected,undefined);
    });
    await t.test('legacy pending payload without generation requires review and cannot be silently overwritten',async()=>{
      const f=durableFixture(),request=f.coordinator.review.intent,body=JSON.parse(request.canonicalCheckout);delete body.identityRevision;
      const canonicalCheckout=JSON.stringify(body),legacy={...request,canonicalCheckout,checkoutHash:require('node:crypto').createHash('sha256').update(canonicalCheckout).digest('hex')};
      await intents.prepareCheckoutIntent(pool,legacy);const r=await f.store.recover(f.identity,request.intentId);assert.equal(r.reason,'LEGACY_METADATA');assert.equal(r.session,undefined);
      const rejected=await f.register();assert.equal(rejected.reason,'INTENT_CONFLICT');assert.equal((await intents.lookupCheckoutIntent(pool,legacy.scope,legacy.intentId)).checkout_hash,legacy.checkoutHash);
    });
    await t.test('completed recovery never returns a draft or permits another registered submission',async()=>{
      const f=durableFixture();await f.register();const intent=f.coordinator.review.intent;
      const fixtureOrder=(await admin.query(`INSERT INTO orders(restaurant_id,customer_id,status,total_price,payment_method,change_for,fulfillment_type,subtotal,delivery_fee,pickup_address)
        VALUES($1,$2,'pending',20.02,'Pix',0,'PICKUP',20.02,0,$3::jsonb) RETURNING id`,[id(1),id(4),JSON.stringify({name:'Loja',street:'Rua A',number:'10',neighborhood:'Centro',city:'Cidade'})])).rows[0].id;
      const c=await pool.connect();let concurrent;
      try{
        await c.query('BEGIN');await intents.lockCheckoutIntent(c,intent);
        concurrent=f.store.recover(f.identity,intent.intentId);
        await new Promise(resolve=>setTimeout(resolve,50));
        await intents.completeCheckoutIntent(c,intent,fixtureOrder);await c.query('COMMIT');
      }finally{c.release();}
      let r=await concurrent;
      if(r.kind==='recoverable_failure'){assert.equal(r.reason,'SERIALIZATION_CONFLICT');r=await f.store.recover(f.identity,intent.intentId);}
      const before=await count();assert.equal(r.kind,'completed');assert.equal(r.orderId,fixtureOrder);assert.equal(r.session,undefined);
      assert.equal((await f.register()).state,'COMPLETED');assert.throws(()=>f.coordinator.createRegisteredSubmission({}));assert.equal(await count(),before);
    });
    for(const mode of ['PICKUP','DELIVERY'])await t.test(`${mode}: one client/serializable transaction preserves items, options and chat`,async()=>{
      const f=await prepared(mode),before=await count(),{result,trace,connections}=await attempt(f);
      assert.equal(result.kind,'success');assert.equal(result.replayed,false);assert.equal(await count(),before+1);assert.equal(connections,1);
      assert.equal(trace[0],'BEGIN ISOLATION LEVEL SERIALIZABLE');assert.equal(trace.at(-1),'COMMIT');assert.equal(trace.filter(sql=>sql.startsWith('BEGIN')).length,1);
      assert.equal(result.fullOrder.items[0].options.length,2);assert.equal(result.fullOrder.items[0].quantity,2);
      assert.equal(result.fullOrder.total_price,mode==='DELIVERY'?22.05:20.02);
      assert.equal((await pool.query('SELECT count(*)::int n FROM chats WHERE order_id=$1',[result.fullOrder.order_id])).rows[0].n,1);
      assert.equal((await intents.lookupCheckoutIntent(pool,f.intent.scope,f.intent.intentId)).order_id,result.fullOrder.order_id);
      const replay=await attempt(f);assert.equal(replay.result.kind,'success');assert.equal(replay.result.replayed,true);assert.equal(replay.result.fullOrder.order_id,result.fullOrder.order_id);assert.equal(await count(),before+1);
      assert.ok(!replay.trace.some(sql=>sql.includes('FROM public.products p')));
    });
    await t.test('concurrent confirmations create exactly one order; serialization retries reuse key',async()=>{
      const f=await prepared(),before=await count();const attempts=await Promise.all([attempt(f),attempt(f)]);
      for(let a of attempts){if(a.result.kind==='recoverable_failure'){assert.equal(a.result.reason,'SERIALIZATION_CONFLICT');a=await attempt(f);}assert.equal(a.result.kind,'success');}
      assert.equal(await count(),before+1);
    });
    await t.test('price and delivery/pickup address changes require new review without order writes',async()=>{
      for(const kind of ['price','delivery address','pickup address']){
        const f=await prepared(kind==='delivery address'?'DELIVERY':'PICKUP'),before=await count();
        const query=kind==='price'?['UPDATE product_variants SET price=9.01 WHERE id=$1',[id(5)]]:kind==='delivery address'?['UPDATE customers SET street=$2 WHERE id=$1',[id(4),'Rua Nova']]:['UPDATE restaurants SET street=$2 WHERE id=$1',[id(1),'Rua Nova']];
        await pool.query(...query);const a=await attempt(f);assert.equal(a.result.kind,'review_required');assert.equal(await count(),before);assert.ok(!a.trace.some(sql=>sql.startsWith('INSERT INTO orders')));
        assert.equal((await intents.lookupCheckoutIntent(pool,f.intent.scope,f.intent.intentId)).state,'RECOVERABLE_FAILURE');
        if(kind==='price')await pool.query('UPDATE product_variants SET price=8.01 WHERE id=$1',[id(5)]);
        else await pool.query(`UPDATE ${kind==='delivery address'?'customers':'restaurants'} SET street='Rua A' WHERE id=$1`,[id(kind==='delivery address'?4:1)]);
      }
    });
    await t.test('failure before commit rolls back header, options, items, chat and intent link',async()=>{
      const f=await prepared(),before=await count();const a=await attempt(f,{beforeCommit:true});assert.equal(a.result.reason,'TRANSACTION_ABORTED');assert.equal(await count(),before);assert.equal(a.trace.at(-1),'ROLLBACK');
      assert.equal((await intents.lookupCheckoutIntent(pool,f.intent.scope,f.intent.intentId)).state,'PENDING');assert.equal((await attempt(f)).result.kind,'success');assert.equal(await count(),before+1);
    });
    await t.test('identity change during persistence rolls back all writes before COMMIT',async()=>{
      const f=await prepared(),before=await count();const a=await attempt(f,{identityChange:true});assert.equal(a.result.reason,'UNAUTHORIZED');assert.equal(await count(),before);
      assert.equal(a.trace.at(-1),'ROLLBACK');assert.ok(!a.trace.includes('COMMIT'));assert.equal((await intents.lookupCheckoutIntent(pool,f.intent.scope,f.intent.intentId)).state,'PENDING');
    });
    await t.test('missing migration infrastructure fails closed before any order insert',async()=>{
      const f=await prepared(),before=await count();await admin.query('ALTER TABLE whatsapp_checkout_intents RENAME TO unavailable_checkout_intents');
      try{const a=await attempt(f);assert.equal(a.result.reason,'NOT_CONFIGURED');assert.equal(await count(),before);assert.ok(!a.trace.some(sql=>sql.startsWith('INSERT INTO orders')));}
      finally{await admin.query('ALTER TABLE unavailable_checkout_intents RENAME TO whatsapp_checkout_intents');}
    });
    await t.test('missing 006 INSERT permissions fail closed; restoring only its versioned grant permits checkout',async()=>{
      const f=await prepared(),before=await count();
      await admin.query('REVOKE INSERT (fulfillment_type,subtotal,delivery_fee,pickup_address) ON orders FROM gama_app');
      try{const a=await attempt(f);assert.equal(a.result.reason,'NOT_CONFIGURED');assert.equal(await count(),before);}
      finally{
        const migration=fs.readFileSync(path.join(__dirname,'../migrations/006_order_fulfillment.sql'),'utf8');
        const grant=migration.match(/GRANT INSERT[\s\S]*?TO gama_app;/)[0];await admin.query(grant);
      }
      assert.equal((await attempt(f)).result.kind,'success');assert.equal(await count(),before+1);
    });
    await t.test('40001 during authorization or COMMIT is recoverable with the same key',async()=>{
      for(const fault of [{authorizationSerialization:true},{commitAbort:true}]){
        const f=await prepared(),before=await count();const a=await attempt(f,fault);assert.equal(a.result.reason,'SERIALIZATION_CONFLICT');assert.equal(a.result.intentId,f.intent.intentId);assert.equal(await count(),before);
        assert.equal((await attempt(f)).result.kind,'success');assert.equal(await count(),before+1);
      }
    });
    await t.test('uncertain commit: lost reply recovers original order, uncommitted attempt requires review',async()=>{
      const f=await prepared(),before=await count();const a=await attempt(f,{commitAfter:true});assert.equal(a.result.reason,'COMMIT_UNKNOWN');assert.equal(await count(),before+1);
      f.snapshot=null;const recovered=await attempt(f);assert.equal(recovered.result.kind,'success');assert.equal(recovered.result.replayed,true);assert.equal(await count(),before+1);
      const g=await prepared(),beforeG=await count();const b=await attempt(g,{commitBefore:true});assert.equal(b.result.reason,'COMMIT_UNKNOWN');assert.equal(await count(),beforeG);
      g.snapshot=null;assert.equal((await attempt(g)).result.kind,'review_required');assert.equal(await count(),beforeG);
    });
    await t.test('payload divergence and wrong restaurant cannot create orders',async()=>{
      const f=await prepared(),before=await count();f.intent={...f.intent,checkoutHash:'0'.repeat(64)};assert.equal((await attempt(f)).result.reason,'INTENT_CONFLICT');
      const g=await prepared();g.contextOverride={...g.live.context,restaurant_id:id(9)};assert.equal((await attempt(g)).result.kind,'rejected');assert.equal(await count(),before);
    });
    await t.test('restart with a new authorizer and no process-local review snapshot recovers completed order',async()=>{
      const activeRestart=activeFixture(11);await activeRestart.register();const activeFrame={...activeRestart.live};
      const pendingRecovery=durableFixture(3);await pendingRecovery.register();const pendingKey=pendingRecovery.coordinator.review.intent.intentId;
      const f=await prepared();const original=(await attempt(f)).result;assert.equal(original.kind,'success');await pool.end();pool=undefined;await admin.end();admin=undefined;
      command('pg_ctl',['-D',data,'-m','fast','-w','stop']);started=false;start();admin=new Pool(config);pool=new Pool(appConfig);f.snapshot=null;
      const activeFresh=new ActiveCheckoutSessions(new WhatsAppCheckoutAuthorizer(new GetClientService(pool),pool),pool);
      const reboot=await activeFresh.inspectBootstrap(()=>({...activeFrame,identityRevision:null}));assert.equal(reboot.kind,'reconciliation_required');
      const reconciled=await activeFresh.reconcileBootstrap(reboot.challenge,()=>({...activeFrame,identityRevision:null}));assert.equal(reconciled.identityRevision,11);
      assert.equal((await activeFresh.recoverActive(()=>activeFrame)).intent.intentId,activeRestart.coordinator.review.intent.intentId);
      // Rebuild a new process session from durable payload + fresh transport, not an old token.
      const fresh=session(),row=await intents.lookupCheckoutIntent(pool,intents.createCheckoutIntentRequest(fresh,f.intent.intentId).scope,f.intent.intentId);
      const payload=JSON.parse(row.canonical_checkout);fresh.checkout.cart.clear();for(const item of payload.items)fresh.checkout.cart.add(item);
      fresh.checkout.pickupAddress={restaurantId:fresh.context.restaurant_id,...payload.address};fresh.checkout.paymentMethod=payload.paymentMethod;
      fresh.checkout.paymentContext=checkoutPaymentSnapshot(fresh.checkout,fresh.context.restaurant_id);
      f.live=fresh;f.intent=intents.createCheckoutIntentRequest(fresh,row.intent_id);
      // A catalog change after creation must not prevent replay of the committed result.
      await pool.query('UPDATE products SET available=false WHERE id=$1',[id(3)]);
      const freshRecovery=durableFixture(0),baseline=await freshRecovery.store.recover(freshRecovery.identity,pendingKey);assert.equal(baseline.reason,'IDENTITY_GENERATION_CHANGED');assert.equal(baseline.session,undefined);
      // Fresh bootstrap, before processing transport events: explicitly reconcile the validated durable baseline.
      freshRecovery.live.identityRevision=baseline.storedIdentityRevision;
      const pendingRestored=await freshRecovery.store.recover(freshRecovery.identity,pendingKey);assert.equal(pendingRestored.kind,'review_required');assert.equal(pendingRestored.storedIdentityRevision,3);assert.ok(pendingRestored.session);
      const recovered=(await attempt(f)).result;assert.equal(recovered.kind,'success');assert.equal(recovered.fullOrder.order_id,original.fullOrder.order_id);assert.equal(recovered.replayed,true);
    });
    await t.test('completed active intention is replayed and cannot be silently replaced',async()=>{
      const f=activeFixture();await f.register();const request=f.coordinator.review.intent;
      // orders are UNIQUE per intent: use a minimal fixture owned by the same customer in this disposable database.
      const candidate=await admin.query("SELECT id FROM orders WHERE restaurant_id=$1 AND customer_id=$2 AND id NOT IN (SELECT order_id FROM whatsapp_checkout_intents WHERE order_id IS NOT NULL) LIMIT 1",[id(1),id(4)]);
      let orderId=candidate.rows[0]?.id;
      if(!orderId){orderId=id(995);await admin.query("INSERT INTO orders (id,restaurant_id,customer_id,payment_method,total_price,status,fulfillment_type,subtotal,delivery_fee,pickup_address) VALUES ($1,$2,$3,'Pix',0,'PENDING','PICKUP',0,0,'{}')",[orderId,id(1),id(4)]);}
      const c=await pool.connect();try{await c.query('BEGIN');await intents.completeCheckoutIntent(c,request,orderId);await c.query('COMMIT');}finally{c.release();}
      const recovered=await f.store.recoverActive(f.identity);assert.equal(recovered.kind,'completed');assert.equal(recovered.orderId,orderId);assert.equal(recovered.session,undefined);
      assert.equal((await f.store.invalidateActive(f.identity,{intentId:request.intentId,identityRevision:0})).kind,'rejected');
      assert.equal((await f.store.recoverActive(f.identity)).orderId,orderId);
      const another=intents.createCheckoutIntentRequest(f.live,id(997)),client=await pool.connect();
      try{await client.query('BEGIN');await intents.prepareCheckoutIntent(client,another);await assert.rejects(client.query('UPDATE whatsapp_checkout_intents SET active=true WHERE intent_id=$1',[another.intentId]),{code:'23505'});await client.query('ROLLBACK');}finally{client.release();}
    });
    await t.test('internal operation never loads HTTP server, controllers or worker',async()=>{
      for(const p of ['../src/server','../src/controller/order/OrderSalesController','../src/messaging/worker/local'])assert.equal(require.cache[require.resolve(p)],undefined);
    });
  }finally{
    if(pool)await pool.end();if(admin)await admin.end();if(started)command('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
    if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('gama-submission-'))fs.rmSync(root,{recursive:true,force:true});
  }
});
