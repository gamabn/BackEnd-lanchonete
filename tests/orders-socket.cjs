const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { io: connect } = require('../../Lanchonete_App/node_modules/socket.io-client');
const { sign, verify } = require('jsonwebtoken');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require('ts-node/register');
const { configureOrdersSocket, createOrdersTicket, restaurantRoom } = require('../src/socket/orders');

process.env.JWT_SECRET = 'isolated-test-secret';
test('newOrder routes using the persisted owner after atomic checkout', async () => {
  const persisted = { order_id: 'order-a', restaurant_id: 'A', customer: { name: 'Customer' } };
  const emissions = [];
  const mocks = {
    '../../service/order/OrderSalesService': { OrderSalesService: class {
      async execute(data) {
        assert.equal(data.customer_id, 'customer-a'); assert.equal(data.restaurant_id, 'A');
        return { order: { id: 'order-a', restaurant_id: 'A', customer_id: 'customer-a' }, fullOrder: persisted };
      }
    } },
    '../../service/order/orderValidation': { OrderValidationError: class extends Error {} },
    '../../socket/chat': { customerChatCredential: () => 'chat-token' },
    '../../socket/orders': { restaurantRoom },
    '../../server': { io: { of: namespace => {
      assert.equal(namespace, '/orders');
      return { to: room => ({ emit: (event, data) => emissions.push({ room, event, data }) }) };
    } } },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/controller/order/OrderSalesController.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, console: { error() {} }, require: name => { assert.ok(name in mocks, name); return mocks[name]; } });
  const response = { locals: { customerPrincipal: { type: 'customer', customerId: 'customer-a', restaurantId: 'A' } },
    set() { return this; }, status(code) { assert.equal(code, 201); return this; }, json(data) { assert.equal(data.fullOrder, persisted); } };
  await new exports.OrderSalesController().handle({ params: { id: 'A' }, body: {} }, response);
  assert.equal(emissions.length, 1); assert.equal(emissions[0].room, restaurantRoom('A'));
  assert.equal(emissions[0].event, 'newOrder'); assert.equal(emissions[0].data, persisted);
});
function ticket(id) {
  let result;
  createOrdersTicket({ user_id: id }, { set: () => ({ json: value => { result = value.ticket; } }) });
  return result;
}
const delay = () => new Promise(resolve => setTimeout(resolve, 100));
function connected(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
}

test('orders namespace isolates tenants, rejects unauthorized access and reconnects', { timeout: 10000 }, async t => {
  const http = createServer();
  const server = new Server(http);
  configureOrdersSocket(server);
  // The existing public chat namespace remains independently available.
  server.on('connection', socket => socket.on('joinRoom', room => socket.join(room)));
  try {
    await new Promise((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    server.close();
    t.skip('Sandbox does not permit listening on localhost');
    return;
  }
  const url = `http://127.0.0.1:${http.address().port}`;
  const sockets = [];
  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await new Promise(resolve => server.close(resolve));
  });
  function client(auth, namespace = '/orders') {
    const socket = connect(url + namespace, { autoConnect: false, forceNew: true, reconnection: false, auth });
    sockets.push(socket);
    return socket;
  }
  const a = client({ ticket: ticket('A'), restaurantId: 'B' });
  const b = client({ ticket: ticket('B') });
  const receivedA = [], receivedB = [];
  a.on('newOrder', order => receivedA.push(order));
  b.on('newOrder', order => receivedB.push(order));
  await Promise.all([connected(a), connected(b)]);
  // No client-controlled event may select a tenant room.
  a.emit('joinRoom', restaurantRoom('B'));
  a.emit('joinRestaurant', 'B');
  await delay();
  const orderA = { order_id: 'a1', restaurant_id: 'A' };
  const orderB = { order_id: 'b1', restaurant_id: 'B' };
  server.of('/orders').to(restaurantRoom('A')).emit('newOrder', orderA);
  server.of('/orders').to(restaurantRoom('B')).emit('newOrder', orderB);
  await delay();
  assert.deepEqual(receivedA, [orderA]);
  assert.deepEqual(receivedB, [orderB]);

  for (const auth of [{}, { ticket: 'forged' }, { ticket: sign({}, process.env.JWT_SECRET, { subject: 'B' }) }]) {
    await assert.rejects(connected(client(auth)), /Não autorizado/);
  }
  assert.throws(() => verify(ticket('A'), process.env.JWT_SECRET));

  const publicSocket = client({}, '');
  const publicOrders = [];
  publicSocket.on('newOrder', order => publicOrders.push(order));
  await connected(publicSocket);
  publicSocket.emit('joinRoom', restaurantRoom('A'));
  await delay();
  server.of('/orders').to(restaurantRoom('A')).emit('newOrder', orderA);
  await delay();
  assert.deepEqual(publicOrders, []);

  a.disconnect();
  a.auth = { ticket: ticket('A') };
  await connected(a);
  await delay();
  const reconnectedOrder = { order_id: 'a2', restaurant_id: 'A' };
  server.of('/orders').to(restaurantRoom('A')).emit('newOrder', reconnectedOrder);
  await delay();
  assert.deepEqual(receivedA.at(-1), reconnectedOrder);
  assert.deepEqual(receivedB, [orderB]);
});

test('authorization and tenant routing work without network access', async () => {
  let authorize, onConnection;
  const members = new Map();
  const namespace = {
    use: middleware => { authorize = middleware; },
    on: (event, handler) => { assert.equal(event, 'connection'); onConnection = handler; },
  };
  configureOrdersSocket({ of: name => { assert.equal(name, '/orders'); return namespace; } });
  function open(auth) {
    let failure;
    const rooms = new Set();
    const events = new Map();
    const received = [];
    const socket = {
      handshake: { auth }, data: {}, join: room => rooms.add(room),
      on: (event, handler) => events.set(event, handler),
      disconnect: () => { rooms.clear(); events.get('disconnect')?.(); members.delete(socket); },
    };
    authorize(socket, error => { failure = error; });
    if (!failure) { members.set(socket, { rooms, received }); onConnection(socket); }
    return { socket, received, failure, events };
  }
  const a = open({ ticket: ticket('A'), restaurantId: 'B' });
  const b = open({ ticket: ticket('B') });
  try {
    assert.equal(a.failure, undefined);
    assert.equal(b.failure, undefined);
    assert.ok(open({}).failure);
    assert.ok(open({ ticket: 'forged' }).failure);
    assert.ok(open({ ticket: sign({}, process.env.JWT_SECRET, { subject: 'B' }) }).failure);
    assert.throws(() => verify(ticket('A'), process.env.JWT_SECRET));
    assert.equal(a.events.has('joinRoom'), false);
    assert.equal(a.events.has('joinRestaurant'), false);
    function emit(id) {
      for (const { rooms, received } of members.values()) {
        if (rooms.has(restaurantRoom(id))) received.push(id);
      }
    }
    emit('A'); emit('B');
    assert.deepEqual(a.received, ['A']);
    assert.deepEqual(b.received, ['B']);
    a.socket.disconnect();
    const reconnected = open({ ticket: ticket('A') });
    emit('A');
    assert.deepEqual(reconnected.received, ['A']);
    assert.deepEqual(b.received, ['B']);
    reconnected.socket.disconnect();
  } finally {
    a.socket.disconnect(); b.socket.disconnect();
  }
});
