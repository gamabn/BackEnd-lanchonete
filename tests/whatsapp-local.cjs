const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('ts-node/register');
const { readLocalBotConfig } = require('../src/messaging/worker/config');
const { acquireLocalAuth } = require('../src/messaging/worker/localAuth');
const { reconnectDelay, connectLocalWhatsApp: connectWorker } = require('../src/messaging/worker/connection');
// These transport tests mock auth I/O; persistent-auth tests exercise actual temporary files.
const connectLocalWhatsApp = (...args) => connectWorker(...args, undefined,
  async (sdk, folder) => ({ ...await sdk.useMultiFileAuthState(folder), flush: async () => {} }));
const { loadBaileys } = require('../src/messaging/channels/whatsapp/runtime');
const { safeCause, formatDiagnostic } = require('../src/messaging/worker/diagnostics');
const { normalizeWhatsAppMessage, LocalMessageProcessor } = require('../src/messaging/channels/whatsapp/messages');

const { ConversationMenu } = require('../src/messaging/core/conversationMenu');
const { buildInitialMenu } = require('../src/messaging/core/initialMenu');
const store = { id: '00000000-0000-4000-8000-000000000001', status: true, name: 'Restaurante Local', street: 'Rua Local', number: '10', neighborhood: 'Centro', city: 'Cidade Local' };
const makeMenu = () => new ConversationMenu(undefined, undefined, undefined, undefined, { execute: async () => store });
const makeProcessor = (context, now, maxSeen = 10000) => new LocalMessageProcessor(context, now, maxSeen, makeMenu());

const now = Date.parse('2026-11-13T12:00:00.000Z');
const context = { restaurant_id: '00000000-0000-4000-8000-000000000001', session_id: '00000000-0000-4000-8000-000000000002', channel: 'whatsapp' };
const env = () => ({ GAMA_BOT_ENABLED: 'true', GAMA_BOT_RESTAURANT_ID: context.restaurant_id, GAMA_BOT_SESSION_ID: context.session_id, GAMA_BOT_AUTH_DIR: '.gama-bot-dev/test' });
const raw = () => ({ key: { id: 'msg1', remoteJid: 'opaque-user@lid', fromMe: false }, messageTimestamp: now / 1000, message: { conversation: 'Oi' }, pushName: 'Sugestão' });
const batch = () => ({ type: 'notify', messages: [raw()] });

test('installed Baileys ESM loads natively inside the CommonJS project, without connecting', async () => {
  const sdk = await loadBaileys();
  assert.equal(typeof sdk.default, 'function');
  assert.equal(typeof sdk.useMultiFileAuthState, 'function');
  assert.equal(typeof require('qrcode-terminal').generate, 'function');
});

test('explicit configuration validates IDs and restricts auth directory', () => {
  assert.deepEqual(readLocalBotConfig(env(), '/tmp/gama').context, context);
  for (const patch of [{ GAMA_BOT_ENABLED: undefined }, { GAMA_BOT_ENABLED: 'false' }, { GAMA_BOT_RESTAURANT_ID: 'bad' }, { GAMA_BOT_SESSION_ID: '' }, { GAMA_BOT_AUTH_DIR: undefined }, { GAMA_BOT_AUTH_DIR: '/tmp/other' }, { GAMA_BOT_AUTH_DIR: '.gama-bot-dev' }, { GAMA_BOT_AUTH_DIR: '.gama-bot-dev/../../other' }]) {
    assert.throws(() => readLocalBotConfig({ ...env(), ...patch }, '/tmp/gama'));
  }
});

test('normalizes supported direct text without extracting a phone or trusting restaurant in text', () => {
  const input = raw(); input.message.conversation = 'restaurant_id=foreign';
  const result = normalizeWhatsAppMessage(input, context, 'own-account', now, now);
  assert.deepEqual(result.context, context);
  assert.equal(result.sender.subject_id, 'opaque-user@lid');
  assert.equal(result.profile_name.requires_confirmation, true);
  const extended = raw(); extended.message = { extendedTextMessage: { text: 'Menu' } };
  assert.equal(normalizeWhatsAppMessage(extended, context, 'own-account', now, now).content.text, 'Menu');
});

test('ignores groups, status, broadcasts, own messages, media, invalid and historical timestamps', () => {
  for (const jid of ['group@g.us', 'status@broadcast', 'list@broadcast', 'channel@newsletter', 'invalid']) {
    const input = raw(); input.key.remoteJid = jid; assert.equal(normalizeWhatsAppMessage(input, context, 'own', now, now), null);
  }
  for (const mutate of [x => x.key.fromMe = true, x => x.key.participant = 'someone', x => x.message = { imageMessage: {} }, x => x.message = {}, x => x.message.conversation = 'x'.repeat(4097), x => x.key.id = '', x => x.messageTimestamp -= 1, x => x.messageTimestamp += 60, x => delete x.messageTimestamp]) {
    const input = raw(); mutate(input); assert.equal(normalizeWhatsAppMessage(input, context, 'own', now, now), null);
  }
});

test('initial menu uses the current conversation contract and preserves options', async () => {
  const menu = makeMenu();
  for (const text of ['Oi', 'Olá', 'Menu', 'qualquer texto', '0']) {
    assert.equal(await menu.handle('session', store.id, text, 'sender@lid'), buildInitialMenu(store));
  }
  assert.match(buildInitialMenu(store), /1 - Ver cardápio\n2 - Meus pedidos\n0 - Menu inicial/);
  assert.match(await menu.handle('session', store.id, '2', 'sender@lid'), /identificar seu cadastro com segurança/);
});

test('filters batch history and requestId; deduplicates concurrently and only replies to sender', async () => {
  const processor = makeProcessor(context, now);
  const sent = [], send = async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'reply' } }; };
  await processor.process({ ...batch(), type: 'append' }, 'own', send, now);
  await processor.process({ ...batch(), requestId: 'history' }, 'own', send, now);
  assert.equal(sent.length, 0);
  await Promise.all([processor.process(batch(), 'own', send, now), processor.process(batch(), 'own', send, now)]);
  assert.deepEqual(sent, [{ jid: 'opaque-user@lid', content: { text: buildInitialMenu(store) } }]);
  const next = batch(); next.messages[0].key.id = 'msg2'; next.messages[0].message.conversation = '2';
  await processor.process(next, 'own', send, now);
  assert.match(sent[1].content.text, /identificar seu cadastro com segurança/);
});

test('ambiguous send is not repeated, and dedup capacity fails closed', async () => {
  const processor = makeProcessor(context, now, 1);
  let calls = 0;
  const send = async () => { calls++; throw new Error('transport secret'); };
  await assert.rejects(processor.process(batch(), 'own', send, now), /resultado incerto/);
  await processor.process(batch(), 'own', send, now);
  assert.equal(calls, 1);
  const next = batch(); next.messages[0].key.id = 'other';
  await assert.rejects(processor.process(next, 'own', send, now), /Limite/);
});

test('reconnection has bounded exponential backoff', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(reconnectDelay), [1000, 2000, 4000, 8000, 16000, null]);
  assert.equal(reconnectDelay(-1), null);
});

test('local auth persists context, excludes concurrent processes and refuses other sessions or links', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'gama-wa-test-'));
  try {
    const config = readLocalBotConfig(env(), cwd);
    const release = await acquireLocalAuth(config);
    await assert.rejects(acquireLocalAuth(config), /lock/);
    await release();
    const releaseAgain = await acquireLocalAuth(config); await releaseAgain();
    const foreign = { ...config, context: { ...context, session_id: '00000000-0000-4000-8000-000000000003' } };
    await assert.rejects(acquireLocalAuth(foreign), /outro contexto/);
    await fs.symlink('/tmp', path.join(config.authDir, 'credentials-link'));
    await assert.rejects(acquireLocalAuth(config), /simbólico/);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

function fakeRuntime() {
  const { EventEmitter } = require('node:events');
  const sockets = []; let saved = 0;
  const sdk = {
    useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => { saved++; } }),
    DisconnectReason: { loggedOut: 401, badSession: 500, connectionReplaced: 440, multideviceMismatch: 411, forbidden: 403 },
    default: options => {
      assert.equal(options.syncFullHistory, false);
      assert.equal(options.shouldSyncHistoryMessage(), false);
      assert.equal(options.shouldIgnoreJid('status@broadcast'), true);
      const socket = { ev: new EventEmitter(), user: { id: 'own' }, ended: false, end() { this.ended = true; }, sendMessage: async () => ({ key: { id: 'reply' } }) };
      sockets.push(socket); return socket;
    },
  };
  return { load: async () => sdk, sockets, saved: () => saved };
}
// Reconnect now includes the auth flush barrier before constructing the replacement socket.
async function settleReconnect() { for (let i=0;i<3;i++) await new Promise(resolve=>setImmediate(resolve)); }

test('connection renders QR, persists creds and stops on logout without reconnecting', async () => {
  const runtime = fakeRuntime(), qr = [], logs = [];
  const worker = await connectLocalWhatsApp(readLocalBotConfig(env(), '/tmp/gama'), value => qr.push(value), value => logs.push(value), runtime.load);
  const socket = runtime.sockets[0];
  socket.ev.emit('connection.update', { qr: 'qr-test-only' });
  socket.ev.emit('creds.update', {});
  socket.ev.emit('connection.update', { connection: 'open' });
  socket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await worker.done;
  assert.deepEqual(qr, ['qr-test-only']);
  assert.equal(runtime.saved(), 2); // creds.update plus final shutdown snapshot.
  assert.equal(socket.ended, true);
  assert.equal(runtime.sockets.length, 1);
  assert.equal(logs.some(line => line.includes('qr-test-only')), false);
  assert.equal(socket.ev.listenerCount('creds.update'), 0);
});

test('transient disconnect reconnects once and shutdown cancels pending retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runtime = fakeRuntime();
  const worker = await connectLocalWhatsApp(readLocalBotConfig(env(), '/tmp/gama'), () => {}, () => {}, runtime.load);
  runtime.sockets[0].ev.emit('connection.update', { connection: 'close' });
  t.mock.timers.tick(1000);
  await settleReconnect();
  assert.equal(runtime.sockets.length, 2);
  runtime.sockets[1].ev.emit('connection.update', { connection: 'close' });
  await worker.stop(); await worker.done;
  t.mock.timers.tick(60_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.sockets.length, 2);
  assert.equal(runtime.sockets[1].ended, true);
});

test('diagnostics identify DNS and stages without exposing errors, credentials or paths', async () => {
  const secret = 'private-token-and-personal-data';
  assert.equal(safeCause({ code: 'EAI_AGAIN', message: secret }), 'EAI_AGAIN');
  assert.equal(safeCause({ message: `WebSocket Error EAI_AGAIN ${secret}`, output: { statusCode: 408 } }), 'EAI_AGAIN');
  assert.equal(safeCause({ code: secret, message: secret }), 'UNKNOWN');
  assert.equal(formatDiagnostic(new Error(secret)).includes(secret), false);
  await assert.rejects(connectLocalWhatsApp(readLocalBotConfig(env(), '/tmp/gama'), () => {}, () => {}, async () => { throw Object.assign(new Error(secret), { code: 'ERR_MODULE_NOT_FOUND' }); }), error => error.stage === 'esm_import' && error.code === 'ERR_MODULE_NOT_FOUND' && !error.message.includes(secret));
  const runtime = fakeRuntime(), sdk = await runtime.load();
  sdk.useMultiFileAuthState = async () => { throw Object.assign(new Error(secret), { code: 'EACCES' }); };
  await assert.rejects(connectLocalWhatsApp(readLocalBotConfig(env(), '/tmp/gama'), () => {}, () => {}, runtime.load), error => error.stage === 'auth_load' && error.code === 'EACCES');
});

test('missing exports produce configuration-specific error, without reading dotenv', () => {
  assert.throws(() => readLocalBotConfig({}, '/tmp/gama'), error => error.stage === 'configuration' && error.code === 'BOT_NOT_ENABLED' && error.message.includes('.env'));
});

test('reconnect exhaustion reports failure and retains preceding safe disconnect cause', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const runtime = fakeRuntime(), logs = [];
  const worker = await connectLocalWhatsApp(readLocalBotConfig(env(), '/tmp/gama'), () => {}, line => logs.push(line), runtime.load);
  const close = () => runtime.sockets.at(-1).ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 }, message: 'WebSocket EAI_AGAIN private-secret' } } });
  close();
  for (const delay of [1000, 2000, 4000, 8000, 16000]) {
    t.mock.timers.tick(delay); await settleReconnect(); close();
  }
  const result = await worker.done;
  assert.equal(result.stage, 'reconnect'); assert.equal(result.code, 'RETRY_LIMIT');
  assert.equal(runtime.sockets.length, 6);
  assert.ok(logs.some(line => line.includes('status=408; causa=EAI_AGAIN')));
  assert.equal(logs.some(line => line.includes('private-secret')), false);
});
