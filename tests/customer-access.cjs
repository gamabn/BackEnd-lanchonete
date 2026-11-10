const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const jwt = require('jsonwebtoken');
const { createHmac } = require('node:crypto');
const secret = 'customer-profile-test-secret';
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports, process: { env: { JWT_SECRET: secret } },
    require: name => {
      if (name in mocks) return mocks[name];
      if (['crypto', 'jsonwebtoken'].includes(name)) return require(name);
      assert.fail(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const security = load('src/security/customerAccess.ts');
const alice = { id: 'alice', restaurant_id: 'A', name: 'Alice', phone: '111', city: 'City' };
const bob = { id: 'bob', restaurant_id: 'A', name: 'Bob', phone: '222', city: 'City' };
const otherStore = { id: 'carol', restaurant_id: 'B', name: 'Carol', phone: '111', city: 'City' };
const contact = { name: 'Changed', phone: '333', city: 'City', street: 'Street', number: '1', neighborhood: 'Area', complement: 'House' };
const ownerToken = id => jwt.sign({}, secret, { subject: id, expiresIn: '1h' });
const customerToken = row => security.issueCustomerCredential(row);
function response() {
  return { locals: {}, statusCode: 200, set() { return this; }, status(n) { this.statusCode = n; return this; }, json(data) { this.body = data; return this; } };
}
function authorize(token, restaurant, extraHeaders = {}) {
  const req = { headers: { authorization: token && `Bearer ${token}`, ...extraHeaders }, params: restaurant ? { id: restaurant } : {} };
  const res = response(); let passed = false;
  security.customerAccess(req, res, () => { passed = true; });
  return { req, res, passed };
}
function services() {
  const records = [alice, bob, otherStore].map(row => ({ ...row }));
  const calls = [];
  const pool = { query: async (sql, params) => {
    calls.push({ sql, params });
    assert.doesNotMatch(sql, /SELECT \*|RETURNING \*/);
    if (sql.startsWith('SELECT')) {
      assert.match(sql, /WHERE restaurant_id = \$1/);
      if (params.length === 3) assert.match(sql, /AND id = \$3/);
      return { rows: records.filter(row => row.restaurant_id === params[0] && (!params[1] || row.phone === params[1]) && (params.length !== 3 || row.id === params[2])) };
    }
    if (sql.startsWith('UPDATE')) {
      assert.match(sql, /WHERE id = \$8 AND restaurant_id = \$9/);
      assert.doesNotMatch(sql.split('WHERE')[0], /SET id|SET restaurant_id|, restaurant_id\s*=/);
      const row = records.find(row => row.id === params[7] && row.restaurant_id === params[8]);
      if (row) ['name', 'phone', 'city', 'street', 'number', 'neighborhood', 'complement'].forEach((key, i) => { row[key] = params[i]; });
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith('INSERT')) {
      assert.match(sql, /FROM restaurants r WHERE r.id = \$8/);
      assert.doesNotMatch(sql, /ON CONFLICT|UPDATE|WHERE phone/);
      const row = { id: `created-${records.length}`, restaurant_id: params[7] };
      ['name', 'phone', 'city', 'street', 'number', 'neighborhood', 'complement'].forEach((key, i) => { row[key] = params[i]; });
      records.push(row); return { rows: [row] };
    }
    assert.fail(sql);
  } };
  const dependencies = { '../../database': { pool }, '../../security/customerAccess': security };
  return {
    records, calls,
    ...load('src/service/clients/GetClientService.ts', dependencies),
    ...load('src/service/clients/UpdateClientService.ts', dependencies),
    ...load('src/service/clients/CreateClientService.ts', dependencies),
  };
}
function controllers(s) {
  const dependencies = {
    '../../security/customerAccess': security,
    '../../service/clients/GetClientService': { GetClientService: s.GetClientService },
    '../../service/clients/UpdateClientService': { UpdateClientService: s.UpdateClientService },
    '../../service/clients/CreateClientService': { CreateClientService: s.CreateClientService },
  };
  return { ...load('src/controller/clients/GetClientController.ts', dependencies),
    ...load('src/controller/clients/UpdateClientController.ts', dependencies),
    ...load('src/controller/clients/CreateClientController.ts', dependencies) };
}

test('missing, invalid, tampered, expired and wrong-purpose credentials are rejected', () => {
  const key = createHmac('sha256', secret).update('gama:customer-profile:v1').digest();
  const expired = jwt.sign({ restaurantId: 'A' }, key, { subject: 'alice', audience: 'customer-profile', issuer: 'gama-delivery', expiresIn: -1 });
  const wrongPurpose = jwt.sign({ restaurantId: 'A' }, key, { subject: 'alice', audience: 'chat-socket', issuer: 'gama-delivery', expiresIn: 300 });
  const chatKey = createHmac('sha256', secret).update('gama:chat:customer:v1').digest();
  const chatCredential = jwt.sign({ orderId: 'order-a' }, chatKey, { subject: 'alice', audience: 'customer-chat', expiresIn: 300 });
  for (const token of [undefined, 'fake', customerToken(alice) + 'tampered', expired, wrongPurpose, chatCredential]) {
    const { res, passed } = authorize(token, 'A'); assert.equal(passed, false); assert.equal(res.statusCode, 401);
  }
});

test('customer credentials cannot authenticate administrative, chat or orders Socket.IO APIs', () => {
  const token = customerToken(alice);
  assert.throws(() => jwt.verify(token, secret));
  for (const purpose of ['gama:chat:customer:v1', 'gama:chat:socket:v1', 'gama-delivery:orders-socket:v1']) {
    const key = createHmac('sha256', secret).update(purpose).digest();
    assert.throws(() => jwt.verify(token, key));
  }
  const principal = security.authenticateCustomerAccess(token);
  assert.equal(principal.customerId, 'alice'); assert.equal(principal.restaurantId, 'A');
});

test('a valid customer credential cannot cross establishments even with a matching phone', () => {
  assert.equal(authorize(customerToken(alice), 'B').res.statusCode, 403);
  assert.equal(authorize(customerToken(otherStore), 'A').res.statusCode, 403);
  assert.equal(authorize(customerToken(alice), undefined, { 'x-customer-restaurant': 'B' }).res.statusCode, 403);
  assert.equal(authorize(ownerToken('A'), 'B').res.statusCode, 403);
});

test('customer GET returns only its own row; another phone or UUID does not expand access', async () => {
  const s = services(); const { GetClientController } = controllers(s);
  const own = authorize(customerToken(alice), 'A');
  await new GetClientController().handle({ ...own.req, query: {} }, own.res);
  assert.equal(own.res.body.length, 1); assert.equal(own.res.body[0].id, 'alice');
  const other = authorize(customerToken(alice), 'A');
  await new GetClientController().handle({ ...other.req, query: { phone: '222', id: 'bob' } }, other.res);
  assert.equal(other.res.statusCode, 404);
  const owner = authorize(ownerToken('A'), 'A');
  await new GetClientController().handle({ ...owner.req, query: { phone: '111' } }, owner.res);
  assert.equal(owner.res.body.length, 1); assert.equal(owner.res.body[0].restaurant_id, 'A');
});

test('public update rejects internal fields and updates only the signed customer and establishment', async () => {
  const s = services(); const { UpdateClientController } = controllers(s);
  for (const [key, value] of [['id', 'bob'], ['restaurant_id', 'B'], ['created_at', 'now'], ['customer_id', 'bob'], ['customer_credential', 'fake'], ['password', 'secret']]) {
    const { req, res } = authorize(customerToken(alice));
    await new UpdateClientController().handle({ ...req, body: { ...contact, [key]: value } }, res);
    assert.equal(res.statusCode, 400); assert.equal(s.calls.length, 0);
  }
  const { req, res } = authorize(customerToken(alice));
  await new UpdateClientController().handle({ ...req, body: contact }, res);
  assert.equal(res.body.id, 'alice'); assert.equal(res.body.restaurant_id, 'A');
  assert.equal(s.records.find(row => row.id === 'bob').name, 'Bob');
  assert.equal(s.records.find(row => row.id === 'carol').name, 'Carol');
  assert.equal(s.calls.at(-1).params[7], 'alice'); assert.equal(s.calls.at(-1).params[8], 'A');
});

test('owner updates are tenant-scoped even when the customer ID is known', async () => {
  const s = services(); const { UpdateClientController } = controllers(s);
  const { req, res } = authorize(ownerToken('A'));
  await new UpdateClientController().handle({ ...req, body: { ...contact, id: 'carol' } }, res);
  assert.equal(res.statusCode, 404); assert.equal(s.records.find(row => row.id === 'carol').name, 'Carol');
});

test('signup issues access only to a newly inserted record, never the existing phone match', async () => {
  const s = services(); const { CreateClientController } = controllers(s);
  const res = response();
  await new CreateClientController().handle({ params: { id: 'A' }, body: { name: 'New', phone: alice.phone, city: 'City' } }, res);
  assert.equal(res.statusCode, 201); assert.notEqual(res.body.id, 'alice');
  const principal = security.authenticateCustomerAccess(res.body.customer_credential);
  assert.equal(principal.customerId, res.body.id); assert.equal(principal.restaurantId, 'A');
  assert.equal(s.records.find(row => row.id === 'alice').name, 'Alice');
});

test('legacy uniqueness conflicts do not grant credentials or recover a record by phone', async () => {
  const { CreateClientController } = controllers({ CreateClientService: class {
    async execute() { throw { code: '23505', detail: 'private existing customer details' }; }
  } });
  const res = response();
  await new CreateClientController().handle({ params: { id: 'A' }, body: { name: 'New', phone: '111', city: 'City' } }, res);
  assert.equal(res.statusCode, 409); assert.equal('customer_credential' in res.body, false);
  assert.equal(JSON.stringify(res.body).includes('private existing'), false);
});

test('signup rejects caller-supplied internal fields and nonexistent establishments receive no credential', async () => {
  const s = services(); const { CreateClientController } = controllers(s);
  for (const field of ['id', 'restaurant_id', 'created_at']) {
    const res = response();
    await new CreateClientController().handle({ params: { id: 'A' }, body: { ...contact, [field]: 'fake' } }, res);
    assert.equal(res.statusCode, 400); assert.equal(s.calls.length, 0);
  }
  const { CreateClientController: MissingController } = controllers({ CreateClientService: class { async execute() { return undefined; } } });
  const res = response(); await new MissingController().handle({ params: { id: 'missing' }, body: contact }, res);
  assert.equal(res.statusCode, 404); assert.equal('customer_credential' in res.body, false);
});
