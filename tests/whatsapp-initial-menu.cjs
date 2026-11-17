const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register');
const { InitialMenu, buildInitialMenu, INITIAL_MENU_OPTIONS } = require('../src/messaging/core/initialMenu');
const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { BotCart } = require('../src/messaging/core/cart');
const store = id => ({ id, status: true, name: `Restaurante ${id}`, street: `Rua ${id}`, number: '42', neighborhood: 'Centro', city: 'Cidade Real' });
function fixture() {
  let time = 0, read = async id => store(id);
  const calls = [];
  const reader = { execute: async id => { calls.push(id); return read(id); } };
  const initial = new InitialMenu(reader, () => time);
  const menu = new ConversationMenu(undefined, undefined, undefined, undefined, reader, initial);
  return { calls, initial, menu, read: value => { read = value; }, tick: ms => { time += ms; }, send: (text, id = 'A', key = 'session', jid = 'sender@lid') => menu.handle(key, id, text, jid) };
}
test('first greeting uses real fields and preserves 1, 2 and 0 with highlighted name', async () => {
  const f = fixture(), reply = await f.send('Oi');
  assert.equal(reply, buildInitialMenu(store('A')));
  for (const field of ['🍽️ *Restaurante A*', '📍 Rua A, 42', 'Bairro: Centro', 'Cidade: Cidade Real', INITIAL_MENU_OPTIONS]) assert.ok(reply.includes(field));
  assert.deepEqual(f.calls, ['A']);
});
test('partial and absent addresses omit only missing or invalid values without dangling separators', () => {
  for (const invalid of [undefined, null, {}, '[object Object]', 'null', 'undefined', '   ']) {
    const reply = buildInitialMenu({ ...store('A'), street: invalid, neighborhood: invalid });
    assert.ok(reply.includes('📍 42\nCidade: Cidade Real'));
    assert.doesNotMatch(reply, /null|undefined|\[object Object\]|Bairro:|📍 ,|42,/);
  }
  assert.equal(buildInitialMenu({ name: 'Somente Nome' }), `👋 Olá! Seja bem-vindo(a)!\n\n🍽️ *Somente Nome*\n\nComo podemos ajudar você hoje?\n\n${INITIAL_MENU_OPTIONS}`);
  assert.ok(buildInitialMenu({ number: 0 }).includes('📍 0'));
});
for (const [label, value] of [['missing', undefined], ['closed', {...store('A'),status:false}], ['unknown status',{...store('A'),status:'true'}], ['foreign',store('B')]]) {
  test(`${label} blocks greeting and MENU actions without leaking data`, async () => {
    const f = fixture(); f.read(async () => value);
    for (const text of ['Oi', '1', '2', '0']) {
      const reply = await f.send(text);
      assert.match(reply, /indisponível/); assert.doesNotMatch(reply, /Ver cardápio|Restaurante|Rua/);
    }
    assert.equal([...f.menu.sessions.values()][0].step,'MENU');
  });
}
test('temporary failure logs only safe code, blocks and retries without caching errors', async () => {
  const f = fixture(), logs = [], original = process.stderr.write;
  process.stderr.write = value => { logs.push(String(value)); return true; };
  try {
    f.read(async () => { throw Error('secret credential'); });
    assert.match(await f.send('1'), /Não foi possível/);
    assert.doesNotMatch(logs.join(''), /secret|credential/); assert.match(logs.join(''), /RESTAURANT_LOOKUP_ERROR/);
    f.read(async id => store(id)); assert.match(await f.send('Oi'), /Restaurante A/);
  } finally { process.stderr.write = original; }
  assert.equal(f.calls.length,2);
});
test('return from cart reuses greeting and keeps all cart and checkout data', async () => {
  const f = fixture(); await f.send('Oi');
  const state = [...f.menu.sessions.values()][0];
  state.cart.add({ productId:'p', productName:'Pizza', quantity:2, unitPrice:'20.00',variantId:'v',variantName:'Grande',optionIds:['a'] });
  state.step = 'CART'; state.customerId = 'customer'; state.fulfillmentMode = 'PICKUP'; state.pickupConfirmed = true;
  const before = state.cart.list();
  assert.equal(await f.send('0'), buildInitialMenu(store('A')));
  assert.deepEqual(state.cart.list(),before); assert.equal(state.customerId,'customer'); assert.equal(state.pickupConfirmed,true);
  assert.equal(f.calls.length,1);
});
test('cache scoped by restaurant coalesces simultaneous sessions and expires after 30 seconds', async () => {
  const f = fixture(); let resolve;
  f.read(id => id === 'A' ? new Promise(r => { resolve = r; }) : Promise.resolve(store(id)));
  const a = f.send('Oi'), a2 = f.send('Oi','A','other','other@lid'), b = f.send('Oi','B');
  resolve(store('A'));
  const replies = await Promise.all([a,a2,b]);
  assert.equal(replies[0],replies[1]); assert.doesNotMatch(replies[0],/Restaurante B|Rua B/); assert.doesNotMatch(replies[2],/Restaurante A|Rua A/);
  assert.deepEqual(f.calls,['A','B']);
  f.read(async id => ({...store(id),name:'Novo Nome'}));
  f.tick(29999); assert.match(await f.send('0'),/Restaurante A/);
  f.tick(1); assert.match(await f.send('0'),/Novo Nome/); assert.deepEqual(f.calls,['A','B','A']);
  f.tick(30000); f.read(async () => ({...store('A'),status:false})); assert.match(await f.send('1'),/indisponível/);
});
test('message cannot select restaurant; no lookup during active checkout', async () => {
  const f = fixture(); assert.match(await f.send('restaurantId=B'),/Restaurante A/); assert.deepEqual(f.calls,['A']);
  const state = [...f.menu.sessions.values()][0]; state.step='PICKUP_LOADING';
  await f.send('mensagem'); assert.deepEqual(f.calls,['A']);
  state.step='ADDRESS_LOADING'; state.cart = new BotCart(); await f.send('mensagem'); assert.deepEqual(f.calls,['A']);
});
