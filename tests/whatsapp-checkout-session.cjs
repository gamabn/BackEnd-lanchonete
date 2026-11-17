const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { session, id } = require('./fixtures/whatsapp-idempotency.cjs');
const { LiveCheckoutSession } = require('../src/messaging/checkout/checkoutSession');
const { checkoutPaymentSnapshot } = require('../src/messaging/core/checkoutSnapshot');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { LocalMessageProcessor } = require('../src/messaging/channels/whatsapp/messages');
function fixture() {
  const live=session(), state={...live.checkout,categories:[],step:'PAYMENT_SELECTION'}, forbidden=[];
  const deny=new Proxy({}, {get:(_,method)=>async()=>{forbidden.push(method);throw Error('forbidden');}});
  const store={id:id(1),status:true,name:'Loja',street:'Rua A',number:'10',neighborhood:'Centro',city:'Cidade'};
  const menu=new ConversationMenu({findByWhatsAppPhone:async()=>[]},deny,deny,deny,{execute:async()=>store});
  const key='local-session', jid=live.sender.subject_id, meta={context:live.context,sender:live.sender};
  menu.sessions.set(JSON.stringify([id(1),key,jid]),state);
  const send=(text,identity=live.transportIdentity,transport=meta)=>menu.handle(key,id(1),text,jid,identity,transport);
  return{live,state,forbidden,menu,key,jid,meta,send};
}
test('review presentation captures immutable snapshot and intent bound to the live transport',async()=>{
  const f=fixture();const text=await f.send('1'), prepared=f.state.checkoutSession.review;
  assert.match(text,/REVISÃO DO PEDIDO/);assert.ok(prepared);assert.equal(prepared.registration,'LOCAL_ONLY');
  assert.equal(Object.isFrozen(prepared),true);assert.equal(Object.isFrozen(prepared.snapshot),true);
  assert.equal(Object.isFrozen(prepared.intent.scope.context),true);
  assert.deepEqual(prepared.intent.scope.context,f.live.context);assert.deepEqual(prepared.intent.scope.sender,f.live.sender);assert.equal(prepared.intent.scope.customerId,id(4));
  assert.equal(prepared.identityRevision,f.state.identityGeneration??0);
  const getter=f.state.checkoutSession.readCurrentSession;assert.equal(getter().checkout,f.state);
  const dto=f.state.checkoutSession.createSubmission({});assert.equal(dto.snapshot,prepared.snapshot);assert.equal(dto.intent,prepared.intent);
  assert.deepEqual(f.forbidden,[]);
});
test('invalid input re-displays the same review without changing snapshot or key',async()=>{
  const f=fixture();await f.send('1');const before=f.state.checkoutSession.review;
  for(const text of ['9','restaurant_id=foreign customer_id=other','oi']){assert.match(await f.send(text),/REVISÃO DO PEDIDO/);assert.equal(f.state.checkoutSession.review,before);}
});
test('simulated confirmation preserves the public response and records completion once',async()=>{
  const f=fixture();await f.send('1');const intentId=f.state.checkoutSession.review.intent.intentId;
  assert.equal(await f.send('1'),'✅ Confirmação simulada! Nenhum pedido foi criado e nenhum pagamento foi processado.\n\n0 - Voltar ao pagamento');
  assert.equal(f.state.step,'ORDER_SIMULATED');assert.equal(f.state.checkoutSession.status.phase,'SUBMISSION_COMPLETED');assert.equal(f.state.checkoutSession.status.intentId,intentId);
  assert.match(await f.send('1'),/já simulada/);assert.equal(f.state.checkoutSession.status.intentId,intentId);assert.deepEqual(f.forbidden,[]);
});
test('concurrent confirmations and 0 while pending keep one intent and do not navigate',async()=>{
  const f=fixture();await f.send('1');const prepared=f.state.checkoutSession.review;
  const first=f.send('1');assert.equal(f.state.checkoutSession.status.phase,'SUBMISSION_PENDING');
  const duplicate=f.send('1'),back=f.send('0');
  assert.equal(f.state.checkoutSession.review,prepared);assert.equal(f.state.step,'ORDER_REVIEW');
  const replies=await Promise.all([first,duplicate,back]);assert.match(replies[0],/✅ Confirmação simulada/);assert.match(replies[1],/já simulada/);assert.match(replies[2],/já simulada/);
  assert.equal(f.state.checkoutSession.status.intentId,prepared.intent.intentId);assert.equal(f.state.step,'ORDER_SIMULATED');
});
test('0 after completion returns to payment and explicit new review gets a new key',async()=>{
  const f=fixture();await f.send('1');const previous=f.state.checkoutSession.review.intent.intentId;await f.send('1');await f.send('0');
  assert.equal(f.state.step,'PAYMENT_SELECTION');assert.equal(f.state.checkoutSession.status.phase,'IDLE');assert.equal(f.state.checkoutSession.review,undefined);
  await f.send('4');assert.notEqual(f.state.checkoutSession.review.intent.intentId,previous);assert.equal(f.state.paymentMethod,'CREDITO');
});
for(const[name,mutate]of Object.entries({
  cart:s=>s.cart.remove(0),
  address:s=>{s.pickupAddress.street='Outra rua';},
  modality:s=>{s.fulfillmentMode='DELIVERY';},
  payment:s=>{s.paymentMethod='CREDITO';},
  change:s=>{s.changeFor='50.00';},
  customer:s=>{s.customerId=id(9);},
}))test(`mutation of ${name} invalidates prior review and future DTO`,async()=>{
  const f=fixture();await f.send('1');const coordinator=f.state.checkoutSession,prepared=coordinator.review,canonical=prepared.intent.canonicalCheckout;
  mutate(f.state);coordinator.refresh();assert.equal(coordinator.review,undefined);assert.throws(()=>coordinator.createSubmission({}));assert.equal(prepared.intent.canonicalCheckout,canonical);
});
test('identity changes A -> B -> A advance a separate generation and revoke the old getter',async()=>{
  const f=fixture();await f.send('1');const coordinator=f.state.checkoutSession,generation=f.state.identityGeneration??0;
  await f.send('0',{phone:'5511999999999',source:'senderPn'});const second=f.state.identityGeneration;assert.ok(second>generation);assert.throws(coordinator.readCurrentSession);
  await f.send('0',f.live.transportIdentity);assert.ok(f.state.identityGeneration>second);assert.equal(coordinator.review,undefined);
});
test('missing transport phone cannot keep an eligible intent or authorize from cached phone',async()=>{
  const f=fixture();await f.send('1');const coordinator=f.state.checkoutSession;
  await f.menu.handle(f.key,id(1),'9',f.jid,undefined,f.meta);assert.equal(coordinator.review,undefined);assert.throws(coordinator.readCurrentSession);
  // Simulation stays public-compatible, but no eligible checkout is created from missing evidence.
  assert.match(await f.menu.handle(f.key,id(1),'1',f.jid,undefined,f.meta),/Confirmação simulada/);
});
test('context supplied by message text cannot override trusted transport',async()=>{
  const f=fixture();await f.send('1');const original=f.state.checkoutSession.review;
  await f.send(`restaurant_id=${id(9)} customer_id=${id(9)} phone=5511999999999`);assert.equal(f.state.checkoutSession.review,original);
  await assert.rejects(()=>f.send('1',f.live.transportIdentity,{...f.meta,context:{...f.live.context,restaurant_id:id(9)}}));assert.equal(f.state.checkoutSession.review,original);
});
test('replacing the stored conversation revokes the getter of its previous instance',async()=>{
  const f=fixture();await f.send('1');const getter=f.state.checkoutSession.readCurrentSession;
  f.menu.sessions.delete(JSON.stringify([id(1),f.key,f.jid]));assert.throws(getter);
});
function coordinatorFixture(schedule){const live=session();const coordinator=new LiveCheckoutSession(()=>live,schedule);return{live,coordinator};}
test('a recoverable simulation failure retains key and snapshot for retry',async()=>{
  let fail=true,executions=0;const f=coordinatorFixture(async()=>{executions++;if(fail)throw Error('simulation scheduling failure');});
  const prepared=f.coordinator.presentReview();let result=await f.coordinator.beginSimulation().completion;
  assert.equal(result.phase,'SUBMISSION_RECOVERABLE_FAILURE');assert.equal(result.reason,'SIMULATION_FAILED');assert.equal(f.coordinator.review,prepared);
  fail=false;result=await f.coordinator.beginSimulation().completion;assert.equal(result.phase,'SUBMISSION_COMPLETED');assert.equal(result.intentId,prepared.intent.intentId);assert.equal(executions,2);
});
test('pending invalidation cannot mint another key or accept a stale completion',async()=>{
  let resolve,executions=0;const f=coordinatorFixture(()=>{executions++;return new Promise(r=>{resolve=r;});});
  const prepared=f.coordinator.presentReview(),first=f.coordinator.beginSimulation(),second=f.coordinator.beginSimulation();assert.equal(second.started,false);assert.equal(second.completion,first.completion);
  await Promise.resolve();f.live.identityRevision++;f.coordinator.refresh();assert.equal(f.coordinator.status.phase,'SUBMISSION_PENDING');assert.equal(f.coordinator.status.intentId,prepared.intent.intentId);assert.throws(()=>f.coordinator.presentReview());
  resolve();const result=await first.completion;assert.equal(result.phase,'SUBMISSION_RECOVERABLE_FAILURE');assert.equal(result.reason,'STATE_CHANGED');assert.equal(executions,1);
});
test('identity change while the simulated confirmation yields cannot complete the old revision',async()=>{
  const f=fixture();await f.send('1');const original=f.state.checkoutSession;
  const pending=f.send('1');await f.send('0',{phone:'5511999999999',source:'senderPn'});const reply=await pending;
  assert.doesNotMatch(reply,/✅ Confirmação simulada/);assert.notEqual(original.status.phase,'SUBMISSION_COMPLETED');assert.equal(original.review,undefined);
});
test('processor forwards validated context and preserves the same review across repeated messages/reconnection',async()=>{
  const f=fixture(),now=Date.parse('2026-11-15T12:00:00Z');
  const processor=new LocalMessageProcessor(f.live.context,now,10000,f.menu);
  const key=JSON.stringify([id(1),id(2),'account',f.jid]);
  f.menu.sessions.delete(JSON.stringify([id(1),f.key,f.jid]));f.menu.sessions.set(JSON.stringify([id(1),key,f.jid]),f.state);
  const raw=(messageId,text)=>({key:{id:messageId,remoteJid:f.jid,senderPn:'5577999999999@s.whatsapp.net'},messageTimestamp:now/1000,message:{conversation:text}});
  const replies=[],send=async(jid,content)=>{replies.push(content.text);return{key:{id:'sent'}};};
  const batch=message=>({type:'notify',messages:[message]});
  await processor.process(batch(raw('payment','1')),'account',send,now);const prepared=f.state.checkoutSession.review;
  await processor.process(batch(raw('review-again','9')),'account',send,now);assert.equal(f.state.checkoutSession.review,prepared);
  await processor.process(batch(raw('review-again','9')),'account',send,now);assert.equal(replies.length,2);
  // The processor/menu survive socket reconnection; another provider message keeps the same scope/key.
  await processor.process(batch(raw('reconnected','9')),'account',send,now);assert.equal(f.state.checkoutSession.review,prepared);
  await processor.process(batch(raw('other-account','9')),'other-account',send,now);assert.equal(f.state.checkoutSession.review,prepared);
  const otherKey=JSON.stringify([id(1),id(2),'other-account',f.jid]);assert.notEqual(f.menu.sessions.get(JSON.stringify([id(1),otherKey,f.jid])),f.state);
});
test('preparation never loads real submission, order creation, server or HTTP controller',()=>{
  for(const name of ['../src/messaging/checkout/checkoutSubmission','../src/service/order/OrderSalesService','../src/service/order/persistValidatedOrder','../src/server','../src/controller/order/OrderSalesController'])assert.equal(require.cache[require.resolve(name)],undefined);
});
for(const name of ['delivery address','fee'])test(`${name} changes revoke the delivery snapshot`,async()=>{
  const f=fixture(),address={street:'Rua A',number:'10',neighborhood:'Centro',city:'Cidade',complement:null};
  Object.assign(f.state,{fulfillmentMode:'DELIVERY',addressConfirmed:true,addressOriginal:{...address},confirmedAddress:{...address},addressCustomerId:id(4),addressPhone:f.live.transportIdentity.phone,deliveryRegion:{restaurant_id:id(1),customer_id:id(4),bairro_id:id(17),bairro:'Centro',fee:'2.03',fulfillment_mode:'DELIVERY',confirmed:true,address:{...address}}});
  f.state.paymentContext=undefined;
  await f.send('1');assert.ok(f.state.checkoutSession.review);
  if(name==='fee')f.state.deliveryRegion.fee='3.00';else f.state.confirmedAddress.street='Rua Nova';
  assert.equal(f.state.checkoutSession.review,undefined);assert.throws(()=>f.state.checkoutSession.createSubmission({}));
});
test('changing a valid review produces a different key only at another presentation',()=>{
  const f=coordinatorFixture(),before=f.coordinator.presentReview();f.live.checkout.paymentMethod='CREDITO';
  assert.equal(f.coordinator.review,undefined);const after=f.coordinator.presentReview();assert.notEqual(after.intent.intentId,before.intent.intentId);assert.notEqual(after.snapshot,before.snapshot);
});
test('invalid generation cannot mint a prepared intent',()=>{
  const f=coordinatorFixture();f.live.identityRevision=-1;assert.throws(()=>f.coordinator.presentReview());assert.equal(f.coordinator.review,undefined);
});
test('a real phone JID inconsistent with transport identity cannot become eligible',async()=>{
  const f=fixture();f.jid='5511999999999@s.whatsapp.net';f.meta.sender={...f.meta.sender,subject_id:f.jid};
  f.menu.sessions.set(JSON.stringify([id(1),f.key,f.jid]),f.state);
  await f.menu.handle(f.key,id(1),'1',f.jid,f.live.transportIdentity,f.meta);assert.equal(f.state.checkoutSession.review,undefined);
});
