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
const productA = '00000000-0000-4000-8000-000000000001';
const productB = '00000000-0000-4000-8000-000000000002';
const foreignProduct = '00000000-0000-4000-8000-000000000003';
const areaA = '00000000-0000-4000-8000-000000000004';
const areaB = '00000000-0000-4000-8000-000000000005';
const input = () => ({ items: [{ product_id: productA, quantity: 2 }], bairro_id: areaA, payment_method: 'Dinheiro', change_for: '50.00' });
function harness(options = {}) {
  const trace = [], inserted = [], insertedOptions = [];
  const tenant = options.restaurantId || 'A';
  const customerId = options.customerId || 'alice';
  const store = options.store || { status: options.open !== false, name: `Restaurante ${tenant}`, street: `Rua Loja ${tenant}`, number: '123', neighborhood: 'Bairro Loja', city: 'Cidade Loja' };
  let saved, committed = false, released = false, rolledBack = false;
  const products = options.products || [{ id: productA, item_price: '12.50', available: true }];
  const address = options.address || { city: 'Cidade A', street: 'Rua A', number: '10', neighborhood: 'Centro', complement: null };
  const client = {
    release() { released = true; },
    async query(sql, params = []) {
      trace.push({ sql, params });
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'ROLLBACK') { rolledBack = true; inserted.length = 0; insertedOptions.length = 0; saved = undefined; return { rows: [] }; }
      if (sql === 'COMMIT') { if (options.failCommit) throw new Error('Commit failed'); committed = true; return { rows: [] }; }
      if (options.failQuery && sql.includes(options.failQuery)) throw new Error('Database read failed');
      if (sql.startsWith('SELECT status')) { assert.match(sql, /WHERE id::text = \$1 FOR SHARE/); assert.equal(params[0], tenant); return { rows: options.missingStore ? [] : [{ ...store }] }; }
      if (sql.startsWith('SELECT city, street, number, neighborhood, complement FROM customers')) {
        assert.equal(params[1], tenant); assert.match(sql, /restaurant_id::text = \$2 FOR SHARE/);
        return { rows: options.wrongCustomer || params[0] !== customerId ? [] : [{ ...address }] };
      }
      if (sql.includes('FROM bairros')) {
        assert.match(sql, /lanchonete_id::text = \$2/); assert.match(sql, /lower\(btrim\(bairro\)\)/); assert.match(sql, /frete::numeric/); assert.match(sql, /FOR SHARE/);
        assert.equal(params[1], tenant); assert.equal(params[2], 'Centro');
        return { rows: params[0] !== areaA ? [] : [{ delivery_fee: options.fee === undefined ? '5.00' : options.fee }] };
      }
      if (sql.includes('FROM public.products p')) {
        assert.match(sql, /p.restaurant_id::text = \$1/); assert.match(sql, /round\(p.price::numeric, 2\)/); assert.match(sql, /FOR SHARE/);
        assert.match(sql, /p\.published = TRUE/); assert.match(sql, /p\.available/); assert.match(sql, /AS has_variants/);
        assert.equal(params[0], tenant); return { rows: products.filter(product => params[1].includes(product.id)) };
      }
      if (sql.includes('FROM public.products')) {
        assert.match(sql, /restaurant_id = \$2/);
        assert.equal(params[1], tenant);
        return { rows: products.filter(product => product.id === params[0] && product.available) };
      }
      if (sql.includes('FROM public.product_variants')) {
        assert.match(sql, /product_id = \$2/);
        return { rows: (options.variants || []).filter(variant => variant.id === params[0] && variant.product_id === params[1] && variant.available) };
      }
      if (sql.includes('FROM public.product_option_groups')) return { rows: options.groups || [] };
      if (sql.includes('FROM public.product_variant_group_limits')) return { rows: options.limits || [] };
      if (sql.includes('FROM public.product_options')) {
        assert.match(sql, /pog.product_id = \$1/);
        return { rows: (options.options || []).filter(option => option.product_id === params[0] && option.available && params[1].includes(option.id)) };
      }
      if (sql.includes('INSERT INTO public.order_item_options')) {
        if (options.failOption) throw new Error('Option insert failed');
        insertedOptions.push(Array.from(params));
        return { rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO orders')) {
        assert.match(sql, /'pending'/); assert.match(sql, /\$3::numeric/);
        assert.match(sql, /delivery_address, fulfillment_type, subtotal, delivery_fee, bairro_id, pickup_address\)/); assert.match(sql, /\$6::jsonb/);
        if (params[6] === 'DELIVERY') {
          assert.deepEqual(JSON.parse(params[5]), address); assert.equal(params[10], null); assert.equal(params[9], areaA);
        } else {
          assert.equal(params[5], null); assert.equal(params[9], null); assert.equal(params[8], '0.00');
          assert.equal(params[2], params[7]); assert.equal(JSON.parse(params[10]).name, store.name.trim());
        }
        saved = { id: 'order-A', restaurant_id: params[0], customer_id: params[1], status: 'pending', total_price: params[2], payment_method: params[3], change_for: params[4], fulfillment_type: params[6], subtotal: params[7], delivery_fee: params[8], pickup_address: params[10] ? JSON.parse(params[10]) : null };
        return { rows: [saved], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO public.order_items')) {
        assert.match(sql, /\$4::numeric/);
        if (params[1] === productA && options.variants) {
          assert.ok(options.variants.some(variant => variant.id === params[4]));
        } else {
          assert.equal(params[4], null); assert.equal(params[5], null);
        }
        if (options.failItem === inserted.length) throw new Error('Item insert failed');
        inserted.push({ order_id: params[0], product_id: params[1], quantity: params[2], item_price: params[3] });
        return { rows: [{ id: 'order-item' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO chats')) {
        if (options.failChat) throw new Error('Chat insert failed');
        return { rows: [{ id: 'chat-A', order_id: params[0], restaurant_id: params[1] }], rowCount: 1 };
      }
      if (sql.includes('FROM public.orders o')) {
        assert.equal(committed, false); assert.equal(params[0], 'order-A');
        if (options.failRead) return { rows: [] };
        return { rows: [{ fulfillment_type: saved.fulfillment_type, pickup_address: saved.pickup_address, order_id: saved.id, restaurant_id: saved.restaurant_id, customer: { id: 'alice' }, total_price: Number(saved.total_price), items: inserted.slice() }] };
      }
      assert.fail(`Unexpected SQL ${sql}`);
    },
  };
  const pool = { connect: async () => client, query: async () => assert.fail('Read escaped the transaction') };
  const itemService = load('src/service/order_item/CreateOrderItemSerice.ts', {});
  const readService = load('src/service/order_item/GetOrderItemService.ts', { '../../database': { pool } });
  const configuredService = load('src/service/productTemplates/ValidateAndPriceConfiguredProductService.ts', {
    '../order/orderValidation': validation,
  });
  const pickupAddress = load('src/service/order/pickupAddress.ts', { './orderValidation': validation });
  const checkoutValidation = load('src/service/order/validateOrderCheckout.ts', {
    './orderValidation': validation, './pickupAddress': pickupAddress,
    '../productTemplates/ValidateAndPriceConfiguredProductService': configuredService,
  });
  const orderPersistence = load('src/service/order/persistValidatedOrder.ts', {
    './orderValidation': validation, '../order_item/CreateOrderItemSerice': itemService,
    '../order_item/GetOrderItemService': readService,
  });
  const { OrderSalesService } = load('src/service/order/OrderSalesService.ts', {
    '../../database': { pool }, '../order_item/CreateOrderItemSerice': itemService,
    '../order_item/GetOrderItemService': readService, './orderValidation': validation,
    '../productTemplates/ValidateAndPriceConfiguredProductService': configuredService, './pickupAddress': pickupAddress,
    './validateOrderCheckout': checkoutValidation, './persistValidatedOrder': orderPersistence,
  });
  const service = new OrderSalesService();
  return { service, trace, inserted, insertedOptions, execute: data => service.execute({ restaurant_id: tenant, customer_id: customerId, input: data }),
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

test('order snapshots the authenticated customer address without changing the response contract', async () => {
  const address = { city: 'Cidade A', street: 'Rua A', number: '10', neighborhood: 'Centro', complement: null };
  const h = harness({ address });
  const result = await h.execute(input());
  const write = h.trace.find(entry => entry.sql.startsWith('INSERT INTO orders'));
  const snapshot = JSON.parse(write.params[5]);
  Object.assign(address, { city: 'Cidade B', street: 'Rua B', number: '20', neighborhood: 'Outro', complement: 'Casa' });
  assert.deepEqual(JSON.parse(write.params[5]), snapshot);
  assert.equal(snapshot.street, 'Rua A');
  assert.equal(snapshot.complement, null);
  assert.equal(Object.hasOwn(result.order, 'delivery_address'), false);
});

test('BigInt cents avoid 0.1 + 0.2 errors, support zero delivery and preserve large exact totals', async () => {
  const h = harness({ fee: '0.00', products: [{ id: productA, item_price: '0.10', available: true }, { id: productB, item_price: '0.20', available: true }] });
  const result = await h.execute({ ...input(), payment_method: 'Pix', change_for: '0', items: [{ product_id: productA, quantity: 1 }, { product_id: productB, quantity: 1 }] });
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
  const h = harness(); const data = input(); data.items[0].product_id = foreignProduct;
  await assert.rejects(h.execute(data), /outro estabelecimento/); assert.equal(h.rolledBack, true); assert.equal(h.saved, undefined);
});
test('unavailable products, closed stores and invalid legacy fees cannot be ordered', async () => {
  for (const opts of [{ open: false }, { products: [{ id: productA, item_price: '12.50', available: false }] }, { fee: null }, { fee: '-1.00' }, { fee: 'NaN' }]) {
    const h = harness(opts); await assert.rejects(h.execute(input())); assert.equal(h.committed, false); assert.equal(h.rolledBack, true);
  }
});
test('a customer from another establishment cannot create an order', async () => {
  const h = harness({ wrongCustomer: true });
  await assert.rejects(h.execute(input()), error => error.status === 403); assert.equal(h.rolledBack, true);
});
test('another establishment\'s neighborhood and orphaned delivery rows never authorize a fee', async () => {
  const h = harness(); const data = { ...input(), bairro_id: areaB };
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
    const h = harness({ ...opts, products: [{ id: productA, item_price: '1.00', available: true }, { id: productB, item_price: '2.00', available: true }] });
    const data = { ...input(), items: [{ product_id: productA, quantity: 1 }, { product_id: productB, quantity: 1 }] };
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
  assert.match(routes, /patch\("\/order", isAuthentication,/); assert.match(routes, /delete\(\s*"\/order_item",\s*isAuthentication,/);
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

const variantA = '00000000-0000-4000-8000-000000000011';
const optionA = '00000000-0000-4000-8000-000000000012';
const optionB = '00000000-0000-4000-8000-000000000013';
const groupA = '00000000-0000-4000-8000-000000000014';

function configuredOptions() {
  return {
    products: [
      { id: productA, item_price: '1.00', has_variants: true, available: true },
      { id: productB, item_price: '5.00', has_variants: false, available: true },
    ],
    variants: [{ id: variantA, product_id: productA, name: 'Grande', price: '15.00', available: true }],
    groups: [{ id: groupA, name: 'Extras', required: true }],
    limits: [{ group_id: groupA, min_select: 1, max_select: 2 }],
    options: [
      { id: optionA, product_id: productA, group_id: groupA, name: 'Grátis', group_name: 'Extras', additional_price: '0.00', available: true },
      { id: optionB, product_id: productA, group_id: groupA, name: 'Pago', group_name: 'Extras', additional_price: '2.50', available: true },
    ],
  };
}

test('configured and mixed orders use current variant and additional prices and store option snapshots atomically', async () => {
  for (const mixed of [false, true]) {
    const h = harness(configuredOptions());
    const items = [{ product_id: productA, quantity: 2, variant_id: variantA, option_ids: [optionA, optionB] }];
    if (mixed) items.push({ product_id: productB, quantity: 1 });
    const result = await h.execute({ ...input(), items });
    assert.equal(result.subtotal, mixed ? '40.00' : '35.00');
    assert.equal(h.inserted[0].item_price, '17.50');
    assert.equal(h.insertedOptions.length, 2);
    assert.equal(h.insertedOptions[0][4], '0.00');
    assert.equal(h.insertedOptions[1][4], '2.50');
    assert.equal(h.committed, true);
  }
});

test('different configurations of the same product create distinct order lines', async () => {
  const h = harness(configuredOptions());
  const result = await h.execute({ ...input(), items: [
    { product_id: productA, quantity: 1, variant_id: variantA, option_ids: [optionA] },
    { product_id: productA, quantity: 1, variant_id: variantA, option_ids: [optionB] },
  ] });
  assert.equal(result.subtotal, '32.50');
  assert.equal(h.inserted.length, 2);
  assert.equal(h.inserted[0].item_price, '15.00');
  assert.equal(h.inserted[1].item_price, '17.50');
});

test('foreign and unavailable selections or size limits abort configured orders without inserting a header', async () => {
  for (const change of [
    config => { config.options[1].product_id = productB; },
    config => { config.options[1].available = false; },
    config => { config.variants[0].available = false; },
    config => { config.variants[0].product_id = productB; },
    config => { config.limits[0].min_select = 3; config.limits[0].max_select = 3; },
    config => { config.limits[0].max_select = 1; },
  ]) {
    const options = configuredOptions();
    change(options);
    const h = harness(options);
    await assert.rejects(h.execute({ ...input(), items: [
      { product_id: productA, quantity: 1, variant_id: variantA, option_ids: [optionA, optionB] },
    ] }), error => error instanceof validation.OrderValidationError);
    assert.equal(h.saved, undefined);
    assert.equal(h.rolledBack, true);
  }
});

test('changed configured prices are recalculated on the server and insufficient cash is rejected', async () => {
  const options = configuredOptions();
  options.variants[0].price = '99.00';
  const h = harness(options);
  await assert.rejects(h.execute({ ...input(), items: [
    { product_id: productA, quantity: 1, variant_id: variantA, option_ids: [optionA] },
  ] }), /troco/);
  assert.equal(h.saved, undefined);
});


test('configured checkout without groups prices the selected variant and stores no additions', async () => {
  const options = configuredOptions();
  options.groups = []; options.limits = []; options.options = [];
  const h = harness(options);
  await h.execute({ ...input(), items: [
    { product_id: productA, quantity: 2, variant_id: variantA, option_ids: [] },
  ] });
  assert.equal(h.committed, true);
  assert.equal(h.saved.total_price, '35.00'); // 2 x current variant price 15.00 + delivery 5.00.
  assert.equal(h.inserted[0].item_price, '15.00');
  assert.equal(h.insertedOptions.length, 0);
});

test('required groups still reject an empty selection during configured checkout', async () => {
  const h = harness(configuredOptions());
  await assert.rejects(h.execute({ ...input(), items: [
    { product_id: productA, quantity: 1, variant_id: variantA, option_ids: [] },
  ] }), /permite entre 1 e 2/);
  assert.equal(h.rolledBack, true);
  assert.equal(h.saved, undefined);
});

const pickupInput = () => { const data = input(); delete data.bairro_id; return { ...data, fulfillment_type: 'PICKUP' }; };
for (const mode of [undefined, 'DELIVERY', 'PICKUP']) {
  test(`fulfillment ${String(mode)} persists server amounts, selection and correct snapshots`, async () => {
    const data = mode === 'PICKUP' ? pickupInput() : { ...input(), ...(mode ? { fulfillment_type: mode } : {}) };
    const h = harness(), result = await h.execute(data);
    const write = h.trace.find(e => e.sql.startsWith('INSERT INTO orders'));
    assert.equal(result.order.fulfillment_type, mode || 'DELIVERY');
    assert.equal(result.order.subtotal, '25.00');
    assert.equal(result.order.delivery_fee, mode === 'PICKUP' ? '0.00' : '5.00');
    assert.equal(result.order.total_price, mode === 'PICKUP' ? '25.00' : '30.00');
    if (mode === 'PICKUP') {
      assert.equal(write.params[5], null); assert.equal(write.params[9], null);
      assert.deepEqual(JSON.parse(write.params[10]), { name:'Restaurante A', street:'Rua Loja A', number:'123', neighborhood:'Bairro Loja', city:'Cidade Loja' });
      assert.equal(h.trace.some(e => e.sql.includes('FROM bairros')), false);
    } else { assert.equal(write.params[10], null); assert.equal(write.params[9], areaA); }
    assert.equal(h.trace.some(e => /UPDATE|DELETE/.test(e.sql)), false);
  });
}

test('PICKUP ignores customer delivery address and invalid region fees; explicit null bairro is accepted', async () => {
  const h = harness({ address: { city: null, street: null, number: null, neighborhood: null, complement: null }, fee:'NaN' });
  const result = await h.execute({ ...pickupInput(), bairro_id:null });
  assert.equal(result.order.total_price, '25.00'); assert.equal(result.delivery_fee, '0.00');
  assert.equal(h.trace.some(e => e.sql.includes('FROM bairros')), false);
});
test('DELIVERY continues requiring the customer neighborhood and a restaurant-owned matching region', async () => {
  const h = harness({ address: { city:'City', street:'Street', number:'1', neighborhood:' ', complement:null } });
  await assert.rejects(h.execute({ ...input(), fulfillment_type:'DELIVERY' }), /Endereço sem bairro/);
  assert.equal(h.rolledBack,true); assert.equal(h.saved,undefined);
});
for (const value of [null,'', 'pickup','DELIVERY ',true,1,{},[]]) {
  test(`invalid fulfillment type ${JSON.stringify(value)} fails before transaction`, async () => {
    const h = harness(); await assert.rejects(h.execute({ ...input(), fulfillment_type:value }), error => error.status === 422);
    assert.equal(h.trace.length,0);
  });
}
for (const value of [areaA, '', 'outro', {}, 0, false]) {
  test(`PICKUP rejects conflicting bairro ${JSON.stringify(value)}`, async () => {
    const h = harness(); await assert.rejects(h.execute({ ...pickupInput(), bairro_id:value }), /não permite bairro/);
    assert.equal(h.trace.length,0);
  });
}
for (const field of ['delivery_address','pickup_address','subtotal','delivery_fee','total_price','restaurant_id','customer_id','frete_id']) {
  test(`caller ${field} is rejected for both fulfillment modes`, async () => {
    for (const data of [input(),pickupInput()]) {
      const h = harness(); await assert.rejects(h.execute({ ...data, [field]:null }), error => error.status === 422);
      assert.equal(h.trace.length,0);
    }
  });
}
for (const field of ['name','street','number','neighborhood','city']) {
  test(`PICKUP rejects missing/invalid restaurant ${field}, without private data or writes`, async () => {
    for (const value of [null,undefined,{},'', 'null','undefined','[object Object]','x\ny']) {
      const store = { status:true,name:'Loja',street:'Rua',number:'1',neighborhood:'Bairro',city:'Cidade',[field]:value };
      const h = harness({ store });
      await assert.rejects(h.execute(pickupInput()), error => error.status === 422 && /Endereço do estabelecimento indisponível/.test(error.message));
      assert.equal(h.saved,undefined); assert.equal(h.rolledBack,true); assert.equal(h.released,true);
    }
  });
}
test('PICKUP normalizes real restaurant address and preserves its snapshot after changes', async () => {
  const store = { status:true,name:' Loja Real ',street:' Rua Real ',number:42,neighborhood:' Centro ',city:' Cidade ' };
  const h = harness({ store }), result = await h.execute(pickupInput());
  assert.equal(result.order.pickup_address.number,'42'); assert.equal(result.order.pickup_address.street,'Rua Real');
  store.street='Changed'; assert.equal(result.order.pickup_address.street,'Rua Real');
});
for (const opts of [{ missingStore:true },{ open:false },{ store:{status:'true'} },{ wrongCustomer:true }]) {
  test(`PICKUP revalidates store/customer ${JSON.stringify(opts)}`, async () => {
    const h = harness(opts); await assert.rejects(h.execute(pickupInput()));
    assert.equal(h.rolledBack,true); assert.equal(h.saved,undefined);
  });
}
test('simultaneous orders use only their authenticated restaurant address and prices', async () => {
  const a = harness(), b = harness({ restaurantId:'B', customerId:'bob', products:[{ id:productA,item_price:'19.99',available:true }] });
  const [ra,rb] = await Promise.all([a.execute(pickupInput()),b.execute(pickupInput())]);
  assert.equal(ra.order.pickup_address.name,'Restaurante A'); assert.equal(rb.order.pickup_address.name,'Restaurante B');
  assert.equal(ra.order.total_price,'25.00'); assert.equal(rb.order.total_price,'39.98');
  for (const [h,id] of [[a,'A'],[b,'B']]) {
    assert.equal(h.trace.find(e=>e.sql.startsWith('SELECT status')).params[0],id);
    assert.equal(h.trace.find(e=>e.sql.includes('FROM customers')).params[1],id);
    assert.equal(h.trace.find(e=>e.sql.includes('FROM public.products p')).params[0],id);
  }
});
test('PICKUP foreign product, configured pricing and cash rules are unchanged', async () => {
  const foreign = harness(); await assert.rejects(foreign.execute({ ...pickupInput(),items:[{ product_id:foreignProduct,quantity:1 }] }), /outro estabelecimento/);
  const h = harness(configuredOptions());
  const result = await h.execute({ ...pickupInput(),items:[{ product_id:productA,quantity:2,variant_id:variantA,option_ids:[optionA,optionB] }] });
  assert.equal(result.order.total_price,'35.00'); assert.equal(result.subtotal,'35.00'); assert.equal(result.delivery_fee,'0.00'); assert.equal(h.insertedOptions.length,2);
  const short = harness(); await assert.rejects(short.execute({ ...pickupInput(),change_for:'24.99' }), /troco/);
});
for (const options of [{failItem:0},{failChat:true},{failCommit:true},{failRead:true},{failQuery:'FROM restaurants'},{failQuery:'FROM customers'}]) {
  test(`PICKUP failure ${JSON.stringify(options)} rolls back without newOrder`, async () => {
    const h = harness(options), c = controller(h), res = response();
    await c.handle({ params:{id:'A'},body:pickupInput() },res);
    assert.equal(res.statusCode,503); assert.equal(h.rolledBack,true); assert.equal(h.released,true);
    assert.equal(h.saved,undefined); assert.equal(c.emissions.length,0);
  });
}
test('PICKUP configured option persistence failure rolls back every row', async () => {
  const h = harness({ ...configuredOptions(),failOption:true });
  await assert.rejects(h.execute({ ...pickupInput(),items:[{product_id:productA,quantity:1,variant_id:variantA,option_ids:[optionA]}] }));
  assert.equal(h.saved,undefined); assert.equal(h.inserted.length,0); assert.equal(h.insertedOptions.length,0); assert.equal(h.rolledBack,true);
});
test('PICKUP emits fullOrder with modality and snapshot only after COMMIT', async () => {
  const h = harness(), c = controller(h), res = response();
  await c.handle({ params:{id:'A'},body:pickupInput() },res);
  assert.equal(res.statusCode,201); assert.equal(c.emissions.length,1);
  assert.equal(c.emissions[0].order.fulfillment_type,'PICKUP'); assert.equal(c.emissions[0].order.pickup_address.name,'Restaurante A');
  assert.ok(h.trace.findIndex(e=>e.sql==='COMMIT') < h.trace.findIndex(e=>e.sql==='EMIT'));
});
