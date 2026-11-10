const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const jwt = require('jsonwebtoken');
const secret = 'chat-test-secret';
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => {
    if (name in mocks) return mocks[name];
    if (['crypto', 'jsonwebtoken'].includes(name)) return require(name);
    throw new Error(name);
  }, process: { env: { JWT_SECRET: secret } }, Date, Map, setTimeout, clearTimeout, console: { log() {}, error() {} } });
  return exports;
}
const chats = [
  { chat_id: 'cc', order_id: 'oc', restaurant_id: 'A', customer_id: 'carol', customer_name: 'Carol', restaurant_name: 'A' },
  { chat_id: 'cd', order_id: 'od', restaurant_id: 'A', customer_id: 'alice', customer_name: 'Alice', restaurant_name: 'A' },
  { chat_id: 'ca', order_id: 'oa', restaurant_id: 'A', customer_id: 'alice', customer_name: 'Alice', restaurant_name: 'A' },
  { chat_id: 'cb', order_id: 'ob', restaurant_id: 'B', customer_id: 'bob', customer_name: 'Bob', restaurant_name: 'B' },
];
const h = load('src/socket/chat.ts', { '../database': { pool: { query: async (sql, params) => {
  assert.match(sql, /cu.restaurant_id = o.restaurant_id/);
  assert.match(sql, /c.restaurant_id = o.restaurant_id/);
  const customer = /o.customer_id = \$2/.test(sql);
  return { rows: chats.filter(c => c[/WHERE o.id/.test(sql) ? 'order_id' : 'chat_id'] === params[0] &&
    (customer ? c.customer_id === params[1] && c.order_id === params[2] : c.restaurant_id === params[1])) };
} } } });
const owner = id => jwt.sign({}, secret, { subject: id, expiresIn: '1h' });
function response() { return { locals: {}, statusCode: 200, set() { return this; }, status(n) { this.statusCode = n; return this; }, json(data) { this.body = data; return this; } }; }
async function guard(token, params = {}, body = {}, method = 'GET') {
  const res = response(); let passed = false;
  await h.chatGuard({ headers: { authorization: token && `Bearer ${token}` }, params, body, method }, res, () => { passed = true; });
  return { res, passed };
}
test('HTTP denies anonymous access, cross-tenant access and customer access to another order', async () => {
  assert.equal((await guard('', { chat_id: 'ca' })).res.statusCode, 401);
  assert.equal((await guard(owner('A'), { chat_id: 'ca' })).passed, true);
  assert.equal((await guard(owner('A'), { chat_id: 'cb' })).res.statusCode, 403);
  assert.equal((await guard(owner('B'), { chat_id: 'ca' })).res.statusCode, 403);
  const token = h.customerChatCredential('oa', 'alice');
  assert.equal((await guard(token, { order_id: 'oa' })).passed, true);
  assert.equal((await guard(token, { chat_id: 'cb' })).res.statusCode, 403);
  assert.equal((await guard(token, { chat_id: 'cc' })).res.statusCode, 403);
  assert.equal((await guard(token, { chat_id: 'cd' })).res.statusCode, 403);
  assert.equal((await guard(token, { order_id: 'ob' })).res.statusCode, 403);
  assert.equal((await guard(token, { order_id: 'oa' }, {}, 'DELETE')).res.statusCode, 403);
  assert.throws(() => h.authenticateChat(token + 'bad'));
  assert.throws(() => jwt.verify(token, secret));
});
test('list service scopes its SQL to the authenticated restaurant', async () => {
  const { GetAllChatService } = load('src/service/message/GetAllChatService.ts', { '../../database': { pool: { query: async (sql, params) => {
    assert.match(sql, /WHERE o.restaurant_id = \$1/); assert.deepEqual(Array.from(params), ['A']); return { rows: [chats[0]] };
  } } } });
  assert.deepEqual(await new GetAllChatService().execute('A'), [chats[0]]);
});
test('socket rooms authorize tickets, isolate typing/messages and support authorized reconnection', async () => {
  let connection; const sockets = [];
  h.configureChatSocket({ on: (event, callback) => { connection = callback; } });
  function socket() {
    const handlers = new Map(), rooms = new Set(), received = [];
    const s = { connected: true, handlers, rooms, received, on: (e, fn) => handlers.set(e, fn),
      join: async r => rooms.add(r), leave: async r => rooms.delete(r), emit: (e, data) => received.push({ e, data }),
      to: r => ({ emit: (e, data) => sockets.forEach(other => { if (other !== s && other.rooms.has(r)) other.received.push({ e, data }); }) }) };
    sockets.push(s); connection(s); return s;
  }
  async function ticket(token, chat_id) { const { res, passed } = await guard(token, {}, { chat_id }, 'POST'); assert.ok(passed); h.chatTicket({}, res); return res.body.ticket; }
  const join = (s, ticket) => new Promise(resolve => s.handlers.get('joinRoom')({ ticket, chatId: 'cb' }, resolve));
  const a = socket(), customer = socket(), b = socket(), anonymous = socket();
  try {
    const ta = await ticket(owner('A'), 'ca');
    const tc = await ticket(h.customerChatCredential('oa', 'alice'), 'ca');
    assert.ok((await join(a, ta)).ok);
    assert.ok((await join(customer, tc)).ok);
    assert.ok((await join(b, await ticket(owner('B'), 'cb'))).ok);
    assert.equal((await join(anonymous, 'fake')).ok, false);
    await anonymous.handlers.get('joinRoom')('ca'); assert.equal(anonymous.rooms.size, 0);
    assert.equal(a.rooms.has(h.chatRoom('cb')), false);
    a.handlers.get('typing')({ chatId: 'ca', sender_id: 'bob', isTyping: true });
    assert.equal(customer.received.at(-1).data.sender_id, 'A');
    assert.equal(customer.received.at(-1).data.sender_type, 'restaurant');
    b.handlers.get('typing')({ chatId: 'ca', isTyping: true });
    assert.equal(customer.received.length, 1);
    a.to(h.chatRoom('ca')).emit('newMessage', { message: 'Hello' });
    assert.equal(customer.received.at(-1).e, 'newMessage');
    assert.equal(b.received.length, 0); assert.equal(anonymous.received.length, 0);
    customer.handlers.get('disconnect')(); customer.rooms.clear();
    assert.ok((await join(customer, tc)).ok);
    a.to(h.chatRoom('ca')).emit('newMessage', { message: 'Reconnected' });
    assert.equal(customer.received.at(-1).data.message, 'Reconnected');
  } finally { sockets.forEach(s => s.handlers.get('disconnect')()); }
});
test('message sender identity and emitted room come exclusively from authorization', async () => {
  let saved, room;
  const { MessagePostController } = load('src/controller/message/MessaPostController.ts', {
    '../../socket/chat': { chatRoom: h.chatRoom },
    '../../service/message/CreateMessageService': { CreateMessageService: class { async execute(data) { saved = data; return { rows: [data] }; } } },
    '../../server': { io: { to: r => { room = r; return { emit() {} }; } } },
  });
  const res = response(); res.locals = { chatActor: { type: 'customer', id: 'alice' }, authorizedChat: chats.find(c => c.chat_id === 'ca') };
  await new MessagePostController().handle({ body: { chat_id: 'cb', sender_id: 'B', sender_type: 'restaurant', name: 'Fake', message: 'Hello' } }, res);
  assert.equal(saved.sender_id, 'alice'); assert.equal(saved.sender_type, 'customer'); assert.equal(saved.name, 'Alice');
  assert.equal(saved.chat_id, 'ca'); assert.equal(room, h.chatRoom('ca'));
});

test('order creation adds only a chat credential bound to the newly persisted order', async () => {
  const persisted = { order: { id: 'oa', customer_id: 'alice', restaurant_id: 'A' }, chat: { id: 'ca' } };
  const { OrderSalesController } = load('src/controller/order/OrderSalesController.ts', {
    '../../socket/chat': { customerChatCredential: h.customerChatCredential },
    '../../socket/orders': { restaurantRoom: id => `restaurant:${id}` },
    '../../server': { io: { of: () => ({ to: () => ({ emit() {} }) }) } },
    '../../service/order/orderValidation': { OrderValidationError: class extends Error {} },
    '../../service/order/OrderSalesService': { OrderSalesService: class { async execute() { return persisted; } } },
  });
  const res = response(); res.locals.customerPrincipal = { type: 'customer', customerId: 'alice', restaurantId: 'A' };
  await new OrderSalesController().handle({ params: { id: 'A' }, body: {} }, res);
  assert.equal(res.body.order, persisted.order);
  const actor = h.authenticateChat(res.body.chat_credential);
  assert.equal(actor.type, 'customer'); assert.equal(actor.id, 'alice'); assert.equal(actor.orderId, 'oa');
});
