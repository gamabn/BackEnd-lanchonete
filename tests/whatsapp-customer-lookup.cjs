const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require('ts-node/register');
const { identifyCustomer } = require('../src/messaging/core/customerIdentification');
const { normalizeCustomerPhone, brazilianNationalPhone } = require('../src/security/customerPhone');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { BotCart } = require('../src/messaging/core/cart');
const identity = { phone: '5577999999999', source: 'senderPn' };
const record = { id: 'customer-a', restaurant_id: 'A', international_format: true };
const reader = rows => ({ findByWhatsAppPhone: async () => rows });

function seed(menu, restaurant = 'A', key = 'session-account-chat', jid = 'opaque@lid') {
  const cart = new BotCart();
  cart.add({ productId: 'product', productName: 'Produto', quantity: 2, unitPrice: '12.50' });
  const state = { step: 'CART', categories: [], cart };
  menu.sessions.set(JSON.stringify([restaurant, key, jid]), state);
  return state;
}

test('normalization preserves full international digits for multiple countries, rejects guesses', () => {
  assert.equal(normalizeCustomerPhone('+55 (77) 99999-9999'), identity.phone);
  assert.equal(normalizeCustomerPhone('+44 20 7946 0958'), '442079460958');
  assert.equal(normalizeCustomerPhone('1 (202) 555-0100'), '12025550100');
  assert.notEqual(normalizeCustomerPhone('(77) 99999-9999'), identity.phone);
  for (const value of ['005577999999999', '123', '55foo77999999999', '+55 77 99999-9999 ramal 2', '5577999999999@lid', '', null, '+1234567890123456']) assert.equal(normalizeCustomerPhone(value), undefined);
});

test('unique match is identified only inside the requested restaurant', async () => {
  const calls = [];
  const records = [record, { id: 'customer-b', restaurant_id: 'B', international_format: true }];
  const service = { findByWhatsAppPhone: async args => {
    calls.push(args);
    return records.filter(row => row.restaurant_id === args.restaurant_id);
  } };
  assert.deepEqual(await identifyCustomer('A', identity, service), { kind: 'found', customerId: 'customer-a' });
  assert.deepEqual(await identifyCustomer('B', identity, service), { kind: 'found', customerId: 'customer-b' });
  assert.deepEqual(calls, [{ restaurant_id: 'A', phone: identity.phone }, { restaurant_id: 'B', phone: identity.phone }]);
  assert.deepEqual(await identifyCustomer('A', identity, reader([records[1]])), { kind: 'error' });
});

test('missing, duplicate and database errors never select a customer', async () => {
  assert.deepEqual(await identifyCustomer('A', identity, reader([])), { kind: 'not_found' });
  assert.deepEqual(await identifyCustomer('A', identity, reader([{ ...record, international_format: false }])), { kind: 'ambiguous' });
  assert.deepEqual(await identifyCustomer('A', identity, reader([record, { ...record, id: 'duplicate' }])), { kind: 'ambiguous' });
  assert.deepEqual(await identifyCustomer('A', identity, { findByWhatsAppPhone: async () => { throw new Error('secret-database-uri phone email address'); } }), { kind: 'error' });
});

test('manual, invalid, malformed and absent phone evidence cannot invoke the reader', async () => {
  let calls = 0;
  const service = { findByWhatsAppPhone: async () => { calls++; return [record]; } };
  for (const value of [undefined, { phone: identity.phone, source: 'manual' }, { phone: '123', source: 'senderPn' }, { phone: '+5577999999999', source: 'senderPn' }]) {
    assert.deepEqual(await identifyCustomer('A', value, service), { kind: 'unverified' });
  }
  assert.equal(calls, 0);
});

test('GetClientService uses mandatory tenant and phone SQL, returns only IDs and limits duplicates', async () => {
  let calls = 0;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/service/clients/GetClientService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(name) {
    if (name === '../../security/customerAccess') return { customerColumns: 'id' };
    if (name === '../../security/customerPhone') return { brazilianNationalPhone };
    assert.equal(name, '../../database');
    return { pool: { query: async (sql, params) => {
      calls++;
      assert.match(sql, /SELECT id, restaurant_id,/);
      assert.match(sql, /FROM customers WHERE restaurant_id = \$1/);
      assert.match(sql, /AS international_format/);
      assert.match(sql, /regexp_replace.*= \$2/);
      assert.match(sql, /LIMIT 2/);
      assert.doesNotMatch(sql, /SELECT \*|name|email|street|LIKE/);
      assert.match(sql, /AS national_format/);
      assert.match(sql, /OR \(\$3::text IS NOT NULL/);
      assert.deepEqual(Array.from(params), ['A', identity.phone, '77999999999']);
      return { rows: [record] };
    } } };
  } });
  const service = new exports.GetClientService();
  assert.equal((await service.findByWhatsAppPhone({ restaurant_id: 'A', phone: identity.phone }))[0].id, record.id);
  for (const args of [{ restaurant_id: '', phone: identity.phone }, { restaurant_id: 'A', phone: '' }, { restaurant_id: 'A', phone: '77999999999 OR 1=1' }]) await assert.rejects(service.findByWhatsAppPhone(args));
  assert.equal(calls, 1);
});

for (const [kind, rows, step] of [
  ['found', [record], 'FULFILLMENT_CHOICE'],
  ['not_found', [], 'CUSTOMER_NAME'],
  ['ambiguous', [record, { ...record, id: 'duplicate' }], 'CUSTOMER_AMBIGUOUS'],
  ['error', null, 'CUSTOMER_LOOKUP_ERROR'],
]) test(`menu ${kind}: minimal reply, isolated state, cart preserved and 0 returns`, async () => {
  const menu = new ConversationMenu(rows ? reader(rows) : { findByWhatsAppPhone: async () => { throw new Error('secret'); } });
  const state = seed(menu), before = state.cart.list();
  const reply = await menu.handle('session-account-chat', 'A', '3', 'opaque@lid', identity);
  assert.equal(state.step, step);
  assert.equal(state.customerId, kind === 'found' ? record.id : undefined);
  assert.doesNotMatch(reply, /5577999999999|customer-a|secret|email|street/);
  assert.deepEqual(state.cart.list(), before);
  await menu.handle('session-account-chat', 'A', '0', 'opaque@lid');
  assert.equal(state.step, 'CART');
  assert.deepEqual(state.cart.list(), before);
  assert.equal(state.customerId, kind === 'found' ? record.id : undefined);
});

test('manual phone/body identifiers and other conversations never reuse verified identity', async () => {
  let calls = 0;
  const menu = new ConversationMenu({ findByWhatsAppPhone: async () => { calls++; return [record]; } });
  const state = seed(menu);
  let reply = await menu.handle('session-account-chat', 'A', '3', 'opaque@lid');
  assert.match(reply, /Precisamos confirmar seu telefone/);
  reply = await menu.handle('session-account-chat', 'A', '5577999999999 restaurant_id=A', 'opaque@lid');
  assert.match(reply, /Precisamos confirmar seu telefone/);
  assert.equal(state.step, 'CUSTOMER_IDENTIFICATION');
  assert.equal(calls, 0);
  await menu.handle('session-account-chat', 'A', 'oi', 'opaque@lid', identity);
  assert.equal(calls, 1);
  const other = seed(menu, 'A', 'other-session-account-chat');
  await menu.handle('other-session-account-chat', 'A', '3', 'opaque@lid');
  assert.equal(other.step, 'CUSTOMER_IDENTIFICATION');
  const otherSender = seed(menu, 'A', 'session-account-chat', 'other@lid');
  await menu.handle('session-account-chat', 'A', '3', 'other@lid');
  assert.equal(otherSender.step, 'CUSTOMER_IDENTIFICATION');
  assert.equal(calls, 1);
});

test('late database response cannot overwrite return to cart', async () => {
  let finish;
  const menu = new ConversationMenu({ findByWhatsAppPhone: () => new Promise(resolve => { finish = resolve; }) });
  const state = seed(menu);
  const pending = menu.handle('session-account-chat', 'A', '3', 'opaque@lid', identity);
  await menu.handle('session-account-chat', 'A', '0', 'opaque@lid');
  finish([record]);
  const reply = await pending;
  assert.equal(state.step, 'CART');
  assert.equal(state.customerId, undefined);
  assert.equal(state.cart.list().length, 1);
  assert.doesNotMatch(reply, /COMO DESEJA RECEBER SEU PEDIDO/);
});

test('lookup failure does not leak records, transport IDs or exception details into logs', async () => {
  const originalWrite = process.stdout.write;
  const diagnostics = [];
  process.stdout.write = chunk => { diagnostics.push(String(chunk)); return true; };
  try {
    const menu = new ConversationMenu({ findByWhatsAppPhone: async () => {
      throw new Error('postgres://private-host secret-email@example.test full-address 5577999999999');
    } });
    seed(menu);
    const reply = await menu.handle('session-account-chat', 'A', '3', 'opaque@lid', identity);
    assert.doesNotMatch(reply + diagnostics.join(''), /postgres:|private-host|secret-email|full-address|5577999999999|opaque@lid|customer-a/);
    assert.match(reply, /Não foi possível consultar/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('a different transport phone clears an earlier association and is queried afresh', async () => {
  const calls = [];
  const menu = new ConversationMenu({ findByWhatsAppPhone: async args => {
    calls.push(args.phone);
    return args.phone === identity.phone ? [record] : [];
  } });
  const state = seed(menu);
  await menu.handle('session-account-chat', 'A', '3', 'opaque@lid', identity);
  assert.equal(state.customerId, record.id);
  await menu.handle('session-account-chat', 'A', 'oi', 'opaque@lid', { phone: '442079460958', source: 'senderPn' });
  assert.equal(state.customerId, undefined);
  assert.equal(state.step, 'CUSTOMER_NAME');
  assert.deepEqual(calls, [identity.phone, '442079460958']);
});

test('Brazilian candidate validates DDI, DDD and fixed/mobile length without repairing digits', () => {
  assert.equal(brazilianNationalPhone('+5577999999999'), '77999999999');
  assert.equal(brazilianNationalPhone('+5521999999999'), '21999999999');
  assert.equal(brazilianNationalPhone('55 (21) 2345-6789'), '2123456789');
  assert.equal(brazilianNationalPhone('5555999999999'), '55999999999');
  for (const value of ['+442079460958', '77999999999', '+5500999999999', '+5523999999999', '+557799999999', '+5577899999999', '+55779999999999', '+557712345678', 'invalid']) {
    assert.equal(brazilianNationalPhone(value), undefined);
  }
});

function brazilianLookupFixture(records) {
  const calls = [];
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/service/clients/GetClientService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(name) {
    if (name === '../../security/customerAccess') return { customerColumns: 'id' };
    if (name === '../../security/customerPhone') return { brazilianNationalPhone };
    assert.equal(name, '../../database');
    return { pool: { query: async (_sql, params) => {
      calls.push(Array.from(params));
      const [restaurant, international, national] = params;
      return { rows: records.filter(row => {
        if (row.restaurant_id !== restaurant) return false;
        const digits = normalizeCustomerPhone(row.phone);
        return digits === international || (national !== null && !row.phone.trim().startsWith('+') && digits === national);
      }).slice(0, 2).map(row => ({ id: row.id, restaurant_id: row.restaurant_id,
        international_format: row.phone.trim().startsWith('+'),
        national_format: national !== null && !row.phone.trim().startsWith('+') && normalizeCustomerPhone(row.phone) === national,
      })) };
    } } };
  } });
  return { service: new exports.GetClientService(), calls };
}

for (const [transport, stored] of [
  ['5577999999999', '77999999999'],
  ['5521999999999', '21999999999'],
  ['5577999999999', '(77) 99999-9999'],
  ['5521999999999', '+55 (21) 99999-9999'],
  ['552123456789', '2123456789'],
  ['442079460958', '+44 20 7946 0958'],
]) test(`unique compatible phone format ${transport.slice(0, 4)}… is found`, async () => {
  const { service, calls } = brazilianLookupFixture([{ id: 'match', restaurant_id: 'A', phone: stored }]);
  assert.deepEqual(await identifyCustomer('A', { phone: transport, source: 'senderPn' }, service), { kind: 'found', customerId: 'match' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['A', transport, transport.startsWith('55') ? transport.slice(2) : null]);
});

test('national/international duplicates are checked together instead of preferring a format', async () => {
  const { service, calls } = brazilianLookupFixture([
    { id: 'national', restaurant_id: 'A', phone: '77999999999' },
    { id: 'international', restaurant_id: 'A', phone: '+5577999999999' },
  ]);
  assert.deepEqual(await identifyCustomer('A', identity, service), { kind: 'ambiguous' });
  assert.equal(calls.length, 1);
});

test('national matching remains tenant scoped and does not repair old ninth-digit formats', async () => {
  const { service } = brazilianLookupFixture([
    { id: 'a', restaurant_id: 'A', phone: '77999999999' },
    { id: 'b', restaurant_id: 'B', phone: '77999999999' },
    { id: 'old', restaurant_id: 'C', phone: '7799999999' },
  ]);
  assert.deepEqual(await identifyCustomer('A', identity, service), { kind: 'found', customerId: 'a' });
  assert.deepEqual(await identifyCustomer('B', identity, service), { kind: 'found', customerId: 'b' });
  assert.deepEqual(await identifyCustomer('C', identity, service), { kind: 'not_found' });
  assert.deepEqual(await identifyCustomer('D', identity, service), { kind: 'not_found' });
});

test('non-Brazilian phone keeps its DDI; Brazilian-invalid phone never generates a national query', async () => {
  const { service, calls } = brazilianLookupFixture([
    { id: 'national-foreign', restaurant_id: 'A', phone: '2079460958' },
    { id: 'invalid-ddd', restaurant_id: 'A', phone: '23999999999' },
    { id: 'invalid-mobile', restaurant_id: 'A', phone: '77899999999' },
  ]);
  for (const phone of ['442079460958', '5523999999999', '5577899999999']) {
    assert.deepEqual(await identifyCustomer('A', { phone, source: 'senderPn' }, service), { kind: 'not_found' });
  }
  assert.ok(calls.every(args => args[2] === null));
  const before = calls.length;
  assert.deepEqual(await identifyCustomer('A', { phone: identity.phone, source: 'manual' }, service), { kind: 'unverified' });
  assert.equal(calls.length, before);
});

test('national lookup preserves menu states, privacy and all cart products on return', async () => {
  const { service } = brazilianLookupFixture([{ id: 'national', restaurant_id: 'A', phone: '77999999999' }]);
  const menu = new ConversationMenu(service);
  const state = seed(menu), before = state.cart.list();
  const reply = await menu.handle('session-account-chat', 'A', '3', 'opaque@lid', identity);
  assert.equal(state.step, 'FULFILLMENT_CHOICE');
  assert.equal(state.customerId, 'national');
  assert.match(reply, /COMO DESEJA RECEBER SEU PEDIDO/);
  assert.doesNotMatch(reply, /77999999999|5577999999999|national|opaque@lid/);
  await menu.handle('session-account-chat', 'A', '0', 'opaque@lid');
  assert.equal(state.step, 'CART');
  assert.deepEqual(state.cart.list(), before);
});
