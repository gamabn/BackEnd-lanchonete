const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { BotCart } = require('../src/messaging/core/cart');
const { GetIdStoreService } = require('../src/service/user/GetIdStoreService');
const { pool } = require('../src/database');
const identity = { phone: '5577999999999', source: 'senderPn' };
const store = id => ({ id, name: `Restaurante ${id}`, street: 'Rua Real', number: '42', neighborhood: 'Centro', city: 'Cidade Real', status: true });
function fixture() {
  const calls = [], forbidden = [];
  let row = store('A'), error = false;
  const deny = new Proxy({}, { get: (_, method) => async () => { forbidden.push(method); throw Error('forbidden'); } });
  const menu = new ConversationMenu(deny, deny, deny, deny, { execute: async id => { calls.push(id); if (error) throw Error('secret database error'); return row; } });
  function seed(id = 'A', key = 'session', jid = 'sender@lid') {
    const cart = new BotCart();
    cart.add({ productId: 'p', productName: 'Pizza', quantity: 2, unitPrice: '25.00', variantId: 'v', variantName: 'Grande', optionIds: ['a', 'b'] });
    const state = { step: 'FULFILLMENT_CHOICE', categories: [], cart, customerId: `customer-${id}`, whatsappPhone: identity };
    menu.sessions.set(JSON.stringify([id, key, jid]), state);
    return state;
  }
  const state = seed();
  return { menu, state, seed, calls, forbidden, set: value => { row = value; }, error: value => { error = value; }, send: text => menu.handle('session', 'A', text, 'sender@lid') };
}
test('PICKUP reads scoped real restaurant, confirms with fresh read and preserves full cart and identity without delivery or writes', async () => {
  const f = fixture(), before = f.state.cart.list();
  const preview = await f.send('2');
  for (const value of ['Restaurante A', 'Rua: Rua Real', 'Número: 42', 'Bairro: Centro', 'Cidade: Cidade Real']) assert.ok(preview.includes(value));
  assert.equal(f.state.pickupConfirmed, false);
  assert.match(await f.send('1'), /RETIRADA CONFIRMADA/);
  assert.deepEqual(f.calls, ['A', 'A']);
  assert.equal(f.state.fulfillmentMode, 'PICKUP'); assert.equal(f.state.pickupConfirmed, true);
  assert.equal(f.state.customerId, 'customer-A'); assert.deepEqual(f.state.cart.list(), before);
  assert.equal(f.state.addressDraft, undefined); assert.equal(f.state.deliveryRegion, undefined);
  await f.send('0'); assert.equal(f.state.step, 'CART'); assert.equal(f.state.pickupConfirmed, true);
  assert.deepEqual(f.state.cart.list(), before); assert.deepEqual(f.forbidden, []);
});
for (const phase of ['selection', 'confirmation']) {
  for (const [label, row] of [['missing', undefined], ['unavailable', { ...store('A'), status: false }], ['unknown status', { ...store('A'), status: 'true' }], ['wrong restaurant', store('B')], ...['name','street','number','neighborhood','city'].flatMap(field => [null, undefined, {}, ''].map(value => [`invalid ${field} ${String(value)}`, { ...store('A'), [field]: value }]))]) {
    test(`${phase} blocks ${label}`, async () => {
      const f = fixture();
      if (phase === 'confirmation') await f.send('2');
      f.set(row); const reply = await f.send(phase === 'selection' ? '2' : '1');
      assert.equal(f.state.step, 'PICKUP_ERROR'); assert.equal(f.state.pickupConfirmed, false);
      assert.doesNotMatch(reply, /RETIRADA CONFIRMADA|undefined|null|\[object Object\]/);
      assert.deepEqual(f.forbidden, []);
    });
  }
}
test('address change requires another confirmation', async () => {
  const f = fixture(); await f.send('2'); f.set({ ...store('A'), street: 'Rua Nova' });
  assert.match(await f.send('1'), /atualizados[\s\S]*Rua Nova/);
  assert.equal(f.state.pickupConfirmed, false); assert.equal(f.state.step, 'PICKUP_REVIEW');
  assert.match(await f.send('1'), /RETIRADA CONFIRMADA/);
});
test('availability loss blocks; reopening requires review before confirmation', async () => {
  const f = fixture(); await f.send('2'); f.set({ ...store('A'), status: false });
  await f.send('1'); assert.equal(f.state.pickupConfirmed, false);
  f.set(store('A')); assert.match(await f.send('1'), /Confirmar retirada/);
  assert.equal(f.state.pickupConfirmed, false); await f.send('1'); assert.equal(f.state.pickupConfirmed, true);
});
test('database errors keep session recoverable and hide internals', async () => {
  const f = fixture(); f.error(true); assert.doesNotMatch(await f.send('2'), /secret/);
  assert.equal(f.state.step, 'PICKUP_ERROR'); f.error(false);
  await f.send('1'); await f.send('1'); assert.equal(f.state.pickupConfirmed, true);
});
test('restaurant, account/session and sender remain isolated; input cannot choose restaurant ID', async () => {
  const f = fixture(); await f.send('2');
  for (const [id,key,jid] of [['B','session','sender@lid'],['A','other','sender@lid'],['A','session','other@lid']]) {
    const state = f.seed(id,key,jid); f.set(store(id));
    await f.menu.handle(key,id,'2',jid); await f.menu.handle(key,id,'1',jid);
    assert.equal(state.pickupAddress.restaurantId,id); assert.equal(state.pickupConfirmed,true);
    assert.equal(f.state.pickupConfirmed,false);
  }
  const count = f.calls.length; await f.send('B'); assert.equal(f.calls.length,count);
});
test('late database reply after 0 cannot confirm or leave cart', async () => {
  const f = fixture(); await f.send('2'); let resolve;
  f.menu.pickupStoreReader = { execute: () => new Promise(r => { resolve = r; }) };
  const pending = f.send('1'); await f.send('0'); resolve(store('A')); await pending;
  assert.equal(f.state.step,'CART'); assert.equal(f.state.pickupConfirmed,false);
});
test('identity change clears pickup confirmation', async () => {
  const f = fixture(); await f.send('2'); await f.send('1');
  await f.menu.handle('session','A','0','sender@lid',{ phone: '5511999999999', source: 'senderPn' });
  assert.equal(f.state.pickupConfirmed,false); assert.equal(f.state.pickupAddress,undefined);
});
test('existing service uses parameterized restaurant-only SELECT without writes', async () => {
  const original = pool.query, calls = [];
  pool.query = async (...args) => { calls.push(args); return { rows: [store('A')] }; };
  try {
    assert.equal((await new GetIdStoreService().execute('A')).id,'A');
    assert.match(calls[0][0], /FROM restaurants WHERE id = \$1/);
    assert.deepEqual(calls[0][1],['A']); assert.match(calls[0][0], /^SELECT /);
  } finally { pool.query = original; }
});
test('switching PICKUP to DELIVERY clears pickup confirmation and invokes only existing delivery path', async () => {
  const f = fixture(); await f.send('2'); await f.send('1'); await f.send('0');
  const { stubGateway, stubRegionCatalog } = require('./fixtures/whatsapp-address-harness.cjs');
  f.menu.addressGateway = stubGateway(); f.menu.regionCatalog = stubRegionCatalog();
  f.state.step = 'FULFILLMENT_CHOICE';
  await f.send('1');
  assert.equal(f.state.fulfillmentMode, 'DELIVERY'); assert.equal(f.state.pickupConfirmed, false);
  assert.equal(f.state.pickupAddress, undefined); assert.equal(f.state.step, 'ADDRESS_EXISTING');
  await f.send('0'); f.state.step = 'FULFILLMENT_CHOICE'; await f.send('2');
  assert.equal(f.state.fulfillmentMode, 'PICKUP'); assert.equal(f.state.deliveryRegion, undefined);
  assert.equal(f.state.addressConfirmed, false);
});
