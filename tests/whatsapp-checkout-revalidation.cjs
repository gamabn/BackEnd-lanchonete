const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { BotCart } = require('../src/messaging/core/cart');
const { checkoutPaymentSnapshot } = require('../src/messaging/core/checkoutSnapshot');
const { adaptWhatsAppCheckout } = require('../src/messaging/checkout/checkoutAdapter');
const { captureCheckoutReview, revalidateCheckoutReview } = require('../src/messaging/checkout/checkoutRevalidation');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture(mode = 'DELIVERY', configured = false) {
  const context = { restaurant_id: id(1), session_id: id(2), channel: 'whatsapp' };
  const address = { city: 'Cidade', street: 'Rua A', number: '10', neighborhood: 'Centro', complement: null };
  const store = { status: true, name: 'Loja', street: 'Rua Loja', number: '20', neighborhood: 'Centro', city: 'Cidade' };
  const cart = new BotCart();
  cart.add({ productId: id(3), productName: 'Pizza', quantity: 3, unitPrice: configured ? '10.30' : '0.10',
    ...(configured ? { variantId: id(5), variantName: 'Grande', optionIds: [id(6)] } : {}) });
  const state = { step: 'ORDER_REVIEW', cart, customerId: id(4), whatsappPhone: { phone: '5577999999999', source: 'senderPn' },
    fulfillmentMode: mode, paymentMethod: 'PIX', pickupConfirmed: true, pickupAddress: { restaurantId: id(1), ...store },
    addressConfirmed: true, addressOriginal: { ...address }, confirmedAddress: { ...address }, addressCustomerId: id(4), addressPhone: '5577999999999',
    deliveryRegion: { restaurant_id: id(1), customer_id: id(4), bairro_id: id(7), bairro: 'Centro', fee: '2.03', fulfillment_mode: 'DELIVERY', confirmed: true, address: { ...address } } };
  state.paymentContext = checkoutPaymentSnapshot(state, id(1));
  const data = { store, address: { ...address }, fee: '2.03', product: { id: id(3), name: 'Pizza', item_price: '0.10', available: true, has_variants: configured },
    variant: { id: id(5), name: 'Grande', price: '10.01' }, groups: [{ id: id(8), name: 'Extras' }], limits: [{ group_id: id(8), min_select: 1, max_select: 2 }],
    options: [{ option_id: id(6), id: id(6), group_id: id(8), name: 'Extra', group_name: 'Extras', additional_price: '0.29' }] };
  const trace = [];
  const client = { query: async (sql, params) => {
    trace.push({ sql, params });
    assert.match(sql.trim(), /^SELECT/); assert.match(sql, /FOR SHARE/); // No writes, BEGIN, COMMIT, pool or socket path.
    if (data.error) throw data.error;
    if (sql.startsWith('SELECT status')) { assert.deepEqual(params, [id(1)]); return { rows: data.store ? [data.store] : [] }; }
    if (sql.startsWith('SELECT city')) { assert.deepEqual(params, [id(4), id(1)]); return { rows: data.address ? [data.address] : [] }; }
    if (sql.includes('FROM bairros')) {
      assert.match(sql, /lanchonete_id::text = \$2/); assert.deepEqual(params, [id(7), id(1), data.address.neighborhood]);
      return { rows: data.regionMissing ? [] : [{ delivery_fee: data.fee }] };
    }
    if (sql.includes('FROM public.products p')) {
      assert.match(sql, /p.restaurant_id::text = \$1/); assert.match(sql, /p.published = TRUE/); assert.deepEqual(params, [id(1), [id(3)]]);
      return { rows: data.product ? [data.product] : [] };
    }
    if (sql.includes('FROM public.products')) { assert.deepEqual(params, [id(3), id(1)]); return { rows: data.product?.available ? [{ id: id(3) }] : [] }; }
    if (sql.includes('FROM public.product_variants')) { assert.deepEqual(params, [id(5), id(3)]); return { rows: data.variant ? [data.variant] : [] }; }
    if (sql.includes('FROM public.product_option_groups')) return { rows: data.groups };
    if (sql.includes('FROM public.product_variant_group_limits')) return { rows: data.limits };
    if (sql.includes('FROM public.product_options')) { assert.deepEqual(params, [id(3), [id(6)]]); return { rows: data.options }; }
    assert.fail(`Unexpected SQL ${sql}`);
  } };
  const snapshot = captureCheckoutReview(context, state);
  const checkout = adaptWhatsAppCheckout(context, state);
  return { context, state, data, client, trace, checkout, snapshot,
    run: () => revalidateCheckoutReview(client, context, checkout, snapshot) };
}
for (const mode of ['DELIVERY', 'PICKUP']) for (const configured of [false, true]) test(`${mode} ${configured ? 'configured' : 'simple'} revalidates on supplied client with exact cents`, async () => {
  const f = fixture(mode, configured), result = await f.run();
  assert.equal(result.kind, 'unchanged');
  assert.equal(result.current.subtotal, configured ? '30.90' : '0.30');
  assert.equal(result.current.delivery_fee, mode === 'PICKUP' ? '0.00' : '2.03');
  assert.equal(result.current.total, mode === 'PICKUP' ? (configured ? '30.90' : '0.30') : (configured ? '32.93' : '2.33'));
  assert.equal(f.trace.some(x => x.sql.includes('FROM bairros')), mode === 'DELIVERY');
  assert.equal(result.validated.priced[0].item_price, configured ? '10.30' : '0.10');
});
for (const [name, mutate, reason] of [
  ['price increase', f => { f.data.product.item_price = '0.11'; }, 'PRICES'],
  ['price decrease', f => { f.data.product.item_price = '0.09'; }, 'PRICES'],
  ['product name', f => { f.data.product.name = 'Outra pizza'; }, 'ITEMS'],
  ['fee', f => { f.data.fee = '3.00'; }, 'DELIVERY_FEE'],
  ['street', f => { f.data.address.street = 'Rua Nova'; }, 'ADDRESS'],
  ['number', f => { f.data.address.number = '11'; }, 'ADDRESS'],
  ['city', f => { f.data.address.city = 'Outra cidade'; }, 'ADDRESS'],
  ['complement', f => { f.data.address.complement = 'Casa'; }, 'ADDRESS'],
]) test(`requires new review on changed ${name}`, async () => {
  const f = fixture(); mutate(f); const result = await f.run(); assert.equal(result.kind, 'review_required'); assert.ok(result.changes.includes(reason));
});
for (const [name, mutate] of [
  ['missing product or foreign/unpublished product', f => { f.data.product = undefined; }],
  ['unavailable product', f => { f.data.product.available = false; }],
  ['closed restaurant', f => { f.data.store.status = false; }],
  ['missing restaurant', f => { f.data.store = undefined; }],
  ['missing or foreign customer', f => { f.data.address = undefined; }],
  ['missing/foreign/mismatching region', f => { f.data.regionMissing = true; }],
  ['missing neighborhood', f => { f.data.address.neighborhood = ''; }],
  ['incomplete address', f => { f.data.address.street = null; }],
  ['invalid fee', f => { f.data.fee = null; }],
  ['product now requires variant', f => { f.data.product.has_variants = true; }],
]) test(`invalid ${name} requires review without a usable validation result`, async () => {
  const f = fixture(); mutate(f); const result = await f.run(); assert.deepEqual(result, { kind: 'review_required', changes: ['UNAVAILABLE'] });
});
for (const [name, mutate, reason] of [
  ['variant price', f => { f.data.variant.price = '11.01'; }, 'PRICES'],
  ['additional price', f => { f.data.options[0].additional_price = '0.30'; }, 'PRICES'],
  ['variant label', f => { f.data.variant.name = 'Pequena'; }, 'ITEMS'],
  ['missing/unavailable/foreign variant', f => { f.data.variant = undefined; }, 'UNAVAILABLE'],
  ['unavailable/foreign option', f => { f.data.options = []; }, 'UNAVAILABLE'],
  ['new group minimum', f => { f.data.limits[0].min_select = 2; }, 'UNAVAILABLE'],
  ['missing group limits', f => { f.data.limits = []; }, 'UNAVAILABLE'],
  ['product no longer configurable', f => { f.data.product.has_variants = false; }, 'UNAVAILABLE'],
]) test(`configured ${name} requires review`, async () => {
  const f = fixture('DELIVERY', true); mutate(f); const result = await f.run(); assert.equal(result.kind, 'review_required'); assert.ok(result.changes.includes(reason));
});
test('pickup uses locked restaurant snapshot, ignores customer delivery address and fee', async () => {
  const f = fixture('PICKUP'); f.data.address = { city: null, street: null, number: null, neighborhood: null, complement: null }; f.data.fee = 'invalid';
  assert.equal((await f.run()).kind, 'unchanged');
  f.data.store.street = 'Outra rua'; assert.ok((await f.run()).changes.includes('ADDRESS'));
  f.data.store.street = null; assert.deepEqual((await f.run()).changes, ['UNAVAILABLE']);
});
test('snapshot stays bound to what was reviewed even after mutable cart prices and address change', async () => {
  const f = fixture(); f.state.confirmedAddress.street = 'Outra';
  f.state.cart.clear(); f.state.cart.add({ productId: id(3), productName: 'Pizza', quantity: 3, unitPrice: '0.11' });
  f.data.product.item_price = '0.11'; f.data.address.street = 'Outra';
  const result = await f.run(); assert.ok(result.changes.includes('PRICES')); assert.ok(result.changes.includes('ADDRESS'));
});
for (const [name, change] of [
  ['quantity', c => { c.input.items[0].quantity = 2; }],
  ['product', c => { c.input.items[0].product_id = id(9); }],
  ['customer', c => { c.customer_id = id(9); }],
  ['restaurant', c => { c.restaurant_id = id(9); }],
  ['payment', c => { c.input.payment_method = 'Cartao'; }],
  ['mode', c => { c.input.fulfillment_type = 'PICKUP'; c.input.bairro_id = null; }],
  ['region', c => { c.input.bairro_id = id(9); }],
]) test(`changed request ${name} is rejected before database reads`, async () => {
  const f = fixture(); change(f.checkout); assert.deepEqual((await f.run()).changes, ['CHECKOUT']); assert.equal(f.trace.length, 0);
});
test('cash must cover current recalculated total', async () => {
  const f = fixture(); f.state.paymentMethod = 'DINHEIRO'; f.state.changeFor = '2.33';
  const snapshot = captureCheckoutReview(f.context, f.state), checkout = adaptWhatsAppCheckout(f.context, f.state);
  f.data.fee = '2.04'; const result = await revalidateCheckoutReview(f.client, f.context, checkout, snapshot);
  assert.deepEqual(result.changes, ['UNAVAILABLE']);
});
test('database failure propagates to abort transaction; never returns unchanged', async () => {
  const f = fixture(); f.data.error = Object.assign(Error('serialization failure'), { code: '40001' });
  await assert.rejects(f.run, error => error.code === '40001');
});
test('forged snapshot is not a confirmed review', async () => {
  const f = fixture(); assert.deepEqual((await revalidateCheckoutReview(f.client, f.context, f.checkout, {})).changes, ['CHECKOUT']); assert.equal(f.trace.length, 0);
});
test('revalidation imports neither order persistence nor server/pool', () => {
  for (const path of ['../src/database', '../src/server', '../src/service/order/OrderSalesService']) assert.equal(require.cache[require.resolve(path)], undefined);
});
for (const [name, mutate] of [
  ['invalid quantity', c => { c.input.items[0].quantity = 0; }],
  ['invalid product ID', c => { c.input.items[0].product_id = 'text'; }],
  ['injected price', c => { c.input.items[0].price = '0.01'; }],
  ['duplicate options', c => { c.input.items[0].option_ids = [id(6), id(6)]; }],
]) test(`${name} returns a typed rejection without reads`, async () => {
  const f = fixture('DELIVERY', true); mutate(f.checkout);
  assert.deepEqual((await f.run()).changes, ['CHECKOUT']); assert.equal(f.trace.length, 0);
});
test('mutable request changes during a read cannot replace the captured request', async () => {
  const f = fixture('DELIVERY', true); const original = f.client.query;
  let resolve;
  f.client.query = async (...args) => {
    if (!resolve) await new Promise(r => { resolve = r; });
    return original(...args);
  };
  const pending = f.run();
  f.checkout.restaurant_id = id(9); f.checkout.customer_id = id(9);
  f.checkout.input.items[0].option_ids[0] = id(9); f.checkout.input.items[0].quantity = 9;
  resolve(); const result = await pending; assert.equal(result.kind, 'unchanged');
  assert.equal(result.current.restaurant_id, id(1)); assert.equal(result.validated.priced[0].quantity, 3);
});
test('same customer and checkout cannot reuse review from another session', async () => {
  const f = fixture(); const context = { ...f.context, session_id: id(9) };
  assert.deepEqual((await revalidateCheckoutReview(f.client, context, f.checkout, f.snapshot)).changes, ['CHECKOUT']); assert.equal(f.trace.length, 0);
});
test('compensating price and freight changes still require review even with same total', async () => {
  const f = fixture(); f.data.product.item_price = '0.11'; f.data.fee = '2.00';
  const result = await f.run(); assert.equal(result.current.total, '2.33'); assert.equal(result.kind, 'review_required');
  assert.ok(result.changes.includes('PRICES')); assert.ok(result.changes.includes('DELIVERY_FEE'));
});
