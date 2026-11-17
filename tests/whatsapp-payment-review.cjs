const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { BotCart } = require('../src/messaging/core/cart');
const { parseCashAmount } = require('../src/messaging/core/payment');
function fixture(mode = 'PICKUP') {
  const forbidden = [];
  const deny = new Proxy({}, { get: (_, name) => async () => { forbidden.push(name); throw Error('unexpected IO'); } });
  const menu = new ConversationMenu(deny, deny, deny, deny, deny);
  const cart = new BotCart(); cart.add({ productId: 'p', productName: 'Pizza', quantity: 3, unitPrice: '10.01' });
  const address = { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Cidade', complement: null };
  const state = { step: 'PAYMENT_SELECTION', categories: [], cart, customerId: 'c', whatsappPhone: { phone: '5577999999999', source: 'senderPn' }, fulfillmentMode: mode,
    pickupConfirmed: true, pickupAddress: { ...address, name: 'Loja', restaurantId: 'r' },
    addressCustomerId: 'c', addressPhone: '5577999999999', addressConfirmed: true, confirmedAddress: address, addressOriginal: address,
    deliveryRegion: { restaurant_id: 'r', customer_id: 'c', bairro_id: 'b', bairro: 'Centro', fee: '2.02', fulfillment_mode: 'DELIVERY', confirmed: true, address } };
  menu.sessions.set(JSON.stringify(['r', 's', 'j@lid']), state);
  return { menu, state, forbidden, send: text => menu.handle('s', 'r', text, 'j@lid') };
}
for (const mode of ['PICKUP', 'DELIVERY']) for (const [input, label] of [['1','PIX'], ['3','débito'], ['4','crédito']]) {
  test(`${mode} ${label}: review and simulation without IO`, async () => {
    const f = fixture(mode); const reply = await f.send(input);
    assert.equal(f.state.step, 'ORDER_REVIEW'); assert.match(reply, new RegExp(label));
    assert.match(reply, /3 x Pizza — R\$ 30,03/); assert.match(reply, mode === 'DELIVERY' ? /Total provisório: R\$ 32,05/ : /Total provisório: R\$ 30,03/);
    assert.match(reply, /Rua A, 10/); assert.match(await f.send('1'), /Confirmação simulada/);
    assert.match(await f.send('1'), /já simulada/); assert.deepEqual(f.forbidden, []);
  });
}
test('cash without change and navigation clear payment', async () => {
  const f = fixture(); await f.send('2'); assert.equal(f.state.step, 'PAYMENT_CHANGE');
  assert.match(await f.send('x'), /inválida/); assert.match(await f.send('2'), /Não precisa de troco/);
  await f.send('0'); assert.equal(f.state.step, 'PAYMENT_SELECTION'); assert.equal(f.state.paymentMethod, undefined);
  await f.send('0'); assert.equal(f.state.step, 'CART');
});
test('cash amount validates exact cents including total with fee', async () => {
  const f = fixture('DELIVERY'); await f.send('2'); await f.send('1');
  for (const value of ['32,04', '-50', '1e3', '50,001', 'R$ 50', '1.000,00', 'NaN', '']) {
    assert.match(await f.send(value), /valor válido/); assert.equal(f.state.step, 'PAYMENT_CHANGE_AMOUNT');
  }
  assert.match(await f.send('50,10'), /troco: R\$ 18,05/); assert.equal(f.state.changeFor, '50.10');
  await f.send('0'); await f.send('2'); await f.send('1'); assert.match(await f.send('32.05'), /troco: R\$ 0,00/);
});
for (const mutate of [s => s.cart.add({ productId: 'p2', productName: 'Outro', quantity: 1, unitPrice: '1.00' }), s => { s.confirmedAddress = { ...s.confirmedAddress, street: 'Outra' }; }, s => { s.fulfillmentMode = 'PICKUP'; }, s => { s.deliveryRegion.fee = '3.00'; }, s => { s.customerId = 'other'; }]) {
  test('changed checkout invalidates previous payment before confirmation', async () => {
    const f = fixture('DELIVERY'); await f.send('1'); mutate(f.state); const reply = await f.send('1');
    assert.equal(f.state.paymentMethod, undefined); assert.notEqual(f.state.step, 'ORDER_SIMULATED'); assert.doesNotMatch(reply, /Confirmação simulada/);
  });
}
test('invalid payment and restaurant context, session isolation and identity change', async () => {
  const f = fixture(); assert.match(await f.send('9'), /inválida/); await f.send('1');
  await f.menu.handle('other', 'r', '1', 'j@lid'); assert.equal(f.state.step, 'ORDER_REVIEW');
  await f.menu.handle('s', 'r', '1', 'j@lid', { phone: '5511999999999', source: 'senderPn' });
  assert.equal(f.state.paymentMethod, undefined); assert.notEqual(f.state.step, 'ORDER_SIMULATED');
  const g = fixture(); g.state.pickupAddress.restaurantId = 'other'; await g.send('1'); assert.equal(g.state.paymentMethod, undefined);
});
test('cash parser does not round or accept ambiguous formats', () => {
  assert.equal(parseCashAmount('0,29'), 29n); assert.equal(parseCashAmount('100.1'), 10010n);
  for (const input of ['0', '0.00', '0.001', 'Infinity', '999999999', '+10', '1,234.56']) assert.equal(parseCashAmount(input), undefined);
});
test('cash amount back clears amount and allows another payment', async () => {
  const f = fixture(); await f.send('2'); await f.send('1'); await f.send('0');
  assert.equal(f.state.step, 'PAYMENT_SELECTION'); assert.equal(f.state.changeFor, undefined);
  assert.match(await f.send('4'), /Cartão de crédito/); assert.equal(f.state.step, 'ORDER_REVIEW');
});
test('pickup confirmation opens actual payment selection', async () => {
  const f = fixture(); f.state.step = 'PICKUP_REVIEW'; f.state.pickupConfirmed = false;
  f.menu.pickupStoreReader = { execute: async id => ({ id, status: true, name: 'Loja', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Cidade' }) };
  // The preview has exactly the validated store fields.
  f.state.pickupAddress = { restaurantId: 'r', name: 'Loja', street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Cidade' };
  await f.send('1'); assert.equal(f.state.step, 'PAYMENT_SELECTION');
  assert.match(await f.send('1'), /REVISÃO DO PEDIDO/);
});
