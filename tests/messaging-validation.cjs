const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const v = require('../src/messaging/validation');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-11-13T12:00:00.000Z');
const future = '2026-11-13T12:05:00.000Z';
const context = () => ({ restaurant_id: id(1), session_id: id(2), channel: 'whatsapp' });
const identity = () => ({ channel: 'whatsapp', account_id: 'opaque-account', subject_id: 'opaque-user@lid' });
const menu = () => ({ id: id(3), context: context(), revision: 2, text: 'Escolha', options: [{ number: 1, label: 'Produto', target: { kind: 'product', product_id: id(4) } }], expires_at: future });
const cart = () => ({ context: context(), conversation_id: id(5), revision: 0, lines: [{ kind: 'simple', line_id: id(6), product_id: id(4), quantity: 1 }] });
const address = () => ({ city: 'Cidade', street: 'Rua', number: '10', neighborhood: 'Centro', complement: null });
const message = () => ({ schema_version: 1, context: context(), message_id: 'message-1', sender: identity(), chat_id: 'opaque-chat', received_at: '2026-11-13T12:00:00.000Z', content: { kind: 'text', text: '1' }, profile_name: { value: 'Sugestão', requires_confirmation: true } });
const conversation = () => ({ schema_version: 1, id: id(5), context: context(), identity: identity(), chat_id: 'opaque-chat', customer_id: null, version: 0, control: { mode: 'bot', epoch: 0 }, step: { name: 'MAIN_MENU' }, cart: cart(), active_menu: menu(), expires_at: future });
const session = () => ({ context: context(), account_id: 'opaque-account', connection: 'connected', automation: 'enabled', lease: { owner_id: id(7), fence: '1', expires_at: future } });
const reject = fn => assert.throws(fn, v.MessagingValidationError);

test('messages accept opaque identities and both channels without phone assumptions', () => {
  assert.equal(v.validateIncomingMessage(message()).sender.subject_id, 'opaque-user@lid');
  const telegram = message(); telegram.context.channel = telegram.sender.channel = 'telegram';
  telegram.sender.subject_id = '12345678901234567890';
  v.validateIncomingMessage(telegram);
  const unsupported = message(); unsupported.content = { kind: 'unsupported', media_type: 'image' }; v.validateIncomingMessage(unsupported);
});

test('messages reject missing fields, wrong types, bad identifiers, timestamps and unconfirmed profile', () => {
  for (const mutate of [
    x => delete x.message_id, x => x.message_id = '', x => x.chat_id = 'bad id',
    x => x.context.restaurant_id = 'restaurant', x => x.context.session_id = null,
    x => x.context.channel = 'sms', x => x.sender.channel = 'telegram',
    x => x.sender.subject_id = 123, x => x.sender.account_id = '',
    x => x.profile_name.requires_confirmation = false, x => x.schema_version = 2,
    x => x.content.text = 1, x => x.received_at = '2026-02-30T12:00:00.000Z',
    x => x.occurred_at = undefined, x => x.reply_to_message_id = ' ',
  ]) { const input = message(); mutate(input); reject(() => v.validateIncomingMessage(input)); }
  for (const input of [null, [], 'text', 1]) reject(() => v.validateIncomingMessage(input));
});

test('unexpected fields are rejected at every payload boundary', () => {
  for (const mutate of [x => x.token = 'secret', x => x.context.extra = true, x => x.sender.phone = '123', x => x.content.price = 1, x => x.profile_name.confirmed = true]) {
    const input = message(); mutate(input); reject(() => v.validateIncomingMessage(input));
  }
  const m = menu(); m.options[0].target.price = 1; reject(() => v.validateNumericMenu(m));
  const c = cart(); c.lines[0].price = '1.00'; reject(() => v.validateConversationCart(c));
  reject(() => v.validateDeliveryAddress({ ...address(), restaurant_id: id(1) }));
  const s = session(); s.lease.credentials = 'secret'; reject(() => v.validateRestaurantSession(s));
  const conv = conversation(); conv.step.payload = {}; reject(() => v.validateConversation(conv));
});

test('menu choices resolve persisted IDs and reject expired, stale, malformed or absent choices', () => {
  const m = menu(), expected = { context: context(), menu_id: m.id, revision: m.revision };
  assert.deepEqual(v.resolveMenuChoice(m, '1', expected, now), m.options[0].target);
  for (const choice of ['0', '01', '1.0', '1e0', ' 1', '2', id(4), 1, null]) reject(() => v.resolveMenuChoice(m, choice, expected, now));
  reject(() => v.resolveMenuChoice(m, '1', expected, Date.parse(future)));
  reject(() => v.resolveMenuChoice(m, '1', { ...expected, revision: 1 }, now));
  reject(() => v.resolveMenuChoice(m, '1', { ...expected, menu_id: id(9) }, now));
  reject(() => v.resolveMenuChoice(m, '1', expected, NaN));
});

test('menus reject duplicate/noninteger numbers, invalid IDs, revisions and excess options', () => {
  for (const mutate of [
    m => m.options.push(m.options[0]), m => m.options[0].number = 1.5,
    m => m.options[0].number = 0, m => m.revision = -1,
    m => m.options[0].target.product_id = '1', m => m.options = [],
    m => m.options = Array.from({ length: 51 }, (_, i) => ({ ...m.options[0], number: i + 1 })),
    m => m.options[0].target = { kind: 'neighborhood', neighborhood_id: 'invalid' },
    m => m.options[0].target = { kind: 'option', option_id: 'invalid' },
    m => m.options[0].target = { kind: 'action', action: 'arbitrary' },
  ]) { const m = menu(); mutate(m); reject(() => v.validateNumericMenu(m)); }
  const m = menu(); m.options[0].target = { kind: 'category', category: null }; v.validateNumericMenu(m);
});

test('cart supports anonymous empty cart and configured products without prices', () => {
  const c = cart(); c.lines = []; v.validateConversationCart(c);
  c.lines = [{ kind: 'configured', line_id: id(6), product_id: id(4), quantity: 32767, variant_id: id(8), option_ids: [id(9)] }];
  v.validateConversationCart(c);
});

test('cart rejects invalid quantities, malformed configurations, duplicates and bounds', () => {
  for (const quantity of [0, -1, 1.5, 32768, '1', NaN, Infinity]) { const c = cart(); c.lines[0].quantity = quantity; reject(() => v.validateConversationCart(c)); }
  for (const mutate of [
    c => c.revision = -1, c => c.conversation_id = 'invalid',
    c => c.lines.push(c.lines[0]), c => c.lines[0].variant_id = id(8),
    c => c.lines[0].kind = 'configured', c => c.lines[0].product_id = 'bad',
    c => c.lines = Array.from({ length: 101 }, (_, n) => ({ ...c.lines[0], line_id: id(n + 20) })),
    c => c.lines = new Array(2),
  ]) { const c = cart(); mutate(c); reject(() => v.validateConversationCart(c)); }
  for (const options of [[id(9), id(9)], ['invalid'], Array.from({ length: 101 }, (_, n) => id(n + 100))]) {
    const c = cart(); c.lines[0] = { ...c.lines[0], kind: 'configured', variant_id: id(8), option_ids: options }; reject(() => v.validateConversationCart(c));
  }
});

test('address preserves exact JSON keys, requires complete shape and does not authorize delivery', () => {
  assert.deepEqual(v.validateDeliveryAddress(address()), address());
  for (const field of Object.keys(address())) { const input = address(); delete input[field]; reject(() => v.validateDeliveryAddress(input)); }
  for (const field of ['city', 'street', 'number', 'neighborhood']) { const input = address(); input[field] = ' '; reject(() => v.validateDeliveryAddress(input)); }
  const selection = { context: context(), neighborhood_id: id(8), address: address(), city_source: 'restaurant', customer_address_update: 'none' };
  v.validateOrderDeliverySelection(selection);
  reject(() => v.validateOrderDeliverySelection({ ...selection, city_source: 'user' }));
  reject(() => v.validateOrderDeliverySelection({ ...selection, customer_address_update: 'save' }));
});

test('trusted context rejects cross-restaurant, cross-session and cross-channel objects', () => {
  v.assertMessageConversation(message(), conversation(), session(), context());
  for (const [key, replacement] of [['restaurant_id', id(20)], ['session_id', id(21)], ['channel', 'telegram']]) {
    const changed = { ...context(), [key]: replacement };
    reject(() => v.assertSameContext(context(), changed));
    const c = conversation(); c.cart.context = changed; reject(() => v.validateConversation(c));
    const s = session(); s.context = changed; reject(() => v.assertConversationSession(context(), conversation(), s));
    const input = message(); input.context = changed; reject(() => v.assertMessageConversation(input, conversation(), session(), context()));
  }
});

test('conversation binding rejects other account, subject, chat, menu and cart conversation', () => {
  for (const mutate of [x => x.identity.account_id = 'foreign-account', x => x.identity.subject_id = 'foreign-user', x => x.chat_id = 'foreign-chat']) {
    const c = conversation(); mutate(c); reject(() => v.assertMessageConversation(message(), c, session(), context()));
  }
  const c = conversation(); c.cart.conversation_id = id(99); reject(() => v.validateConversation(c));
  const m = conversation(); m.active_menu.context.restaurant_id = id(99); reject(() => v.validateConversation(m));
});

test('conversation step, checkout and session shapes are validated', () => {
  const c = conversation(); c.step = { name: 'CHECKOUT', draft: { customer: { name: { value: 'Nome', confirmed: true }, phone: null, email_candidate: null }, delivery: null, payment: { method: 'Pix', change_for: '0.00' } } }; v.validateConversation(c);
  c.step.draft.payment.change_for = '1.00'; reject(() => v.validateConversation(c));
  c.step = { name: 'CONFIRM_ORDER', quote_id: id(10), cart_revision: 1, quote_expires_at: future, confirmation_id: id(11) }; reject(() => v.validateConversation(c));
  c.step = { name: 'HUMAN' }; reject(() => v.validateConversation(c)); c.control.mode = 'human'; v.validateConversation(c);
  for (const fence of ['-1', '01', '9223372036854775808', 1]) { const s = session(); s.lease.fence = fence; reject(() => v.validateRestaurantSession(s)); }
});

test('outgoing transport validates routing, text and nested menu context', () => {
  const outgoing = { delivery_id: id(10), context: context(), conversation_id: id(5), chat_id: 'opaque-chat', expected_control_epoch: 0, content: { kind: 'menu', menu: menu() } };
  v.validateOutgoingMessage(outgoing);
  outgoing.content.menu.context.restaurant_id = id(99); reject(() => v.validateOutgoingMessage(outgoing));
  outgoing.content = { kind: 'text', text: 'Resposta' }; v.validateOutgoingMessage(outgoing);
  outgoing.expected_control_epoch = -1; reject(() => v.validateOutgoingMessage(outgoing));
});

test('text, identity, profile and address length boundaries', () => {
  const input = message(); input.content.text = 'x'.repeat(4096); v.validateIncomingMessage(input);
  input.content.text += 'x'; reject(() => v.validateIncomingMessage(input));
  const user = identity(); user.subject_id = 'x'.repeat(256); v.validateExternalIdentity(user); user.subject_id += 'x'; reject(() => v.validateExternalIdentity(user));
  const profile = message(); profile.profile_name.value = 'x'.repeat(121); reject(() => v.validateIncomingMessage(profile));
  const a = address(); a.street = 'x'.repeat(200); v.validateDeliveryAddress(a); a.street += 'x'; reject(() => v.validateDeliveryAddress(a));
});

test('validator errors never echo supplied values', () => {
  const input = message(); input.message_id = 'private secret';
  assert.throws(() => v.validateIncomingMessage(input), error => error instanceof v.MessagingValidationError && !error.message.includes('private secret'));
});

test('outgoing conversation guard blocks foreign destinations and human-control races', () => {
  const out = { delivery_id: id(10), context: context(), conversation_id: id(5), chat_id: 'opaque-chat', expected_control_epoch: 0, content: { kind: 'text', text: 'Resposta' } };
  v.assertOutgoingConversation(out, conversation(), session(), context());
  for (const change of [{ conversation_id: id(99) }, { chat_id: 'foreign-chat' }, { expected_control_epoch: 1 }]) reject(() => v.assertOutgoingConversation({ ...out, ...change }, conversation(), session(), context()));
  const c = conversation(); c.step = { name: 'HUMAN' }; c.control.mode = 'human';
  reject(() => v.assertOutgoingConversation(out, c, session(), context()));
});

test('non-JSON objects and sparse arrays cannot bypass structural validation', () => {
  const c = cart(); c.lines = new Array(1); c.lines.extra = {};
  reject(() => v.validateConversationCart(c));
  const m = menu(); m.options[Symbol('hidden')] = true;
  reject(() => v.validateNumericMenu(m));
  const input = Object.create(message()); reject(() => v.validateIncomingMessage(input));
  const a = address(); Object.defineProperty(a, 'extra', { value: 'hidden' });
  reject(() => v.validateDeliveryAddress(a));
});
