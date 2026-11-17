const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const postgres = process.env.GAMA_TEST_POSTGRES_BIN || 'postgres';
const initdb = process.env.GAMA_TEST_INITDB_BIN || 'initdb';
const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
const available = [postgres, initdb].every(bin => spawnSync(bin, ['--version'], { env: environment }).status === 0);

test('migration works on disposable PostgreSQL: unique tenant email, composite FK and runtime grants', {
  skip: available ? false : 'Local PostgreSQL tools unavailable',
}, () => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'gama-email-migration-'));
  try {
    const initialized = spawnSync(initdb, ['-D', cluster, '-A', 'trust', '-U', 'gama_email_test',
      '--no-sync', '--locale=C', '--encoding=UTF8'], { env: environment, encoding: 'utf8', timeout: 30000 });
    assert.equal(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/runtime-role-schema.sql'), 'utf8');
    const migration = fs.readFileSync(path.join(__dirname, '../migrations/003_customer_email_verification.sql'), 'utf8');
    const sql = `CREATE ROLE gama_app NOSUPERUSER NOBYPASSRLS;
${fixture}
${migration}
BEGIN;
INSERT INTO customers(id,restaurant_id,name) VALUES
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','One'),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','Two'),
('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000002','Other restaurant');
UPDATE customers SET email='shared@example.invalid', email_verified_at=now()
WHERE id IN ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000103');
DO $test$
DECLARE observed TEXT;
BEGIN
  PERFORM set_config('exit_on_error','off',true);
  BEGIN
    UPDATE customers SET email='shared@example.invalid',email_verified_at=now()
    WHERE id='00000000-0000-4000-8000-000000000102';
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE;
  END;
  IF observed IS DISTINCT FROM '23505' THEN RAISE EXCEPTION 'Same-restaurant uniqueness failed: %',observed; END IF;
  observed := NULL;
  BEGIN
    INSERT INTO customer_email_challenges(id,restaurant_id,customer_id,email,code_hash,expires_at)
    VALUES ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000101','test@example.invalid',repeat('a',64),now()+interval '5 minutes');
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed=RETURNED_SQLSTATE;
  END;
  IF observed IS DISTINCT FROM '23503' THEN RAISE EXCEPTION 'Cross-tenant FK failed: %',observed; END IF;
  IF NOT has_column_privilege('gama_app','customers','email','UPDATE')
    OR NOT has_column_privilege('gama_app','customers','email_verified_at','UPDATE')
    OR NOT has_table_privilege('gama_app','customer_email_challenges','SELECT')
    OR NOT has_column_privilege('gama_app','customer_email_challenges','attempts','UPDATE')
    OR NOT has_column_privilege('gama_app','customer_email_challenges','code_hash','INSERT') THEN
    RAISE EXCEPTION 'Required grants missing';
  END IF;
  IF has_column_privilege('gama_app','customer_email_challenges','code_hash','UPDATE') THEN
    RAISE EXCEPTION 'Unexpected hash UPDATE grant';
  END IF;
  PERFORM set_config('exit_on_error','on',true);
END $test$;
ROLLBACK;`;
    const inputPath = path.join(cluster, 'test.sql');
    fs.writeFileSync(inputPath, sql);
    const input = fs.openSync(inputPath, 'r');
    let result;
    try {
      result = spawnSync(postgres, ['--single', '-D', cluster, '-c', 'exit_on_error=true',
        '-c', 'log_checkpoints=off', '-c', 'log_min_messages=error', '-j', 'postgres'], {
        env: environment, stdio: [input, 'pipe', 'pipe'], encoding: 'utf8', timeout: 30000,
      });
    } finally { fs.closeSync(input); }
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    if (path.dirname(cluster) === os.tmpdir() && path.basename(cluster).startsWith('gama-email-migration-')) {
      fs.rmSync(cluster, { recursive: true });
    }
  }
});
