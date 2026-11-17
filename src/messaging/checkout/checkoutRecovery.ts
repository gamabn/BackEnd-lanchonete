import type { PoolClient } from "pg";
import { GetClientService } from "../../service/clients/GetClientService";
import { identifyCustomer } from "../core/customerIdentification";
import { BotCart } from "../core/cart";
import { checkoutPaymentSnapshot, type CheckoutState } from "../core/checkoutSnapshot";
import { moneyCents, moneyText, parseOrder } from "../../service/order/orderValidation";
import { CheckoutAuthorizationError, CheckoutCommitUncertainError, readWhatsAppSessionIdentity,
  type WhatsAppCheckoutSession, type WhatsAppSessionIdentity, type WhatsAppCheckoutAuthorizer, type WhatsAppCheckoutAuthorization } from "./checkoutAuthorization";
import { createCheckoutIntentRequest, prepareCheckoutIntent, lookupCheckoutIntent, listCheckoutIntents, validateCheckoutIntentRequest,
  CheckoutIntentConflict, type CheckoutIntentRequest, type CheckoutIntentScope, type StoredCheckoutIntent } from "./checkoutIdempotency";
import type { LiveCheckoutSession } from "./checkoutSession";

type Client = Pick<PoolClient, "query" | "release">;
interface RecoveryDatabase { connect(): Promise<Client> }
type Failure = { readonly kind: "recoverable_failure"; readonly intentId: string; readonly reuseSameKey: true;
  readonly reason: "COMMIT_UNKNOWN" | "SERIALIZATION_CONFLICT" | "DATABASE_FAILURE" | "REGISTRATION_BUSY" };
type Rejected = { readonly kind: "rejected"; readonly intentId: string; readonly reason: "UNAUTHORIZED_OR_STALE" | "INTENT_CONFLICT" | "NOT_CONFIGURED" };
export type CheckoutRegistrationResult = Failure | Rejected |
  { readonly kind: "registered"; readonly intent: CheckoutIntentRequest; readonly state: StoredCheckoutIntent["state"]; readonly current: boolean };
export type CheckoutRecoveryResult = Failure | Rejected |
  { readonly kind: "not_found"; readonly intentId: string; readonly reuseSameKey: true } |
  { readonly kind: "completed"; readonly intent: CheckoutIntentRequest; readonly orderId: string; readonly storedIdentityRevision: number | null } |
  { readonly kind: "review_required"; readonly intent: CheckoutIntentRequest; readonly state: "PENDING" | "RECOVERABLE_FAILURE";
    readonly storedIdentityRevision: number | null; readonly reason: "NEW_REVIEW_REQUIRED" | "IDENTITY_GENERATION_CHANGED" | "LEGACY_METADATA";
    /** Rehydrated data only. No snapshot, authorization or confirmation is restored. */
    readonly session?: WhatsAppCheckoutSession };

function identityKey(session: WhatsAppSessionIdentity): string {
  return JSON.stringify([session.context.restaurant_id, session.context.session_id, session.context.channel,
    session.sender.account_id, session.sender.subject_id, session.sender.channel,
    session.transportIdentity, session.identityRevision]);
}
export function checkoutRecoveryFailure(error: unknown, intentId: string): Failure | Rejected {
  if (error instanceof CheckoutCommitUncertainError) return { kind: "recoverable_failure", intentId, reason: "COMMIT_UNKNOWN", reuseSameKey: true };
  if (error instanceof CheckoutIntentConflict) return { kind: "rejected", intentId, reason: "INTENT_CONFLICT" };
  if (error instanceof CheckoutAuthorizationError) return { kind: "rejected", intentId, reason: "UNAUTHORIZED_OR_STALE" };
  const code = (error as { code?: string })?.code;
  if (code === "40001" || code === "40P01") return { kind: "recoverable_failure", intentId, reason: "SERIALIZATION_CONFLICT", reuseSameKey: true };
  if (code === "42P01" || code === "42703" || code === "42501") return { kind: "rejected", intentId, reason: "NOT_CONFIGURED" };
  return { kind: "recoverable_failure", intentId, reason: "DATABASE_FAILURE", reuseSameKey: true };
}

/** Decode data, never identity evidence. A roundtrip through H.1/H.4 must match the original bytes/hash. */
function restoreForReview(request: CheckoutIntentRequest, identity: WhatsAppSessionIdentity): WhatsAppCheckoutSession {
  try {
    const data = JSON.parse(request.canonicalCheckout);
    const input = parseOrder(data.input);
    const cart = new BotCart();
    if (!Array.isArray(data.items)) throw new CheckoutIntentConflict();
    for (const item of data.items) {
      if (typeof item.productName !== "string" || typeof item.unitPrice !== "string") throw new CheckoutIntentConflict();
      cart.add({ productId: item.productId, productName: item.productName, quantity: item.quantity, unitPrice: item.unitPrice,
        variantId: item.variantId ?? undefined, variantName: item.variantName ?? undefined, optionIds: item.optionIds });
    }
    const checkout: CheckoutState = {
      step: "ORDER_REVIEW", cart, customerId: request.scope.customerId, whatsappPhone: { ...identity.transportIdentity! },
      fulfillmentMode: input.fulfillment_type, paymentMethod: data.paymentMethod,
      changeFor: input.payment_method === "Dinheiro" && moneyCents(input.change_for) > 0n ? moneyText(moneyCents(input.change_for)) : undefined,
      ...(input.fulfillment_type === "PICKUP" ? {
        pickupConfirmed: true, pickupAddress: { ...data.address, restaurantId: identity.context.restaurant_id },
      } : {
        addressConfirmed: true, confirmedAddress: { ...data.address }, addressOriginal: { ...data.address },
        addressCustomerId: request.scope.customerId, addressPhone: identity.transportIdentity!.phone,
        deliveryRegion: { restaurant_id: identity.context.restaurant_id, customer_id: request.scope.customerId,
          bairro_id: input.bairro_id, bairro: data.address.neighborhood, fee: data.fee, fulfillment_mode: "DELIVERY" as const,
          confirmed: true, address: { ...data.address } },
      }),
    };
    const restored: WhatsAppCheckoutSession = { ...identity, checkout: { ...checkout, paymentContext: checkoutPaymentSnapshot(checkout, identity.context.restaurant_id) } };
    const roundtrip = createCheckoutIntentRequest(restored, request.intentId);
    if (roundtrip.canonicalCheckout !== request.canonicalCheckout || roundtrip.checkoutHash !== request.checkoutHash) throw new CheckoutIntentConflict();
    return restored;
  } catch { throw new CheckoutIntentConflict(); }
}

/** Explicit infrastructure operation. No default pool and no connection to the public simulation. */
export class DurableCheckoutSessions {
  constructor(protected readonly authorizer: WhatsAppCheckoutAuthorizer, protected readonly database: RecoveryDatabase) {}

  async register(coordinator: LiveCheckoutSession, authorization: WhatsAppCheckoutAuthorization): Promise<CheckoutRegistrationResult> {
    return this.registerUsing(coordinator, authorization, prepareCheckoutIntent);
  }

  protected async registerUsing(coordinator: LiveCheckoutSession, authorization: WhatsAppCheckoutAuthorization,
    write: (client: Pick<PoolClient, "query">, request: CheckoutIntentRequest) => Promise<StoredCheckoutIntent>): Promise<CheckoutRegistrationResult> {
    const existing = coordinator.recoveryReference;
    if (existing?.registration === "REGISTERING") return { kind: "recoverable_failure", intentId: existing.intent.intentId, reason: "REGISTRATION_BUSY", reuseSameKey: true };
    let request: CheckoutIntentRequest;
    try { request = coordinator.beginDurableRegistration().intent; }
    catch { return { kind: "rejected", intentId: existing?.intent.intentId ?? "", reason: "UNAUTHORIZED_OR_STALE" }; }
    try {
      const row = await this.authorizer.withAuthorizedTransaction(authorization, async (client, _, session) => {
        const current = createCheckoutIntentRequest(session, request.intentId);
        if (current.canonicalCheckout !== request.canonicalCheckout || current.checkoutHash !== request.checkoutHash) throw new CheckoutIntentConflict();
        return write(client, request);
      });
      const current = coordinator.finishDurableRegistration(request, row.state);
      return { kind: "registered", intent: request, state: row.state, current };
    } catch (error) {
      coordinator.registrationFailed(request, error instanceof CheckoutCommitUncertainError);
      return checkoutRecoveryFailure(error, request.intentId);
    }
  }

  protected async identified<T>(current: () => WhatsAppSessionIdentity,
    action: (client: Client, scope: CheckoutIntentScope, identity: WhatsAppSessionIdentity) => Promise<T>): Promise<T> {
    const identity = readWhatsAppSessionIdentity(current);
    const assertCurrent = () => { if (identityKey(identity) !== identityKey(readWhatsAppSessionIdentity(current))) throw new CheckoutAuthorizationError(); };
    const client = await this.database.connect();
    let begun = false, discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); begun = true;
      assertCurrent();
      const reader = new GetClientService(client);
      let lookupError: unknown;
      const result = await identifyCustomer(identity.context.restaurant_id, identity.transportIdentity, {
        findByWhatsAppPhone: async args => {
          try { return await reader.findByWhatsAppPhone(args, "share"); }
          catch (error) { lookupError = error; throw error; }
        },
      });
      if (lookupError) throw lookupError;
      if (result.kind !== "found") throw new CheckoutAuthorizationError();
      assertCurrent();
      const scope: CheckoutIntentScope = { context: identity.context, sender: identity.sender, identity: identity.transportIdentity!, customerId: result.customerId };
      const value = await action(client, scope, identity);
      assertCurrent();
      try { await client.query("COMMIT"); }
      catch (error) {
        discard = true;
        const code = (error as { code?: string })?.code;
        if (code === "40001" || code === "40P01") throw error;
        throw new CheckoutCommitUncertainError(error);
      }
      begun = false;
      assertCurrent();
      return value;
    } finally {
      try { if (begun) await client.query("ROLLBACK").catch(() => { discard = true; }); }
      finally { client.release(discard); }
    }
  }

  async recover(current: () => WhatsAppSessionIdentity, intentId: string): Promise<CheckoutRecoveryResult> {
    try {
      return await this.identified(current, async (client, scope, identity): Promise<CheckoutRecoveryResult> => {
        // Unlike lockCheckoutIntent, recovery must not promote a failed row to PENDING.
        const row = await lookupCheckoutIntent(client, scope, intentId, "update");
        if (!row) return { kind: "not_found", intentId, reuseSameKey: true };
        return this.recovered(row, scope, identity);
      });
    } catch (error) { return checkoutRecoveryFailure(error, intentId); }
  }

  protected recovered(row: StoredCheckoutIntent, scope: CheckoutIntentScope, identity: WhatsAppSessionIdentity): CheckoutRecoveryResult {
    if (row.retired_at && row.state !== "COMPLETED") throw new CheckoutIntentConflict();
    const request = validateCheckoutIntentRequest({ intentId: row.intent_id, scope, checkoutHash: row.checkout_hash, canonicalCheckout: row.canonical_checkout });
    const revision = JSON.parse(row.canonical_checkout).identityRevision;
    const storedIdentityRevision = Number.isSafeInteger(revision) && revision >= 0 ? revision as number : null;
    if (row.state === "COMPLETED") return { kind: "completed", intent: request, orderId: row.order_id, storedIdentityRevision };
    if (storedIdentityRevision === null) return { kind: "review_required", intent: request, state: row.state, storedIdentityRevision, reason: "LEGACY_METADATA" };
    if (storedIdentityRevision !== identity.identityRevision) return { kind: "review_required", intent: request, state: row.state, storedIdentityRevision, reason: "IDENTITY_GENERATION_CHANGED" };
    return { kind: "review_required", intent: request, state: row.state, storedIdentityRevision,
      reason: "NEW_REVIEW_REQUIRED", session: restoreForReview(request, identity) };
  }

  /** Discovery is not active-intent selection. Never select the newest row or mint a fallback key. */
  async candidates(current: () => WhatsAppSessionIdentity) {
    return this.identified(current, async (client, scope) => {
      const rows = await listCheckoutIntents(client, scope);
      return { kind: "candidates" as const, mayBeTruncated: rows.length === 20,
        intents: rows.map(row => ({ intentId: row.intent_id, state: row.state })) };
    });
  }
}
