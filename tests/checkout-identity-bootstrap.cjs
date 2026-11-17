const {test}=require('node:test');const assert=require('node:assert/strict');
require('ts-node/register');
const {CheckoutIdentityBootstrap}=require('../src/messaging/checkout/checkoutIdentityBootstrap');
const frame=()=>({context:{restaurant_id:'restaurant'},sender:{subject_id:'sender'},transportIdentity:{phone:'5577999999999'}});
test('bootstrap gate cannot rebase after a message arrives during DB reconciliation',async()=>{
  const gate=new CheckoutIdentityBootstrap(frame);let release;
  const waiting=new Promise(r=>{release=r;});
  const service={inspectBootstrap:async()=>({kind:'reconciliation_required',challenge:{}}),reconcileBootstrap:async()=>{await waiting;return{kind:'generation_reconciled',identityRevision:8};}};
  const pending=gate.reconcile(service);await Promise.resolve();gate.markMessageObserved();release();
  assert.equal(await pending,false);assert.equal(gate.identityRevision,null);
});
test('bootstrap gate rejects transport changes, missing generation and parallel initialization',async()=>{
  let live=frame();const gate=new CheckoutIdentityBootstrap(()=>live);let release;
  const service={inspectBootstrap:()=>new Promise(r=>{release=r;}),reconcileBootstrap:async()=>({kind:'generation_reconciled',identityRevision:9})};
  const pending=gate.reconcile(service);assert.equal(await gate.reconcile(service),false);
  live={...live,sender:{subject_id:'other'}};release({kind:'reconciliation_required',challenge:{}});
  assert.equal(await pending,false);assert.equal(gate.identityRevision,null);
  const empty=new CheckoutIdentityBootstrap(frame);assert.equal(await empty.reconcile({inspectBootstrap:async()=>({kind:'no_durable_generation'})}),false);
});
test('bootstrap module imports no database, worker or order service',()=>{
  for(const p of ['../src/database','../src/messaging/worker/connection','../src/messaging/checkout/checkoutSubmission'])assert.equal(require.cache[require.resolve(p)],undefined);
});
