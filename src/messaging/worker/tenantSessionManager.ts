import path from "path";
import { createHash } from "crypto";
import { ApiWhatsAppHost } from "./apiHost";
import type { CheckoutHost } from "./checkoutStartup";
import type { LocalBotConfig } from "./config";
import type { WorkerConnectionEvent } from "./connection";
import { TenantSessionStore, isTenantUUID, type TenantSessionRecord } from "./tenantSessionStore";
import { BotDiagnosticError } from "./diagnostics";

export class WhatsAppSessionError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
type Phase = WorkerConnectionEvent["state"] | "qr_required";
type Host = Pick<ApiWhatsAppHost, "start" | "stop">;
interface Entry { record: TenantSessionRecord; phase: Phase; host?: Host; qr?: string; expires?: number; code?: string; epoch: number }
interface Options {
  root: string;
  enabled: () => boolean;
  ready: () => Promise<unknown>;
  legacyReserved?: (restaurantId: string) => boolean;
  ownerExists?: (restaurantId: string) => Promise<boolean>;
  hostFactory?: (qr: (value: string) => void, observe: (event: WorkerConnectionEvent) => void) => Host;
  now?: () => number;
  restoreFailed?: (restaurantId: string, code: string) => void;
}
function tenantSessionId(id: string): string {
  const bytes = createHash("sha256").update(`gama:tenant-whatsapp:v1:${id}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One host/processor/checkout per tenant; shared resources are only the API pool and Socket.IO. */
export class TenantWhatsAppSessionManager {
  private readonly entries = new Map<string, Entry>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly store: TenantSessionStore;
  private readonly now: () => number;
  private closed = false;
  constructor(private readonly resources: CheckoutHost, private readonly options: Options) {
    this.store = new TenantSessionStore(options.root);
    this.now = options.now ?? Date.now;
  }
  private async owner(id: string): Promise<string> {
    if (!isTenantUUID(id)) throw new WhatsAppSessionError(401, "INVALID_OWNER");
    id = id.toLowerCase();
    const exists = this.options.ownerExists ? await this.options.ownerExists(id) :
      (await this.resources.database.query("SELECT id FROM public.restaurants WHERE id = $1", [id])).rows.length === 1;
    if (!exists) throw new WhatsAppSessionError(403, "OWNER_NOT_FOUND");
    return id;
  }
  private serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    this.queues.set(id, task);
    void task.finally(() => { if (this.queues.get(id) === task) this.queues.delete(id); }).catch(() => {});
    return task;
  }
  private view(id: string, entry?: Entry) {
    return { restaurant_id: id, status: entry?.phase ?? "disconnected",
      qr_available: Boolean(entry?.qr && entry.expires! > this.now()), error: entry?.code ?? null };
  }
  hasSession(id: string): boolean {
    const entry = this.entries.get(id.toLowerCase());
    return Boolean(entry && entry.phase !== "disconnected");
  }
  async status(restaurantId: string) {
    const id = await this.owner(restaurantId);
    if (this.options.legacyReserved?.(id)) return { restaurant_id: id, status: "legacy_active", qr_available: false, error: "LEGACY_WORKER_ACTIVE" };
    return this.view(id, this.entries.get(id));
  }
  async qr(restaurantId: string) {
    const id = await this.owner(restaurantId), entry = this.entries.get(id);
    const valid = Boolean(entry?.qr && entry.expires! > this.now());
    return { qr: valid ? entry!.qr : null, expires_at: valid ? new Date(entry!.expires!).toISOString() : null };
  }
  async connect(restaurantId: string) {
    const id = await this.owner(restaurantId);
    if (!this.options.enabled()) throw new WhatsAppSessionError(503, "REAL_CHECKOUT_DISABLED");
    if (this.options.legacyReserved?.(id)) throw new WhatsAppSessionError(409, "LEGACY_WORKER_ACTIVE");
    return this.serial(id, async () => {
      if (this.closed) throw new WhatsAppSessionError(503, "HOST_STOPPING");
      if (this.options.legacyReserved?.(id)) throw new WhatsAppSessionError(409, "LEGACY_WORKER_ACTIVE");
      let entry = this.entries.get(id);
      if (entry && ["connecting", "connected", "qr_required", "reconnecting"].includes(entry.phase)) return this.view(id, entry);
      if (entry?.host) { await entry.host.stop(); entry.host = undefined; }
      const record = entry?.record ?? await this.store.read(id) ?? { version: 1 as const, restaurantId: id, sessionId: tenantSessionId(id), enabled: true };
      entry = { record: { ...record, enabled: true }, phase: "connecting", epoch: (entry?.epoch ?? 0) + 1 };
      this.entries.set(id, entry);
      const owner = entry, epoch = entry.epoch;
      const valid = () => this.entries.get(id) === owner && owner.epoch === epoch;
      const qr = (value: string) => { if (valid() && !this.closed) { owner.qr = value; owner.expires = this.now() + 60_000; owner.phase = "qr_required"; } };
      const observe = (event: WorkerConnectionEvent) => {
        if (!valid()) return;
        owner.phase = event.state; owner.code = event.code;
        owner.qr = undefined; owner.expires = undefined;
      };
      try {
        await this.options.ready();
        if (this.closed) throw new WhatsAppSessionError(503, "HOST_STOPPING");
        await this.store.save(owner.record);
        if (this.closed) throw new WhatsAppSessionError(503, "HOST_STOPPING");
        const config: LocalBotConfig = { context: { restaurant_id: id, session_id: record.sessionId, channel: "whatsapp" },
          authRoot: this.store.root, authDir: path.join(this.store.root, id, record.sessionId), realCheckoutEnabled: true };
        owner.host = this.options.hostFactory ? this.options.hostFactory(qr, observe) :
          new ApiWhatsAppHost(this.resources, qr, () => {}, undefined, observe);
        await owner.host.start(config);
        return this.view(id, owner);
      } catch (error) {
        const code = (error instanceof BotDiagnosticError || error instanceof WhatsAppSessionError) && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : "START_FAILED";
        owner.phase = "error"; owner.code = code; owner.qr = undefined; owner.expires = undefined;
        throw new WhatsAppSessionError(503, code);
      }
    });
  }
  async disconnect(restaurantId: string) {
    const id = await this.owner(restaurantId);
    if (this.options.legacyReserved?.(id)) throw new WhatsAppSessionError(409, "LEGACY_WORKER_ACTIVE");
    return this.serial(id, async () => {
      const entry = this.entries.get(id), record = entry?.record ?? await this.store.read(id);
      if (!record) return this.view(id);
      await this.store.save({ ...record, enabled: false });
      if (entry) {
        entry.epoch++; entry.qr = undefined; entry.expires = undefined;
        try { await entry.host?.stop(); }
        catch { entry.phase = "error"; entry.code = "STOP_FAILED"; throw new WhatsAppSessionError(503, "STOP_FAILED"); }
        entry.record.enabled = false; entry.host = undefined; entry.phase = "disconnected"; entry.code = undefined;
      }
      return this.view(id, entry);
    });
  }
  async restore(): Promise<{ restored: number; failed: number }> {
    const result = { restored: 0, failed: 0 };
    if (!this.options.enabled() || this.closed) return result;
    const stored = await this.store.list();
    result.failed += stored.invalid;
    for (const record of stored.records) {
      if (!record.enabled || this.closed) continue;
      try { await this.connect(record.restaurantId); result.restored++; }
      catch (error) {
        result.failed++;
        const code = error instanceof WhatsAppSessionError ? error.code : "RESTORE_FAILED";
        try { this.options.restoreFailed?.(record.restaurantId, code); } catch { /* Diagnostics cannot stop another tenant's restoration. */ }
      }
    }
    return result;
  }
  async stopAll(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.queues.values()]);
    const stopped = await Promise.allSettled([...this.entries.values()].map(async entry => {
      entry.epoch++; entry.qr = undefined; entry.expires = undefined;
      await entry.host?.stop(); entry.host = undefined; entry.phase = "disconnected";
    }));
    if (stopped.some(result => result.status === "rejected")) throw new WhatsAppSessionError(503, "STOP_FAILED");
    // No manifest disable: a clean API restart must restore the owner's enabled sessions.
  }
}
