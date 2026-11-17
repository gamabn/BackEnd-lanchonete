const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { BotCart } = require('../src/messaging/core/cart');
const { ADDRESS_SAVED, ADDRESS_CONFIRMED } = require('../src/messaging/core/customerAddress');
const { addressLimitsFromColumns, normalizeAddressField, normalizeDeliveryAddress } = require('../src/security/customerAddress');
const { harness, complete, empty, metadata, stubRegionCatalog } = require('./fixtures/whatsapp-address-harness.cjs');
const identity = { phone: '5577999999999', source: 'senderPn' };
const owner = { customer_id: 'customer-A', restaurant_id: 'A', phone: identity.phone };
const draft = { street: 'Rua Nova', number: '25', neighborhood: 'Vila Nova', city: 'Cidade Nova', complement: null };
function fixture(options = {}) {
  const db = harness(options);
  const reader = { findByWhatsAppPhone: async ({ restaurant_id }) => [{ id: `customer-${restaurant_id}`, restaurant_id, international_format: true }] };
  const writer = { createInitialForWhatsApp: async () => { assert.fail('Address flow must not sign up'); } };
  const menu = new ConversationMenu(reader, writer, db.gateway, stubRegionCatalog(), { execute: async id => ({ id, name: 'Restaurante Teste', street: 'Rua Teste', number: '10', neighborhood: 'Centro', city: 'Cidade Teste', status: true }) });
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
  const start = async () => { await send('3', identity); const reply = await send('1'); return state.step === 'DELIVERY_NEIGHBORHOOD_CHOICE' ? send('1') : reply; };
  return { ...db, menu, state, send, start, seed };
}
const updates = f => f.calls.filter(call => call.sql.startsWith('UPDATE'));
async function collect(f, address = draft) {
  await f.send(address.street); await f.send(address.number); await f.send(address.city);
  return f.send(address.complement || 'P');
}

test('complete address is shown only for the verified customer and does not cause UPDATE', async () => {
  const f = fixture({ records: [{ id: owner.customer_id, restaurant_id: 'A', phone: '+5577999999999', ...complete }] });
  assert.equal(await f.start(), '📍 ENDEREÇO CADASTRADO\n\nRua: Rua das Flores\nNúmero: 12A\nBairro: Centro\nCidade: Cidade Teste\n\n1 - Confirmar endereço\n2 - Alterar endereço\nB - Escolher outro bairro\n0 - Voltar ao carrinho');
  assert.equal(f.state.step, 'ADDRESS_EXISTING'); assert.equal(updates(f).length, 0);
  assert.equal(f.state.fulfillmentMode, 'DELIVERY');
});

for (const existing of [empty, { ...empty, street: 'Rua antiga', city: 'Cidade Antiga' }, { ...complete, street: '  ' }]) test('empty or partial address starts collection without guessing missing values', async () => {
  const f = fixture({ records: [{ id: owner.customer_id, restaurant_id: 'A', phone: '+5577999999999', ...existing }] });
  assert.match(await f.start(), /Qual é a rua/);
  assert.equal(f.state.step, 'ADDRESS_STREET');
  assert.deepEqual(f.state.addressDraft, { neighborhood: f.state.addressRegion.bairro }); assert.equal(updates(f).length, 0);
});

test('fields are collected in order and saved only after explicit preview confirmation', async () => {
  const f = fixture(), before = f.state.cart.list();
  await f.start();
  assert.match(await f.send(' Rua Nova '), /Qual é o número/);
  assert.match(await f.send('25'), /Qual é a cidade/);
  assert.match(await f.send('Cidade Nova'), /Qual é o complemento/);
  const preview = await f.send('P');
  assert.match(preview, /CONFIRME SEU ENDEREÇO/); assert.match(preview, /Complemento: Não informado/);
  assert.equal(f.state.step, 'ADDRESS_REVIEW'); assert.equal(f.state.addressConfirmed, false);
  assert.equal(updates(f).length, 0); assert.equal(f.rows[0].street, null);
  assert.match(await f.send('1'), /^✅ Endereço salvo com sucesso!/);
  assert.equal(f.rows[0].street, 'Rua Nova'); assert.equal(f.rows[0].number, '25');
  assert.equal(f.rows[0].neighborhood, 'Vila Nova'); assert.equal(f.rows[0].city, 'Cidade Nova');
  assert.equal(f.rows[0].complement, null); assert.equal(f.state.addressConfirmed, true);
  assert.deepEqual(f.state.confirmedAddress, draft); assert.deepEqual(f.state.cart.list(), before);
});

test('invalid required fields and menu controls are rejected without advancing', async () => {
  const f = fixture(); await f.start();
  for (const value of ['', ' ', '1', '2', 'menu', 'voltar', 'Entrega', '3 - Finalizar pedido', 'Confirmar nome', 'Finalizar pedido', 'Rua\nOutra', 'Rua\u202eOutra']) {
    assert.match(await f.send(value), /Valor inválido/); assert.equal(f.state.step, 'ADDRESS_STREET');
  }
  await f.send('Rua Nova');
  for (const value of ['', ' ', 'menu', 'Rua Nova', '-15', '1 - Confirmar']) {
    assert.match(await f.send(value), /Valor inválido/); assert.equal(f.state.step, 'ADDRESS_NUMBER');
  }
  await f.send('1'); // House number 1 is data in this field, not a confirmation command.
  assert.equal(f.state.step, 'ADDRESS_CITY');
  assert.match(await f.send('2'), /Valor inválido/);
  assert.equal(updates(f).length, 0);
});

test('actual smaller database limits are applied in the UI and again on save', async () => {
  const f = fixture({ columns: { street: { data_type: 'character varying', character_maximum_length: 8 } } });
  assert.match(await f.start(), /Máximo de 8 caracteres/);
  assert.match(await f.send('Rua longa'), /Valor inválido/);
  assert.equal(f.state.step, 'ADDRESS_STREET');
  await collect(f, { ...draft, street: 'Rua Nova' });
  // Database metadata can change between collection and confirmation.
  f.columns.find(column => column.column_name === 'street').character_maximum_length = 5;
  assert.match(await f.send('1'), /Não foi possível validar/);
  assert.equal(updates(f).length, 0); assert.equal(f.rows[0].street, null);
});

test('number column type is respected, including integral range and canonical digits', () => {
  const limits = addressLimitsFromColumns(metadata({ number: { data_type: 'smallint' } }));
  assert.equal(normalizeAddressField('number', '0012', limits), '12');
  for (const value of ['S/N', '12A', '32768', '-1', '0', '00']) assert.equal(normalizeAddressField('number', value, limits), undefined);
  const textLimits = addressLimitsFromColumns(metadata());
  assert.equal(normalizeAddressField('number', 'S/N', textLimits), 'S/N');
  assert.equal(normalizeAddressField('number', '12A', textLimits), '12A');
  assert.equal(normalizeDeliveryAddress({ ...draft, number: 12 }, textLimits), undefined);
});

test('existing address confirmation rechecks data but never updates the record', async () => {
  const f = fixture({ records: [{ id: owner.customer_id, restaurant_id: 'A', phone: '+5577999999999', ...complete }] });
  await f.start();
  assert.match(await f.send('1'), /^✅ Endereço confirmado!/);
  assert.equal(f.state.addressConfirmed, true); assert.deepEqual(f.state.confirmedAddress, complete);
  assert.equal(f.state.step, 'DELIVERY_REGION_AVAILABLE'); assert.equal(updates(f).length, 0);
  assert.match(await f.send('1'), /REGIÃO DE ENTREGA CONFIRMADA/); assert.equal(updates(f).length, 0);
});

test('changed existing address is presented again and requires another explicit confirmation', async () => {
  const f = fixture({ records: [{ id: owner.customer_id, restaurant_id: 'A', phone: '+5577999999999', ...complete }] });
  await f.start(); f.rows[0].street = 'Rua Atualizada';
  const reply = await f.send('1');
  assert.match(reply, /endereço atual/); assert.match(reply, /Rua Atualizada/);
  assert.equal(f.state.addressConfirmed, false); assert.equal(f.state.step, 'ADDRESS_EXISTING');
  assert.equal(updates(f).length, 0);
  assert.match(await f.send('1'), /^✅ Endereço confirmado!/);
});

test('correction restarts the draft; previous address remains intact until confirmation', async () => {
  const f = fixture({ records: [{ id: owner.customer_id, restaurant_id: 'A', phone: '+5577999999999', ...complete }] });
  await f.start(); await f.send('2'); await collect(f);
  assert.equal(f.state.step, 'ADDRESS_REVIEW'); assert.equal(f.rows[0].street, complete.street);
  await f.send('2'); assert.equal(f.state.step, 'ADDRESS_STREET'); assert.deepEqual(f.state.addressDraft, { neighborhood: f.state.addressRegion.bairro });
  await collect(f, { ...draft, street: 'Rua Corrigida', complement: 'Apto 2' });
  assert.equal(updates(f).length, 0);
  assert.match(await f.send('1'), /^✅ Endereço salvo com sucesso!/);
  assert.equal(f.rows[0].street, 'Rua Corrigida'); assert.equal(f.rows[0].complement, 'Apto 2');
});

test('0 cancels unconfirmed editing and preserves customer, mode and all cart details', async () => {
  const f = fixture(), before = f.state.cart.list();
  await f.start(); await collect(f); await f.send('0');
  assert.equal(f.state.step, 'CART'); assert.equal(f.state.fulfillmentMode, 'DELIVERY');
  assert.equal(f.state.customerId, owner.customer_id); assert.equal(f.state.addressDraft, undefined);
  assert.equal(updates(f).length, 0); assert.equal(f.rows[0].street, null);
  assert.deepEqual(f.state.cart.list(), before);
});

for (const failure of [{ updateError: true }, { commitError: true }, { updateError: true, rollbackError: true }, { triggerChangesAddress: true }]) test('failed persistence rolls back and never reports success', async () => {
  const f = fixture({ ...failure, records: [{ id: owner.customer_id, restaurant_id: 'A', phone: '+5577999999999', ...complete }] });
  const before = f.state.cart.list();
  await f.start(); await f.send('2'); await collect(f);
  const reply = await f.send('1');
  assert.doesNotMatch(reply, /salvo com sucesso|secret|Rua das Flores|Rua Nova/);
  assert.equal(f.state.step, 'ADDRESS_ERROR'); assert.equal(f.state.addressConfirmed, false);
  assert.equal(f.rows[0].street, complete.street); assert.deepEqual(f.state.cart.list(), before);
  assert.ok(f.calls.some(call => call.sql === 'ROLLBACK'));
  if (failure.rollbackError) assert.equal(f.releases.at(-1), true);
});

test('tenant/customer/phone mismatch and duplicate phone proof cannot disclose or update addresses', async () => {
  const f = harness({ records: [{ id: owner.customer_id, restaurant_id: 'A', phone: '+5577999999999', ...complete },
    { id: 'customer-B', restaurant_id: 'B', phone: '+5577999999999', ...draft }] });
  for (const forged of [{ ...owner, restaurant_id: 'B' }, { ...owner, customer_id: 'customer-B' }, { ...owner, phone: '5521999999999' }]) {
    assert.equal((await f.gateway.load(forged)).kind, 'forbidden');
    assert.equal((await f.gateway.save(forged, complete, draft)).kind, 'forbidden');
  }
  assert.equal(updates(f).length, 0);
  f.rows.push({ id: 'duplicate', restaurant_id: 'A', phone: '77999999999', ...draft });
  assert.equal((await f.gateway.load(owner)).kind, 'forbidden');
});

test('drafts never cross restaurant, session/conversation or sender', async () => {
  const f = fixture(); await f.start(); await f.send('Rua Nova');
  for (const [restaurant, key, jid] of [['B', 'session-account-chat', 'opaque@lid'], ['A', 'other-session-account-chat', 'opaque@lid'], ['A', 'session-account-chat', 'other@lid']]) {
    const state = f.seed(restaurant, key, jid);
    await f.menu.handle(key, restaurant, '3', jid, identity);
    assert.equal(state.addressDraft, undefined); assert.equal(state.addressConfirmed, false);
  }
  assert.equal(f.state.addressDraft.street, 'Rua Nova'); assert.equal(updates(f).length, 0);
});

test('PICKUP never reads or updates addresses and retains its mode', async () => {
  const f = fixture(), before = f.state.cart.list();
  await f.send('3', identity);
  assert.match(await f.send('2'), /RETIRADA NO ESTABELECIMENTO/);
  assert.equal(f.calls.length, 0); assert.equal(f.state.fulfillmentMode, 'PICKUP');
  await f.send('1'); assert.equal(f.calls.length, 0);
  await f.send('0'); assert.deepEqual(f.state.cart.list(), before);
});

test('invalid previews, repeated confirmations and concurrent messages cannot duplicate UPDATE', async () => {
  const f = fixture(); await f.start(); await collect(f);
  assert.match(await f.send('3'), /Opção inválida/); assert.equal(updates(f).length, 0);
  await Promise.all([f.send('1'), f.send('1'), f.send('1')]);
  assert.equal(updates(f).length, 1); assert.equal(f.state.addressConfirmed, true);
  assert.match(await f.send('1'), /REGIÃO DE ENTREGA CONFIRMADA/); assert.equal(updates(f).length, 1);
});

test('address service retries are idempotent and stale drafts cannot overwrite another update', async () => {
  const f = harness();
  assert.equal((await f.gateway.save(owner, empty, draft)).kind, 'saved');
  assert.equal((await f.gateway.save(owner, empty, draft)).kind, 'saved');
  assert.equal(updates(f).length, 1);
  assert.equal((await f.gateway.save(owner, empty, { ...draft, street: 'Rua Conflitante' })).kind, 'conflict');
  assert.equal(f.rows[0].street, draft.street); assert.equal(updates(f).length, 1);
});

test('parallel address operations serialize so one changed draft gets a conflict', async () => {
  const f = harness();
  const results = await Promise.all([f.gateway.save(owner, empty, draft), f.gateway.save(owner, empty, { ...draft, street: 'Rua Diferente' })]);
  assert.deepEqual(results.map(result => result.kind).sort(), ['conflict', 'saved']); assert.equal(updates(f).length, 1);
});

test('reentry after save reads stored address and asks confirmation again', async () => {
  const f = fixture(); await f.start(); await collect(f); await f.send('1');
  await f.send('0'); await f.send('3');
  assert.match(await f.send('1'), /ENDEREÇO CADASTRADO/);
  assert.equal(f.state.step, 'ADDRESS_EXISTING'); assert.equal(f.state.addressConfirmed, false);
  assert.equal(f.state.addressOriginal.street, draft.street); assert.equal(updates(f).length, 1);
});

test('late read or write cannot overwrite cancellation; transport change invalidates draft', async () => {
  const f = fixture(); let finish;
  f.menu.addressGateway = { load: () => new Promise(resolve => { finish = resolve; }), save: async () => ({ kind: 'error' }) };
  await f.send('3', identity); const pending = f.send('1'); await f.send('0');
  finish({ kind: 'loaded', address: complete, limits: addressLimitsFromColumns(metadata()) });
  assert.doesNotMatch(await pending, /Rua das Flores/); assert.equal(f.state.step, 'CART');
  const g = fixture(); await g.start(); await collect(g);
  g.menu.addressGateway = { load: g.gateway.load.bind(g.gateway), save: () => new Promise(resolve => { finish = resolve; }) };
  const saving = g.send('1'); await g.send('0'); finish({ kind: 'saved', address: draft });
  await saving; assert.equal(g.state.step, 'CART'); assert.equal(g.state.addressConfirmed, false);
  const h = fixture(); await h.start(); await h.send('Rua Nova');
  await h.send('25', { phone: '5521999999999', source: 'senderPn' });
  assert.equal(h.state.addressDraft, undefined); assert.equal(h.state.addressConfirmed, false); assert.equal(updates(h).length, 0);
});

test('unsupported metadata or connection errors block collection without changing a record', async () => {
  for (const options of [{ missingColumns: true }, { metadataError: true }, { connectError: true }, { columns: { number: { data_type: 'numeric' } } }]) {
    const f = fixture(options);
    assert.match(await f.start(), /preservado/); assert.equal(f.state.step, 'ADDRESS_ERROR'); assert.equal(updates(f).length, 0);
  }
});

test('manual/unresolved phone cannot request or update addresses; diagnostics omit address data', async () => {
  const f = fixture();
  await f.send('3'); await f.send(identity.phone); await f.send('1'); assert.equal(f.calls.length, 0);
  const original = process.stdout.write, logs = [];
  process.stdout.write = chunk => { logs.push(String(chunk)); return true; };
  try {
    const g = fixture(); await g.start(); await collect(g); await g.send('1');
    assert.doesNotMatch(logs.join(''), /Rua|Vila|Cidade|5577999999999|customer-A|opaque@lid/);
  } finally { process.stdout.write = original; }
});
