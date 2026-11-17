import { createHash, randomUUID } from "crypto";
import type { PoolClient } from "pg";
import type { WhatsAppCheckoutSession } from "./checkoutAuthorization";
import { adaptWhatsAppCheckout } from "./checkoutAdapter";
import { trustedWhatsAppPhone, phoneFromJid, type WhatsAppPhoneIdentity } from "../channels/whatsapp/phoneIdentity";
import type { ExternalIdentity, RestaurantContext } from "../contracts";
import { validateRestaurantContext, validateExternalIdentity } from "../validation";
import { moneyCents, moneyText } from "../../service/order/orderValidation";

type Client = Pick<PoolClient, "query">;
export interface CheckoutIntentScope {
  readonly context: RestaurantContext;
  readonly sender: ExternalIdentity;
  readonly identity: WhatsAppPhoneIdentity;
  readonly customerId: string;
}
export interface CheckoutIntentRequest {
  readonly intentId: string;
  readonly scope: CheckoutIntentScope;
  readonly canonicalCheckout: string;
  readonly checkoutHash: string;
}
export type CheckoutIntentState = "PENDING" | "COMPLETED" | "RECOVERABLE_FAILURE";
interface StoredIntentBinding {
  intent_id: string;
  checkout_hash: string;
  canonical_checkout: string;
  active: boolean;
  retired_at: string | Date | null;
  identity_revision: string | null;
}
export type StoredCheckoutIntent = StoredIntentBinding & (
  | { state: "PENDING"; order_id: null; failure_code: null }
  | { state: "COMPLETED"; order_id: string; failure_code: null }
  | { state: "RECOVERABLE_FAILURE"; order_id: null; failure_code: "TRANSACTION_ABORTED" | "REVALIDATION_REQUIRED" }
);
export class CheckoutIntentConflict extends Error {
  constructor() { super("Intenção de checkout ausente, incompatível ou de outro contexto."); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertId(id: string): void { if (!uuid.test(id)) throw new CheckoutIntentConflict(); }
function scopeValues(scope: CheckoutIntentScope): string[] {
  validateRestaurantContext(scope.context);
  validateExternalIdentity(scope.sender);
  const phone = trustedWhatsAppPhone(scope.identity);
  if (scope.context.channel !== "whatsapp" || scope.sender.channel !== "whatsapp" || !phone ||
      !/^[^\s@]+@(s\.whatsapp\.net|lid)$/.test(scope.sender.subject_id) ||
      (scope.sender.subject_id.endsWith("@s.whatsapp.net") && phoneFromJid(scope.sender.subject_id) !== phone)) throw new CheckoutIntentConflict();
  assertId(scope.customerId);
  return [scope.context.restaurant_id.toLowerCase(), scope.customerId.toLowerCase(), scope.context.session_id.toLowerCase(), scope.sender.account_id, scope.sender.subject_id, phone];
}
/** Stable JSON: sorted object keys, exact decimal strings; arrays retain semantic ordering. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
/** Generate ONCE for an explicitly new intent; never generate a key for a retry. */
export const newCheckoutIntentId = (): string => randomUUID();

/** Pure server-side binding, not authorization. H.2/H.3 remain mandatory before any future creation. */
export function createCheckoutIntentRequest(session: WhatsAppCheckoutSession, intentId: string): CheckoutIntentRequest {
  assertId(intentId);
  if (!Number.isSafeInteger(session.identityRevision) || session.identityRevision < 0) throw new CheckoutIntentConflict();
  const adapted = adaptWhatsAppCheckout(session.context, session.checkout);
  const scope: CheckoutIntentScope = {
    context: { ...session.context }, sender: { ...session.sender },
    identity: { ...session.transportIdentity! }, customerId: adapted.customer_id,
  };
  const values = scopeValues(scope);
  if (trustedWhatsAppPhone(scope.identity) !== trustedWhatsAppPhone(session.checkout.whatsappPhone)) throw new CheckoutIntentConflict();
  const input = { ...adapted.input, items: adapted.input.items.map(item => ({ ...item,
    ...(item.option_ids ? { option_ids: [...item.option_ids].sort() } : {}),
  })) };
  const checkout = session.checkout;
  const canonicalCheckout = canonical({
    version: 1, identityRevision: session.identityRevision, scope: values, input,
    items: checkout.cart.list().map(item => ({
      productId: item.productId, productName: item.productName, quantity: item.quantity,
      unitPrice: moneyText(moneyCents(item.unitPrice)), variantId: item.variantId ?? null,
      variantName: item.variantName ?? null, optionIds: [...(item.optionIds ?? [])].sort(),
    })),
    address: checkout.fulfillmentMode === "DELIVERY" ? checkout.confirmedAddress : {
      name: checkout.pickupAddress!.name, street: checkout.pickupAddress!.street, number: checkout.pickupAddress!.number,
      neighborhood: checkout.pickupAddress!.neighborhood, city: checkout.pickupAddress!.city,
    },
    fee: checkout.fulfillmentMode === "DELIVERY" ? moneyText(moneyCents(checkout.deliveryRegion!.fee)) : "0.00",
    // Preserve the distinction displayed by the bot even though the legacy input maps both to Cartao.
    paymentMethod: checkout.paymentMethod,
  });
  return stableRequest({ intentId, scope, canonicalCheckout, checkoutHash: hash(canonicalCheckout) });
}

const columns = "intent_id, checkout_hash, canonical_checkout, state, order_id, failure_code, active, retired_at, identity_revision";
const scopeWhere = `restaurant_id = $2 AND customer_id = $3 AND session_id = $4
  AND account_id = $5 AND sender_id = $6 AND whatsapp_phone = $7`;
function params(request: CheckoutIntentRequest): string[] {
  assertId(request.intentId);
  const values = scopeValues(request.scope);
  // Detect caller mutation, including replacing identity or owners after hash generation.
  let decoded: { scope?: unknown };
  try { decoded = JSON.parse(request.canonicalCheckout); } catch { throw new CheckoutIntentConflict(); }
  if (!decoded || typeof decoded !== "object") throw new CheckoutIntentConflict();
  if (hash(request.canonicalCheckout) !== request.checkoutHash || canonical(decoded.scope) !== canonical(values)) throw new CheckoutIntentConflict();
  return [request.intentId, ...values];
}
/** Detach mutable caller data before any await or database operation. */
function stableRequest(request: CheckoutIntentRequest): CheckoutIntentRequest {
  const copy = Object.freeze({ ...request, scope: Object.freeze({
    context: Object.freeze({ ...request.scope.context }),
    sender: Object.freeze({ ...request.scope.sender }),
    identity: Object.freeze({ ...request.scope.identity }), customerId: request.scope.customerId,
  }) });
  params(copy);
  return copy;
}
/** Validate and detach an existing request before passing it across async boundaries. */
export function validateCheckoutIntentRequest(request: CheckoutIntentRequest): CheckoutIntentRequest {
  return stableRequest(request);
}
function assertSame(row: StoredCheckoutIntent | undefined, request: CheckoutIntentRequest): StoredCheckoutIntent {
  if (!row || row.checkout_hash !== request.checkoutHash || row.canonical_checkout !== request.canonicalCheckout) throw new CheckoutIntentConflict();
  return row;
}

/** Register/commit before displaying confirmation. The caller owns this short transaction. */
export async function prepareCheckoutIntent(client: Client, request: CheckoutIntentRequest): Promise<StoredCheckoutIntent> {
  request = stableRequest(request);
  const args = params(request);
  await client.query(`INSERT INTO public.whatsapp_checkout_intents
    (intent_id, restaurant_id, customer_id, session_id, account_id, sender_id, whatsapp_phone, canonical_checkout, checkout_hash)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (intent_id) DO NOTHING`,
  [...args, request.canonicalCheckout, request.checkoutHash]);
  const row = await lookupCheckoutIntent(client, request.scope, request.intentId);
  if (row?.retired_at) throw new CheckoutIntentConflict();
  return assertSame(row ?? undefined, request);
}

/** Recovery must first re-establish the customer's WhatsApp authorization; a key is not a credential. */
export async function lookupCheckoutIntent(client: Client, scope: CheckoutIntentScope, intentId: string, lock?: "update"): Promise<StoredCheckoutIntent | null> {
  assertId(intentId);
  const result = await client.query<StoredCheckoutIntent>(`SELECT ${columns} FROM public.whatsapp_checkout_intents WHERE intent_id = $1 AND ${scopeWhere}${lock === "update" ? " FOR UPDATE" : ""}`,
    [intentId, ...scopeValues(scope)]);
  return result.rows[0] ?? null;
}

/** Find durable keys after a restart/lost registration reply. Never automatically create a new intent. */
export async function listCheckoutIntents(client: Client, scope: CheckoutIntentScope): Promise<StoredCheckoutIntent[]> {
  const result = await client.query<StoredCheckoutIntent>(`SELECT ${columns} FROM public.whatsapp_checkout_intents
    WHERE ${scopeWhere.replace(/\$(\d+)/g, (_, n) => `$${Number(n) - 1}`)} ORDER BY created_at DESC, intent_id LIMIT 20`, scopeValues(scope));
  return result.rows;
}

/** Caller must already be in the same transaction as future order persistence. */
export async function lockCheckoutIntent(client: Client, request: CheckoutIntentRequest): Promise<StoredCheckoutIntent> {
  request = stableRequest(request);
  const result = await client.query<StoredCheckoutIntent>(`SELECT ${columns} FROM public.whatsapp_checkout_intents WHERE intent_id = $1 AND ${scopeWhere} FOR UPDATE`, params(request));
  const row = assertSame(result.rows[0], request);
  if (row.retired_at && row.state !== "COMPLETED") throw new CheckoutIntentConflict();
  if (row.state === "RECOVERABLE_FAILURE") {
    await client.query(`UPDATE public.whatsapp_checkout_intents SET state = 'PENDING', failure_code = NULL WHERE intent_id = $1`, [request.intentId]);
    return { ...row, state: "PENDING", failure_code: null };
  }
  return row;
}

/** Link only a persisted order owned by this customer/restaurant, using the SAME transaction. */
export async function completeCheckoutIntent(client: Client, request: CheckoutIntentRequest, orderId: string): Promise<StoredCheckoutIntent> {
  request = stableRequest(request);
  assertId(orderId);
  orderId = orderId.toLowerCase();
  const row = await lockCheckoutIntent(client, request);
  if (row.state === "COMPLETED") {
    if (row.order_id !== orderId) throw new CheckoutIntentConflict();
    return row;
  }
  const result = await client.query<StoredCheckoutIntent>(`UPDATE public.whatsapp_checkout_intents
    SET state = 'COMPLETED', order_id = $2, failure_code = NULL
    WHERE intent_id = $1 AND state = 'PENDING' RETURNING ${columns}`, [request.intentId, orderId]);
  return assertSame(result.rows[0], request);
}

/** Only after a DEFINITE rollback, or fresh locked recovery proving no committed completion. */
export async function markCheckoutIntentRecoverable(client: Client, request: CheckoutIntentRequest,
  code: "TRANSACTION_ABORTED" | "REVALIDATION_REQUIRED"): Promise<StoredCheckoutIntent> {
  request = stableRequest(request);
  const row = await lockCheckoutIntent(client, request);
  if (row.state === "COMPLETED") return row;
  const result = await client.query<StoredCheckoutIntent>(`UPDATE public.whatsapp_checkout_intents
    SET state = 'RECOVERABLE_FAILURE', failure_code = $2 WHERE intent_id = $1 AND state = 'PENDING' RETURNING ${columns}`, [request.intentId, code]);
  return assertSame(result.rows[0], request);
}


/** Serialize scope creation/replacement even when no row exists. The partial UNIQUE is definitive. */
export async function lockCheckoutScope(client: Client, scope: CheckoutIntentScope): Promise<void> {
  const [restaurant, customer, session, account, sender] = scopeValues(scope);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [JSON.stringify(["gama:active-checkout:v1", restaurant, customer, session, account, sender])]);
}
const activeWhere = "restaurant_id=$1 AND customer_id=$2 AND session_id=$3 AND account_id=$4 AND sender_id=$5";
export async function activeCheckoutIntent(client: Client, scope: CheckoutIntentScope): Promise<StoredCheckoutIntent | null> {
  const values = scopeValues(scope);
  const result = await client.query<StoredCheckoutIntent>(`SELECT ${columns} FROM public.whatsapp_checkout_intents WHERE ${activeWhere} AND active FOR UPDATE`, values.slice(0, 5));
  const row = result.rows[0];
  if (!row) return null;
  const payload = JSON.parse(row.canonical_checkout);
  if (payload.scope?.[5] !== values[5]) throw new CheckoutIntentConflict();
  return row;
}
export async function checkoutGenerationBaseline(client: Client, scope: CheckoutIntentScope) {
  const values = scopeValues(scope);
  const result = await client.query<{ revision: string | null; legacy: boolean | null; identity_changed: boolean | null }>(
    `SELECT max(identity_revision)::text revision, bool_or(identity_revision IS NULL) legacy,
      bool_or(whatsapp_phone <> $6) identity_changed FROM public.whatsapp_checkout_intents WHERE ${activeWhere}`, values);
  return result.rows[0];
}
function revisionOf(request: CheckoutIntentRequest): number {
  const revision = JSON.parse(request.canonicalCheckout).identityRevision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new CheckoutIntentConflict();
  return revision;
}
export async function prepareActiveCheckoutIntent(client: Client, request: CheckoutIntentRequest): Promise<StoredCheckoutIntent> {
  request = stableRequest(request);
  await lockCheckoutScope(client, request.scope);
  const existing = await activeCheckoutIntent(client, request.scope);
  if (existing && existing.intent_id !== request.intentId) throw new CheckoutIntentConflict();
  const baseline = await checkoutGenerationBaseline(client, request.scope);
  if (baseline.legacy || baseline.identity_changed ||
      (baseline.revision !== null && Number(baseline.revision) !== revisionOf(request))) throw new CheckoutIntentConflict();
  const registered = await prepareCheckoutIntent(client, request);
  if (registered.retired_at) throw new CheckoutIntentConflict();
  if (registered.active) return registered;
  if (registered.state === "COMPLETED") throw new CheckoutIntentConflict();
  const result = await client.query<StoredCheckoutIntent>(`UPDATE public.whatsapp_checkout_intents SET active=true WHERE intent_id=$1 RETURNING ${columns}`, [request.intentId]);
  return assertSame(result.rows[0], request);
}

/** Explicit expected-key/epoch transition. Never silently replaces a completed or uncertain row. */
export async function replaceActiveCheckoutIntent(client: Client, request: CheckoutIntentRequest,
  expected: { intentId: string; identityRevision: number }): Promise<StoredCheckoutIntent> {
  request = stableRequest(request);
  await lockCheckoutScope(client, request.scope);
  const existing = await activeCheckoutIntent(client, request.scope);
  if (existing?.intent_id === request.intentId) {
    // Retry after a lost replacement COMMIT reply, never mint a replacement key.
    const previous = await lookupCheckoutIntent(client, request.scope, expected.intentId, "update");
    if (!previous?.retired_at || previous.identity_revision === null ||
        Number(previous.identity_revision) !== expected.identityRevision ||
        Number(existing.identity_revision) !== revisionOf(request)) throw new CheckoutIntentConflict();
    return assertSame(existing, request);
  }
  if (!Number.isSafeInteger(expected.identityRevision) || expected.identityRevision < 0) throw new CheckoutIntentConflict();
  if (!existing || existing.intent_id !== expected.intentId || Number(existing.identity_revision) !== expected.identityRevision ||
      existing.identity_revision === null || existing.state === "COMPLETED" || request.intentId === existing.intent_id ||
      existing.checkout_hash === request.checkoutHash || revisionOf(request) < expected.identityRevision) throw new CheckoutIntentConflict();
  await client.query("UPDATE public.whatsapp_checkout_intents SET active=false, retired_at=clock_timestamp() WHERE intent_id=$1", [existing.intent_id]);
  // The explicit expected epoch permits advancement; ordinary registration never reconciles epochs implicitly.
  const row = await prepareCheckoutIntent(client, request);
  if (row.retired_at || row.state === "COMPLETED") throw new CheckoutIntentConflict();
  const result = await client.query<StoredCheckoutIntent>(`UPDATE public.whatsapp_checkout_intents SET active=true WHERE intent_id=$1 RETURNING ${columns}`, [request.intentId]);
  return assertSame(result.rows[0], request);
}
export async function retireActiveCheckoutIntent(client: Client, scope: CheckoutIntentScope,
  expected: { intentId: string; identityRevision: number }): Promise<void> {
  await lockCheckoutScope(client, scope);
  const existing = await activeCheckoutIntent(client, scope);
  if (!existing || existing.intent_id !== expected.intentId || existing.identity_revision === null ||
      Number(existing.identity_revision) !== expected.identityRevision || existing.state === "COMPLETED") throw new CheckoutIntentConflict();
  await client.query("UPDATE public.whatsapp_checkout_intents SET active=false, retired_at=clock_timestamp() WHERE intent_id=$1", [existing.intent_id]);
}
