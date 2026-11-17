import type { RestaurantContext } from "../contracts";
import { validateRestaurantContext } from "../validation";
import { checkoutPaymentSnapshot, type CheckoutState } from "../core/checkoutSnapshot";
import { parseCashAmount } from "../core/payment";
import {
  parseOrder, moneyCents, moneyText, OrderValidationError, type OrderInput,
} from "../../service/order/orderValidation";

export interface AdaptedCheckout {
  readonly restaurant_id: string;
  readonly customer_id: string;
  readonly input: OrderInput;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reject(): never {
  throw new OrderValidationError("Checkout incompleto ou desatualizado. Revise os dados novamente.");
}
export function isCompleteCheckoutAddress(address: object | undefined): boolean {
  if (!address) return false;
  const fields = address as Record<string, unknown>;
  return ["street", "number", "neighborhood", "city"].every(key =>
    typeof fields[key] === "string" && fields[key].trim().length > 0 &&
    !/[\x00-\x1f\x7f]/.test(fields[key] as string));
}

/**
 * Pure conversion of server-owned conversation state and trusted session context.
 * Does not authorize a customer, reprice against PostgreSQL, or submit an order.
 * The caller must obtain state from the session store, never from message text.
 */
export function adaptWhatsAppCheckout(context: RestaurantContext, state: CheckoutState): AdaptedCheckout {
  validateRestaurantContext(context);
  if (context.channel !== "whatsapp" || state.step !== "ORDER_REVIEW" ||
      !state.customerId || !uuid.test(state.customerId) || state.cart.isEmpty()) reject();

  const snapshot = checkoutPaymentSnapshot(state, context.restaurant_id);
  if (!snapshot || !state.paymentContext || snapshot !== state.paymentContext) reject();

  if (state.fulfillmentMode === "PICKUP") {
    if (!isCompleteCheckoutAddress(state.pickupAddress) || !state.pickupAddress?.name?.trim()) reject();
  } else if (state.fulfillmentMode === "DELIVERY") {
    if (!isCompleteCheckoutAddress(state.confirmedAddress) ||
        state.deliveryRegion?.fulfillment_mode !== "DELIVERY" ||
        state.deliveryRegion.bairro !== state.confirmedAddress?.neighborhood) reject();
  } else reject();

  let payment: OrderInput["payment_method"];
  switch (state.paymentMethod) {
    case "PIX": payment = "Pix"; break;
    case "DINHEIRO": payment = "Dinheiro"; break;
    case "DEBITO":
    case "CREDITO": payment = "Cartao"; break;
    default: return reject();
  }

  let change = 0n;
  if (state.changeFor !== undefined) {
    if (payment !== "Dinheiro") reject();
    const amount = parseCashAmount(state.changeFor);
    if (amount === undefined) reject();
    change = amount;
  }
  const subtotal = state.cart.list().reduce((sum, item) =>
    sum + moneyCents(item.unitPrice) * BigInt(item.quantity), 0n);
  const total = subtotal + (state.fulfillmentMode === "DELIVERY" ? moneyCents(state.deliveryRegion!.fee) : 0n);
  if (change > 0n && change < total) reject();

  const input = parseOrder({
    items: state.cart.toOrderItems(),
    fulfillment_type: state.fulfillmentMode,
    bairro_id: state.fulfillmentMode === "DELIVERY" ? state.deliveryRegion!.bairro_id : null,
    payment_method: payment,
    change_for: moneyText(change),
  });
  // Detach configured option arrays from the mutable cart as well.
  return {
    restaurant_id: context.restaurant_id,
    customer_id: state.customerId,
    input: { ...input, items: input.items.map(item => ({ ...item,
      ...(item.option_ids ? { option_ids: [...item.option_ids] } : {}),
    })) },
  };
}
