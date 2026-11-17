const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const owner = { customerId: 'alice', restaurantId: 'A' };
function load(file, mocks, env = { JWT_SECRET: 'test-only-email-secret' }) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, { exports, Buffer, process: { env }, require(name) { assert.ok(name in mocks, name); return mocks[name]; } });
  return exports;
}
function harness(options = {}) {
  const state = { challenges: [], email: null, verified: false };
  const deliveries = [], trace = [];
  let saved;
  const client = { async query(sql, p = []) {
    trace.push({ sql, p });
    if (sql.startsWith('SELECT id FROM public.customers')) {
      return { rows: options.missingOwner || p[0] !== owner.customerId || p[1] !== owner.restaurantId ? [] : [{ id: owner.customerId }] };
    }
    if (sql.includes('count(*)::text AS recent')) return { rows: [{ recent: options.tooMany ? '3' : '0', cooldown: Boolean(options.cooldown) }] };
    if (sql.startsWith('INSERT INTO public.customer_email_challenges')) {
      state.challenges.push({ id: p[0], restaurant: p[1], customer: p[2], email: p[3], code_hash: p[4], purpose: 'verification', attempts: 0, consumed: false, sent: false, expired: false });
    } else if (sql.includes('SET sent_at = now()')) {
      const c = state.challenges.find(c => c.id === p[0] && c.restaurant === p[1] && c.customer === p[2] && c.purpose === 'verification' && !c.consumed);
      if (c) c.sent = true;
    } else if (sql.includes('SET consumed_at = now()')) {
      state.challenges.filter(c => c.restaurant === p[0] && c.customer === p[1] && c.purpose === 'verification').forEach(c => c.consumed = true);
    } else if (sql.startsWith('SELECT email, code_hash')) {
      const c = state.challenges.find(c => c.id === p[0] && c.restaurant === p[1] && c.customer === p[2] && c.purpose === 'verification');
      return { rows: c ? [{ ...c, usable: c.sent && !c.consumed && !c.expired }] : [] };
    } else if (sql.includes('SET attempts = attempts + 1')) {
      const c = state.challenges.find(c => c.id === p[0] && c.restaurant === p[1] && c.customer === p[2] && c.purpose === 'verification');
      c.attempts++;
      if (p[3] || c.attempts >= 5) c.consumed = true;
    } else if (sql === 'SAVEPOINT verified_email') saved = structuredClone(state);
    else if (sql === 'ROLLBACK TO SAVEPOINT verified_email') Object.assign(state, saved);
    else if (sql.startsWith('UPDATE public.customers SET email')) {
      assert.deepEqual(Array.from(p.slice(1)), [owner.customerId, owner.restaurantId]);
      if (options.duplicate) throw { code: '23505' };
      state.email = p[0]; state.verified = true;
    } else assert.fail(`Unexpected query: ${sql}`);
    return { rows: [] };
  } };
  const serviceModule = load('src/service/clients/CustomerEmailVerificationService.ts', {
    crypto: { ...crypto, randomInt: () => 12345 },
    'validator/lib/isEmail': require('validator/lib/isEmail'),
    '../product/productTransaction': { async productTransaction(fn) {
      const before = structuredClone(state);
      try { return await fn(client); } catch (e) { Object.assign(state, before); throw e; }
    } },
    './CustomerEmailSender': { async sendCustomerEmailCode(email, code) {
      if (options.failSend) throw new Error('private provider details');
      deliveries.push({ email, code });
    } },
  });
  return { service: new serviceModule.CustomerEmailVerificationService(), state, trace, deliveries };
}
test('correct code is six digits, stored only as HMAC, and email is written only after confirmation', async () => {
  const h = harness(); const result = await h.service.request(owner, ' Alice@Example.com ');
  assert.equal(h.deliveries[0].code, '012345');
  assert.equal(h.state.email, null);
  assert.match(h.state.challenges[0].code_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(h.trace).includes('012345'));
  assert.equal((await h.service.confirm(owner, result.challengeId, '012345')).verified, true);
  assert.equal(h.state.email, 'alice@example.com');
  assert.equal(h.state.verified, true);
});
test('incorrect attempts commit and the fifth failure blocks even the correct code', async () => {
  const h = harness(); const { challengeId } = await h.service.request(owner, 'alice@example.com');
  for (let i = 1; i <= 5; i++) {
    await assert.rejects(h.service.confirm(owner, challengeId, '999999'), e => e.status === 400);
    assert.equal(h.state.challenges[0].attempts, i);
  }
  await assert.rejects(h.service.confirm(owner, challengeId, '012345'));
  assert.equal(h.state.email, null);
});
test('expired codes and repeated successful codes cannot be used', async () => {
  for (const expired of [true, false]) {
    const h = harness(); const { challengeId } = await h.service.request(owner, 'alice@example.com');
    h.state.challenges[0].expired = expired;
    if (!expired) await h.service.confirm(owner, challengeId, '012345');
    await assert.rejects(h.service.confirm(owner, challengeId, '012345'), e => e.status === 400);
  }
});
test('another customer or restaurant cannot confirm or consume a challenge', async () => {
  const h = harness(); const { challengeId } = await h.service.request(owner, 'alice@example.com');
  for (const actor of [{ ...owner, restaurantId: 'B' }, { ...owner, customerId: 'bob' }]) {
    await assert.rejects(h.service.confirm(actor, challengeId, '012345'));
  }
  assert.equal(h.state.challenges[0].attempts, 0);
  assert.equal(h.state.email, null);
});
test('duplicate verified email consumes the code, returns generic failure and keeps the previous email', async () => {
  const h = harness({ duplicate: true });
  h.state.email = 'previous@example.com';
  const { challengeId } = await h.service.request(owner, 'alice@example.com');
  await assert.rejects(h.service.confirm(owner, challengeId, '012345'), e => e.status === 400);
  assert.equal(h.state.email, 'previous@example.com');
  assert.equal(h.state.challenges[0].consumed, true);
});
test('provider failure leaves the new email unverified and its challenge unusable', async () => {
  const h = harness({ failSend: true });
  await assert.rejects(h.service.request(owner, 'alice@example.com'), e => e.status === 503 && !e.message.includes('private'));
  const c = h.state.challenges[0];
  assert.equal(c.sent, false);
  await assert.rejects(h.service.confirm(owner, c.id, '012345'));
  assert.equal(h.state.email, null);
});
test('resend invalidates the old code without overwriting the verified address', async () => {
  const h = harness();
  const old = await h.service.request(owner, 'alice@example.com');
  const next = await h.service.request(owner, 'other@example.com');
  await assert.rejects(h.service.confirm(owner, old.challengeId, '012345'));
  await h.service.confirm(owner, next.challengeId, '012345');
  assert.equal(h.state.email, 'other@example.com');
});
test('invalid email, cooldown and request quota prevent sending', async () => {
  for (const options of [{ cooldown: true }, { tooMany: true }]) {
    const h = harness(options);
    await assert.rejects(h.service.request(owner, 'alice@example.com'), e => e.status === 429);
    assert.equal(h.deliveries.length, 0);
  }
  const h = harness(); await assert.rejects(h.service.request(owner, 'invalid'));
  assert.equal(h.trace.length, 0);
});
test('controller rejects administrators, missing identities and caller-supplied owner fields', async () => {
  const { CustomerEmailVerificationController } = load('src/controller/clients/CustomerEmailVerificationController.ts', {
    '../../service/clients/CustomerEmailVerificationService': { CustomerEmailError: Error, CustomerEmailVerificationService: class {} },
  });
  for (const actor of [undefined, { type: 'restaurant', restaurantId: 'A' }]) {
    const res = { locals: { customerPrincipal: actor }, set() {}, status(n) { this.code = n; return this; }, json() {} };
    await new CustomerEmailVerificationController().request({ body: { email: 'alice@example.com' } }, res);
    assert.equal(res.code, 403);
  }
  const res = { locals: { customerPrincipal: { ...owner, type: 'customer' } }, set() {}, status(n) { this.code = n; return this; }, json() {} };
  await new CustomerEmailVerificationController().request({ body: { email: 'alice@example.com', restaurantId: 'B' } }, res);
  assert.equal(res.code, 400);
});
test('Gmail SMTP sender checks acceptance, rejection, transport failures and missing credentials without exposing details', async () => {
  for (const mode of ['success', 'rejected', 'empty', 'throw', 'transport-error', 'missing-user', 'missing-password']) {
    let calls = 0, transports = 0;
    const env = { EMAIL_USER: 'sender@example.com', EMAIL_APP_PASSWORD: 'test-app-password' };
    if (mode === 'missing-user') delete env.EMAIL_USER;
    if (mode === 'missing-password') delete env.EMAIL_APP_PASSWORD;
    const { sendCustomerEmailCode } = load('src/service/clients/CustomerEmailSender.ts', {
      nodemailer: { createTransport(options) {
        transports++;
        assert.equal(options.service, 'gmail');
        assert.equal(options.auth.user, env.EMAIL_USER);
        assert.equal(options.auth.pass, env.EMAIL_APP_PASSWORD);
        assert.equal(options.logger, false);
        assert.equal(options.debug, false);
        if (mode === 'transport-error') throw new Error('provider-secret');
        return { async sendMail(input) {
          calls++;
          assert.equal(input.from.address, env.EMAIL_USER);
          assert.equal(input.to, 'alice@example.com');
          assert.equal(input.subject, 'Confirme seu e-mail — Gama Delivery');
          assert.ok(input.text.includes('012345'));
          assert.ok(input.text.includes('5 minutos'));
          if (mode === 'throw') throw new Error('provider-secret');
          if (mode === 'empty') return {};
          return { accepted: mode === 'rejected' ? [] : [input.to], rejected: mode === 'rejected' ? [input.to] : [] };
        } };
      } },
    }, env);
    if (mode === 'success') await sendCustomerEmailCode('alice@example.com', '012345');
    else await assert.rejects(sendCustomerEmailCode('alice@example.com', '012345'), error =>
      ['Customer email sender unavailable', 'Customer email delivery failed'].includes(error.message));
    const unconfigured = mode === 'missing-user' || mode === 'missing-password';
    assert.equal(transports, unconfigured ? 0 : 1);
    assert.equal(calls, unconfigured || mode === 'transport-error' ? 0 : 1);
  }
});

test('authenticated verification cannot confirm or invalidate a recovery challenge', async () => {
  const h = harness(); const r = await h.service.request(owner, 'alice@example.com');
  h.state.challenges[0].purpose = 'recovery';
  await assert.rejects(h.service.confirm(owner, r.challengeId, '012345'), e => e.status === 400);
  assert.equal(h.state.challenges[0].attempts, 0);
  await h.service.request(owner, 'other@example.com');
  assert.equal(h.state.challenges[0].consumed, false);
});
