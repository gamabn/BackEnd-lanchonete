const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
require('ts-node/register');
const db=require.resolve('../src/database');require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:new Proxy({},{get:()=>()=>assert.fail('Production database forbidden')})}};
const {TenantWhatsAppSessionManager}=require('../src/messaging/worker/tenantSessionManager');
const {acquireLocalAuth}=require('../src/messaging/worker/localAuth');
const {LocalMessageProcessor}=require('../src/messaging/channels/whatsapp/messages');
const {ConversationMenu}=require('../src/messaging/core/conversationMenu');
const {id}=require('./fixtures/whatsapp-idempotency.cjs');
const A=id(1),B=id(2);
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gama-multi-h11-')),hosts=[],managers=[];
 const f={root,hosts,time:Date.now(),enabled:true,unknown:new Set(),legacy:new Set(),failTenant:null,restoreFailures:[]};
 const resources={database:{query:()=>assert.fail('Injected owner lookup expected'),end:()=>assert.fail('Pool must remain open')},io:{close:()=>assert.fail('Shared Socket.IO must remain open')}};
 f.makeManager=()=>{
  const manager=new TenantWhatsAppSessionManager(resources,{root,enabled:()=>f.enabled,now:()=>f.time,ready:async()=>{if(f.ready)await f.ready();},legacyReserved:r=>f.legacy.has(r),ownerExists:async r=>!f.unknown.has(r),restoreFailed:(id,code)=>f.restoreFailures.push({id,code}),
   hostFactory:(qr,observe)=>{
    const h={qr,observe,stops:0,start:async config=>{h.config=config;if(f.failTenant===config.context.restaurant_id)throw Error('private credentials');h.release=await acquireLocalAuth(config);observe({state:'connecting'});},stop:async()=>{h.stops++;await h.release?.();observe({state:'disconnected'});}};
    hosts.push(h);return h;
   }});managers.push(manager);return manager;
 };
 f.manager=f.makeManager();
 t.after(async()=>{await Promise.allSettled(managers.map(m=>m.stopAll()));await fs.rm(root,{recursive:true,force:true});});
 return f;
}
test('A and B connect simultaneously with separate contexts, auth directories, locks and QRs',async t=>{
 const f=await fixture(t);await Promise.all([f.manager.connect(A),f.manager.connect(B)]);assert.equal(f.hosts.length,2);
 const a=f.hosts.find(h=>h.config.context.restaurant_id===A),b=f.hosts.find(h=>h.config.context.restaurant_id===B);
 assert.notEqual(a.config.authDir,b.config.authDir);assert.notEqual(a.config.context.session_id,b.config.context.session_id);
 assert.equal(a.config.realCheckoutEnabled,true);assert.equal(b.config.realCheckoutEnabled,true);
 a.qr('QR_A');b.qr('QR_B');assert.equal((await f.manager.qr(A)).qr,'QR_A');assert.equal((await f.manager.qr(B)).qr,'QR_B');
 a.observe({state:'connected'});assert.equal((await f.manager.status(A)).status,'connected');assert.equal((await f.manager.qr(A)).qr,null);
 assert.equal((await f.manager.status(B)).status,'qr_required');
 for(const h of [a,b]){const marker=JSON.parse(await fs.readFile(path.join(h.config.authDir,'.context.json'),'utf8'));assert.equal(marker.restaurant_id,h.config.context.restaurant_id);await assert.rejects(()=>acquireLocalAuth(h.config),e=>e.code==='LOCK_PRESENT');}
 assert.doesNotMatch(JSON.stringify(await f.manager.status(B)),/QR_B|authDir|sessionId|creds|private/);
});
test('concurrent start requests for one restaurant create only one host',async t=>{
 const f=await fixture(t);await Promise.all([f.manager.connect(A),f.manager.connect(A),f.manager.connect(A)]);assert.equal(f.hosts.length,1);
});
test('A connected while B starts, both connected, then B disconnects without stopping A',async t=>{
 const f=await fixture(t);await f.manager.connect(A);const a=f.hosts[0];a.observe({state:'connected'});
 await f.manager.connect(B);const b=f.hosts[1];
 assert.equal((await f.manager.status(A)).status,'connected');assert.equal((await f.manager.status(B)).status,'connecting');
 b.observe({state:'connected'});assert.equal((await f.manager.status(A)).status,'connected');assert.equal((await f.manager.status(B)).status,'connected');
 await f.manager.disconnect(B);assert.equal((await f.manager.status(B)).status,'disconnected');assert.equal((await f.manager.status(A)).status,'connected');assert.equal(a.stops,0);
 await assert.rejects(()=>acquireLocalAuth(a.config),e=>e.code==='LOCK_PRESENT');
});
test('B lock in another manager rejects only B and preserves connected A and the lock owner',async t=>{
 const f=await fixture(t);await f.manager.connect(A);f.hosts[0].observe({state:'connected'});
 const other=f.makeManager();await other.connect(B);const b=f.hosts[1];b.observe({state:'connected'});
 await assert.rejects(()=>f.manager.connect(B),e=>e.status===503&&e.code==='LOCK_PRESENT');
 assert.equal((await f.manager.status(A)).status,'connected');assert.equal((await other.status(B)).status,'connected');
 assert.equal(f.hosts[0].stops,0);assert.equal(b.stops,0);
 await assert.rejects(()=>acquireLocalAuth(b.config),e=>e.code==='LOCK_PRESENT');
 // Only the owner releases its own lock; a subsequent explicit retry can then proceed.
 await other.disconnect(B);await f.manager.connect(B);
 assert.equal((await f.manager.status(B)).status,'connecting');assert.equal((await f.manager.status(A)).status,'connected');
});
test('disconnect A preserves credentials and B, and invalidates late A callbacks',async t=>{
 const f=await fixture(t);await f.manager.connect(A);await f.manager.connect(B);const [a,b]=f.hosts;
 const sentinel=path.join(a.config.authDir,'preserved-test-key.json');await fs.writeFile(sentinel,'{"test":"preserve"}');
 b.observe({state:'connected'});a.qr('OLD_A');await f.manager.disconnect(A);a.qr('STALE_A');a.observe({state:'connected'});
 assert.equal((await f.manager.status(A)).status,'disconnected');assert.equal((await f.manager.qr(A)).qr,null);assert.equal((await f.manager.status(B)).status,'connected');assert.equal(b.stops,0);
 assert.equal(await fs.readFile(sentinel,'utf8'),'{"test":"preserve"}');
});
test('QR expires and never appears in status responses',async t=>{
 const f=await fixture(t);await f.manager.connect(A);f.hosts[0].qr('SECRET_QR');assert.equal((await f.manager.status(A)).qr_available,true);
 assert.doesNotMatch(JSON.stringify(await f.manager.status(A)),/SECRET_QR/);f.time+=60001;assert.equal((await f.manager.qr(A)).qr,null);assert.equal((await f.manager.status(A)).qr_available,false);
});
test('clean restart restores A and B with unchanged session IDs and auth paths',async t=>{
 const f=await fixture(t);await f.manager.connect(A);await f.manager.connect(B);const original=f.hosts.map(h=>h.config);
 await f.manager.stopAll();const restarted=f.makeManager();assert.deepEqual(await restarted.restore(),{restored:2,failed:0});
 for(const previous of original){const next=f.hosts.slice(2).find(h=>h.config.context.restaurant_id===previous.context.restaurant_id).config;assert.equal(next.authDir,previous.authDir);assert.deepEqual(next.context,previous.context);}
});
test('restore and duplicate connect on the current instance do not acquire locks twice',async t=>{
 const f=await fixture(t);await f.manager.connect(A);await f.manager.connect(B);f.hosts.forEach(h=>h.observe({state:'connected'}));
 assert.deepEqual(await f.manager.restore(),{restored:2,failed:0});
 await Promise.all([f.manager.connect(A),f.manager.connect(A.toUpperCase()),f.manager.connect(B)]);
 assert.equal(f.hosts.length,2);assert.equal((await f.manager.status(A)).status,'connected');assert.equal((await f.manager.status(B)).status,'connected');
});
test('B locked during restart does not prevent restoring A and is reported independently',async t=>{
 const f=await fixture(t);await f.manager.connect(A);await f.manager.connect(B);const configB=f.hosts[1].config;
 await f.manager.stopAll();const releaseB=await acquireLocalAuth(configB);t.after(releaseB);
 const restarted=f.makeManager();assert.deepEqual(await restarted.restore(),{restored:1,failed:1});
 assert.deepEqual(f.restoreFailures,[{id:B,code:'LOCK_PRESENT'}]);assert.equal((await restarted.status(B)).error,'LOCK_PRESENT');
 const a=f.hosts.findLast(h=>h.config.context.restaurant_id===A);a.observe({state:'connected'});
 assert.equal((await restarted.status(A)).status,'connected');await assert.rejects(()=>acquireLocalAuth(configB),e=>e.code==='LOCK_PRESENT');
 await releaseB();await restarted.connect(B);assert.equal((await restarted.status(A)).status,'connected');
});
test('explicit disconnect is durable and is not restored on restart',async t=>{
 const f=await fixture(t);await f.manager.connect(A);await f.manager.connect(B);await f.manager.disconnect(A);await f.manager.stopAll();
 const restarted=f.makeManager();assert.deepEqual(await restarted.restore(),{restored:1,failed:0});assert.equal(f.hosts.at(-1).config.context.restaurant_id,B);
});
test('A startup failure is sanitized, has no simulation fallback and does not prevent B',async t=>{
 const f=await fixture(t);f.failTenant=A;await assert.rejects(()=>f.manager.connect(A),e=>e.status===503&&e.code==='START_FAILED');
 assert.equal((await f.manager.status(A)).error,'START_FAILED');assert.doesNotMatch(JSON.stringify(await f.manager.status(A)),/private credentials/);
 await f.manager.connect(B);assert.equal(f.hosts.filter(h=>h.config.context.restaurant_id===A).length,1);assert.equal((await f.manager.status(B)).status,'connecting');
});
test('invalid or nonexistent owners cannot initialize metadata or workers',async t=>{
 const f=await fixture(t);f.unknown.add(A);await assert.rejects(()=>f.manager.connect(A),e=>e.status===403);
 await assert.rejects(()=>f.manager.connect('../../other'),e=>e.status===401);assert.deepEqual(await fs.readdir(f.root),[]);assert.equal(f.hosts.length,0);
});
test('real checkout disabled blocks startup without fallback and skips restoration',async t=>{
 const f=await fixture(t);f.enabled=false;await assert.rejects(()=>f.manager.connect(A),e=>e.code==='REAL_CHECKOUT_DISABLED');assert.equal(f.hosts.length,0);assert.deepEqual(await f.manager.restore(),{restored:0,failed:0});
});
test('legacy integrated worker reserves its restaurant without blocking another tenant',async t=>{
 const f=await fixture(t);f.legacy.add(A);await assert.rejects(()=>f.manager.connect(A),e=>e.code==='LEGACY_WORKER_ACTIVE');await assert.rejects(()=>f.manager.disconnect(A),e=>e.code==='LEGACY_WORKER_ACTIVE');assert.equal((await f.manager.status(A)).status,'legacy_active');await f.manager.connect(B);assert.equal(f.hosts.length,1);
});
test('default owner lookup checks the authenticated UUID in restaurants with a bound parameter',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gama-owner-h11-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const calls=[],database={query:async(sql,args)=>{calls.push({sql,args});return{rows:args[0]===A?[{id:A}]:[]};}};
 const manager=new TenantWhatsAppSessionManager({database,io:{}},{root,enabled:()=>false,ready:async()=>{}});
 assert.equal((await manager.status(A)).restaurant_id,A);await assert.rejects(()=>manager.status(B),e=>e.code==='OWNER_NOT_FOUND');
 assert.deepEqual(calls[0].args,[A]);assert.match(calls[0].sql,/FROM public.restaurants WHERE id = \$1/);assert.deepEqual(await fs.readdir(root),[]);
});
test('shutdown during dependency initialization prevents creation of a WhatsApp host',async t=>{
 const f=await fixture(t),entered=deferred(),gate=deferred();f.ready=()=>{entered.resolve();return gate.promise;};
 const connecting=f.manager.connect(A);await entered.promise;const stopped=f.manager.stopAll();gate.resolve();
 await assert.rejects(()=>connecting);await stopped;assert.equal(f.hosts.length,0);await assert.rejects(()=>f.manager.connect(B),e=>e.code==='HOST_STOPPING');
});
test('corrupt A metadata does not block B restoration and is preserved',async t=>{
 const f=await fixture(t);await f.manager.connect(A);await f.manager.connect(B);await f.manager.stopAll();
 const file=path.join(f.root,'.tenants',A+'.json');await fs.writeFile(file,'{broken');const restarted=f.makeManager();assert.deepEqual(await restarted.restore(),{restored:1,failed:1});assert.equal(await fs.readFile(file,'utf8'),'{broken');assert.equal(f.hosts.at(-1).config.context.restaurant_id,B);
});
test('each restaurant processor uses its own menu/catalog and cart for the same sender',async()=>{
 const now=Date.now(),menus=[],catalogCalls=[],sender='5577999999999@s.whatsapp.net';
 for(const [index,restaurant]of [A,B].entries()){
  const context={restaurant_id:restaurant,session_id:id(100+index),channel:'whatsapp'},name=index===0?'CATALOGO_A':'CATALOGO_B';
  const deny=new Proxy({},{get:()=>()=>assert.fail('Unexpected IO')});const initial={load:async()=>({available:true,reply:'MENU '+name}),reply:async()=> 'MENU '+name};
  const menu=new ConversationMenu(deny,deny,deny,deny,deny,initial,undefined,deny,async r=>{catalogCalls.push(r);return[{id:id(300+index),name:'Produto',price:'5.00',category:name,has_variants:false}];});menus.push(menu);
  const processor=new LocalMessageProcessor(context,now,100,menu),sent=[];
  const batch=text=>({type:'notify',messages:[{key:{id:text,remoteJid:sender,fromMe:false},messageTimestamp:Math.ceil(now/1000),message:{conversation:text}}]});
  await processor.process(batch('Oi'),'account-'+index,async(jid,content)=>{assert.equal(jid,sender);sent.push(content.text);});
  await processor.process(batch('1'),'account-'+index,async(_,content)=>sent.push(content.text));assert.match(sent.at(-1),new RegExp(name));
 }
 assert.deepEqual(catalogCalls,[A,B]);const a=[...menus[0].sessions.values()][0],b=[...menus[1].sessions.values()][0];a.cart.add({productId:id(300),productName:'A',quantity:1,unitPrice:'5.00'});assert.equal(b.cart.isEmpty(),true);
});
