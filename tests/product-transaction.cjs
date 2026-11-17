const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Load only the helper; never import the real database module or read DATABASE_URL.
function harness({ failAt, rollbackFails = false, loggerFails = false, connectFails = false } = {}) {
  const original = new Error('original transaction error');
  const rollbackError = new Error('sensitive driver details must not appear in logs');
  const trace = [], releases = [], logs = [];
  const client = {
    async query(sql) {
      trace.push(sql);
      if (sql === 'ROLLBACK' && rollbackFails) throw rollbackError;
      if (sql === failAt) throw original;
      return { rows: [] };
    },
    release(...args) { releases.push(args); },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/service/product/productTransaction.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    console: { error(...args) {
      logs.push(args);
      if (loggerFails) throw new Error('logging unavailable');
    } },
    require(name) {
      assert.equal(name, '../../database');
      return { pool: { async connect() {
        if (connectFails) throw original;
        return client;
      } } };
    },
  });
  return {
    ...exports, original, rollbackError, trace, releases, logs,
    async operation(receivedClient) {
      assert.equal(receivedClient, client);
      trace.push('operation');
      if (failAt === 'operation') throw original;
      return { saved: true };
    },
  };
}

test('successful transaction preserves its result and releases once without discarding', async () => {
  const h = harness();
  assert.deepEqual(await h.productTransaction(h.operation), { saved: true });
  assert.deepEqual(h.trace, ['BEGIN', 'operation', 'COMMIT']);
  assert.deepEqual(h.releases, [[]]);
  assert.deepEqual(h.logs, []);
});

for (const failAt of ['BEGIN', 'operation', 'COMMIT']) {
  for (const rollbackFails of [false, true]) {
    test(`${failAt} failure preserves the original error; rollback ${rollbackFails ? 'fails and discards' : 'succeeds and releases'}`, async () => {
      const h = harness({ failAt, rollbackFails });
      await assert.rejects(h.productTransaction(h.operation), error => error === h.original);
      const expected = ['BEGIN'];
      if (failAt !== 'BEGIN') expected.push('operation');
      if (failAt === 'COMMIT') expected.push('COMMIT');
      expected.push('ROLLBACK');
      assert.deepEqual(h.trace, expected);
      assert.deepEqual(h.releases, rollbackFails ? [[true]] : [[]]);
      assert.equal(h.logs.length, rollbackFails ? 1 : 0);
      if (rollbackFails) {
        assert.deepEqual(h.logs[0], ['productTransaction: ROLLBACK failed; discarding database connection.']);
        assert.ok(!JSON.stringify(h.logs).includes(h.rollbackError.message));
      }
    });
  }
}

test('logging failure cannot mask the operation error or prevent connection discard', async () => {
  const h = harness({ failAt: 'operation', rollbackFails: true, loggerFails: true });
  await assert.rejects(h.productTransaction(h.operation), error => error === h.original);
  assert.deepEqual(h.releases, [[true]]);
});

test('pool acquisition failure preserves its error without attempting queries or release', async () => {
  const h = harness({ connectFails: true });
  await assert.rejects(h.productTransaction(h.operation), error => error === h.original);
  assert.deepEqual(h.trace, []);
  assert.deepEqual(h.releases, []);
});
