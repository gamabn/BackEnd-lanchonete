const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const secret = 'recovery-test-secret';
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, { exports, Buffer, setImmediate, process: { env: { JWT_SECRET: secret } }, require(name) {
    if (name in mocks) return mocks[name];
    if (['crypto', 'jsonwebtoken', 'validator/lib/isEmail'].includes(name)) return require(name);
    assert.fail(`Unexpected dependency: ${name}`);
  }, ...globals });
  return exports;
}
const security = load('src/security/customerAccess.ts');
const verification = load('src/service/clients/CustomerEmailVerificationService.ts', {
  '../product/productTransaction': {}, './CustomerEmailSender': {},
});
function harness(options = {}) {
  let now = 0, chain = Promise.resolve();
  const state = { customers: [
    { id: 'alice', restaurant_id: A, email: 'alice@example.com', verified: true },
    { id: 'bob', restaurant_id: B, email: 'alice@example.com', verified: true },
    { id: 'unverified', restaurant_id: A, email: 'unverified@example.com', verified: false },
  ], challenges: [] };
  const deliveries = [], trace = [];
  const db = { async query(sql, p = []) {
    trace.push({ sql, p });
    if (sql.startsWith('SELECT id FROM public.customers')) {
      assert.match(sql, /restaurant_id = \$1 AND email = \$2 AND email_verified_at IS NOT NULL FOR UPDATE/);
      return { rows: state.customers.filter(c => c.restaurant_id === p[0] && c.email === p[1] && c.verified) };
    }
    if (sql.startsWith('SELECT c.id, c.email')) {
      assert.match(sql, /h.purpose = 'recovery' AND h.email = c.email/);
      const c = state.challenges.find(c => c.id === p[1] && c.restaurant === p[0] && c.purpose === 'recovery');
      return { rows: c ? state.customers.filter(o => o.id === c.customer && o.restaurant_id === p[0] && o.verified && o.email === c.email) : [] };
    }
    assert.match(sql, /purpose = 'recovery'|'recovery'\)/);
    if (sql.includes('count(*)::text')) {
      const recent = state.challenges.filter(c => c.restaurant === p[0] && c.customer === p[1] && c.purpose === 'recovery' && c.created > now - 900000);
      return { rows: [{ recent: String(recent.length), cooldown: recent.some(c => c.created > now - 60000) }] };
    }
    if (sql.startsWith('INSERT')) {
      assert.match(sql, /INTERVAL '5 minutes'/);
      state.challenges.push({ id: p[0], restaurant: p[1], customer: p[2], email: p[3], hash: p[4],
        purpose: 'recovery', attempts: 0, consumed: false, sent: false, created: now, expires: now + 300000 });
    } else if (sql.includes('SET consumed_at = now()')) {
      state.challenges.filter(c => c.restaurant === p[0] && c.customer === p[1] && c.purpose === 'recovery').forEach(c => c.consumed = true);
    } else {
      const c = state.challenges.find(c => c.id === p[0] && c.restaurant === p[1] && c.customer === p[2] && c.purpose === 'recovery');
      if (sql.startsWith('SELECT code_hash')) return { rows: c ? [{ code_hash: c.hash, attempts: c.attempts, usable: c.sent && !c.consumed && c.expires > now }] : [] };
      if (sql.includes('SET sent_at')) { if (c && !c.consumed && c.expires > now) c.sent = true; }
      else if (sql.includes('SET attempts = attempts + 1')) { c.attempts++; if (p[3] || c.attempts >= 5) c.consumed = true; }
      else assert.fail(sql);
    }
    return { rows: [] };
  } };
  const transactions = { productTransaction(fn) {
    const result = chain.then(async () => {
      const snapshot = structuredClone(state);
      try { return await fn(db); } catch (e) { Object.assign(state, snapshot); throw e; }
    });
    chain = result.catch(() => {}); return result;
  } };
  const module = load('src/service/clients/CustomerEmailRecoveryService.ts', {
    crypto: { ...crypto, randomInt: () => 12345 }, '../product/productTransaction': transactions,
    '../../security/customerAccess': security, './CustomerEmailVerificationService': verification,
    './CustomerEmailSender': { async sendCustomerEmailCode(email, code) {
      if (options.failSend) throw new Error('smtp-private-secret');
      if (options.pendingSend) await options.pendingSend;
      deliveries.push({ email, code });
    } },
  });
  return { service: new module.CustomerEmailRecoveryService(), state, deliveries, trace,
    advance(ms) { now += ms; }, async flush() { await new Promise(setImmediate); await chain; } };
}
test('valid recovery issues existing customer JWT with six digits and HMAC-only storage', async () => {
  const h = harness(); const r = await h.service.request(A, ' Alice@Example.com '); await h.flush();
  assert.equal(h.deliveries[0].code, '012345'); assert.match(h.state.challenges[0].hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(h.trace).includes('012345'));
  const result = await h.service.confirm(A, r.challengeId, '012345');
  const actor = security.authenticateCustomerAccess(result.customer_credential);
  assert.equal(actor.customerId, 'alice'); assert.equal(actor.restaurantId, A); assert.equal(actor.type, 'customer');
  assert.equal(h.state.challenges[0].consumed, true);
});
test('unknown and unverified emails, missing restaurant and cooldown share a neutral response', async () => {
  const h = harness(), messages = [];
  for (const [restaurant, email] of [[A, 'alice@example.com'], [A, 'missing@example.com'], [A, 'unverified@example.com'],
    ['00000000-0000-4000-8000-000000000099', 'alice@example.com'], [A, 'alice@example.com']]) {
    const r = await h.service.request(restaurant, email); assert.match(r.challengeId, /^[a-f0-9-]{36}$/); messages.push(r.message);
    if (email !== 'alice@example.com' || restaurant !== A) await assert.rejects(h.service.confirm(restaurant, r.challengeId, '012345'), e => e.status === 400);
  }
  await h.flush(); assert.equal(new Set(messages).size, 1); assert.equal(h.deliveries.length, 1);
});
test('incorrect attempts persist and fifth failure blocks even the correct code', async () => {
  const h = harness(); const r = await h.service.request(A, 'alice@example.com'); await h.flush();
  for (let i = 1; i <= 5; i++) {
    await assert.rejects(h.service.confirm(A, r.challengeId, '999999'), e => e.status === 400);
    assert.equal(h.state.challenges[0].attempts, i);
  }
  await assert.rejects(h.service.confirm(A, r.challengeId, '012345')); assert.equal(h.state.challenges[0].consumed, true);
});
test('expired and reused codes fail; concurrent confirmations issue only one credential', async () => {
  const h = harness(); const r = await h.service.request(A, 'alice@example.com'); await h.flush();
  const results = await Promise.allSettled([h.service.confirm(A, r.challengeId, '012345'), h.service.confirm(A, r.challengeId, '012345')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await assert.rejects(h.service.confirm(A, r.challengeId, '012345'));
  const h2 = harness(); const r2 = await h2.service.request(A, 'alice@example.com'); await h2.flush(); h2.advance(300000);
  await assert.rejects(h2.service.confirm(A, r2.challengeId, '012345'), e => e.status === 400);
});
test('restaurant and purpose isolation reject foreign or verification challenges without consuming them', async () => {
  const h = harness(); const r = await h.service.request(A, 'alice@example.com'); await h.flush();
  await assert.rejects(h.service.confirm(B, r.challengeId, '012345'), e => e.status === 400);
  h.state.challenges[0].purpose = 'verification';
  await assert.rejects(h.service.confirm(A, r.challengeId, '012345'), e => e.status === 400);
  assert.equal(h.state.challenges[0].attempts, 0);
});
test('HMAC domain separation rejects verification hashes', async () => {
  const h = harness(); const r = await h.service.request(A, 'alice@example.com'); await h.flush();
  h.state.challenges[0].hash = crypto.createHmac('sha256', secret).update(JSON.stringify([
    'gama:customer-email:verify:v1', A, 'alice', r.challengeId, 'alice@example.com', '012345',
  ])).digest('hex');
  await assert.rejects(h.service.confirm(A, r.challengeId, '012345'));
});
test('requests enforce 60 seconds and 3 per 15 minutes; resend invalidates the old challenge', async () => {
  const h = harness(); const first = await h.service.request(A, 'alice@example.com'); await h.flush();
  await h.service.request(A, 'alice@example.com'); await h.flush(); assert.equal(h.deliveries.length, 1);
  for (let i = 0; i < 2; i++) { h.advance(60001); await h.service.request(A, 'alice@example.com'); await h.flush(); }
  h.advance(60001); await h.service.request(A, 'alice@example.com'); await h.flush(); assert.equal(h.deliveries.length, 3);
  await assert.rejects(h.service.confirm(A, first.challengeId, '012345'));
  h.advance(900001); await h.service.request(A, 'alice@example.com'); await h.flush(); assert.equal(h.deliveries.length, 4);
});
test('parallel requests are serialized by customer lock and send once', async () => {
  const h = harness(); await Promise.all(Array.from({ length: 4 }, () => h.service.request(A, 'alice@example.com'))); await h.flush();
  assert.equal(h.deliveries.length, 1);
});
test('failed or pending SMTP delivery leaves challenge unusable with neutral response', async () => {
  for (const options of [{ failSend: true }, { pendingSend: new Promise(() => {}) }]) {
    const h = harness(options); const r = await h.service.request(A, 'alice@example.com'); await h.flush();
    assert.match(r.message, /^Se houver/); assert.equal(h.state.challenges[0].sent, false);
    await assert.rejects(h.service.confirm(A, r.challengeId, '012345'), e => e.status === 400 && !e.message.includes('smtp'));
  }
});
test('changing or removing verified email after request prevents recovery', async () => {
  for (const mode of ['unverified', 'changed']) {
    const h = harness(); const r = await h.service.request(A, 'alice@example.com'); await h.flush();
    if (mode === 'unverified') h.state.customers[0].verified = false; else h.state.customers[0].email = 'changed@example.com';
    await assert.rejects(h.service.confirm(A, r.challengeId, '012345'));
  }
});
test('public controller rejects owner injection and sanitizes unexpected failures', async () => {
  const { CustomerEmailRecoveryController } = load('src/controller/clients/CustomerEmailRecoveryController.ts', {
    '../../service/clients/CustomerEmailVerificationService': verification,
    '../../service/clients/CustomerEmailRecoveryService': { CustomerEmailRecoveryService: class { async request() { throw new Error('database-private'); } } },
  });
  for (const [body, status] of [[{ email: 'alice@example.com', customerId: 'bob' }, 400], [{ email: 'alice@example.com' }, 503]]) {
    const res = { set() {}, status(n) { this.code = n; return this; }, json(data) { this.body = data; } };
    await new CustomerEmailRecoveryController().request({ params: { id: A }, body }, res);
    assert.equal(res.code, status); assert.ok(!JSON.stringify(res.body).includes('private'));
  }
});
test('source ceiling ignores spoofed forwarded IP and expires after fifteen minutes', () => {
  let now = 0, next = 0;
  const { customerRecoveryLimit } = load('src/middlewares/customerRecoveryLimit.ts', {}, { Date: { now: () => now } });
  const res = { set() {}, status(n) { this.code = n; return this; }, json() {} };
  for (let i = 0; i < 121; i++) customerRecoveryLimit({ socket: { remoteAddress: 'source' }, headers: { 'x-forwarded-for': String(i) } }, res, () => next++);
  assert.equal(next, 120); assert.equal(res.code, 429); now = 900001;
  customerRecoveryLimit({ socket: { remoteAddress: 'source' } }, res, () => next++); assert.equal(next, 121);
});

test('neutral response is returned before any account lookup or SMTP work', async () => {
  const h = harness(); const r = await h.service.request(A, 'alice@example.com');
  assert.match(r.message, /^Se houver/); assert.equal(h.trace.length, 0); assert.equal(h.deliveries.length, 0);
  await h.flush(); assert.equal(h.deliveries.length, 1);
});
test('recovery does not invalidate pending email verification challenges', async () => {
  const h = harness(); await h.service.request(A, 'alice@example.com'); await h.flush();
  h.state.challenges[0].purpose = 'verification';
  await h.service.request(A, 'alice@example.com'); await h.flush();
  assert.equal(h.state.challenges[0].consumed, false);
  assert.equal(h.state.challenges[1].purpose, 'recovery');
});
