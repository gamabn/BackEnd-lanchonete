const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { BotCart } = require('../src/messaging/core/cart');
const { checkoutPaymentSnapshot } = require('../src/messaging/core/checkoutSnapshot');
const { adaptWhatsAppCheckout } = require('../src/messaging/checkout/checkoutAdapter');
const { parseOrder } = require('../src/service/order/orderValidation');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(mode = 'DELIVERY', method = 'PIX', changeFor) {
  const context = { restaurant_id: id(1), session_id: id(2), channel: 'whatsapp' };
  const cart = new BotCart();
  cart.add({ productId: id(3), productName: 'Simples', quantity: 3, unitPrice: '0.10' });
  cart.add({ productId: id(4), productName: 'Configurável', quantity: 2, unitPrice: '10.01', variantId: id(5), variantName: 'Grande', optionIds: [id(6)] });
  const address = { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Cidade', complement: null };
  const state = { step: 'ORDER_REVIEW', cart, customerId: id(7), whatsappPhone: { phone: '5577999999999', source: 'senderPn' },
    fulfillmentMode: mode, paymentMethod: method, changeFor,
    pickupConfirmed: true, pickupAddress: { restaurantId: id(1), name: 'Loja', ...address },
    addressCustomerId: id(7), addressPhone: '5577999999999', addressConfirmed: true,
    confirmedAddress: { ...address }, addressOriginal: { ...address },
    deliveryRegion: { restaurant_id: id(1), customer_id: id(7), fulfillment_mode: 'DELIVERY', bairro_id: id(8), bairro: 'Centro', fee: '2.03', confirmed: true, address: { ...address } } };
  const snapshot = () => { state.paymentContext = checkoutPaymentSnapshot(state, context.restaurant_id); };
  snapshot();
  return { context, state, snapshot, adapt: () => adaptWhatsAppCheckout(context, state) };
}
for (const mode of ['DELIVERY', 'PICKUP']) {
  for (const [method, expected] of [['PIX', 'Pix'], ['DINHEIRO', 'Dinheiro'], ['DEBITO', 'Cartao'], ['CREDITO', 'Cartao']]) {
    test(`${mode} ${method} converts to the real order contract without side effects`, () => {
      const f = fixture(mode, method), before = JSON.stringify(f.state);
      let conversions = 0;
      const original = f.state.cart.toOrderItems.bind(f.state.cart);
      f.state.cart.toOrderItems = () => { conversions++; return original(); };
      const result = f.adapt();
      assert.equal(conversions, 1);
      assert.deepEqual(result, { restaurant_id: id(1), customer_id: id(7), input: {
        items: [{ product_id: id(3), quantity: 3 }, { product_id: id(4), quantity: 2, variant_id: id(5), option_ids: [id(6)] }],
        fulfillment_type: mode, bairro_id: mode === 'DELIVERY' ? id(8) : null, payment_method: expected, change_for: '0.00',
      } });
      assert.deepEqual(parseOrder(result.input), result.input);
      assert.equal(JSON.stringify(f.state), before); assert.equal(f.state.step, 'ORDER_REVIEW');
      result.input.items[1].option_ids.push(id(9));
      assert.deepEqual(f.state.cart.list()[1].optionIds, [id(6)]);
    });
  }
}
for (const mode of ['DELIVERY', 'PICKUP']) for (const [amount, expected] of [['50,1', '50.10'], ['50.10', '50.10'], ['00050', '50.00']]) {
  test(`${mode} cash ${amount} normalizes without rounding`, () => {
    const f = fixture(mode, 'DINHEIRO', amount); assert.equal(f.adapt().input.change_for, expected);
  });
}
test('cash exact provisional total includes fee and accepts zero change due', () => {
  const f = fixture('DELIVERY', 'DINHEIRO', '22,35'); assert.equal(f.adapt().input.change_for, '22.35');
  f.state.changeFor = '22.34'; assert.throws(f.adapt);
  const g = fixture('PICKUP', 'DINHEIRO', '20.32'); assert.equal(g.adapt().input.change_for, '20.32');
});
for (const amount of ['', '0', '-1', '1e3', '50.001', 'R$ 50', '1.000,00', 'Infinity', '999999999', '20.00']) {
  test(`rejects invalid or insufficient cash: ${amount}`, () => assert.throws(fixture('DELIVERY', 'DINHEIRO', amount).adapt));
}
for (const method of ['PIX', 'DEBITO', 'CREDITO']) test(`rejects change on ${method}`, () => assert.throws(fixture('DELIVERY', method, '50.00').adapt));
const invalid = {
  'empty cart': s => s.cart.clear(),
  'missing identity': s => { s.whatsappPhone = undefined; },
  'untrusted identity': s => { s.whatsappPhone.source = 'text'; },
  'missing customer': s => { s.customerId = undefined; },
  'invalid customer UUID': s => { s.customerId = 'customer from text'; },
  'missing modality': s => { s.fulfillmentMode = undefined; },
  'unconfirmed address': s => { s.addressConfirmed = false; },
  'unconfirmed region': s => { s.deliveryRegion.confirmed = false; },
  'foreign region': s => { s.deliveryRegion.restaurant_id = id(9); },
  'foreign region customer': s => { s.deliveryRegion.customer_id = id(9); },
  'foreign address customer': s => { s.addressCustomerId = id(9); },
  'different address phone': s => { s.addressPhone = '5511999999999'; },
  'missing original address': s => { s.addressOriginal = undefined; },
  'missing confirmed address': s => { s.confirmedAddress = undefined; },
  'incomplete address': s => { s.confirmedAddress.street = ''; s.addressOriginal.street = ''; s.deliveryRegion.address.street = ''; },
  'invalid region UUID': s => { s.deliveryRegion.bairro_id = '1'; },
  'region modality': s => { s.deliveryRegion.fulfillment_mode = 'PICKUP'; },
  'region neighborhood mismatch': s => { s.deliveryRegion.bairro = 'Outro'; },
  'missing payment': s => { s.paymentMethod = undefined; },
  'unknown payment': s => { s.paymentMethod = 'BOLETO'; },
  'missing snapshot': s => { s.paymentContext = undefined; },
  'invalid product UUID': s => { s.cart.clear(); s.cart.add({ productId: '1', productName: 'X', unitPrice: '1', quantity: 1 }); },
  'quantity above contract': s => { s.cart.clear(); s.cart.add({ productId: id(3), productName: 'X', unitPrice: '1', quantity: 32768 }); },
};
for (const [name, mutate] of Object.entries(invalid)) test(`rejects ${name}`, () => {
  const f = fixture(); mutate(f.state);
  if (name !== 'missing snapshot') f.snapshot(); // Even a freshly captured token cannot authorize incomplete state.
  assert.throws(f.adapt);
});
for (const [name, mutate] of Object.entries({
  cart: s => s.cart.remove(0),
  address: s => { s.confirmedAddress.street = 'Outra'; },
  fee: s => { s.deliveryRegion.fee = '3.00'; },
  customer: s => { s.customerId = id(9); },
  identity: s => { s.whatsappPhone.phone = '5511999999999'; },
  modality: s => { s.fulfillmentMode = 'PICKUP'; },
  pickup: s => { s.pickupAddress.street = 'Outra'; },
})) test(`rejects stale payment after changed ${name}`, () => {
  const f = fixture(); mutate(f.state); assert.throws(f.adapt);
});
for (const field of ['pickupConfirmed', 'pickupAddress']) test(`rejects missing ${field}`, () => {
  const f = fixture('PICKUP'); f.state[field] = undefined; f.snapshot(); assert.throws(f.adapt);
});
test('rejects foreign or incomplete pickup address', () => {
  const f = fixture('PICKUP'); f.state.pickupAddress.restaurantId = id(9); f.snapshot(); assert.throws(f.adapt);
  const g = fixture('PICKUP'); g.state.pickupAddress.city = ''; g.snapshot(); assert.throws(g.adapt);
});
for (const step of ['PAYMENT_SELECTION', 'PAYMENT_CHANGE', 'PAYMENT_CHANGE_AMOUNT', 'ORDER_SIMULATED', 'CART']) {
  test(`rejects checkout in ${step}`, () => { const f = fixture(); f.state.step = step; assert.throws(f.adapt); });
}
test('trusted restaurant context cannot be overridden by extra text fields', () => {
  const f = fixture(); f.state.text = `restaurant_id=${id(9)} customer_id=${id(9)} bairro_id=${id(9)}`;
  assert.equal(f.adapt().restaurant_id, id(1)); assert.equal(f.adapt().customer_id, id(7)); assert.equal(f.adapt().input.bairro_id, id(8));
  f.context.restaurant_id = id(9); assert.throws(f.adapt);
});
test('invalid context or other channel is rejected', () => {
  for (const change of [{ session_id: '' }, { restaurant_id: 'text' }, { channel: 'telegram' }]) {
    const f = fixture(); Object.assign(f.context, change); assert.throws(f.adapt);
  }
});
for (const [name, changes] of [
  ['variant UUID', { variantId: 'text' }],
  ['option UUID', { optionIds: ['text'] }],
  ['duplicate options', { optionIds: [id(6), id(6)] }],
  ['unit precision', { unitPrice: '1.001' }],
]) test(`rejects invalid configured ${name}`, () => {
  const f = fixture(); f.state.cart.clear();
  f.state.cart.add({ productId: id(4), productName: 'X', quantity: 1, unitPrice: '10.00', variantId: id(5), optionIds: [id(6)], ...changes });
  f.snapshot(); assert.throws(f.adapt);
});
test('adapter import does not load persistence, order submission or HTTP server', () => {
  for (const path of ['../src/database', '../src/service/order/OrderSalesService', '../src/server']) {
    assert.equal(require.cache[require.resolve(path)], undefined);
  }
});
