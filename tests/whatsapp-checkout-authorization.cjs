const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { WhatsAppCheckoutAuthorizer, CheckoutAuthorizationError } = require('../src/messaging/checkout/checkoutAuthorization');
const { checkoutPaymentSnapshot } = require('../src/messaging/core/checkoutSnapshot');
const { BotCart } = require('../src/messaging/core/cart');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const cart = new BotCart(); cart.add({ productId: id(3), productName: 'Pizza', quantity: 1, unitPrice: '10.00' });
  const phone = { phone: '5577999999999', source: 'senderPn' };
  const context = { restaurant_id: id(1), session_id: id(2), channel: 'whatsapp' };
  const checkout = { step: 'ORDER_REVIEW', cart, customerId: id(4), whatsappPhone: { ...phone }, fulfillmentMode: 'PICKUP',
    pickupConfirmed: true, pickupAddress: { restaurantId: id(1), name: 'Loja', street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'Cidade' }, paymentMethod: 'PIX' };
  checkout.paymentContext = checkoutPaymentSnapshot(checkout, context.restaurant_id);
  const session = { context, sender: { channel: 'whatsapp', account_id: 'account', subject_id: 'opaque@lid' }, transportIdentity: { ...phone }, identityRevision: 0, checkout };
  const row = { id: id(4), restaurant_id: id(1), international_format: true, national_format: false };
  let initialRows = [row], transactionRows = [row], initialError = false, failQuery, failConnect = false;
  const calls = [], trace = [];
  let lookup = async () => initialRows;
  const reader = { findByWhatsAppPhone: async args => { calls.push(args); if (initialError) throw Error('secret DB URL'); return lookup(args); } };
  const client = { query: async (sql, params) => {
    trace.push({ sql, params });
    if (failQuery && sql.includes(failQuery)) throw Error('database failure');
    if (sql.startsWith('SELECT id, restaurant_id,')) return { rows: transactionRows };
    return { rows: [] };
  }, release: () => trace.push({ sql: 'RELEASE' }) };
  const database = { connect: async () => { trace.push({ sql: 'CONNECT' }); if (failConnect) throw Error('connect failure'); return client; } };
  const authorizer = new WhatsAppCheckoutAuthorizer(reader, database);
  const current = () => session;
  return { session, checkout, row, calls, trace, client, authorizer, current,
    authorize: () => authorizer.authorize(current),
    setInitial: rows => { initialRows = rows; }, setTransaction: rows => { transactionRows = rows; },
    lookup: fn => { lookup = fn; }, initialError: () => { initialError = true; },
    fail: sql => { failQuery = sql; }, failConnect: () => { failConnect = true; },
  };
}
const denied = action => assert.rejects(action, CheckoutAuthorizationError);
test('authorization uses only trusted context/transport and transaction revalidates on the same locked client', async () => {
  const f = fixture(); f.session.text = `restaurant_id=${id(9)} phone=5511999999999`;
  const token = await f.authorize(); assert.deepEqual(f.calls, [{ restaurant_id: id(1), phone: '5577999999999' }]);
  assert.equal(Object.isFrozen(token), true); assert.equal(JSON.stringify(token), '{}');
  const result = await f.authorizer.withAuthorizedTransaction(token, async (client, checkout) => {
    assert.equal(client, f.client); assert.equal(checkout.restaurant_id, id(1)); assert.equal(checkout.customer_id, id(4));
    assert.equal(checkout.input.fulfillment_type, 'PICKUP'); f.trace.push({ sql: 'ACTION' }); return 'authorized';
  });
  assert.equal(result, 'authorized');
  assert.deepEqual(f.trace.map(x => x.sql).filter(x => !x.startsWith('SELECT')), ['CONNECT', 'BEGIN ISOLATION LEVEL SERIALIZABLE', 'ACTION', 'COMMIT', 'RELEASE']);
  const query = f.trace.find(x => x.sql.startsWith('SELECT'));
  assert.match(query.sql, /FROM customers WHERE restaurant_id = \$1/);
  assert.match(query.sql, /LIMIT 2 FOR SHARE$/); assert.deepEqual(query.params, [id(1), '5577999999999', '77999999999']);
  await denied(() => f.authorizer.withAuthorizedTransaction(token, async () => assert.fail('reused')));
});
for (const [name, rows] of [
  ['missing customer', []], ['another restaurant', [{ id: id(4), restaurant_id: id(9), international_format: true }]],
  ['different customer', [{ id: id(9), restaurant_id: id(1), international_format: true }]],
  ['ambiguous phone', [{ id: id(4), restaurant_id: id(1), international_format: true }, { id: id(5), restaurant_id: id(1), international_format: true }]],
  ['incompatible phone format', [{ id: id(4), restaurant_id: id(1), international_format: false, national_format: false }]],
]) {
  test(`initial authorization rejects ${name}`, async () => { const f = fixture(); f.setInitial(rows); await denied(f.authorize); assert.deepEqual(f.trace, []); });
  test(`transaction revalidation rejects ${name} and rolls back before action`, async () => {
    const f = fixture(), token = await f.authorize(); f.setTransaction(rows);
    await denied(() => f.authorizer.withAuthorizedTransaction(token, async () => assert.fail('unauthorized action')));
    assert.deepEqual(f.trace.slice(-2).map(x => x.sql), ['ROLLBACK', 'RELEASE']); assert.equal(f.trace.some(x => x.sql === 'COMMIT'), false);
  });
}
test('Brazilian national exception is reused; non-Brazilian national match is refused', async () => {
  const f = fixture(); f.setInitial([{ ...f.row, international_format: false, national_format: true }]); await f.authorize();
  const g = fixture(); g.session.transportIdentity.phone = g.checkout.whatsappPhone.phone = '442079460958';
  g.checkout.paymentContext = checkoutPaymentSnapshot(g.checkout, id(1));
  g.setInitial([{ ...g.row, international_format: false, national_format: true }]); await denied(g.authorize);
});
const mutations = {
  'missing transport': f => { f.session.transportIdentity = undefined; },
  'manual identity': f => { f.session.transportIdentity.source = 'text'; },
  'missing checkout identity': f => { f.checkout.whatsappPhone = undefined; },
  'changed transport phone': f => { f.session.transportIdentity.phone = '5511999999999'; },
  'changed checkout phone': f => { f.checkout.whatsappPhone.phone = '5511999999999'; },
  'changed session': f => { f.session.context.session_id = id(9); },
  'changed account': f => { f.session.sender.account_id = 'other'; },
  'changed sender': f => { f.session.sender.subject_id = 'other@lid'; },
  'changed revision': f => { f.session.identityRevision++; },
  'changed customer': f => { f.checkout.customerId = id(9); },
  'changed restaurant': f => { f.session.context.restaurant_id = id(9); },
  'changed cart': f => { f.checkout.cart.remove(0); },
  'cleared payment snapshot': f => { f.checkout.paymentContext = undefined; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`old grant rejects ${name} and is permanently invalidated`, async () => {
  const f = fixture(), token = await f.authorize(); mutate(f);
  await denied(() => f.authorizer.withAuthorizedTransaction(token, async () => assert.fail('stale')));
  assert.deepEqual(f.trace, []);
});
for (const [name, mutate] of Object.entries({
  'absent identity': f => { f.session.transportIdentity = undefined; },
  'manual phone': f => { f.session.transportIdentity.source = 'manual'; },
  'wrong phone JID': f => { f.session.sender.subject_id = '5511999999999@s.whatsapp.net'; },
  'group sender': f => { f.session.sender.subject_id = 'group@g.us'; },
  'wrong channel': f => { f.session.sender.channel = 'telegram'; },
  'invalid revision': f => { f.session.identityRevision = -1; },
})) test(`invalid ${name} does not query customers`, async () => {
  const f = fixture(); mutate(f); await denied(f.authorize); assert.deepEqual(f.calls, []);
});
test('valid phone JID must match transport phone', async () => {
  const f = fixture(); f.session.sender.subject_id = '5577999999999@s.whatsapp.net'; await f.authorize();
});
test('database identification errors are denied without disclosing internals', async () => {
  const f = fixture(); f.initialError(); await assert.rejects(f.authorize, error => error instanceof CheckoutAuthorizationError && !error.message.includes('secret'));
});
test('late authorization cannot accept concurrent identity change, including A -> B -> A', async () => {
  const f = fixture(); let resolve; f.lookup(() => new Promise(r => { resolve = r; }));
  const pending = f.authorize(); f.session.identityRevision += 2; resolve([f.row]); await denied(() => pending);
});
test('two simultaneous uses of one grant allow only one transaction', async () => {
  const f = fixture(), token = await f.authorize(); let resolve;
  const first = f.authorizer.withAuthorizedTransaction(token, () => new Promise(r => { resolve = r; }));
  await denied(() => f.authorizer.withAuthorizedTransaction(token, async () => assert.fail('duplicate')));
  while (!resolve) await new Promise(r => setImmediate(r));
  resolve('ok'); assert.equal(await first, 'ok'); assert.equal(f.trace.filter(x => x.sql === 'CONNECT').length, 1);
});
test('separate sessions and authorizer instances cannot exchange grants', async () => {
  const f = fixture(), g = fixture(); g.session.context.session_id = id(9);
  const [a,b] = await Promise.all([f.authorize(), g.authorize()]);
  await denied(() => g.authorizer.withAuthorizedTransaction(a, async () => assert.fail('foreign grant')));
  await Promise.all([f.authorizer.withAuthorizedTransaction(a, async () => 'A'), g.authorizer.withAuthorizedTransaction(b, async () => 'B')]);
});
test('identity change while transactional lookup waits prevents action and rolls back', async () => {
  const f = fixture(), token = await f.authorize(); let resolve;
  const original = f.client.query; f.client.query = async (...args) => {
    if (args[0].startsWith('SELECT')) return new Promise(r => { resolve = r; });
    return original(...args);
  };
  const pending = f.authorizer.withAuthorizedTransaction(token, async () => assert.fail('stale action'));
  while (!resolve) await new Promise(r => setImmediate(r));
  f.session.identityRevision++; resolve({ rows: [f.row] }); await denied(() => pending);
  assert.deepEqual(f.trace.slice(-2).map(x => x.sql), ['ROLLBACK', 'RELEASE']);
});
test('identity change during action prevents commit; changes cannot be hidden by restoring phone', async () => {
  const f = fixture(), token = await f.authorize();
  await denied(() => f.authorizer.withAuthorizedTransaction(token, async () => { f.session.identityRevision += 2; }));
  assert.equal(f.trace.some(x => x.sql === 'COMMIT'), false);
});
for (const phase of ['BEGIN', 'SELECT', 'COMMIT', 'action', 'connect']) test(`${phase} failure releases connection and consumes grant`, async () => {
  const f = fixture(), token = await f.authorize();
  if (phase === 'connect') f.failConnect(); else if (phase !== 'action') f.fail(phase);
  await assert.rejects(() => f.authorizer.withAuthorizedTransaction(token, async () => { if (phase === 'action') throw Error('action failure'); }));
  if (phase !== 'connect') assert.equal(f.trace.at(-1).sql, 'RELEASE');
  await denied(() => f.authorizer.withAuthorizedTransaction(token, async () => assert.fail('reused')));
});
test('explicit invalidation and forged tokens cannot authorize a transaction', async () => {
  const f = fixture(), token = await f.authorize(); f.authorizer.invalidate(token);
  for (const invalid of [token, {}, JSON.parse(JSON.stringify(token))]) await denied(() => f.authorizer.withAuthorizedTransaction(invalid, async () => assert.fail('invalid token')));
  assert.deepEqual(f.trace, []);
});
test('revoked grant stays invalid after session identity is restored', async () => {
  const f = fixture(), token = await f.authorize();
  const original = f.session.sender.subject_id; f.session.sender.subject_id = 'other@lid';
  await denied(() => f.authorizer.withAuthorizedTransaction(token, async () => assert.fail('stale')));
  f.session.sender.subject_id = original;
  await denied(() => f.authorizer.withAuthorizedTransaction(token, async () => assert.fail('revoked')));
});
test('rollback failure discards client without replacing the original action error', async () => {
  const f = fixture(), token = await f.authorize(); f.fail('ROLLBACK');
  let discarded; f.client.release = value => { discarded = value; };
  await assert.rejects(() => f.authorizer.withAuthorizedTransaction(token, async () => { throw Error('original action error'); }), /original action error/);
  assert.equal(discarded, true);
});
