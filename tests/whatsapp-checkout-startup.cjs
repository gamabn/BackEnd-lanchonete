const {test}=require('node:test');
const assert=require('node:assert/strict');
require('ts-node/register');
const db=require.resolve('../src/database');
require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:new Proxy({},{get:()=>()=>{throw Error('Production database forbidden');}})}};
const {readLocalBotConfig}=require('../src/messaging/worker/config');
const {prepareWorkerCheckout,startConfiguredWhatsApp}=require('../src/messaging/worker/checkoutStartup');
const {connectLocalWhatsApp}=require('../src/messaging/worker/connection');
const {PersistentWhatsAppCheckout}=require('../src/messaging/checkout/whatsappPersistentCheckout');
const env={GAMA_BOT_ENABLED:'true',GAMA_BOT_RESTAURANT_ID:'00000000-0000-4000-8000-000000000001',GAMA_BOT_SESSION_ID:'00000000-0000-4000-8000-000000000002',GAMA_BOT_AUTH_DIR:'.gama-bot-dev/startup'};
const config=flag=>readLocalBotConfig({...env,...(flag===undefined?{}:{WHATSAPP_REAL_CHECKOUT_ENABLED:flag})},'/tmp/gama');
function fixture(){
 const trace=[];
 const role={role:'gama_app',login:'gama_app',rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false};
 const f={role,allowed:true,fail:null};
 const client={query:async sql=>{
   trace.push(sql);assert.match(sql,/^SELECT/);
   if(f.fail&&sql.includes(f.fail))throw Error('secret connection details');
   return {rows:sql.includes('FROM pg_roles')?[f.role]:sql.includes(' AS allowed')?[{allowed:f.allowed}]:[]};
 },release:()=>trace.push('release')};
 const orders={to:()=>orders,emit:()=>{throw Error('Startup must not emit');}};
 const io={_nsps:new Map([['/orders',orders]]),of:name=>{assert.equal(name,'/orders');return orders;}};
 return Object.assign(f,{trace,client,io,database:{connect:async()=>client},host:async()=>({database:f.database,io:f.io})});
}
for(const flag of [undefined,'false'])test(`flag ${flag}: simulation starts without touching real dependencies`,async()=>{
 const calls=[];const worker={stop:async()=>{},done:Promise.resolve()};
 const actual=await startConfiguredWhatsApp(config(flag),()=>{},()=>{},async()=>{assert.fail('host must not be loaded');},async(...args)=>{calls.push(args);return worker;});
 assert.equal(actual,worker);assert.equal(calls.length,1);assert.equal(calls[0][4],undefined);
});
for(const flag of ['TRUE','1','','yes'])test(`invalid flag ${JSON.stringify(flag)} is rejected`,()=>{
 assert.throws(()=>config(flag),e=>e.code==='INVALID_CHECKOUT_FLAG');
});
test('enabled startup validates pool and injects the actual persistent factory into the connector',async()=>{
 const f=fixture();let count=0;
 await startConfiguredWhatsApp(config('true'),()=>{},()=>{},f.host,async(...args)=>{
   count++;assert.ok(args[4] instanceof PersistentWhatsAppCheckout);
   assert.equal(f.trace.at(-1),'release');
   assert.ok(f.trace.some(sql=>sql.includes('public.customers')));
   assert.ok(f.trace.some(sql=>sql.includes('public.orders')));
   return {stop:async()=>{},done:Promise.resolve()};
 });assert.equal(count,1);
 assert.equal(require.cache[require.resolve('../src/server')],undefined);
});
for(const kind of ['host','socket','connect','role','login','elevated','grants','schema','identity-reader'])test(`${kind} startup failure prevents transport startup and simulation fallback`,async()=>{
 const f=fixture();let started=0;
 if(kind==='socket')f.io._nsps.clear();
 if(kind==='connect')f.database.connect=async()=>{throw Error('secret');};
 if(kind==='role')f.role.role='owner';
 if(kind==='login')f.role.login='owner';
 if(kind==='elevated')f.role.rolbypassrls=true;
 if(kind==='grants')f.allowed=false;
 if(kind==='schema')f.fail='public.orders';
 if(kind==='identity-reader')f.fail='public.customers';
 const host=kind==='host'?async()=>{throw Error('secret');}:f.host;
 await assert.rejects(()=>startConfiguredWhatsApp(config('true'),()=>{},()=>{},host,async()=>{started++;}),e=>e.code==='REAL_CHECKOUT_UNAVAILABLE'&&!e.message.includes('secret'));
 assert.equal(started,0);
 if(!['host','socket','connect'].includes(kind))assert.equal(f.trace.at(-1),'release');
});
test('standalone enabled worker fails without an existing Socket.IO host',async()=>{
 await assert.rejects(()=>prepareWorkerCheckout(config('true')),e=>e.code==='REAL_CHECKOUT_UNAVAILABLE');
});
test('connection boundary refuses enabled mode without checkout before loading SDK',async()=>{
 let loaded=false;
 await assert.rejects(()=>connectLocalWhatsApp(config('true'),()=>{},()=>{},async()=>{loaded=true;}),e=>e.code==='REAL_CHECKOUT_REQUIRED');
 assert.equal(loaded,false);
});
