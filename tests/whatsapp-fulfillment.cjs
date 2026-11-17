const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { BotCart } = require('../src/messaging/core/cart');
const { FULFILLMENT_MENU } = require('../src/messaging/core/fulfillment');
const { stubGateway, stubRegionCatalog } = require('./fixtures/whatsapp-address-harness.cjs');
const identity = { phone: '5577999999999', source: 'senderPn' };
const delivery = '📍 ENDEREÇO CADASTRADO\n\nRua: Rua das Flores\nNúmero: 12A\nBairro: Centro\nCidade: Cidade Teste\n\n1 - Confirmar endereço\n2 - Alterar endereço\nB - Escolher outro bairro\n0 - Voltar ao carrinho';
const store = { id: 'A', name: 'Restaurante Real', street: 'Rua Real', number: '42', neighborhood: 'Centro', city: 'Cidade Real', status: true };
const { pickupPreview, pickupAddress, pickupConfirmed } = require('../src/messaging/core/pickup');
const pickup = pickupPreview(pickupAddress(store, 'A'));

function fixture(options = {}) {
  const reads = [], writes = [];
  const reader = { findByWhatsAppPhone: async input => {
    reads.push(input);
    if (options.error) throw new Error('private database details');
    if (options.rows) return options.rows;
    return options.newCustomer ? [] : [{ id: `customer-${input.restaurant_id}`, restaurant_id: input.restaurant_id, international_format: true }];
  } };
  const writer = { createInitialForWhatsApp: async input => {
    writes.push(input);
    return options.writeResult || { kind: 'created', customerId: `customer-${input.restaurant_id}` };
  } };
  const addresses = stubGateway(), addressReads = [];
  const gateway = { ...addresses, load: async owner => { addressReads.push(owner); return addresses.load(owner); } };
  const menu = new ConversationMenu(reader, writer, gateway, stubRegionCatalog(), { execute: async id => ({ ...store, id }) });
  function seed(restaurant = 'A', key = 'session-account-chat', jid = 'opaque@lid') {
    const cart = new BotCart();
    cart.add({ productId: 'simple', productName: 'Simples', quantity: 2, unitPrice: '10.00' });
    cart.add({ productId: 'configured', productName: 'Configurado', quantity: 3, unitPrice: '17.25', variantId: 'variant', variantName: 'Grande', optionIds: ['option-1', 'option-2'] });
    const state = { step: 'CART', categories: [], cart };
    menu.sessions.set(JSON.stringify([restaurant, key, jid]), state);
    return state;
  }
  const state = seed();
  const send = (text, evidence) => menu.handle('session-account-chat', 'A', text, 'opaque@lid', evidence);
  return { menu, state, seed, send, reads, writes, addressReads };
}

test('verified existing customer reaches the exact fulfillment menu on finish', async () => {
  const f = fixture();
  const reply = await f.send('3', identity);
  assert.equal(reply, '🚚 COMO DESEJA RECEBER SEU PEDIDO?\n\n1 - Entrega\n2 - Retirada no estabelecimento\n\n0 - Voltar ao carrinho');
  assert.equal(f.state.step, 'FULFILLMENT_CHOICE');
  assert.equal(f.state.customerId, 'customer-A');
  assert.equal(f.state.fulfillmentMode, undefined);
  assert.deepEqual(f.reads, [{ restaurant_id: 'A', phone: identity.phone }]);
  assert.equal(f.writes.length, 0);
});

for (const [choice, mode, message] of [['1', 'DELIVERY', delivery], ['2', 'PICKUP', pickup]]) {
  test(`${mode} preserves the whole cart and follows the appropriate next step`, async () => {
    const f = fixture(), before = f.state.cart.list();
    await f.send('3', identity);
    assert.equal(await f.send(choice), message);
    assert.equal(f.state.fulfillmentMode, mode);
    assert.equal(f.state.step, mode === 'DELIVERY' ? 'ADDRESS_EXISTING' : 'PICKUP_REVIEW');
    assert.deepEqual(f.state.cart.list(), before);
    assert.equal(f.state.customerId, 'customer-A');
    assert.equal(f.reads.length, 1); assert.equal(f.writes.length, 0);
    if (mode === 'PICKUP') {
      assert.equal(await f.send('qualquer texto'), message);
      assert.equal(await f.send('1'), pickupConfirmed(pickupAddress(store, 'A')));
      assert.equal(f.state.pickupConfirmed, true);
      assert.equal(f.addressReads.length, 0);
    } else {
      assert.equal(f.addressReads.length, 1);
    }
    assert.equal(f.state.fulfillmentMode, mode);
  });
}

test('0 keeps cart, customer and mode; finishing again allows changing the mode', async () => {
  const f = fixture(), before = f.state.cart.list();
  await f.send('3', identity); await f.send('1');
  await f.send('0');
  assert.equal(f.state.step, 'CART');
  assert.equal(f.state.fulfillmentMode, 'DELIVERY');
  assert.equal(f.state.customerId, 'customer-A');
  assert.deepEqual(f.state.cart.list(), before);
  assert.equal(await f.send('3'), FULFILLMENT_MENU);
  assert.equal(await f.send('2'), pickup);
  assert.equal(f.state.fulfillmentMode, 'PICKUP');
  assert.deepEqual(f.state.cart.list(), before);
  await f.send('0');
  assert.equal(f.state.fulfillmentMode, 'PICKUP');
});

test('0 from menu returns without implicitly selecting delivery or pickup', async () => {
  const f = fixture(), before = f.state.cart.list();
  await f.send('3', identity); await f.send('0');
  assert.equal(f.state.step, 'CART'); assert.equal(f.state.fulfillmentMode, undefined);
  assert.deepEqual(f.state.cart.list(), before);
});

test('invalid choices repeat menu without changing a previous preference', async () => {
  const f = fixture();
  await f.send('3', identity); await f.send('2'); await f.send('0'); await f.send('3');
  for (const text of ['', '3', '01', '02', '1.0', 'Entrega', 'Retirada', '1 - Entrega']) {
    assert.equal(await f.send(text), '❌ Opção inválida.\n\n' + FULFILLMENT_MENU);
    assert.equal(f.state.fulfillmentMode, 'PICKUP');
    assert.equal(f.state.step, 'FULFILLMENT_CHOICE');
  }
  assert.equal(f.reads.length, 2); assert.equal(f.writes.length, 0);
});

test('new customer confirms name and proceeds directly to the same menu', async () => {
  const f = fixture({ newCustomer: true }), before = f.state.cart.list();
  assert.match(await f.send('3', identity), /Qual é o seu nome/);
  assert.equal(f.state.step, 'CUSTOMER_NAME');
  await f.send('João Silva');
  assert.equal(f.state.step, 'CUSTOMER_NAME_CONFIRM');
  assert.equal(f.writes.length, 0);
  assert.equal(await f.send('1'), '✅ Cadastro inicial concluído!\n\n' + FULFILLMENT_MENU);
  assert.equal(f.state.customerId, 'customer-A');
  assert.equal(f.state.step, 'FULFILLMENT_CHOICE');
  assert.equal(await f.send('2'), pickup);
  assert.deepEqual(f.state.cart.list(), before);
  assert.equal(f.writes.length, 1);
});

test('customer found during registration also reaches fulfillment without duplicate signup', async () => {
  const f = fixture({ newCustomer: true, writeResult: { kind: 'existing', customerId: 'existing-A' } });
  await f.send('3', identity); await f.send('João Silva');
  assert.equal(await f.send('1'), FULFILLMENT_MENU);
  assert.equal(f.state.customerId, 'existing-A');
  assert.equal(f.state.step, 'FULFILLMENT_CHOICE');
});

test('LID-only and manual phone never unlock fulfillment', async () => {
  for (const evidence of [undefined, { ...identity, source: 'manual' }]) {
    const f = fixture();
    assert.match(await f.send('3', evidence), /Precisamos confirmar seu telefone/);
    await f.send(identity.phone); await f.send('1'); await f.send('2');
    assert.equal(f.state.step, 'CUSTOMER_IDENTIFICATION');
    assert.equal(f.state.fulfillmentMode, undefined);
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
});

test('lookup ambiguity and errors, and registration errors, cannot reach fulfillment', async () => {
  for (const options of [{ error: true }, { rows: [
    { id: 'a', restaurant_id: 'A', international_format: true },
    { id: 'b', restaurant_id: 'A', international_format: true },
  ] }]) {
    const f = fixture(options); await f.send('3', identity); await f.send('1');
    assert.notEqual(f.state.step, 'FULFILLMENT_CHOICE');
    assert.equal(f.state.fulfillmentMode, undefined);
  }
  const f = fixture({ newCustomer: true, writeResult: { kind: 'error' } });
  await f.send('3', identity); await f.send('João Silva'); await f.send('1');
  assert.equal(f.state.step, 'CUSTOMER_REGISTRATION_ERROR');
  assert.equal(f.state.fulfillmentMode, undefined);
});

test('mode never crosses restaurant, session/account/chat key, or sender', async () => {
  const f = fixture();
  await f.send('3', identity); await f.send('1');
  const scopes = [ ['B', 'session-account-chat', 'opaque@lid'], ['A', 'other-session-account-chat', 'opaque@lid'], ['A', 'session-account-chat', 'other@lid'] ];
  for (const [restaurant, key, jid] of scopes) {
    const state = f.seed(restaurant, key, jid);
    assert.equal(await f.menu.handle(key, restaurant, '3', jid, identity), FULFILLMENT_MENU);
    assert.equal(state.fulfillmentMode, undefined);
    assert.equal(state.customerId, `customer-${restaurant}`);
    await f.menu.handle(key, restaurant, '2', jid);
    assert.equal(state.fulfillmentMode, 'PICKUP');
    assert.equal(f.state.fulfillmentMode, 'DELIVERY');
  }
});

test('changing transport identity clears previous mode and customer before offering a new menu', async () => {
  const f = fixture();
  await f.send('3', identity); await f.send('1');
  assert.equal(await f.send('2', { phone: '5521999999999', source: 'senderPn' }), FULFILLMENT_MENU);
  assert.equal(f.state.fulfillmentMode, undefined);
  assert.equal(f.state.step, 'FULFILLMENT_CHOICE');
  assert.equal(f.reads.length, 2);
});

test('missing identity or customer and empty cart cannot authorize a modality choice', async () => {
  const f = fixture();
  await f.send('3', identity);
  f.state.whatsappPhone = undefined;
  assert.match(await f.send('1'), /Precisamos confirmar seu telefone/);
  assert.equal(f.state.customerId, undefined); assert.equal(f.state.fulfillmentMode, undefined);
  await f.send('3', identity);
  f.state.cart.clear();
  await f.send('2');
  assert.equal(f.state.step, 'CART'); assert.equal(f.state.fulfillmentMode, undefined);
  const empty = fixture(); empty.state.cart.clear();
  assert.match(await empty.send('3', identity), /carrinho está vazio/);
  assert.equal(empty.reads.length, 0);
});

test('late lookup after 0 cannot force a fulfillment menu', async () => {
  const f = fixture(); let finish;
  f.menu.customerReader = { findByWhatsAppPhone: () => new Promise(resolve => { finish = resolve; }) };
  const pending = f.send('3', identity);
  await f.send('0');
  finish([{ id: 'existing', restaurant_id: 'A', international_format: true }]);
  const reply = await pending;
  assert.equal(f.state.step, 'CART'); assert.equal(f.state.fulfillmentMode, undefined);
  assert.doesNotMatch(reply, /COMO DESEJA RECEBER/);
});

test('fulfillment diagnostics and replies do not disclose customer data', async () => {
  const original = process.stdout.write, logs = [];
  process.stdout.write = chunk => { logs.push(String(chunk)); return true; };
  try {
    const f = fixture();
    const replies = [await f.send('3', identity), await f.send('2')];
    assert.doesNotMatch(replies.join('') + logs.join(''), /5577999999999|opaque@lid|customer-A|João/);
  } finally { process.stdout.write = original; }
});
