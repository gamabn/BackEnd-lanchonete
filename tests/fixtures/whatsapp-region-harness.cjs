require('ts-node/register');
const assert = require('node:assert/strict');
const { ConversationMenu } = require('../../src/messaging/core/conversationMenu');
const { BotCart } = require('../../src/messaging/core/cart');
const { ExistingRegionCatalog } = require('../../src/messaging/core/deliveryRegions');
const { harness, complete } = require('./whatsapp-address-harness.cjs');
const identity = { phone: '5577999999999', source: 'senderPn' };
const regionA = '00000000-0000-4000-8000-000000000501';
const regionB = '00000000-0000-4000-8000-000000000502';
function fixture(options = {}) {
  const regions = options.regions || [{ id: regionA, bairro: 'Centro', frete: '5.00', lanchonete_id: 'A' }];
  const db = harness({ ...options, regions, records: [
    { id: 'customer-A', restaurant_id: 'A', phone: '+5577999999999', ...(options.address ?? complete), ...(options.neighborhood === undefined ? {} : { neighborhood: options.neighborhood }) },
    { id: 'customer-B', restaurant_id: 'B', phone: '+5577999999999', ...complete },
  ] });
  const catalogCalls = [];
  let fail = false;
  const reader = { getBairro: async (restaurant, neighborhood) => {
    catalogCalls.push({ restaurant, neighborhood });
    if (fail) throw new Error('private database details 5577999999999');
    // Test double for the SQL boolean. Production comparison happens in PostgreSQL.
    const key = text => text.replace(/^ +| +$/g, '').toLowerCase();
    return regions.map(row => ({ ...row, ...(neighborhood === undefined ? {} : { matches_address: typeof row.bairro === 'string' && key(row.bairro) === key(neighborhood) }) }));
  } };
  const catalog = new ExistingRegionCatalog(reader);
  const menu = new ConversationMenu({ findByWhatsAppPhone: async ({ restaurant_id }) => [{ id: `customer-${restaurant_id}`, restaurant_id, international_format: true }] }, {
    createInitialForWhatsApp: async () => { assert.fail('No signup allowed in region selection'); },
  }, db.gateway, catalog, { execute: async id => ({ id, name: 'Restaurante Teste', street: 'Rua Teste', number: '10', neighborhood: 'Centro', city: 'Cidade Teste', status: true }) });
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
  const enterDelivery = async () => { await send('3', identity); return send('1'); };
  const start = async () => { const reply = await enterDelivery(); return state.step === 'ADDRESS_EXISTING' ? send('1') : reply; };
  return { ...db, regions, catalogCalls, catalog, menu, state, seed, send, start, enterDelivery, setFailure(value) { fail = value; } };
}
async function collect(f, neighborhood = 'Santa Cruz') {
  await f.send('Rua Nova'); await f.send('12'); await f.send('Cidade Teste'); return f.send('P');
}
const updates = f => f.calls.filter(call => call.sql.startsWith('UPDATE'));


module.exports = { fixture, collect, identity, regionA, regionB, updates };
