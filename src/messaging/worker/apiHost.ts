import type { CheckoutHost } from "./checkoutStartup";
import { prepareWorkerCheckout } from "./checkoutStartup";
import { connectLocalWhatsApp, type WorkerConnectionEvent } from "./connection";
import { acquireLocalAuth } from "./localAuth";
import type { LocalBotConfig } from "./config";
import { BotDiagnosticError, formatDiagnostic } from "./diagnostics";

interface HostDependencies {
  prepare: typeof prepareWorkerCheckout;
  acquire: typeof acquireLocalAuth;
  connect: typeof connectLocalWhatsApp;
}

/** Owns only the worker and its auth lock, never HTTP, PostgreSQL or Socket.IO. */
export class ApiWhatsAppHost {
  private worker?: Awaited<ReturnType<typeof connectLocalWhatsApp>>;
  private release?: () => Promise<void>;
  private starting?: Promise<void>;
  private stopping?: Promise<void>;
  private stopRequested = false;

  constructor(
    private readonly resources: CheckoutHost,
    private readonly renderQr: (qr: string) => void,
    private readonly log: (message: string) => void,
    private readonly dependencies: HostDependencies = {
      prepare: prepareWorkerCheckout, acquire: acquireLocalAuth, connect: connectLocalWhatsApp,
    },
    private readonly observe?: (event: WorkerConnectionEvent) => void,
  ) {}

  async start(config: LocalBotConfig): Promise<void> {
    if (this.stopping) throw new BotDiagnosticError("configuration", "HOST_STOPPING", "Aguarde o encerramento do worker.");
    if (this.starting) return this.starting;
    if (this.worker) return;
    this.stopRequested = false;
    const task = this.open(config);
    this.starting = task;
    try { await task; }
    finally { if (this.starting === task) this.starting = undefined; }
  }

  private async open(config: LocalBotConfig): Promise<void> {
    if (config.realCheckoutEnabled !== true)
      throw new BotDiagnosticError("configuration", "REAL_CHECKOUT_REQUIRED", "O host da API exige checkout real explicitamente habilitado.");
    // Preflight before taking the auth lock or loading/connecting Baileys.
    const checkout = await this.dependencies.prepare(config, async () => this.resources);
    if (!checkout) throw new BotDiagnosticError("configuration", "REAL_CHECKOUT_REQUIRED", "Checkout persistente obrigatório.");
    if (this.stopRequested) return;
    this.release = await this.dependencies.acquire(config);
    try {
      if (this.stopRequested) { await this.releaseAuth(); return; }
      this.worker = await this.dependencies.connect(config, this.renderQr, this.log, undefined, checkout, undefined, this.observe);
      // SDK shutdown drains in-flight messages/writes before the auth lock is released.
      void this.worker.done.then(async failure => {
        if (failure) this.log(formatDiagnostic(failure));
        await this.stop();
      }).catch(error => this.log(formatDiagnostic(error)));
    } catch (error) { await this.releaseAuth(); throw error; }
  }

  private async releaseAuth(): Promise<void> {
    const release = this.release;
    await release?.();
    if (this.release === release) this.release = undefined;
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopRequested = true;
    const task = (async () => {
      await this.starting?.catch(() => {});
      const worker = this.worker;
      // A failed drain must not unlock credentials still potentially in use.
      await worker?.stop();
      this.worker = undefined;
      await this.releaseAuth();
    })();
    this.stopping = task;
    try { await task; }
    finally { if (this.stopping === task) this.stopping = undefined; }
  }
}
