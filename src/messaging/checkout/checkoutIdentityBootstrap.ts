import type { ActiveCheckoutSessions } from "./activeCheckoutSession";
import type { WhatsAppSessionIdentity } from "./checkoutAuthorization";

/** Optional future worker bootstrap gate. Never rebase a worker that has processed a message. */
export class CheckoutIdentityBootstrap {
  private revision: number | null = null;
  private observed = false;
  private busy = false;
  constructor(private readonly transport: () => Omit<WhatsAppSessionIdentity, "identityRevision">) {}
  get identityRevision() { return this.revision; }
  markMessageObserved(): void { this.observed = true; }
  async reconcile(service: ActiveCheckoutSessions): Promise<boolean> {
    if (this.observed || this.busy || this.revision !== null) return false;
    this.busy = true;
    const initial = JSON.stringify(this.transport());
    const current = () => {
      const live = this.transport();
      if (this.observed || JSON.stringify(live) !== initial) throw Error("Bootstrap transport changed");
      return { ...live, identityRevision: this.revision };
    };
    try {
      const inspection = await service.inspectBootstrap(current);
      if (inspection.kind !== "reconciliation_required") return false;
      const result = await service.reconcileBootstrap(inspection.challenge, current);
      current();
      if (result.kind !== "generation_reconciled") return false;
      this.revision = result.identityRevision;
      return true;
    } catch { return false; }
    finally { this.busy = false; }
  }
}
