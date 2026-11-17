// Read-only: never acquires/releases locks, loads Baileys or accesses the database.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function audit(root, boot) {
  root = path.resolve(root);
  async function stat(relative) {
    let current = root;
    for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
      current = path.join(current, part);
      const value = await fs.lstat(current).catch(e => { if (e.code !== 'ENOENT') throw e; });
      if (!value) return undefined;
      if (value.isSymbolicLink()) throw Error('Unsafe audit path');
    }
    return fs.lstat(current);
  }
  async function json(relative) {
    const value = await stat(relative);
    if (!value) return undefined;
    if (!value.isFile()) throw Error('Invalid audit file');
    return JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
  }
  if (!/^[a-zA-Z0-9-]+$/.test(boot)) throw Error('Invalid boot identity');
  if (!await stat('.tenants')) return { tenants: [], processOwnership: 'unknown' };
  const tenants = [], accounts = new Map();
  for (const name of (await fs.readdir(path.join(root, '.tenants'))).sort()) {
    if (!uuid.test(name.slice(0, -5)) || !name.endsWith('.json')) continue;
    const restaurantId = name.slice(0, -5);
    try {
      const record = await json(path.join('.tenants', name));
      if (record.version !== 1 || record.restaurantId !== restaurantId || !uuid.test(record.sessionId) || typeof record.enabled !== 'boolean') throw Error('Invalid metadata');
      const context = { restaurant_id: restaurantId, session_id: record.sessionId, channel: 'whatsapp' };
      const directory = path.join(restaurantId, record.sessionId);
      const scope = createHash('sha256').update(JSON.stringify(context)).digest('hex');
      const candidates = {
        legacy: path.join(directory, '.worker.lock'),
        session: path.join('.session-locks', `${scope}-${boot}.lock`),
        directory: path.join(directory, `.worker-${boot}.lock`),
      };
      const locks = {}, lockDetails = {};
      for (const [kind, file] of Object.entries(candidates)) {
        locks[kind] = Boolean(await stat(file));
        if (!locks[kind]) continue;
        const owner = await json(path.join(file, 'owner.json'));
        // Empty legacy locks have unknown ownership; never infer "stale" from a PID alone.
        const valid = owner?.version === 1 && Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
          uuid.test(owner.instance) && uuid.test(owner.lease) && /^[a-zA-Z0-9-]+$/.test(owner.boot) &&
          typeof owner.hostname === 'string' && /^[a-zA-Z0-9_.-]{1,253}$/.test(owner.hostname) &&
          (owner.pidNamespace === null || /^pid:\[\d+\]$/.test(owner.pidNamespace)) &&
          (owner.processStart === null || /^\d+$/.test(owner.processStart));
        lockDetails[kind] = { path: file, owner: valid ? {
          pid: owner.pid, instance: owner.instance, boot: owner.boot, hostname: owner.hostname,
          pidNamespace: owner.pidNamespace, processStart: owner.processStart,
        } : null };
      }
      const marker = await json(path.join(directory, '.context.json'));
      const binding = await json(path.join('.session-bindings', `${scope}.json`));
      const creds = await json(path.join(directory, 'creds.json'));
      // Compare only the linked account portion; never return JIDs, phone numbers or keys.
      const account = typeof creds?.me?.id === 'string' ? creds.me.id.split('@')[0].split(':')[0] : undefined;
      if (account) accounts.set(restaurantId, account);
      tenants.push({ restaurantId, sessionId: record.sessionId, enabled: record.enabled,
        contextMatches: JSON.stringify(marker) === JSON.stringify(context),
        bindingMatches: binding === directory, locks, lockDetails,
        linkedAccountPresent: Boolean(account), duplicateLinkedAccount: false });
    } catch {
      tenants.push({ restaurantId, error: 'AUDIT_UNAVAILABLE' });
    }
  }
  for (const tenant of tenants) {
    const account = accounts.get(tenant.restaurantId);
    if (account) tenant.duplicateLinkedAccount = [...accounts].some(([id, other]) => id !== tenant.restaurantId && account === other);
  }
  return { tenants, processOwnership: 'unknown' };
}

module.exports = { audit };
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  (async () => {
    const root = process.argv[2] || process.env.WHATSAPP_AUTH_ROOT || path.resolve(__dirname, '..', '.gama-whatsapp');
    const boot = process.platform === 'linux' ? (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() : 'local';
    console.log(JSON.stringify(await audit(root, boot), null, 2));
  })().catch(() => { console.error('AUDIT_UNAVAILABLE: confira caminho e permissões; arquivos preservados.'); process.exitCode = 1; });
}
