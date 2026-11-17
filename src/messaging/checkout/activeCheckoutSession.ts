import { DurableCheckoutSessions, checkoutRecoveryFailure } from "./checkoutRecovery";
import { activeCheckoutIntent, checkoutGenerationBaseline, lockCheckoutScope, prepareActiveCheckoutIntent,
  replaceActiveCheckoutIntent, retireActiveCheckoutIntent, CheckoutIntentConflict } from "./checkoutIdempotency";
import type { WhatsAppSessionIdentity, WhatsAppCheckoutAuthorization } from "./checkoutAuthorization";
import type { LiveCheckoutSession } from "./checkoutSession";

type BootstrapIdentity = Omit<WhatsAppSessionIdentity, "identityRevision"> & { identityRevision: number | null };
function binding(identity: BootstrapIdentity): string {
  return JSON.stringify([identity.context, identity.sender, identity.transportIdentity]);
}
/** Explicit preparation only. No worker, default pool, submission or restored authorization. */
export class ActiveCheckoutSessions extends DurableCheckoutSessions {
  private readonly challenges = new WeakMap<object, { binding: string; revision: number }>();

  registerActive(coordinator: LiveCheckoutSession, authorization: WhatsAppCheckoutAuthorization) {
    return this.registerUsing(coordinator, authorization, prepareActiveCheckoutIntent);
  }
  replaceActive(coordinator: LiveCheckoutSession, authorization: WhatsAppCheckoutAuthorization,
    expected: { intentId: string; identityRevision: number }) {
    const detached = { ...expected };
    return this.registerUsing(coordinator, authorization, (client, request) => replaceActiveCheckoutIntent(client, request, detached));
  }
  async invalidateActive(current: () => WhatsAppSessionIdentity, expected: { intentId: string; identityRevision: number }) {
    const detached = { ...expected };
    try {
      return await this.identified(current, async (client, scope, identity) => {
        if (identity.identityRevision !== detached.identityRevision) throw new CheckoutIntentConflict();
        await retireActiveCheckoutIntent(client, scope, detached);
        return { kind: "invalidated" as const };
      });
    } catch (error) { return checkoutRecoveryFailure(error, detached.intentId); }
  }
  async recoverActive(current: () => WhatsAppSessionIdentity) {
    try {
      return await this.identified(current, async (client, scope, identity) => {
        await lockCheckoutScope(client, scope);
        const row = await activeCheckoutIntent(client, scope);
        if (!row) return { kind: "no_active_intent" as const };
        const baseline = await checkoutGenerationBaseline(client, scope);
        if (baseline.legacy || baseline.identity_changed || baseline.revision === null ||
            Number(baseline.revision) !== identity.identityRevision ||
            Number(row.identity_revision) !== identity.identityRevision) throw new CheckoutIntentConflict();
        return this.recovered(row, scope, identity);
      });
    } catch (error) { return checkoutRecoveryFailure(error, ""); }
  }

  /** Null is exclusively an uninitialized bootstrap, never an accepted generation zero. */
  async inspectBootstrap(current: () => BootstrapIdentity) {
    try {
      const initial = current();
      const initialBinding = binding(initial);
      const result = await this.identified(() => {
        const live = current();
        if (binding(live) !== initialBinding || live.identityRevision !== initial.identityRevision) throw new CheckoutIntentConflict();
        return { ...live, identityRevision: live.identityRevision ?? 0 };
      }, async (client, scope) => {
        await lockCheckoutScope(client, scope);
        const baseline = await checkoutGenerationBaseline(client, scope);
        const row = await activeCheckoutIntent(client, scope);
        if (baseline.legacy || baseline.identity_changed) throw new CheckoutIntentConflict();
        if (baseline.revision === null) return { kind: "no_durable_generation" as const };
        const revision = Number(baseline.revision);
        if (row && Number(row.identity_revision) !== revision) throw new CheckoutIntentConflict();
        if (initial.identityRevision !== null && initial.identityRevision !== revision) throw new CheckoutIntentConflict();
        return { kind: "baseline" as const, revision };
      });
      if (result.kind !== "baseline") return result;
      if (initial.identityRevision !== null) return { kind: "generation_verified" as const, identityRevision: result.revision };
      const challenge = Object.freeze({});
      this.challenges.set(challenge, { binding: initialBinding, revision: result.revision });
      return { kind: "reconciliation_required" as const, identityRevision: result.revision, challenge };
    } catch (error) { return checkoutRecoveryFailure(error, ""); }
  }

  /** Caller must install the result only before processing messages. Nothing else is restored. */
  async reconcileBootstrap(challenge: object, current: () => BootstrapIdentity) {
    const expected = this.challenges.get(challenge);
    this.challenges.delete(challenge);
    try {
      if (!expected || current().identityRevision !== null || binding(current()) !== expected.binding)
        return { kind: "rejected" as const, reason: "UNAUTHORIZED_OR_STALE" as const };
      // Fresh transport identification and a fresh DB read; the challenge is never authority.
      const verified = await this.inspectBootstrap(() => {
        const live = current();
        if (live.identityRevision !== null || binding(live) !== expected.binding) throw new CheckoutIntentConflict();
        return { ...live, identityRevision: expected.revision };
      });
      if (verified.kind !== "generation_verified") return verified;
      return Object.freeze({ kind: "generation_reconciled" as const, identityRevision: verified.identityRevision });
    } catch (error) { return checkoutRecoveryFailure(error, ""); }
  }
}
