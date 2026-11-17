const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const databasePath=require.resolve('../src/database');
require.cache[databasePath]={id:databasePath,filename:databasePath,loaded:true,exports:{pool:new Proxy({}, {get:()=>()=>{throw Error('Production pool forbidden');}})}};
const { session, id }=require('./fixtures/whatsapp-idempotency.cjs');
const { createCheckoutIntentRequest }=require('../src/messaging/checkout/checkoutIdempotency');
const { adaptWhatsAppCheckout }=require('../src/messaging/checkout/checkoutAdapter');
const { CheckoutAuthorizationError, CheckoutCommitUncertainError }=require('../src/messaging/checkout/checkoutAuthorization');
const { WhatsAppCheckoutSubmission }=require('../src/messaging/checkout/checkoutSubmission');
function fixture() {
  const live=session(), intent=createCheckoutIntentRequest(live,id(30));
  const fullOrder={order_id:id(900),restaurant_id:id(1),customer:{id:id(4)},items:[]};
  const row={intent_id:intent.intentId,checkout_hash:intent.checkoutHash,canonical_checkout:intent.canonicalCheckout,state:'COMPLETED',order_id:id(900),failure_code:null};
  const calls=[];
  const client={query:async(sql,args)=>{calls.push({sql,args}); if(sql.includes('whatsapp_checkout_intents')) return {rows:[row]}; if(sql.includes('FROM public.orders o')) return {rows:[fullOrder]}; assert.fail(sql);}};
  const authorizer={withAuthorizedTransaction:async(token,action)=>action(client,adaptWhatsAppCheckout(live.context,live.checkout),live)};
  const service=new WhatsAppCheckoutSubmission(authorizer);
  const args={context:live.context,authorization:{},snapshot:null,intent};
  return {live,intent,row,fullOrder,calls,client,authorizer,service,args};
}
test('completed intent returns the existing full order without catalog or persistence',async()=>{
  const f=fixture(), result=await f.service.submit(f.args);
  assert.equal(result.kind,'success');assert.equal(result.replayed,true);assert.equal(result.fullOrder.order_id,id(900));
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(x=>x.sql.trim().startsWith('SELECT')));
});
test('pending intent without retained snapshot requires review and creates nothing',async()=>{
  const f=fixture(); f.row.state='PENDING';f.row.order_id=null;
  const result=await f.service.submit(f.args);assert.equal(result.kind,'review_required');assert.deepEqual(result.changes,['CHECKOUT']);
  assert.ok(f.calls.every(x=>!x.sql.includes('INSERT INTO orders')));
});
for(const [name,mutate] of [
  ['context',f=>{f.args.context={...f.live.context,restaurant_id:id(9)};}],
  ['hash',f=>{f.args.intent={...f.intent,checkoutHash:'0'.repeat(64)};}],
  ['body',f=>{f.args.intent={...f.intent,canonicalCheckout:'{}'};}],
  ['intent scope',f=>{f.args.intent={...f.intent,scope:{...f.intent.scope,customerId:id(9)}};}],
  ['stored owner',f=>{f.fullOrder.restaurant_id=id(9);} ],
  ['stored customer',f=>{f.fullOrder.customer.id=id(9);} ],
])test(`rejects divergent ${name}`,async()=>{const f=fixture();mutate(f);assert.equal((await f.service.submit(f.args)).kind,'rejected');});
for(const [error,reason] of [
  [Object.assign(Error('retry'),{code:'40001'}),'SERIALIZATION_CONFLICT'],
  [Object.assign(Error('deadlock'),{code:'40P01'}),'SERIALIZATION_CONFLICT'],
  [new CheckoutCommitUncertainError(Error('lost reply')),'COMMIT_UNKNOWN'],
  [Error('failure before commit'),'TRANSACTION_ABORTED'],
])test(`recoverable ${reason} preserves original key and exposes no raw errors`,async()=>{
  const f=fixture();f.authorizer.withAuthorizedTransaction=async()=>{throw error;};const result=await f.service.submit(f.args);
  assert.deepEqual(result,{kind:'recoverable_failure',intentId:f.intent.intentId,reason,reuseSameKey:true});
});
for(const [error,reason] of [[new CheckoutAuthorizationError(),'UNAUTHORIZED'],[Object.assign(Error('missing table'),{code:'42P01'}),'NOT_CONFIGURED'],[Object.assign(Error('foreign key'),{code:'23503'}),'PERSISTENCE_REJECTED']])test(`definitive ${reason}`,async()=>{
  const f=fixture();f.authorizer.withAuthorizedTransaction=async()=>{throw error;};assert.equal((await f.service.submit(f.args)).reason,reason);
});
test('worker, simulation and HTTP server are not loaded by the internal service',()=>{
  for(const p of ['../src/server','../src/messaging/worker/local','../src/controller/order/OrderSalesController'])assert.equal(require.cache[require.resolve(p)],undefined);
});
