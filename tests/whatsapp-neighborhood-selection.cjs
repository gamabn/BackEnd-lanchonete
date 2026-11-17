const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { fixture: base, identity, regionA, regionB, updates } = require('./fixtures/whatsapp-region-harness.cjs');
const { complete, empty } = require('./fixtures/whatsapp-address-harness.cjs');
const regionC = '00000000-0000-4000-8000-000000000503';
const regions = () => [
  { id: regionA, bairro: 'Santa Cruz', frete: '5.00', lanchonete_id: 'A' },
  { id: regionB, bairro: 'Senador Câmara', frete: '6.00', lanchonete_id: 'A' },
  { id: regionC, bairro: 'jacarezinho b2', frete: '10.00', lanchonete_id: 'A' },
];
const fixture = options => base({ address: empty, regions: regions(), ...options });
async function collect(f, values = {}) {
  const address = { street: 'Rua João Paulo', number: '24', city: 'Itambé', complement: null, ...values };
  await f.send(address.street); await f.send(address.number); await f.send(address.city);
  return f.send(address.complement || 'P');
}
async function ready(f, choice = '1') { await f.enterDelivery(); return f.send(choice); }

test('delivery lists stored neighborhoods and fees before collecting an address', async () => {
  const f = fixture(); const before = f.state.cart.list();
  assert.equal(await f.enterDelivery(), '🚚 ESCOLHA SEU BAIRRO\n\n1 - Santa Cruz — R$ 5,00\n2 - Senador Câmara — R$ 6,00\n3 - jacarezinho b2 — R$ 10,00\n\nR - Atualizar bairros\n0 - Voltar ao carrinho');
  assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_CHOICE'); assert.equal(f.state.addressDraft, undefined);
  assert.equal(f.state.addressRegion, undefined); assert.equal(updates(f).length, 0);
  assert.deepEqual(f.state.cart.list(), before); assert.ok(f.catalogCalls.every(call => call.restaurant === 'A'));
});

test('numeric selection binds the displayed UUID even if a subsequent query reorders the rows', async () => {
  const f = fixture(); await f.enterDelivery(); f.regions.reverse();
  assert.match(await f.send('2'), /Bairro selecionado: Senador Câmara/);
  assert.equal(f.state.addressRegion.bairro_id, regionB); assert.equal(f.state.addressDraft.neighborhood, 'Senador Câmara');
  assert.equal(f.state.addressRegion.fee, '6.00'); assert.equal(f.state.step, 'ADDRESS_STREET');
  assert.equal(f.rows[0].neighborhood, null); assert.equal(updates(f).length, 0);
});

test('free delivery is valid and shown as GRÁTIS in selection and quote', async () => {
  const data = regions(); data[0].frete = '0.00'; const f = fixture({ regions: data });
  assert.match(await f.enterDelivery(), /Santa Cruz — GRÁTIS/); assert.doesNotMatch(await f.send('1'), /R\$ 0,00/);
  await collect(f); assert.match(await f.send('1'), /Taxa de entrega: GRÁTIS/);
  assert.equal(f.state.deliveryRegion.fee, '0.00');
});

test('invalid prices are not selectable and never become free shipping', async () => {
  for (const price of [null, -1, '5.001', 'NaN', Infinity, '100000000.00']) {
    const f = fixture({ regions: [{ id: regionA, bairro: 'Santa Cruz', frete: price, lanchonete_id: 'A' }] });
    const message = await f.enterDelivery(); assert.doesNotMatch(message, /1 - Santa Cruz/);
    await f.send('1'); assert.equal(f.state.addressRegion, undefined); assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_CHOICE');
    assert.equal(updates(f).length, 0);
  }
});

for (const tenant of ['B', null]) test(`neighborhood with tenant ${tenant} is excluded before selection and cannot be saved`, async () => {
  const f = fixture({ regions: [{ id: regionA, bairro: 'Santa Cruz', frete: '5.00', lanchonete_id: tenant }] });
  const reply = await f.enterDelivery(); assert.doesNotMatch(reply, /Santa Cruz/);
  await f.send('1'); assert.equal(f.state.addressRegion, undefined); assert.equal(f.state.addressDraft, undefined);
  assert.equal(updates(f).length, 0);
});

test('new address collects only street, number, city and optional complement', async () => {
  const f = fixture(); await ready(f);
  assert.match(await f.send('Rua João Paulo'), /Qual é o número/);
  assert.match(await f.send('24'), /Qual é a cidade/);
  assert.equal(f.state.step, 'ADDRESS_CITY');
  assert.match(await f.send('Itambé'), /Qual é o complemento/);
  const preview = await f.send('P');
  assert.match(preview, /Bairro: Santa Cruz/); assert.match(preview, /Complemento: Não informado/);
  assert.equal(f.state.step, 'ADDRESS_REVIEW'); assert.equal(updates(f).length, 0);
  assert.equal(f.rows[0].neighborhood, null);
  assert.match(await f.send('1'), /Endereço salvo com sucesso/);
  assert.equal(f.rows[0].neighborhood, 'Santa Cruz'); assert.equal(f.rows[0].street, 'Rua João Paulo');
  assert.equal(f.state.deliveryRegion.bairro_id, regionA); assert.equal(f.state.deliveryRegion.confirmed, false);
});

test('official spelling, lower case, internal spaces and Unicode are persisted exactly', async () => {
  for (const official of ['jacarezinho b2', "  Sa\u0303o  d'Água  "]) {
    const f = fixture({ regions: [{ id: regionA, bairro: official, frete: '5.00', lanchonete_id: 'A' }] });
    await ready(f); const preview = await collect(f); assert.ok(preview.includes(`Bairro: ${official}`));
    await f.send('1'); assert.equal(f.rows[0].neighborhood, official); assert.equal(updates(f).length, 1);
    const writes = updates(f)[0]; assert.equal(writes.params[3], official);
  }
});

test('existing valid address is offered for confirmation, without rewriting the neighborhood', async () => {
  const f = fixture({ address: { ...complete, neighborhood: ' santa cruz ' } });
  assert.match(await f.enterDelivery(), /ENDEREÇO CADASTRADO/); assert.equal(f.state.step, 'ADDRESS_EXISTING');
  assert.equal(f.state.addressRegion.bairro_id, regionA);
  assert.match(await f.send('1'), /ENTREGA DISPONÍVEL/);
  assert.equal(f.rows[0].neighborhood, ' santa cruz '); assert.equal(updates(f).length, 0);
});

test('existing unserved neighborhood explains the problem and requires a listed replacement', async () => {
  const f = fixture({ address: { ...complete, neighborhood: 'Fora da área' } });
  const reply = await f.enterDelivery(); assert.match(reply, /não está entre as regiões atendidas/); assert.match(reply, /ESCOLHA SEU BAIRRO/);
  assert.match(await f.send('Santa Cruz'), /pelo número/); assert.equal(f.rows[0].neighborhood, 'Fora da área');
  await f.send('1'); assert.equal(f.state.step, 'ADDRESS_STREET'); assert.equal(f.rows[0].neighborhood, 'Fora da área');
});

test('editing other address fields preserves the selected valid neighborhood', async () => {
  const f = fixture({ address: { ...complete, neighborhood: 'Santa Cruz' } });
  await f.enterDelivery(); await f.send('2');
  assert.equal(f.state.addressRegion.bairro_id, regionA); assert.equal(f.state.addressDraft.neighborhood, 'Santa Cruz');
  await collect(f, { street: 'Rua Corrigida', complement: 'Casa' });
  await f.send('2'); assert.equal(f.state.addressRegion.bairro_id, regionA);
  await collect(f, { street: 'Rua Final' }); await f.send('1');
  assert.equal(f.rows[0].street, 'Rua Final'); assert.equal(f.rows[0].neighborhood, 'Santa Cruz');
});

test('changing the neighborhood uses the list and clears the previous selection', async () => {
  const f = fixture(); await ready(f); await collect(f);
  assert.match(await f.send('B'), /ESCOLHA SEU BAIRRO/); assert.equal(f.state.addressRegion, undefined);
  assert.equal(f.state.deliveryRegion, undefined); assert.equal(f.state.addressDraft, undefined);
  await f.send('2'); assert.equal(f.state.addressRegion.bairro_id, regionB);
  const preview = await collect(f); assert.match(preview, /Bairro: Senador Câmara/);
  await f.send('1'); assert.equal(f.rows[0].neighborhood, 'Senador Câmara');
  assert.equal(f.state.deliveryRegion.bairro_id, regionB); assert.equal(updates(f).length, 1);
});

test('canceling a change never persists a draft or loses cart details', async () => {
  const f = fixture({ address: { ...complete, neighborhood: 'Santa Cruz' } }); const before = f.state.cart.list();
  await f.enterDelivery(); await f.send('B'); await f.send('2'); await collect(f); await f.send('0');
  assert.equal(f.rows[0].neighborhood, 'Santa Cruz'); assert.equal(f.rows[0].street, complete.street);
  assert.equal(updates(f).length, 0); assert.equal(f.state.step, 'CART');
  assert.equal(f.state.fulfillmentMode, 'DELIVERY'); assert.deepEqual(f.state.cart.list(), before);
});

test('removed or repriced neighborhood cannot be accepted using a stale displayed option', async () => {
  const f = fixture(); await f.enterDelivery(); f.regions.splice(0, 1);
  assert.match(await f.send('1'), /não está mais disponível/); assert.equal(f.state.addressRegion, undefined);
  const g = fixture(); await g.enterDelivery(); g.regions[0].frete = '8.00';
  assert.match(await g.send('1'), /mudou/); assert.equal(g.state.addressRegion, undefined);
  await g.send('1'); assert.equal(g.state.addressRegion.fee, '8.00');
});

test('region and price are revalidated before saving and inside the address transaction', async () => {
  const f = fixture(); await ready(f); await collect(f); f.regions[0].frete = '8.00';
  assert.match(await f.send('1'), /mudou/); assert.equal(updates(f).length, 0); assert.equal(f.rows[0].street, null);
  const g = fixture(); await ready(g); await collect(g);
  const originalSave = g.gateway.save.bind(g.gateway);
  g.menu.addressGateway = { load: g.gateway.load.bind(g.gateway), save: (...args) => { g.regions[0].frete = '9.00'; return originalSave(...args); } };
  assert.match(await g.send('1'), /mudou durante/); assert.equal(updates(g).length, 0); assert.equal(g.rows[0].street, null);
});

test('duplicates never resolve to the first ID, including a duplicate introduced during save', async () => {
  const data = regions(); data.push({ id: '00000000-0000-4000-8000-000000000504', bairro: ' SANTA CRUZ ', frete: '7.00', lanchonete_id: 'A' });
  const f = fixture({ regions: data }); await f.enterDelivery();
  assert.match(await f.send('1'), /mais de uma região/); assert.equal(f.state.addressRegion, undefined); assert.equal(updates(f).length, 0);
  const g = fixture(); await ready(g); await collect(g); const originalSave = g.gateway.save.bind(g.gateway);
  g.menu.addressGateway = { load: g.gateway.load.bind(g.gateway), save: (...args) => {
    g.regions.push({ id: '00000000-0000-4000-8000-000000000504', bairro: 'SANTA CRUZ', frete: '7.00', lanchonete_id: 'A' }); return originalSave(...args);
  } };
  await g.send('1'); assert.equal(updates(g).length, 0); assert.equal(g.rows[0].street, null);
});

test('selection, draft and UUID are isolated by session/conversation and restaurant', async () => {
  const data = regions(); data.push({ id: '00000000-0000-4000-8000-000000000505', bairro: 'Centro', frete: '3.00', lanchonete_id: 'B' });
  const f = fixture({ regions: data }); await ready(f); await f.send('Rua A');
  const state = f.seed('A', 'other-session-account-chat', 'other@lid');
  await f.menu.handle('other-session-account-chat', 'A', '3', 'other@lid', identity);
  await f.menu.handle('other-session-account-chat', 'A', '1', 'other@lid');
  await f.menu.handle('other-session-account-chat', 'A', '2', 'other@lid');
  assert.equal(state.addressRegion.bairro_id, regionB); assert.equal(f.state.addressRegion.bairro_id, regionA);
  assert.equal(f.state.addressDraft.street, 'Rua A'); assert.equal(state.addressDraft.street, undefined);
  const b = f.seed('B'); await f.menu.handle('session-account-chat', 'B', '3', 'opaque@lid', identity);
  const reply = await f.menu.handle('session-account-chat', 'B', '1', 'opaque@lid');
  assert.match(reply, /ENDEREÇO CADASTRADO/); assert.equal(b.addressRegion.bairro_id, data[3].id);
});

test('PICKUP makes no address/catalog queries and does not create orders', async () => {
  const f = fixture(); const before = f.state.cart.list(); await f.send('3', identity);
  assert.match(await f.send('2'), /RETIRADA/); assert.equal(f.calls.length, 0); assert.equal(f.catalogCalls.length, 0);
  assert.equal(f.state.fulfillmentMode, 'PICKUP'); assert.deepEqual(f.state.cart.list(), before);
  assert.ok(f.calls.every(call => !/orders|payment/i.test(call.sql)));
});

test('invalid/free text selections and manually typed prices never replace catalog data', async () => {
  const f = fixture(); await f.enterDelivery();
  for (const text of ['Santa Cruz', regionA, '0.01', '{"restaurant_id":"B"}', '1.0', '99']) {
    assert.match(await f.send(text), /pelo número/); assert.equal(f.state.addressRegion, undefined); assert.equal(updates(f).length, 0);
  }
  await f.send('3'); assert.equal(f.state.addressRegion.bairro, 'jacarezinho b2');
  assert.equal(f.state.addressDraft.neighborhood, 'jacarezinho b2');
});

test('failed save retains the old address and does not claim success', async () => {
  const f = fixture({ address: { ...complete, neighborhood: 'Santa Cruz' }, updateError: true });
  await f.enterDelivery(); await f.send('2'); await collect(f);
  assert.doesNotMatch(await f.send('1'), /Endereço salvo com sucesso/);
  assert.equal(f.state.addressConfirmed, false);
  assert.equal(f.rows[0].street, complete.street); assert.equal(f.rows[0].neighborhood, 'Santa Cruz');
});

test('late list or selection response cannot restore a canceled neighborhood', async () => {
  const f = fixture(); let finish;
  f.menu.regionCatalog = { ...f.catalog, list: () => new Promise(resolve => { finish = resolve; }) };
  await f.send('3', identity); const pending = f.send('1');
  for (let i = 0; i < 30 && !finish; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finish, 'function'); await f.send('0');
  finish({ kind: 'listed', options: [] }); await pending;
  assert.equal(f.state.step, 'CART'); assert.equal(f.state.addressRegion, undefined);
});
