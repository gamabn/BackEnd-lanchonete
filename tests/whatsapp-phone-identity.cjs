const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { WhatsAppPhoneResolver, phoneFromJid } = require('../src/messaging/channels/whatsapp/phoneIdentity');
const { LocalMessageProcessor } = require('../src/messaging/channels/whatsapp/messages');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { BotCart } = require('../src/messaging/core/cart');
const pn = '5577999999999@s.whatsapp.net';
const identity = { phone: '5577999999999', source: 'senderPn' };

test('phone evidence priority and strict JID validation; numeric LIDs are opaque', () => {
  const resolver = new WhatsAppPhoneResolver();
  for (const value of ['5577999999999@lid', '05577999999999@s.whatsapp.net', '123@s.whatsapp.net', '+5577999999999@s.whatsapp.net', '5577999999999:2@s.whatsapp.net', null, 123]) assert.equal(phoneFromJid(value), undefined);
  const raw = { key: { remoteJid: '5577999999999@lid', remoteJidAlt: pn, senderPn: '5511999999999@s.whatsapp.net' } };
  assert.deepEqual(resolver.resolve(raw, 'account'), { ...identity, source: 'remoteJidAlt' });
  raw.key.remoteJidAlt = 123;
  assert.deepEqual(resolver.resolve(raw, 'account'), { phone: '5511999999999', source: 'senderPn' });
  raw.key.remoteJid = pn;
  assert.equal(resolver.resolve(raw, 'account').source, 'remoteJid');
  delete raw.key.senderPn; raw.key.remoteJid = '5577999999999@lid';
  assert.equal(resolver.resolve(raw, 'account'), undefined);
});

test('share mappings are scoped to processor restaurant/session and account', () => {
  const a = new WhatsAppPhoneResolver(), b = new WhatsAppPhoneResolver();
  const raw = { key: { remoteJid: 'opaque@lid' } };
  assert.equal(a.recordShare('a', 'opaque@lid', pn), true);
  assert.equal(a.resolve(raw, 'a').source, 'phoneNumberShare');
  assert.equal(a.resolve(raw, 'b'), undefined);
  assert.equal(b.resolve(raw, 'a'), undefined);
  assert.equal(a.recordShare('a', 'opaque@lid', '5577999999999@lid'), false);
});

function seed(menu, restaurant, key, jid) {
  const cart = new BotCart();
  cart.add({ productId: 'product', productName: 'Produto', quantity: 1, unitPrice: '10.00' });
  const state = { step: 'CART', categories: [], cart };
  menu.sessions.set(JSON.stringify([restaurant, key, jid]), state);
  return state;
}

test('checkout skips phone entry, preserves cart and does not collect or expose records', async () => {
  const menu = new ConversationMenu({ findByWhatsAppPhone: async () => [{ id: 'customer', restaurant_id: 'r', international_format: true }] });
  const state = seed(menu, 'r', 'session-conversation', 'opaque@lid');
  const before = state.cart.list();
  const reply = await menu.handle('session-conversation', 'r', '3', 'opaque@lid', identity);
  assert.match(reply, /COMO DESEJA RECEBER SEU PEDIDO/);
  assert.equal(state.step, 'FULFILLMENT_CHOICE');
  assert.deepEqual(state.cart.list(), before);
  assert.equal(reply.includes(identity.phone), false);
  await menu.handle('session-conversation', 'r', '0', 'opaque@lid');
  assert.equal(state.step, 'CART');
  assert.match(await menu.handle('session-conversation', 'r', '3', 'opaque@lid'), /COMO DESEJA RECEBER SEU PEDIDO/);
  const other = seed(menu, 'other', 'session-conversation', 'opaque@lid');
  assert.match(await menu.handle('session-conversation', 'other', '3', 'opaque@lid'), /Precisamos confirmar seu telefone/);
  assert.equal(other.whatsappPhone, undefined);
});

test('LID fallback keeps typed number unverified and cart intact; later transport evidence advances', async () => {
  const menu = new ConversationMenu({ findByWhatsAppPhone: async () => [{ id: 'customer', restaurant_id: 'r', international_format: true }] });
  const state = seed(menu, 'r', 's', 'numeric@lid');
  assert.match(await menu.handle('s', 'r', '3', 'numeric@lid'), /Precisamos confirmar seu telefone/);
  assert.match(await menu.handle('s', 'r', '77999999999', 'numeric@lid'), /Precisamos confirmar seu telefone/);
  assert.equal(state.whatsappPhone, undefined);
  assert.equal(state.cart.list().length, 1);
  assert.match(await menu.handle('s', 'r', 'oi', 'numeric@lid', identity), /COMO DESEJA RECEBER SEU PEDIDO/);
  assert.equal(state.step, 'FULFILLMENT_CHOICE');
});

test('message pipeline passes transport evidence and replies to original LID', async () => {
  const now = Date.now();
  const context = { restaurant_id: '00000000-0000-4000-8000-000000000001', session_id: '00000000-0000-4000-8000-000000000002', channel: 'whatsapp' };
  const processor = new LocalMessageProcessor(context, now);
  let evidence, sender;
  processor.conversationMenu.handle = async (_key, _r, _text, jid, phone) => { sender = jid; evidence = phone; return 'OK'; };
  const sent = [];
  await processor.process({ type: 'notify', messages: [{ key: { remoteJid: 'opaque@lid', id: 'msg', senderPn: pn }, messageTimestamp: Math.floor(now / 1000), message: { conversation: '77999999999' } }] }, 'account', async jid => { sent.push(jid); }, now);
  assert.deepEqual(evidence, identity);
  assert.equal(sender, 'opaque@lid');
  assert.deepEqual(sent, ['opaque@lid']);
});
