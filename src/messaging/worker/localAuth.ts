import fs from "fs/promises";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { hostname } from "os";
import type { LocalBotConfig } from "./config";
import { BotDiagnosticError } from "./diagnostics";

const processInstance = randomUUID();

/** Disk credentials with exclusive leases; unknown existing locks are never reclaimed. */
export async function acquireLocalAuth(config: LocalBotConfig, bootIdentity = async () =>
  process.platform === "linux" ? (await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim() : "local",
): Promise<() => Promise<void>> {
  const parts = path.relative(config.authRoot, config.authDir).split(path.sep);
  let current = config.authRoot;
  for (const part of ["", ...parts]) {
    current = part ? path.join(current, part) : current;
    await fs.mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BotDiagnosticError("local_auth", "UNSAFE_AUTH_DIRECTORY", "Diretório local inseguro.");
    await fs.chmod(current, 0o700);
  }
  // Never remove an unknown legacy lock or credentials. Linux boot IDs isolate stale
  // locks from an earlier boot without risking takeover of another live process.
  const legacy = await fs.lstat(path.join(config.authDir, ".worker.lock")).catch(error => { if (error.code !== "ENOENT") throw error; });
  if (legacy) throw new BotDiagnosticError("local_auth", "LOCK_PRESENT", "Lock legado presente. Confirme que o worker parou e remova somente o lock vazio; preserve as credenciais.");
  const boot = await bootIdentity();
  if (!/^[a-zA-Z0-9-]+$/.test(boot)) throw new BotDiagnosticError("local_auth", "INVALID_BOOT_ID", "Não foi possível conferir o boot local.");
  const scope = createHash("sha256").update(JSON.stringify(config.context)).digest("hex");
  const lockRoot = path.join(config.authRoot, ".session-locks");
  const bindings = path.join(config.authRoot, ".session-bindings");
  for (const directory of [lockRoot, bindings]) {
    await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new BotDiagnosticError("local_auth", "UNSAFE_AUTH_DIRECTORY", "Diretório local inseguro.");
  }
  const sessionLock = path.join(lockRoot, `${scope}-${boot}.lock`);
  const lock = path.join(config.authDir, `.worker-${boot}.lock`);
  const owner = { version: 1, pid: process.pid, instance: processInstance, lease: randomUUID(), boot,
    hostname: hostname(), pidNamespace: await fs.readlink("/proc/self/ns/pid").catch(() => null),
    processStart: await fs.readFile("/proc/self/stat", "utf8").then(value => value.slice(value.lastIndexOf(")") + 2).split(" ")[19]).catch(() => null) };
  const acquire = async (name: string) => {
    await fs.mkdir(name, { mode: 0o700 }).catch(error => {
      if (error.code === "EEXIST") throw new BotDiagnosticError("local_auth", "LOCK_PRESENT", "Autenticação em uso ou lock pendente neste boot. Confira os processos antes de remover somente os locks; preserve as credenciais.");
      throw error;
    });
    const identity = await fs.lstat(name);
    const ownerFile = path.join(name, "owner.json");
    let ownerCreated = false;
    try {
      const file = await fs.open(ownerFile, "wx", 0o600); ownerCreated = true;
      try { await file.writeFile(JSON.stringify(owner)); await file.sync(); } finally { await file.close(); }
    }
    catch (error) {
      // A partial write is ours, but never remove unexpected content or a replaced lock.
      if (ownerCreated) await fs.unlink(ownerFile).catch(() => {});
      await fs.rmdir(name).catch(() => {});
      throw error;
    }
    let ownerRemoved = false, released = false;
    return async () => {
      if (released) return;
      const current = await fs.lstat(name);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
        throw new BotDiagnosticError("local_auth", "LOCK_OWNER_CHANGED", "Lock substituído; arquivos preservados.");
      if (!ownerRemoved) {
        const stat = await fs.lstat(ownerFile);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new BotDiagnosticError("local_auth", "LOCK_OWNER_CHANGED", "Proprietário do lock alterado.");
        const saved = JSON.parse(await fs.readFile(ownerFile, "utf8"));
        if (saved.lease !== owner.lease || saved.instance !== owner.instance)
          throw new BotDiagnosticError("local_auth", "LOCK_OWNER_CHANGED", "Proprietário do lock alterado.");
        await fs.unlink(ownerFile); ownerRemoved = true;
      }
      await fs.rmdir(name); released = true;
    };
  };
  const releaseSession = await acquire(sessionLock);
  let releaseDirectory: () => Promise<void>;
  try { releaseDirectory = await acquire(lock); } catch (error) { await releaseSession(); throw error; }
  let releaseTask: Promise<void> | undefined;
  const release = () => {
    if (!releaseTask) releaseTask = (async () => { await releaseDirectory(); await releaseSession(); })()
      .catch(error => { releaseTask = undefined; throw error; });
    return releaseTask;
  };
  try {
    const bindingFile = path.join(bindings, `${scope}.json`);
    const relativeDir = path.relative(config.authRoot, config.authDir);
    const bound = await fs.lstat(bindingFile).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (bound) {
      if (!bound.isFile() || bound.isSymbolicLink()) throw new BotDiagnosticError("local_auth", "INVALID_SESSION_BINDING", "Vínculo local inválido; arquivo preservado.");
      let saved: unknown;
      try { saved = JSON.parse(await fs.readFile(bindingFile, "utf8")); }
      catch { throw new BotDiagnosticError("local_auth", "INVALID_SESSION_BINDING", "Vínculo local ilegível; arquivo preservado."); }
      if (saved !== relativeDir) throw new BotDiagnosticError("local_auth", "SESSION_AUTH_DIR_CHANGED", "A sessão já está vinculada a outro diretório. Reutilize o diretório original; para novo pareamento, configure uma nova sessão explicitamente.");
    }
    const marker = path.join(config.authDir, ".context.json");
    const entries = await fs.readdir(config.authDir);
    const stat = await fs.lstat(marker).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (stat) {
      if (!stat.isFile() || stat.isSymbolicLink()) throw new BotDiagnosticError("local_auth", "INVALID_CONTEXT_MARKER", "Marcador de autenticação inválido.");
      const markerText = await fs.readFile(marker, "utf8");
      let saved: unknown;
      try { saved = JSON.parse(markerText); }
      catch { throw new BotDiagnosticError("local_auth", "INVALID_CONTEXT_JSON", "Marcador de contexto não é JSON válido; arquivo preservado."); }
      if (JSON.stringify(saved) !== JSON.stringify(config.context)) throw new BotDiagnosticError("local_auth", "CONTEXT_MISMATCH", "Autenticação pertence a outro contexto de teste.");
    } else {
      if (entries.some(entry => !/^\.worker-[a-zA-Z0-9-]+\.lock$/.test(entry))) throw new BotDiagnosticError("local_auth", "UNBOUND_AUTH_FILES", "Não adotar credenciais sem contexto; escolha uma pasta vazia.");
      await fs.writeFile(marker, JSON.stringify(config.context), { mode: 0o600, flag: "wx" });
    }
    // Refuse links in an existing credential directory before Baileys reads it.
    for (const entry of await fs.readdir(config.authDir)) {
      const item = await fs.lstat(path.join(config.authDir, entry));
      if (item.isSymbolicLink()) throw new BotDiagnosticError("local_auth", "AUTH_SYMLINK", "Link simbólico não permitido na autenticação.");
      if (item.isFile()) await fs.chmod(path.join(config.authDir, entry), 0o600);
      else if (!/^\.worker-[a-zA-Z0-9-]+\.lock$/.test(entry)) throw new BotDiagnosticError("local_auth", "UNEXPECTED_AUTH_DIRECTORY", "Subdiretório inesperado na autenticação.");
    }
    if (!bound) await fs.writeFile(bindingFile, JSON.stringify(relativeDir), { mode: 0o600, flag: "wx" });
    return release;
  } catch (error) { await release(); throw error; }
}
