import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

export const isTenantUUID = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export interface TenantSessionRecord {
  version: 1;
  restaurantId: string;
  sessionId: string;
  enabled: boolean;
}

/** Only non-secret session metadata. Baileys files stay in their independent auth directories. */
export class TenantSessionStore {
  readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }
  private metadata() { return path.join(this.root, ".tenants"); }
  private filename(id: string) {
    if (!isTenantUUID(id)) throw new Error("Invalid tenant identity");
    return path.join(this.metadata(), `${id.toLowerCase()}.json`);
  }
  private validate(record: TenantSessionRecord, id: string): TenantSessionRecord {
    if (record?.version !== 1 || record.restaurantId !== id.toLowerCase() ||
        !isTenantUUID(record.sessionId) || typeof record.enabled !== "boolean") throw new Error("Invalid session metadata");
    return { version: 1, restaurantId: record.restaurantId, sessionId: record.sessionId, enabled: record.enabled };
  }
  async read(id: string): Promise<TenantSessionRecord | undefined> {
    try {
      const file = this.filename(id), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe session metadata");
      return this.validate(JSON.parse(await fs.readFile(file, "utf8")), id);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async save(record: TenantSessionRecord): Promise<void> {
    record = this.validate(record, record.restaurantId);
    for (const directory of [this.root, this.metadata()]) {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe session directory");
    }
    const target = this.filename(record.restaurantId), temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, target);
      const directory = await fs.open(this.metadata(), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  }
  async list(): Promise<{ records: TenantSessionRecord[]; invalid: number }> {
    let names: string[];
    try { names = await fs.readdir(this.metadata()); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], invalid: 0 }; throw error; }
    const records: TenantSessionRecord[] = [];
    let invalid = 0;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!isTenantUUID(id)) { invalid++; continue; }
      try { const record = await this.read(id); if (record) records.push(record); }
      catch { invalid++; } // Preserve damaged metadata; one tenant must not block another's recovery.
    }
    return { records, invalid };
  }
}
