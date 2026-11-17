const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { deliveryFee, formatDeliveryFee } = require('../src/messaging/core/deliveryRegions');
const identity = { phone: '5577999999999', source: 'senderPn' };
const regionA = '00000000-0000-4000-8000-000000000501';
const regionB = '00000000-0000-4000-8000-000000000502';
const { fixture, collect, updates } = require('./fixtures/whatsapp-region-harness.cjs');

test('unique valid region stores its real UUID, tenant, DELIVERY and preview fee', async () => {
  const f = fixture(); const reply = await f.start();
  assert.match(reply, /🚚 ENTREGA DISPONÍVEL/); assert.match(reply, /Bairro: Centro/); assert.match(reply, /Taxa de entrega: R\$ 5,00/);
  assert.equal(f.state.deliveryRegion.bairro_id, regionA); assert.equal(f.state.deliveryRegion.restaurant_id, 'A');
  assert.equal(f.state.deliveryRegion.fulfillment_mode, 'DELIVERY'); assert.equal(f.state.deliveryRegion.fee, '5.00');
  assert.equal(f.state.deliveryRegion.confirmed, false); assert.equal(f.state.addressConfirmed, true);
  assert.match(await f.send('1'), /REGIÃO DE ENTREGA CONFIRMADA/);
  assert.equal(f.state.step, 'PAYMENT_SELECTION'); assert.equal(f.state.deliveryRegion.confirmed, true);
  assert.equal(updates(f).length, 0); assert.ok(f.catalogCalls.every(call => call.restaurant === 'A'));
});

test('matching uses persisted neighborhood without replacing internal spaces or removing accents', async () => {
  const f = fixture({ neighborhood: 'Centro  Sul', regions: [{ id: regionA, bairro: 'Centro Sul', frete: '5.00', lanchonete_id: 'A' }] });
  await f.start(); assert.equal(f.catalogCalls[0].neighborhood, 'Centro  Sul');
  assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_CHOICE'); assert.equal(f.state.deliveryRegion, undefined);
  const g = fixture({ neighborhood: 'São José', regions: [{ id: regionA, bairro: 'Sao Jose', frete: '5.00', lanchonete_id: 'A' }] });
  await g.start(); assert.equal(g.state.step, 'DELIVERY_NEIGHBORHOOD_CHOICE');
});

test('unserved neighborhood requires catalog selection before an explicit address edit', async () => {
  const f = fixture({ neighborhood: 'Não Cadastrado' });
  assert.match(await f.start(), /não está entre as regiões atendidas/);
  assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_CHOICE'); assert.equal(f.state.deliveryRegion, undefined);
  assert.match(await f.send('1'), /Bairro selecionado: Centro/);
  assert.equal(f.state.step, 'ADDRESS_STREET'); assert.equal(f.state.addressRegion.bairro_id, regionA);
  assert.equal(f.state.deliveryRegion, undefined); assert.equal(f.rows[0].neighborhood, 'Não Cadastrado');
  assert.equal(updates(f).length, 0);
});

for (const tenant of ['B', null]) test(`catalog entry scoped to ${tenant} never authorizes delivery or appears in the list`, async () => {
  const f = fixture({ regions: [{ id: regionA, bairro: 'Centro', frete: '5.00', lanchonete_id: tenant }] });
  const reply = await f.start(); assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_CHOICE');
  assert.equal(f.state.deliveryRegion, undefined); assert.equal(f.state.regionOptions.length, 0);
  assert.doesNotMatch(reply, /1 - Centro/);
});

test('zero fee is valid; money is parsed and formatted without floating arithmetic', async () => {
  const f = fixture({ regions: [{ id: regionA, bairro: 'Centro', frete: '0.00', lanchonete_id: 'A' }] });
  assert.match(await f.start(), /GRÁTIS/); assert.equal(f.state.deliveryRegion.fee, '0.00');
  await f.send('1'); assert.equal(f.state.deliveryRegion.confirmed, true);
  assert.equal(deliveryFee(0), '0.00'); assert.equal(deliveryFee('0.29'), '0.29');
  assert.equal(formatDeliveryFee(deliveryFee('99999999.99')), 'R$ 99.999.999,99');
});

test('negative, null, malformed and overprecision fees never become zero or a valid quote', async () => {
  for (const fee of [-1, '-0.01', null, undefined, '', ' ', '5,00', '5.001', 'NaN', NaN, Infinity, true, '100000000.00']) {
    assert.equal(deliveryFee(fee), undefined);
    const f = fixture({ regions: [{ id: regionA, bairro: 'Centro', frete: fee, lanchonete_id: 'A' }] });
    await f.start(); assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_ERROR'); assert.equal(f.state.deliveryRegion, undefined);
    await f.send('1'); assert.equal(f.state.deliveryRegion, undefined);
  }
});

test('duplicates block confirmation even with different or invalid prices, and log no sensitive data', async () => {
  const original = process.stdout.write, logs = [];
  process.stdout.write = chunk => { logs.push(String(chunk)); return true; };
  try {
    for (const fee of ['5.00', '7.00', null]) {
      const f = fixture({ regions: [{ id: regionA, bairro: 'Centro', frete: '5.00', lanchonete_id: 'A' }, { id: regionB, bairro: ' CENTRO ', frete: fee, lanchonete_id: 'A' }] });
      assert.match(await f.start(), /mais de uma região/); assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_ERROR');
      await f.send('1'); assert.equal(f.state.deliveryRegion, undefined);
    }
    assert.ok(logs.some(text => text.includes('motivo=AMBIGUOUS')));
    assert.doesNotMatch(logs.join(''), /Centro|CENTRO|5577999999999|opaque@lid|000000000501|5\.00/);
  } finally { process.stdout.write = original; }
});

test('catalog selection uses address persistence explicitly and refreshes the region quote', async () => {
  const f = fixture({ neighborhood: 'Não Cadastrado', regions: [{ id: regionA, bairro: 'Santa Cruz', frete: '5.00', lanchonete_id: 'A' }] });
  await f.start(); await f.send('1');
  assert.match(await f.send('1'), /Qual é a rua/); assert.equal(f.state.step, 'ADDRESS_STREET');
  assert.equal(f.state.deliveryRegion, undefined); assert.equal(f.state.addressConfirmed, false);
  assert.equal(f.rows[0].neighborhood, 'Não Cadastrado');
  await collect(f); assert.equal(f.state.step, 'ADDRESS_REVIEW'); assert.equal(updates(f).length, 0);
  assert.match(await f.send('1'), /ENTREGA DISPONÍVEL/);
  assert.equal(updates(f).length, 1); assert.equal(f.rows[0].neighborhood, 'Santa Cruz');
  assert.equal(f.state.deliveryRegion.bairro_id, regionA); assert.equal(f.state.deliveryRegion.confirmed, false);
  await f.send('1'); assert.equal(f.state.deliveryRegion.confirmed, true);
});

test('canceling correction does not change customer address, mode or cart', async () => {
  const f = fixture({ neighborhood: 'Não Cadastrado' }), before = f.state.cart.list();
  await f.start(); await f.send('1'); await f.send('Rua Nova'); await f.send('0');
  assert.equal(f.rows[0].neighborhood, 'Não Cadastrado'); assert.equal(updates(f).length, 0);
  assert.equal(f.state.step, 'CART'); assert.equal(f.state.fulfillmentMode, 'DELIVERY');
  assert.equal(f.state.deliveryRegion, undefined); assert.deepEqual(f.state.cart.list(), before);
});

test('PICKUP clears delivery association and performs no address or region lookup', async () => {
  const f = fixture(), before = f.state.cart.list();
  await f.start(); await f.send('1'); await f.send('0');
  assert.equal(f.state.deliveryRegion.bairro_id, regionA); assert.equal(f.state.addressConfirmed, true);
  await f.send('3'); const count = f.calls.length, regions = f.catalogCalls.length;
  assert.match(await f.send('2'), /RETIRADA/);
  assert.equal(f.calls.length, count); assert.equal(f.catalogCalls.length, regions);
  assert.equal(f.state.deliveryRegion, undefined); assert.equal(f.state.fulfillmentMode, 'PICKUP');
  assert.deepEqual(f.state.cart.list(), before);
});

test('catalog failure preserves cart and blocks address/region confirmation', async () => {
  const f = fixture(), before = f.state.cart.list(); f.setFailure(true);
  assert.match(await f.start(), /Não foi possível consultar/);
  assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_ERROR'); assert.equal(f.state.deliveryRegion, undefined);
  assert.equal(f.state.addressConfirmed, false); assert.deepEqual(f.state.cart.list(), before);
  f.setFailure(false); await f.send('R'); assert.equal(f.state.step, 'ADDRESS_EXISTING');
});

test('removed region invalidates preview and a previously confirmed quote', async () => {
  for (const confirmed of [false, true]) {
    const f = fixture(); await f.start(); if (confirmed) await f.send('1');
    f.regions.splice(0);
    if (confirmed) await f.menu.refreshRegions(f.state, 'A', { check: true });
    else await f.send('1');
    assert.equal(f.state.step, 'DELIVERY_NEIGHBORHOOD_CHOICE'); assert.equal(f.state.deliveryRegion, undefined);
  }
});

test('price changes require a fresh explicit confirmation and never trust message prices', async () => {
  const f = fixture(); await f.start();
  await f.send('0.01 restaurant_id=B'); assert.equal(f.state.deliveryRegion.fee, '5.00');
  f.regions[0].frete = '7.50';
  assert.match(await f.send('1'), /mudou/); assert.equal(f.state.deliveryRegion.fee, '7.50');
  assert.equal(f.state.deliveryRegion.confirmed, false);
  await f.send('1'); assert.equal(f.state.deliveryRegion.confirmed, true);
  f.regions[0].frete = '8.00'; await f.menu.refreshRegions(f.state, 'A', { check: true }); assert.equal(f.state.deliveryRegion.confirmed, false);
});

test('selection uses displayed IDs, not a new list position; deleted neighborhoods are rejected', async () => {
  const f = fixture({ neighborhood: 'Fora', regions: [
    { id: regionA, bairro: 'Centro', frete: '5.00', lanchonete_id: 'A' },
    { id: regionB, bairro: 'Santa Cruz', frete: '7.00', lanchonete_id: 'A' },
  ] });
  await f.start(); f.regions.reverse(); await f.send('1');
  assert.equal(f.state.addressRegion.bairro_id, regionA); assert.equal(f.state.deliveryRegion, undefined);
  await f.send('B'); const selected = f.state.regionOptions[0].bairro_id;
  f.regions.splice(f.regions.findIndex(region => region.id === selected), 1);
  assert.match(await f.send('1'), /não está mais disponível/); assert.equal(f.state.addressRegion, undefined);
});

test('persisted address changes invalidate region and require a new address confirmation', async () => {
  const f = fixture(); await f.start(); f.rows[0].street = 'Rua Alterada';
  assert.match(await f.send('1'), /ENDEREÇO CADASTRADO/);
  assert.equal(f.state.addressConfirmed, false); assert.equal(f.state.deliveryRegion, undefined);
  assert.equal(f.state.step, 'ADDRESS_EXISTING');
});

test('state is isolated by restaurant, session/conversation and sender', async () => {
  const f = fixture({ regions: [
    { id: regionA, bairro: 'Centro', frete: '5.00', lanchonete_id: 'A' },
    { id: regionB, bairro: 'Centro', frete: '8.00', lanchonete_id: 'B' },
  ] });
  await f.start(); await f.send('1');
  for (const [restaurant, key, jid] of [['B', 'session-account-chat', 'opaque@lid'], ['A', 'other-session-account-chat', 'opaque@lid'], ['A', 'session-account-chat', 'other@lid']]) {
    const state = f.seed(restaurant, key, jid);
    await f.menu.handle(key, restaurant, '3', jid, identity); await f.menu.handle(key, restaurant, '1', jid); await f.menu.handle(key, restaurant, '1', jid);
    assert.equal(state.deliveryRegion.bairro_id, restaurant === 'A' ? regionA : regionB);
    assert.equal(state.deliveryRegion.confirmed, false); assert.equal(f.state.deliveryRegion.confirmed, true);
  }
});

test('reentry clears old quote and revalidates current region/fee after address confirmation', async () => {
  const f = fixture(); await f.start(); await f.send('1'); await f.send('0');
  f.regions[0].frete = '9.00'; await f.send('3'); assert.equal(f.state.deliveryRegion, undefined);
  await f.send('1'); await f.send('1'); assert.equal(f.state.deliveryRegion.fee, '9.00'); assert.equal(f.state.deliveryRegion.confirmed, false);
});

test('pagination keeps messages bounded and only accepts a displayed option', async () => {
  const regions = Array.from({ length: 12 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i + 700).padStart(12, '0')}`, bairro: 'Região ' + 'A'.repeat(70) + i, frete: '5.00', lanchonete_id: 'A' }));
  const f = fixture({ neighborhood: 'Fora', regions });
  const first = await f.start(); assert.ok(first.length <= 4096); assert.match(first, /N - Próximas/);
  assert.match(await f.send('11'), /número exibido/);
  const next = await f.send('N'); assert.ok(next.length <= 4096); assert.match(next, /11 - Região/);
  await f.send('11'); assert.equal(f.state.addressRegion.bairro_id, regions[10].id);
});

test('late region lookup cannot restore a canceled selection', async () => {
  const f = fixture(); let finish;
  await f.start();
  f.menu.regionCatalog = { lookup: () => new Promise(resolve => { finish = resolve; }) };
  const pending = f.send('1');
  for (let i = 0; i < 30 && !finish; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finish, 'function'); await f.send('0');
  finish({ kind: 'found', region: { bairro_id: regionA, bairro: 'Centro', fee: '5.00', restaurant_id: 'A', fulfillment_mode: 'DELIVERY' } });
  assert.doesNotMatch(await pending, /ENTREGA DISPONÍVEL/); assert.equal(f.state.step, 'CART'); assert.equal(f.state.deliveryRegion, undefined);
});

test('no region path creates orders, changes payment or writes customer address implicitly', async () => {
  const f = fixture(), before = f.state.cart.list(); await f.start();
  await Promise.all([f.send('1'), f.send('1')]); await f.send('1');
  assert.ok(f.calls.every(call => !/INSERT|UPDATE|DELETE|payment|orders/i.test(call.sql.replace(/FOR UPDATE/g, ''))));
  assert.equal(updates(f).length, 0); assert.deepEqual(f.state.cart.list(), before);
});
