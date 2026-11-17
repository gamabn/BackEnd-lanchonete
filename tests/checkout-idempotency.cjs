const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { id, session, request } = require('./fixtures/whatsapp-idempotency.cjs');
const { createCheckoutIntentRequest, prepareCheckoutIntent, lookupCheckoutIntent, listCheckoutIntents, lockCheckoutIntent, completeCheckoutIntent, markCheckoutIntentRecoverable, CheckoutIntentConflict } = require('../src/messaging/checkout/checkoutIdempotency');
test('key is stable when supplied again and canonical hash normalizes options and decimal money', () => {
  const a = request(id(20)), s = session(); const item = s.checkout.cart.list()[0];
  s.checkout.cart.clear(); s.checkout.cart.add({ ...item, optionIds: [...item.optionIds].reverse(), unitPrice: '10.01' });
  const { checkoutPaymentSnapshot } = require('../src/messaging/core/checkoutSnapshot');
  s.checkout.paymentContext = checkoutPaymentSnapshot(s.checkout, id(1));
  const b = createCheckoutIntentRequest(s, id(20));
  assert.deepEqual(a, b); assert.equal(a.checkoutHash, createHash('sha256').update(a.canonicalCheckout).digest('hex'));
  assert.notEqual(request().intentId, request().intentId);
});
for (const field of ['PIX', 'DINHEIRO', 'DEBITO', 'CREDITO']) test(`payment ${field} participates in the hash`, () => {
  const s = session(); s.checkout.paymentMethod = field;
  const r = createCheckoutIntentRequest(s, id(20)); assert.equal(JSON.parse(r.canonicalCheckout).paymentMethod, field);
});
test('credit and debit remain distinct despite the legacy Cartao mapping', () => {
  const a = session(), b = session(); a.checkout.paymentMethod = 'DEBITO'; b.checkout.paymentMethod = 'CREDITO';
  assert.notEqual(createCheckoutIntentRequest(a,id(20)).checkoutHash, createCheckoutIntentRequest(b,id(20)).checkoutHash);
});
test('missing, manual and mismatching transport identities cannot produce a request', () => {
  for (const identity of [undefined, { phone: '5577999999999', source: 'text' }, { phone: '5511999999999', source: 'senderPn' }]) {
    const s = session(); s.transportIdentity = identity; assert.throws(() => createCheckoutIntentRequest(s,id(20)));
  }
});
function harness(row) {
  const calls = [];
  const client = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: sql.startsWith('INSERT') ? [] : row ? [row] : [] }; } };
  return { calls, client };
}
function stored(r, state = 'PENDING') { return { intent_id: r.intentId, checkout_hash: r.checkoutHash, canonical_checkout: r.canonicalCheckout, state, order_id: state === 'COMPLETED' ? id(900) : null, failure_code: null }; }
test('registration uses parameterized INSERT ON CONFLICT followed by scoped comparison', async () => {
  const r = request(), h = harness(stored(r)); assert.equal((await prepareCheckoutIntent(h.client,r)).state, 'PENDING');
  assert.match(h.calls[0].sql, /ON CONFLICT \(intent_id\) DO NOTHING/); assert.match(h.calls[1].sql, /restaurant_id = \$2 AND customer_id = \$3 AND session_id = \$4/);
  assert.deepEqual(h.calls[1].args, [r.intentId,id(1),id(4),id(2),'account','opaque@lid','5577999999999']);
});
test('same key with different canonical body conflicts', async () => {
  const r = request(), h = harness({ ...stored(r), checkout_hash: '0'.repeat(64) });
  await assert.rejects(() => prepareCheckoutIntent(h.client,r), CheckoutIntentConflict);
});
test('hash/body and scope tampering fail before SQL', async () => {
  const r = request(), h = harness();
  await assert.rejects(() => prepareCheckoutIntent(h.client,{ ...r, checkoutHash: '0'.repeat(64) }), CheckoutIntentConflict);
  await assert.rejects(() => prepareCheckoutIntent(h.client,{ ...r, scope: { ...r.scope, customerId: id(9) } }), CheckoutIntentConflict);
  assert.equal(h.calls.length,0);
});
test('locking uses FOR UPDATE and repeated completion returns the original order without updating', async () => {
  const r = request(), h = harness(stored(r,'COMPLETED'));
  const result = await completeCheckoutIntent(h.client,r,id(900)); assert.equal(result.order_id,id(900)); assert.equal(h.calls.length,1); assert.match(h.calls[0].sql,/FOR UPDATE$/);
  await assert.rejects(() => completeCheckoutIntent(h.client,r,id(901)), CheckoutIntentConflict);
});
test('recovery can read and list durable keys without generating a new intent', async () => {
  const r = request(), h = harness(stored(r,'COMPLETED'));
  assert.equal((await lookupCheckoutIntent(h.client,r.scope,r.intentId)).order_id,id(900));
  assert.equal((await listCheckoutIntents(h.client,r.scope))[0].intent_id,r.intentId);
  assert.match(h.calls[1].sql,/restaurant_id = \$1 AND customer_id = \$2 AND session_id = \$3/);
});
test('failure marking never downgrades a completed order', async () => {
  const r = request(), h = harness(stored(r,'COMPLETED'));
  assert.equal((await markCheckoutIntentRecoverable(h.client,r,'TRANSACTION_ABORTED')).state,'COMPLETED'); assert.equal(h.calls.length,1);
});
test('service does not import pool, server or order creation', () => {
  for (const p of ['../src/database','../src/server','../src/service/order/OrderSalesService']) assert.equal(require.cache[require.resolve(p)],undefined);
});
