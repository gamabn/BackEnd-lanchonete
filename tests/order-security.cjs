const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: name => { assert.ok(name in mocks, name); return mocks[name]; }, console: { error() {} } });
  return exports;
}
const validation = load('src/service/order/orderValidation.ts', {});
const input = () => ({ items: [{ product_id: 'p1', quantity: 2 }], bairro_id: 'area-A', payment_method: 'Dinheiro', change_for: '50.00' });
function harness(options = {}) {
  const trace = [], inserted = [];
  let saved, committed = false, released = false, rolledBack = false;
  const products = options.products || [{ id: 'p1', item_price: '12.50', available: true }];
  const client = {
    release() { released = true; },
    async query(sql, params = []) {
      trace.push({ sql, params });
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'ROLLBACK') { rolledBack = true; inserted.length = 0; saved = undefined; return { rows: [] }; }
      if (sql === 'COMMIT') { if (options.failCommit) throw new Error('Commit failed'); committed = true; return { rows: [] }; }
      if (sql.startsWith('SELECT status')) { assert.match(sql, /FOR SHARE/); return { rows: [{ status: options.open !== false }] }; }
      if (sql.startsWith('SELECT neighborhood')) {
        assert.equal(params[1], 'A'); assert.match(sql, /restaurant_id::text = \$2 FOR SHARE/);
        return { rows: options.wrongCustomer || params[0] !== 'alice' ? [] : [{ neighborhood: 'Centro' }] };
      }
      if (sql.includes('FROM bairros')) {
        assert.match(sql, /lanchonete_id::text = \$2/); assert.match(sql, /lower\(btrim\(bairro\)\)/); assert.match(sql, /frete::numeric/); assert.match(sql, /FOR SHARE/);
        assert.equal(params[1], 'A'); assert.equal(params[2], 'Centro');
        return { rows: params[0] !== 'area-A' ? [] : [{ delivery_fee: options.fee === undefined ? '5.00' : options.fee }] };
      }
      if (sql.includes('FROM products p')) {
        assert.match(sql, /p.restaurant_id::text = \$1/); assert.match(sql, /round\(p.price::numeric, 2\)/); assert.match(sql, /FOR SHARE/);
        assert.match(sql, /to_jsonb\(p\) \? 'available'/); assert.doesNotMatch(sql, /p\.available/);
        assert.equal(params[0], 'A'); return { rows: products.filter(product => params[1].includes(product.id)) };
      }
      if (sql.startsWith('INSERT INTO orders')) {
        assert.match(sql, /'pending'/); assert.match(sql, /\$3::numeric/);
        saved = { id: 'order-A', restaurant_id: params[0], customer_id: params[1], status: 'pending', total_price: params[2], payment_method: params[3], change_for: params[4] };
        return { rows: [saved], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO order_items')) {
        assert.match(sql, /\$4::numeric/);
        if (options.failItem === inserted.length) throw new Error('Item insert failed');
        inserted.push({ order_id: params[0], product_id: params[1], quantity: params[2], item_price: params[3] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO chats')) {
        if (options.failChat) throw new Error('Chat insert failed');
        return { rows: [{ id: 'chat-A', order_id: params[0], restaurant_id: params[1] }], rowCount: 1 };
      }
      if (sql.includes('FROM orders o')) {
        assert.equal(committed, false); assert.equal(params[0], 'order-A');
        return { rows: [{ order_id: saved.id, restaurant_id: saved.restaurant_id, customer: { id: 'alice' }, total_price: Number(saved.total_price), items: inserted.slice() }] };
      }
      assert.fail(`Unexpected SQL ${sql}`);
    },
  };
  const pool = { connect: async () => client, query: async () => assert.fail('Read escaped the transaction') };
  const itemService = load('src/service/order_item/CreateOrderItemSerice.ts', {});
  const readService = load('src/service/order_item/GetOrderItemService.ts', { '../../database': { pool } });
  const { OrderSalesService } = load('src/service/order/OrderSalesService.ts', {
    '../../database': { pool }, '../order_item/CreateOrderItemSerice': itemService,
    '../order_item/GetOrderItemService': readService, './orderValidation': validation,
  });
  const service = new OrderSalesService();
  return { service, trace, inserted, execute: data => service.execute({ restaurant_id: 'A', customer_id: 'alice', input: data }),
    get committed() { return committed; }, get released() { return released; }, get rolledBack() { return rolledBack; }, get saved() { return saved; } };
}
function response() { return { locals: { customerPrincipal: { type: 'customer', customerId: 'alice', restaurantId: 'A' } }, statusCode: 200,
  set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function controller(h, failEmit = false) {
  const emissions = [];
  const { OrderSalesController } = load('src/controller/order/OrderSalesController.ts', {
    '../../service/order/OrderSalesService': { OrderSalesService: class { execute(args) { return h.service.execute(args); } } },
    '../../service/order/orderValidation': validation,
    '../../socket/chat': { customerChatCredential: (order, customer) => `chat:${order}:${customer}` },
    '../../socket/orders': { restaurantRoom: id => `restaurant:${id}` },
    '../../server': { io: { of: namespace => {
      assert.equal(namespace, '/orders');
      return { to: room => ({ emit: (event, order) => {
        assert.equal(h.committed, true); h.trace.push({ sql: 'EMIT' });
        if (failEmit) throw new Error('Socket failed'); emissions.push({ room, event, order });
      } }) };
    } } },
  });
  return { handle: (...args) => new OrderSalesController().handle(...args), emissions };
}

test('current database unit prices and delivery fee determine totals and cash change exactly', async () => {
  const h = harness(); const result = await h.execute(input());
  assert.equal(result.subtotal, '25.00'); assert.equal(result.delivery_fee, '5.00');
  assert.equal(result.order.total_price, '30.00'); assert.equal(result.order.status, 'pending'); assert.equal(result.change_due, '20.00');
  assert.equal(h.inserted[0].item_price, '12.50'); assert.equal(h.committed, true); assert.equal(h.released, true);
});

test('BigInt cents avoid 0.1 + 0.2 errors, support zero delivery and preserve large exact totals', async () => {
  const h = harness({ fee: '0.00', products: [{ id: 'p1', item_price: '0.10', available: true }, { id: 'p2', item_price: '0.20', available: true }] });
  const result = await h.execute({ ...input(), payment_method: 'Pix', change_for: '0', items: [{ product_id: 'p1', quantity: 1 }, { product_id: 'p2', quantity: 1 }] });
  assert.equal(result.order.total_price, '0.30'); assert.equal(result.change_due, '0.00');
  assert.equal(validation.moneyText(validation.moneyCents('9007199254740993.01')), '9007199254740993.01');
});

for (const [name, mutate] of [
  ['item_price', data => { data.items[0].item_price = '0.01'; }],
  ['total_price', data => { data.total_price = '0.01'; }],
  ['frete', data => { data.frete = '0.00'; }],
  ['customer_id', data => { data.customer_id = 'bob'; }],
  ['status', data => { data.status = 'completed'; }],
  ['restaurant_id', data => { data.restaurant_id = 'B'; }],
]) test(`caller-controlled ${name} cannot alter a new order`, async () => {
  const h = harness(); const data = input(); mutate(data);
  await assert.rejects(h.execute(data), error => error instanceof validation.OrderValidationError);
  assert.equal(h.saved, undefined); assert.equal(h.committed, false);
});

for (const quantity of [0, -1, 0.5, '2', null, undefined, NaN, Infinity, 2147483648]) {
  test(`invalid quantity ${String(quantity)} is rejected`, async () => {
    const h = harness(); const data = input(); data.items[0].quantity = quantity;
    await assert.rejects(h.execute(data)); assert.equal(h.committed, false); assert.equal(h.saved, undefined);
  });
}

test('empty orders, duplicate products and missing delivery selection are rejected', async () => {
  for (const data of [{ ...input(), items: [] }, { ...input(), items: [...input().items, ...input().items] }, { ...input(), bairro_id: '' }]) {
    const h = harness(); await assert.rejects(h.execute(data)); assert.equal(h.committed, false);
  }
});

test('foreign or missing products are rejected with rollback', async () => {
  const h = harness(); const data = input(); data.items[0].product_id = 'product-B';
  await assert.rejects(h.execute(data), /outro estabelecimento/); assert.equal(h.rolledBack, true); assert.equal(h.saved, undefined);
});
test('unavailable products, closed stores and invalid legacy fees cannot be ordered', async () => {
  for (const opts of [{ open: false }, { products: [{ id: 'p1', item_price: '12.50', available: false }] }, { fee: null }, { fee: '-1.00' }, { fee: 'NaN' }]) {
    const h = harness(opts); await assert.rejects(h.execute(input())); assert.equal(h.committed, false); assert.equal(h.rolledBack, true);
  }
});
test('a customer from another establishment cannot create an order', async () => {
  const h = harness({ wrongCustomer: true });
  await assert.rejects(h.execute(input()), error => error.status === 403); assert.equal(h.rolledBack, true);
});
test('another establishment\'s neighborhood and orphaned delivery rows never authorize a fee', async () => {
  const h = harness(); const data = { ...input(), bairro_id: 'area-B' };
  await assert.rejects(h.execute(data), /Bairro não autorizado/); assert.equal(h.rolledBack, true);
});
test('cash must cover the current server total and non-cash payments cannot request change', async () => {
  for (const data of [{ ...input(), change_for: '29.99' }, { ...input(), payment_method: 'Pix', change_for: '50' }, { ...input(), change_for: '-1' }, { ...input(), payment_method: 'unknown' }]) {
    const h = harness(); await assert.rejects(h.execute(data)); assert.equal(h.committed, false);
  }
  for (const method of ['Dinheiro', 'Cartao', 'Pix']) {
    const h = harness(); assert.equal((await h.execute({ ...input(), payment_method: method, change_for: '0' })).order.payment_method, method);
  }
});
test('item, chat or commit failure rolls back and emits no event', async () => {
  for (const opts of [{ failItem: 0 }, { failItem: 1 }, { failChat: true }, { failCommit: true }]) {
    const h = harness({ ...opts, products: [{ id: 'p1', item_price: '1.00', available: true }, { id: 'p2', item_price: '2.00', available: true }] });
    const data = { ...input(), items: [{ product_id: 'p1', quantity: 1 }, { product_id: 'p2', quantity: 1 }] };
    const c = controller(h), res = response(); await c.handle({ params: { id: 'A' }, body: data }, res);
    assert.equal(res.statusCode, 503); assert.equal(c.emissions.length, 0); assert.equal(h.rolledBack, true);
    assert.equal(h.saved, undefined); assert.equal(h.inserted.length, 0); assert.equal(h.released, true);
  }
});
test('newOrder and chat credential become available only after transaction commit', async () => {
  const h = harness(), c = controller(h), res = response();
  await c.handle({ params: { id: 'A' }, body: input() }, res);
  assert.equal(res.statusCode, 201); assert.equal(res.body.chat_credential, 'chat:order-A:alice');
  assert.equal(c.emissions.length, 1); assert.equal(c.emissions[0].room, 'restaurant:A');
  assert.equal(c.emissions[0].event, 'newOrder'); assert.equal(c.emissions[0].order.restaurant_id, 'A');
  assert.ok(h.trace.findIndex(item => item.sql === 'COMMIT') < h.trace.findIndex(item => item.sql === 'EMIT'));
});
test('notification failure does not turn a committed order into a failed checkout', async () => {
  const h = harness(), c = controller(h, true), res = response();
  await c.handle({ params: { id: 'A' }, body: input() }, res);
  assert.equal(res.statusCode, 201); assert.equal(h.committed, true);
});
test('checkout rejects an administrative principal or mismatched establishment before SQL', async () => {
  for (const actor of [{ type: 'restaurant', restaurantId: 'A' }, { type: 'customer', restaurantId: 'B', customerId: 'bob' }]) {
    const h = harness(), c = controller(h), res = response(); res.locals.customerPrincipal = actor;
    await c.handle({ params: { id: 'A' }, body: input() }, res);
    assert.equal(res.statusCode, 403); assert.equal(h.trace.length, 0);
  }
});
test('legacy separate-item insertion cannot mutate orders or emit events', async () => {
  const { CreateOrderItemController } = load('src/controller/order_item/CreateOrderItemController.ts', {});
  const res = response(); await new CreateOrderItemController().handle({ body: [{ order_id: 'victim', item_price: 0 }] }, res);
  assert.equal(res.statusCode, 409);
});
test('status changes and whole-order deletion require administrative tenant ownership', async () => {
  let changed = false;
  const { UpdateOrderService } = load('src/service/order/UpdateOrderService.ts', { '../../database': { pool: { query: async (sql, params) => {
    assert.match(sql, /WHERE id = \$2 AND restaurant_id = \$3/); assert.equal(params[2], 'B'); return { rows: [] };
  } } } });
  assert.equal(await new UpdateOrderService().execute({ id: 'order-A', status: 'completed', restaurant_id: 'B' }), undefined);
  const { DeleteOrderService } = load('src/service/order_item/DeleteOrderService.ts', { '../../database': { pool: { connect: async () => ({ release() {}, query: async (sql, params) => {
    if (sql.startsWith('SELECT')) { assert.match(sql, /restaurant_id = \$2 FOR UPDATE/); assert.equal(params[1], 'B'); return { rows: [] }; }
    if (sql.startsWith('DELETE')) changed = true;
    return { rows: [] };
  } }) } } });
  assert.equal(await new DeleteOrderService().execute('order-A', 'B'), undefined); assert.equal(changed, false);
  const routes = fs.readFileSync('src/routes.ts', 'utf8');
  assert.match(routes, /post\("\/order\/:id", customerAccess,/);
  assert.match(routes, /patch\("\/order", isAuthentication,/); assert.match(routes, /delete\("\/order_item", isAuthentication,/);
});
test('authorized deletion removes dependents in one transaction and rolls back on a failure', async () => {
  for (const fail of [false, true]) {
    const trace = []; let released = false;
    const { DeleteOrderService } = load('src/service/order_item/DeleteOrderService.ts', { '../../database': { pool: { connect: async () => ({
      release() { released = true; }, async query(sql, params = []) {
        trace.push(sql);
        if (sql.startsWith('SELECT')) return { rows: [{ id: 'order-A' }] };
        if (sql.startsWith('DELETE')) { assert.equal(params[0], 'order-A'); assert.equal(params[1], 'A'); }
        if (fail && sql.startsWith('DELETE FROM order_items')) throw new Error('Dependency failure');
        return { rows: [], rowCount: 1 };
      },
    }) } } });
    const action = new DeleteOrderService().execute('order-A', 'A');
    if (fail) { await assert.rejects(action); assert.equal(trace.at(-1), 'ROLLBACK'); assert.equal(trace.includes('COMMIT'), false); }
    else { assert.equal((await action).message, 'Pedido excluído com sucesso'); assert.equal(trace.at(-1), 'COMMIT'); }
    assert.equal(released, true);
    assert.ok(trace.findIndex(sql => sql.startsWith('DELETE FROM chat_messages')) < trace.findIndex(sql => sql.startsWith('DELETE FROM chats')));
  }
});
