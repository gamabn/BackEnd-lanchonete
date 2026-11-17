import type { PoolClient } from "pg";
import type { RestaurantContext } from "../contracts";
import { validateRestaurantContext } from "../validation";
import type { CheckoutState } from "../core/checkoutSnapshot";
import { adaptWhatsAppCheckout, isCompleteCheckoutAddress, type AdaptedCheckout } from "./checkoutAdapter";
import { validateOrderCheckout } from "../../service/order/validateOrderCheckout";
import { moneyCents, moneyText, parseOrder, OrderValidationError, type OrderInput } from "../../service/order/orderValidation";
import { isStoredAddress, type StoredAddress } from "../../security/customerAddress";
import type { PickupAddressSnapshot } from "../../service/order/pickupAddress";

type ValidatedCheckout = Awaited<ReturnType<typeof validateOrderCheckout>>;
interface ReviewItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
  variant_id: string | null;
  variant_name: string | null;
  option_ids: string[];
}
export interface CheckoutReviewData {
  restaurant_id: string;
  customer_id: string;
  input: OrderInput;
  items: ReviewItem[];
  address: StoredAddress | PickupAddressSnapshot;
  subtotal: string;
  delivery_fee: string;
  total: string;
}
const reviewBrand: unique symbol = Symbol("CheckoutReviewSnapshot");
/** Opaque, process-local snapshot. Not authorization and not a database quote. */
export interface CheckoutReviewSnapshot { readonly [reviewBrand]: true }
const reviews = new WeakMap<CheckoutReviewSnapshot, { context: string; data: CheckoutReviewData }>();
function contextKey(context: RestaurantContext): string {
  validateRestaurantContext(context);
  return JSON.stringify([context.restaurant_id, context.session_id, context.channel]);
}

/** Canonicalize IDs of options as a set; changing only their input order is not material. */
function canonicalInput(input: unknown): OrderInput {
  const parsed = parseOrder(input);
  return { ...parsed, items: parsed.items.map(item => ({ ...item,
    ...(item.option_ids ? { option_ids: [...item.option_ids].sort() } : {}),
  })) };
}

/**
 * Capture when presenting ORDER_REVIEW, and retain this token until confirmation.
 * Never recreate it at confirmation from newly loaded prices or mutable session data.
 * The caller must associate it with the owning session/authorization from H.2.
 */
export function captureCheckoutReview(context: RestaurantContext, state: CheckoutState): CheckoutReviewSnapshot {
  const adapted = adaptWhatsAppCheckout(context, state);
  const items = state.cart.list().map(item => ({
    product_id: item.productId,
    product_name: item.productName,
    quantity: item.quantity,
    unit_price: moneyText(moneyCents(item.unitPrice)),
    subtotal: moneyText(moneyCents(item.unitPrice) * BigInt(item.quantity)),
    variant_id: item.variantId ?? null,
    variant_name: item.variantName ?? null,
    option_ids: [...(item.optionIds ?? [])].sort(),
  }));
  const subtotal = items.reduce((sum, item) => sum + moneyCents(item.subtotal), 0n);
  const fee = state.fulfillmentMode === "DELIVERY" ? moneyCents(state.deliveryRegion!.fee) : 0n;
  const address = state.fulfillmentMode === "DELIVERY" ? { ...state.confirmedAddress! } : {
    name: state.pickupAddress!.name, street: state.pickupAddress!.street, number: state.pickupAddress!.number,
    neighborhood: state.pickupAddress!.neighborhood, city: state.pickupAddress!.city,
  };
  const token: CheckoutReviewSnapshot = Object.freeze({ [reviewBrand]: true as const });
  // No reference to the mutable cart, address or options escapes into this snapshot.
  reviews.set(token, { context: contextKey(context), data: {
    restaurant_id: adapted.restaurant_id, customer_id: adapted.customer_id,
    input: canonicalInput(adapted.input), items, address,
    subtotal: moneyText(subtotal), delivery_fee: moneyText(fee), total: moneyText(subtotal + fee),
  } });
  return token;
}

export type CheckoutReviewChange = "CHECKOUT" | "ITEMS" | "PRICES" | "ADDRESS" | "DELIVERY_FEE" | "TOTAL" | "UNAVAILABLE";
export type CheckoutRevalidationResult =
  | { readonly kind: "unchanged"; readonly current: CheckoutReviewData; readonly validated: ValidatedCheckout }
  | { readonly kind: "review_required"; readonly changes: readonly CheckoutReviewChange[]; readonly current?: CheckoutReviewData };

function currentReview(checkout: AdaptedCheckout, validated: ValidatedCheckout): CheckoutReviewData {
  const address = validated.pickup ?? validated.deliveryAddress;
  if (!address || !isCompleteCheckoutAddress(address) ||
      (!validated.pickup && !isStoredAddress(address))) throw new OrderValidationError("Endereço de entrega incompleto.");
  return {
    restaurant_id: checkout.restaurant_id, customer_id: checkout.customer_id,
    input: canonicalInput(validated.data),
    items: validated.priced.map(item => ({
      product_id: item.product_id,
      product_name: validated.productNames.find(product => product.id === item.product_id)!.name,
      quantity: item.quantity,
      unit_price: moneyText(moneyCents(item.item_price)),
      subtotal: moneyText(moneyCents(item.item_price) * BigInt(item.quantity)),
      variant_id: item.variant_id ?? null, variant_name: item.variant_name ?? null,
      option_ids: (item.options ?? []).map(option => option.option_id).sort(),
    })),
    address, subtotal: moneyText(validated.subtotal), delivery_fee: moneyText(validated.fee), total: moneyText(validated.total),
  };
}

/**
 * Read-only revalidation. No connection acquisition, transaction control or persistence.
 * Call inside H.2's SERIALIZABLE scope and persist only an `unchanged` result using
 * the SAME client/locked validation result before commit. Never use it in another transaction.
 */
export async function revalidateCheckoutReview(
  client: Pick<PoolClient, "query">,
  context: RestaurantContext,
  checkout: AdaptedCheckout,
  snapshot: CheckoutReviewSnapshot,
): Promise<CheckoutRevalidationResult> {
  const captured = reviews.get(snapshot);
  if (!captured || captured.context !== contextKey(context) || context.restaurant_id !== checkout.restaurant_id) {
    return { kind: "review_required", changes: ["CHECKOUT"] };
  }
  const reviewed = captured.data;
  let request: AdaptedCheckout;
  try {
    request = { restaurant_id: checkout.restaurant_id, customer_id: checkout.customer_id, input: canonicalInput(checkout.input) };
  } catch (error) {
    if (error instanceof OrderValidationError) return { kind: "review_required", changes: ["CHECKOUT"] };
    throw error;
  }
  if (!reviewed || reviewed.restaurant_id !== request.restaurant_id || reviewed.customer_id !== request.customer_id ||
      JSON.stringify(reviewed.input) !== JSON.stringify(request.input)) {
    return { kind: "review_required", changes: ["CHECKOUT"] };
  }
  let validated: ValidatedCheckout;
  let current: CheckoutReviewData;
  try {
    validated = await validateOrderCheckout(client, request);
    current = currentReview(request, validated);
  } catch (error) {
    if (error instanceof OrderValidationError) return { kind: "review_required", changes: ["UNAVAILABLE"] };
    // Infrastructure/serialization errors must abort the surrounding transaction.
    throw error;
  }
  const changes: CheckoutReviewChange[] = [];
  const configuration = (items: ReviewItem[]) => items.map(({ unit_price, subtotal, ...item }) => item);
  if (JSON.stringify(configuration(reviewed.items)) !== JSON.stringify(configuration(current.items))) changes.push("ITEMS");
  if (reviewed.items.some((item, i) => item.unit_price !== current.items[i]?.unit_price || item.subtotal !== current.items[i]?.subtotal)) changes.push("PRICES");
  const addressKeys = ["name", "street", "number", "neighborhood", "city", "complement"] as const;
  if (addressKeys.some(key => (reviewed.address as unknown as Record<string, unknown>)[key] !==
      (current.address as unknown as Record<string, unknown>)[key])) changes.push("ADDRESS");
  if (reviewed.delivery_fee !== current.delivery_fee) changes.push("DELIVERY_FEE");
  if (reviewed.total !== current.total || reviewed.subtotal !== current.subtotal) changes.push("TOTAL");
  return changes.length ? { kind: "review_required", changes, current } : { kind: "unchanged", current, validated };
}
