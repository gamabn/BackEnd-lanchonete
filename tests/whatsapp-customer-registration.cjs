const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require('ts-node/register');
const { normalizeCustomerName } = require('../src/security/customerName');
const { normalizeCustomerPhone, brazilianNationalPhone } = require('../src/security/customerPhone');
const { GetClientService } = require('../src/service/clients/GetClientService');
const { registerCustomer } = require('../src/messaging/core/customerRegistration');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { BotCart } = require('../src/messaging/core/cart');
const { stubGateway, stubRegionCatalog } = require('./fixtures/whatsapp-address-harness.cjs');
const identity = { phone: '5577999999999', source: 'senderPn' };

function harness(options = {}) {
  const records = (options.records || []).map(row => ({ ...row }));
  const calls = [], releases = [], locks = new Map();
  let sequence = 0;
  const columns = [
    { column_name: 'id', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
    ...['restaurant_id', 'name', 'phone'].map(column_name => ({ column_name, is_nullable: 'NO', column_default: null })),
    ...['city', 'street', 'number', 'neighborhood', 'complement'].map(column_name => ({ column_name, is_nullable: 'YES', column_default: null })),
  ].map(column => ({ ...column, is_identity: 'NO', is_generated: 'NEVER', data_type: 'text', character_maximum_length: null }));
  if (options.numericPhone) columns.find(column => column.column_name === 'phone').data_type = 'bigint';
  if (options.shortPhone) columns.find(column => column.column_name === 'phone').character_maximum_length = 11;
  if (options.requiredAddress) columns.find(column => column.column_name === options.requiredAddress).is_nullable = 'NO';
  if (options.missingAddress) columns.splice(columns.findIndex(column => column.column_name === options.missingAddress), 1);
  if (options.extraRequired) columns.push({ column_name: 'extra', is_nullable: 'NO', column_default: null, is_identity: 'NO', is_generated: 'NEVER' });
  const pool = { async connect() {
    if (options.connectError) throw new Error('private connection details');
    let pending = [], unlock;
    return {
      async query(sql, params = []) {
        calls.push({ sql, params: Array.from(params) });
        if (sql.startsWith('BEGIN')) { assert.match(sql, /READ COMMITTED/); return { rows: [] }; }
        if (sql.startsWith('SET LOCAL')) return { rows: [] };
        if (sql.includes('pg_advisory_xact_lock')) {
          const key = params[0], previous = locks.get(key) || Promise.resolve();
          let release;
          const current = new Promise(resolve => { release = resolve; });
          locks.set(key, previous.then(() => current));
          await previous;
          unlock = release;
          return { rows: [] };
        }
        if (sql.includes('FROM customers WHERE restaurant_id = $1')) {
          if (options.readError) throw new Error('private read details');
          const [restaurant, phone, national] = params;
          return { rows: records.filter(row => row.restaurant_id === restaurant &&
            (normalizeCustomerPhone(row.phone) === phone || (national && !row.phone.startsWith('+') && normalizeCustomerPhone(row.phone) === national))
          ).slice(0, 2).map(row => ({ id: row.id, restaurant_id: row.restaurant_id,
            international_format: row.phone.startsWith('+'),
            national_format: Boolean(national && !row.phone.startsWith('+') && normalizeCustomerPhone(row.phone) === national),
          })) };
        }
        if (sql.includes('information_schema.columns')) {
          if (options.schemaError) throw new Error('metadata unavailable');
          assert.match(sql, /table_schema = 'public' AND table_name = 'customers'/);
          return { rows: columns };
        }
        if (sql.startsWith('INSERT')) {
          if (options.insertCode) throw Object.assign(new Error('private insert details'), { code: options.insertCode });
          assert.match(sql, /NULL, NULL, NULL, NULL, NULL/);
          assert.match(sql, /FROM public.restaurants r WHERE r.id = \$3/);
          assert.match(sql, /RETURNING id, restaurant_id/);
          assert.doesNotMatch(sql, /UPDATE|ON CONFLICT|RETURNING \*/);
          assert.equal(params.length, 3);
          assert.match(params[1], /^\+[1-9][0-9]{6,14}$/);
          if (options.missingRestaurant) return { rows: [] };
          const row = { id: `created-${++sequence}`, name: params[0], phone: params[1], restaurant_id: params[2],
            city: null, street: null, number: null, neighborhood: null, complement: null };
          pending.push(row);
          return { rows: [{ id: row.id, restaurant_id: row.restaurant_id }] };
        }
        if (sql === 'COMMIT') {
          records.push(...pending); pending = []; unlock?.(); unlock = undefined;
          if (options.commitError) throw new Error('connection lost after commit');
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          pending = []; unlock?.(); unlock = undefined;
          if (options.rollbackError) throw new Error('rollback failed');
          return { rows: [] };
        }
        assert.fail('Unexpected database operation');
      },
      release(discard) { releases.push(discard); unlock?.(); },
    };
  } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/service/clients/CreateClientService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require(name) {
    const dependencies = {
      '../../database': { pool }, '../../security/customerAccess': { customerColumns: 'id' },
      '../../security/customerName': { normalizeCustomerName }, '../../security/customerPhone': { brazilianNationalPhone },
      './GetClientService': { GetClientService },
    };
    assert.ok(name in dependencies, 'Unexpected dependency');
    return dependencies[name];
  } });
  return { service: new exports.CreateClientService(), records, calls, releases };
}

const input = { restaurant_id: 'A', name: 'João Silva', phone: identity.phone };
function menuFixture(options = {}) {
  const database = harness(options);
  let readCalls = 0;
  const reader = { findByWhatsAppPhone: async () => {
    readCalls++;
    return options.existing ? [{ id: 'existing', restaurant_id: 'A', international_format: true }] : [];
  } };
  const menu = new ConversationMenu(reader, database.service, stubGateway(), stubRegionCatalog());
  const cart = new BotCart();
  cart.add({ productId: 'simple', productName: 'Simples', quantity: 2, unitPrice: '10.00' });
  cart.add({ productId: 'configured', productName: 'Configurado', quantity: 3, unitPrice: '15.50', variantId: 'variant', variantName: 'Grande', optionIds: ['option-1', 'option-2'] });
  const state = { step: 'CART', categories: [], cart };
  menu.sessions.set(JSON.stringify(['A', 'session-account-chat', 'opaque@lid']), state);
  const send = (text, phone = undefined) => menu.handle('session-account-chat', 'A', text, 'opaque@lid', phone);
  return { ...database, menu, state, send, reads: () => readCalls };
}
async function confirm(fixture) {
  await fixture.send('3', identity);
  await fixture.send('João Silva');
  return fixture.send('1');
}

test('new customer is asked for name and must confirm before any write', async () => {
  const f = menuFixture();
  assert.equal(await f.send('3', identity), '👤 Vamos realizar seu cadastro!\n\nQual é o seu nome?\n\n0 - Voltar ao carrinho');
  assert.equal(f.state.step, 'CUSTOMER_NAME');
  const reply = await f.send('  João   Silva  ');
  assert.equal(reply, '✅ Nome recebido: João Silva\n\n1 - Confirmar nome\n2 - Corrigir nome\n0 - Voltar ao carrinho');
  assert.equal(f.state.step, 'CUSTOMER_NAME_CONFIRM');
  assert.equal(f.records.length, 0);
  assert.equal(f.calls.length, 0);
});

test('empty, oversized, numeric commands, profile-like content and control characters are rejected', async () => {
  const f = menuFixture();
  await f.send('3', identity);
  for (const name of ['', ' ', '1', '2', '3', 'Menu', 'Menu inicial', 'Ver cardápio', 'Meus pedidos', 'Voltar', 'Confirmar nome', 'Sim', 'A', 'a'.repeat(81), '<script>', 'João\nSilva', 'João\tSilva', 'João\u202eSilva', '5577999999999']) {
    assert.match(await f.send(name), /nome válido/);
    assert.equal(f.state.step, 'CUSTOMER_NAME');
  }
  assert.equal(normalizeCustomerName('Ana-Maria'), 'Ana-Maria');
  assert.equal(normalizeCustomerName("D'Ávila"), "D'Ávila");
  assert.equal(f.calls.length, 0);
});

test('correction replaces the draft and confirmation stores only the corrected name', async () => {
  const f = menuFixture();
  await f.send('3', identity); await f.send('Nome Errado');
  assert.match(await f.send('2'), /Qual é o seu nome/);
  assert.equal(f.state.step, 'CUSTOMER_NAME_CORRECT');
  assert.equal(f.state.draftName, undefined);
  await f.send('Maria Silva');
  assert.match(await f.send('1'), /Cadastro inicial concluído/);
  assert.equal(f.records[0].name, 'Maria Silva');
  assert.equal(f.state.step, 'FULFILLMENT_CHOICE');
  assert.equal(f.state.customerId, f.records[0].id);
});

test('confirmed registration stores verified international phone and real null addresses', async () => {
  const f = menuFixture(), before = f.state.cart.list();
  assert.match(await confirm(f), /Cadastro inicial concluído/);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].phone, `+${identity.phone}`);
  assert.equal(f.records[0].restaurant_id, 'A');
  for (const field of ['city', 'street', 'number', 'neighborhood', 'complement']) assert.equal(f.records[0][field], null);
  assert.deepEqual(f.state.cart.list(), before);
  assert.equal(f.state.draftName, undefined);
  assert.equal(f.calls.at(-1).sql, 'COMMIT');
  assert.deepEqual(f.releases, [false]);
});

test('known customer skips name collection and creation, preserving its ID', async () => {
  const f = menuFixture({ existing: true });
  assert.match(await f.send('3', identity), /COMO DESEJA RECEBER SEU PEDIDO/);
  assert.equal(f.state.step, 'FULFILLMENT_CHOICE');
  assert.equal(f.state.customerId, 'existing');
  await f.send('João Silva'); await f.send('1');
  assert.equal(f.calls.length, 0);
});

test('repeated and simultaneous confirmation messages create just one record', async () => {
  const f = menuFixture();
  await f.send('3', identity); await f.send('João Silva');
  await Promise.all([f.send('1'), f.send('1'), f.send('1')]);
  await f.send('1');
  assert.equal(f.records.length, 1);
  assert.equal(f.calls.filter(call => call.sql.startsWith('INSERT')).length, 1);
});

test('cross-worker bot creations serialize, then recheck the customer inside the lock', async () => {
  const f = harness();
  const results = await Promise.all([
    f.service.createInitialForWhatsApp(input), f.service.createInitialForWhatsApp(input),
  ]);
  assert.deepEqual(results.map(result => result.kind).sort(), ['created', 'existing']);
  assert.equal(f.records.length, 1);
  assert.equal(results[0].customerId, results[1].customerId);
  assert.equal(f.calls.filter(call => call.sql.startsWith('INSERT')).length, 1);
  assert.equal(f.calls.filter(call => call.sql.includes('pg_advisory_xact_lock')).length, 2);
});

test('customer created between lookup and confirmation is reused, including Brazilian national format', async () => {
  const f = menuFixture({ records: [{ id: 'national-existing', restaurant_id: 'A', phone: '77999999999', name: 'Existing Name' }] });
  assert.match(await confirm(f), /COMO DESEJA RECEBER SEU PEDIDO/);
  assert.equal(f.state.customerId, 'national-existing');
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].name, 'Existing Name');
  assert.ok(!f.calls.some(call => call.sql.startsWith('INSERT')));
});

test('duplicates never choose or update a customer', async () => {
  const f = menuFixture({ records: [
    { id: 'a', restaurant_id: 'A', phone: '77999999999' },
    { id: 'b', restaurant_id: 'A', phone: '+5577999999999' },
  ] });
  assert.match(await confirm(f), /confirmar sua identificação/);
  assert.equal(f.state.step, 'CUSTOMER_AMBIGUOUS');
  assert.equal(f.state.customerId, undefined);
  assert.ok(!f.calls.some(call => call.sql.startsWith('INSERT')));
});

test('same phone in another restaurant never blocks or associates a customer from that tenant', async () => {
  const f = harness({ records: [{ id: 'b', restaurant_id: 'B', phone: '+5577999999999' }] });
  const a = await f.service.createInitialForWhatsApp(input);
  assert.equal(a.kind, 'created'); assert.notEqual(a.customerId, 'b');
  const b = await f.service.createInitialForWhatsApp({ ...input, restaurant_id: 'B' });
  assert.equal(b.kind, 'existing'); assert.equal(b.customerId, 'b');
  const keys = f.calls.filter(call => call.sql.includes('pg_advisory_xact_lock')).map(call => call.params[0]);
  assert.notEqual(keys[0], keys[1]);
});

test('missing or manually provided identity cannot call the registration service', async () => {
  let writes = 0;
  const writer = { createInitialForWhatsApp: async () => { writes++; return { kind: 'created', customerId: 'never' }; } };
  for (const evidence of [undefined, { ...identity, source: 'manual' }, { phone: 'opaque@lid', source: 'senderPn' }]) {
    assert.deepEqual(await registerCustomer('A', evidence, input.name, writer), { kind: 'unverified' });
  }
  const f = menuFixture();
  await f.send('3'); await f.send(identity.phone); await f.send('João Silva'); await f.send('1');
  assert.equal(f.state.step, 'CUSTOMER_IDENTIFICATION');
  assert.equal(f.reads(), 0); assert.equal(f.calls.length, 0); assert.equal(writes, 0);
});

for (const field of ['city', 'street', 'number', 'neighborhood', 'complement']) test(`required ${field} prevents a partial INSERT without inventing an address`, async () => {
  const f = menuFixture({ requiredAddress: field });
  assert.match(await confirm(f), /sem endereço ainda não está disponível/);
  assert.equal(f.state.step, 'CUSTOMER_REGISTRATION_ERROR');
  assert.ok(!f.calls.some(call => call.sql.startsWith('INSERT')));
  assert.equal(f.records.length, 0);
});

test('unknown/missing schema and another required column fail closed', async () => {
  for (const options of [{ missingAddress: 'city' }, { extraRequired: true }, { schemaError: true }, { numericPhone: true }, { shortPhone: true }]) {
    const f = harness(options);
    const result = await f.service.createInitialForWhatsApp(input);
    assert.ok(['schema_unsupported', 'error'].includes(result.kind));
    assert.ok(!f.calls.some(call => call.sql.startsWith('INSERT')));
  }
});

test('database failure, constraints and rollback failure do not lose cart or expose details', async () => {
  for (const options of [{ connectError: true }, { readError: true }, { insertCode: '23502' }, { insertCode: '23514' }, { insertCode: '23505' }, { insertCode: '08006', rollbackError: true }, { missingRestaurant: true }]) {
    const f = menuFixture(options), before = f.state.cart.list();
    const reply = await confirm(f);
    assert.doesNotMatch(reply, /private|08006|23502|João Silva|5577999999999|77999999999|opaque@lid/);
    assert.ok(['CUSTOMER_REGISTRATION_ERROR', 'CUSTOMER_AMBIGUOUS'].includes(f.state.step));
    assert.equal(f.records.length, 0);
    await f.send('0');
    assert.equal(f.state.step, 'CART'); assert.deepEqual(f.state.cart.list(), before);
    if (options.rollbackError) assert.deepEqual(f.releases, [true]);
  }
});

test('uncertain commit can be recovered by lookup without creating a duplicate', async () => {
  const f = harness({ commitError: true });
  assert.equal((await f.service.createInitialForWhatsApp(input)).kind, 'error');
  assert.equal(f.records.length, 1);
  await f.service.createInitialForWhatsApp(input);
  assert.equal(f.records.length, 1);
  assert.equal(f.calls.filter(call => call.sql.startsWith('INSERT')).length, 1);
});

test('0 discards a pending name and returns without losing configured products or quantities', async () => {
  const f = menuFixture(), before = f.state.cart.list();
  await f.send('3', identity); await f.send('João Silva');
  await f.send('0'); await f.send('confirmar');
  assert.equal(f.state.draftName, undefined); assert.equal(f.state.draftPhone, undefined);
  assert.deepEqual(f.state.cart.list(), before); assert.equal(f.records.length, 0);
});

test('a late confirmed write cannot overwrite return to cart', async () => {
  let finish;
  const f = menuFixture(), before = f.state.cart.list();
  f.menu.customerWriter = { createInitialForWhatsApp: () => new Promise(resolve => { finish = resolve; }) };
  await f.send('3', identity); await f.send('João Silva');
  const pending = f.send('1');
  assert.equal(f.state.step, 'CUSTOMER_REGISTERING');
  await f.send('0');
  finish({ kind: 'created', customerId: 'confirmed' });
  await pending;
  assert.equal(f.state.step, 'CART'); assert.deepEqual(f.state.cart.list(), before);
});

test('changed transport phone invalidates the name confirmation', async () => {
  const f = menuFixture();
  await f.send('3', identity); await f.send('João Silva');
  await f.send('1', { phone: '5521999999999', source: 'senderPn' });
  assert.equal(f.state.step, 'CUSTOMER_NAME');
  assert.equal(f.state.draftName, undefined); assert.equal(f.records.length, 0);
});

test('registration diagnostics never contain confirmed names, IDs or phone numbers', async () => {
  const original = process.stdout.write, messages = [];
  process.stdout.write = chunk => { messages.push(String(chunk)); return true; };
  try {
    const f = menuFixture(); await confirm(f);
    assert.doesNotMatch(messages.join(''), /João|Silva|5577999999999|77999999999|opaque@lid|created-/);
  } finally { process.stdout.write = original; }
});

test('invalid service input is rejected before any transaction or INSERT', async () => {
  const f = harness();
  for (const value of [{ ...input, name: '1' }, { ...input, name: '' }, { ...input, name: 'a'.repeat(81) }, { ...input, phone: '123' }, { ...input, restaurant_id: '' }]) {
    assert.equal((await f.service.createInitialForWhatsApp(value)).kind, 'error');
  }
  assert.equal(f.calls.length, 0);
  let writes = 0;
  assert.deepEqual(await registerCustomer('A', identity, 'Menu', { createInitialForWhatsApp: async () => { writes++; return { kind: 'created', customerId: 'never' }; } }), { kind: 'error' });
  assert.equal(writes, 0);
});
