const {test}=require('node:test');const assert=require('node:assert/strict');
require('ts-node/register');
const db=require.resolve('../src/database');require.cache[db]={id:db,filename:db,loaded:true,exports:{pool:new Proxy({},{get:()=>()=>{throw Error('Production database forbidden');}})}};
const {session,id}=require('./fixtures/whatsapp-idempotency.cjs');
const {PersistentWhatsAppCheckout}=require('../src/messaging/checkout/whatsappPersistentCheckout');
const {ConversationMenu}=require('../src/messaging/core/conversationMenu');
const {createCheckoutIntentRequest}=require('../src/messaging/checkout/checkoutIdempotency');
function fixture(mode='PICKUP'){
 const live=session(); if(mode==='DELIVERY'){
  const a={street:'Rua A',number:'10',neighborhood:'Centro',city:'Cidade',complement:null};Object.assign(live.checkout,{fulfillmentMode:mode,addressConfirmed:true,confirmedAddress:a,addressOriginal:a,addressCustomerId:id(4),addressPhone:live.transportIdentity.phone,deliveryRegion:{restaurant_id:id(1),customer_id:id(4),bairro_id:id(8),bairro:'Centro',fee:'2.00',fulfillment_mode:mode,confirmed:true,address:a}});
 // Real fulfillment confirmation clears the previous payment before selection.
 // session() starts with a PICKUP review; its snapshot is stale after switching to DELIVERY.
 live.checkout.paymentMethod=undefined;
 live.checkout.paymentContext=undefined;
 }
 const state={...live.checkout,categories:[],checkoutTransport:{context:live.context,sender:live.sender,identity:live.transportIdentity},identityGeneration:0};
 let stored,submits=0,notifications=0,result,resolveSubmit;const trace=[];
 const active={inspectBootstrap:async()=>({kind:'no_durable_generation'}),recoverActive:async current=>current().context.session_id===live.context.session_id?(stored||{kind:'no_active_intent'}):{kind:'no_active_intent'},registerActive:async(c)=>{trace.push('register');const p=c.beginDurableRegistration();c.finishDurableRegistration(p.intent,'PENDING');stored={kind:'review_required',intent:p.intent,state:'PENDING',storedIdentityRevision:0,session:{...live,checkout:state}};return{kind:'registered',current:true};},replaceActive:async(c)=>{trace.push('replace');const p=c.beginDurableRegistration();c.finishDurableRegistration(p.intent,'PENDING');stored={kind:'review_required',intent:p.intent,state:'PENDING',storedIdentityRevision:0,session:live};return{kind:'registered',current:true};}};
 const authorizer={authorize:async current=>{current();trace.push('authorize');return {};}};
 const submission={submit:async dto=>{submits++;trace.push('submit');assert.ok(dto.snapshot);if(resolveSubmit)await resolveSubmit;trace.push('committed');return result||{kind:'success',replayed:false,fullOrder:{order_id:id(900),restaurant_id:id(1)}};}};
 const runtime=new PersistentWhatsAppCheckout(authorizer,active,submission,()=>{trace.push('notify');notifications++;});
 const deny=new Proxy({},{get:()=>()=>{throw Error('Unexpected IO');}});
 const initialMenu={reply:async()=> 'MENU PRINCIPAL',load:async()=>({available:true,reply:'MENU PRINCIPAL'})};
 const menu=new ConversationMenu(deny,deny,deny,deny,deny,initialMenu,runtime);
 menu.sessions.set(JSON.stringify([id(1),'key',live.sender.subject_id]),state);
 const send=t=>menu.handle('key',id(1),t,live.sender.subject_id,live.transportIdentity,{context:live.context,sender:live.sender});
 return{live,state,active,runtime,menu,trace,send,current:()=>({...live,checkout:state}),setStored:x=>stored=x,setResult:x=>result=x,delay:p=>resolveSubmit=p,get submits(){return submits},get notifications(){return notifications}};
}
for(const mode of ['DELIVERY','PICKUP'])test(`${mode}: real menu registers before review, commits before success/event, duplicate confirms replay`,async()=>{
 const f=fixture(mode);f.state.step='PAYMENT_SELECTION';const review=await f.send('1');assert.match(review,/REVISÃO/);assert.doesNotMatch(review,/simulada/);assert.equal(f.submits,0);assert.ok(f.trace.includes('register'));
 const [a,b]=await Promise.all([f.send('1'),f.send('1')]);assert.match(a,/Pedido confirmado/);assert.equal(a,b);assert.equal(f.submits,1);assert.equal(f.notifications,1);assert.ok(f.trace.indexOf('notify')>f.trace.indexOf('committed'));
});
test('restart: recovered pending requires presentation and another message, preserving exact intent',async()=>{
 const f=fixture();const intent=createCheckoutIntentRequest(f.live,id(30));f.setStored({kind:'review_required',intent,state:'PENDING',storedIdentityRevision:0,session:f.live});const a=await f.send('1');assert.match(a,/Recuperamos/);assert.equal(f.submits,0);await f.send('1');assert.equal(f.submits,1);assert.equal(f.trace.includes('register'),false);
});
test('restart after commit reports original order without submitting or notifying',async()=>{
 const f=fixture();f.setStored({kind:'completed',orderId:id(900)});assert.match(await f.send('1'),/Pedido confirmado/);assert.equal(f.submits,0);assert.equal(f.notifications,0);
});
test('lost COMMIT response: no success/event, next message recovers completed order',async()=>{
 const f=fixture();f.state.step='PAYMENT_SELECTION';await f.send('1');f.setResult({kind:'recoverable_failure',reason:'COMMIT_UNKNOWN'});assert.doesNotMatch(await f.send('1'),/✅/);assert.equal(f.notifications,0);f.setStored({kind:'completed',orderId:id(900)});assert.match(await f.send('1'),/Pedido confirmado/);assert.equal(f.submits,1);assert.equal(f.notifications,0);
});
test('changed data requires fresh review and does not notify',async()=>{
 const f=fixture();f.state.step='PAYMENT_SELECTION';await f.send('1');f.setResult({kind:'review_required',changes:['PRICES']});assert.match(await f.send('1'),/mudaram/);assert.doesNotMatch(await f.send('1'),/Pedido confirmado/);assert.equal(f.submits,1);assert.equal(f.notifications,0);
});
test('replay and socket failure never cause a second order',async()=>{
 const f=fixture();f.state.step='PAYMENT_SELECTION';await f.send('1');f.setResult({kind:'success',replayed:true,fullOrder:{order_id:id(900)}});assert.match(await f.send('1'),/Pedido confirmado/);assert.equal(f.notifications,0);
});
test('identity change cannot expose cached completion',async()=>{
 const f=fixture();f.setStored({kind:'completed',orderId:id(900)});await f.send('1');f.live.transportIdentity={phone:'5577888888888',source:'senderPn'};assert.doesNotMatch(await f.send('1'),/Pedido confirmado/);
});
test('notification exception does not turn committed order into failure',async()=>{
 const f=fixture();const runtime=new PersistentWhatsAppCheckout({authorize:async()=>({})},f.active,{submit:async()=>({kind:'success',replayed:false,fullOrder:{order_id:id(900)}})},()=>{throw Error('socket unavailable')});
 await runtime.resume(f.state,f.current,()=>{});assert.equal(await runtime.prepare(f.state,f.current),true);assert.match(await runtime.confirm(f.state),/Pedido confirmado/);assert.match(await runtime.confirm(f.state),/Pedido confirmado/);
});
