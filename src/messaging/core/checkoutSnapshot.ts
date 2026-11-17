import type { BotCart } from "./cart";
import type { PaymentMethod } from "./payment";
import { trustedWhatsAppPhone, type WhatsAppPhoneIdentity } from "../channels/whatsapp/phoneIdentity";
import { sameAddress, type StoredAddress, type DeliveryAddress } from "../../security/customerAddress";
import type { PickupAddress } from "./pickup";
import type { DeliveryRegionSelection } from "./deliveryRegions";
import { moneyCents } from "../../service/order/orderValidation";

/** Internal conversation data, never a WhatsApp text payload or authorization proof. */
export interface CheckoutState {
  readonly step: string;
  readonly cart: BotCart;
  readonly customerId?: string;
  readonly whatsappPhone?: WhatsAppPhoneIdentity;
  readonly fulfillmentMode?: "DELIVERY" | "PICKUP";
  readonly pickupConfirmed?: boolean;
  readonly pickupAddress?: PickupAddress;
  readonly addressCustomerId?: string;
  readonly addressPhone?: string;
  readonly addressConfirmed?: boolean;
  readonly confirmedAddress?: DeliveryAddress;
  readonly addressOriginal?: StoredAddress;
  readonly deliveryRegion?: DeliveryRegionSelection;
  readonly paymentMethod?: PaymentMethod;
  readonly changeFor?: string;
  readonly paymentContext?: string;
}

/** Same in-memory invalidation token used by the conversation; not a signed quote. */
export function checkoutPaymentSnapshot(state: CheckoutState, restaurantId: string): string | undefined {
  const phone = trustedWhatsAppPhone(state.whatsappPhone);
  if (!restaurantId.trim() || !state.customerId || !phone || state.cart.isEmpty()) return;
  if (state.fulfillmentMode === "PICKUP") {
    if (!state.pickupConfirmed || state.pickupAddress?.restaurantId !== restaurantId) return;
  } else if (state.fulfillmentMode === "DELIVERY") {
    const region = state.deliveryRegion;
    if (
      state.customerId !== state.addressCustomerId || phone !== state.addressPhone || !state.addressPhone ||
      !state.addressConfirmed || !state.confirmedAddress || !state.addressOriginal ||
      !region?.confirmed || region.restaurant_id !== restaurantId || region.customer_id !== state.customerId ||
      !sameAddress(region.address, state.confirmedAddress) || !sameAddress(region.address, state.addressOriginal)
    ) return;
  } else return;
  try {
    for (const item of state.cart.list()) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) return;
      moneyCents(item.unitPrice);
    }
    if (state.fulfillmentMode === "DELIVERY") moneyCents(state.deliveryRegion!.fee);
  } catch { return; }
  return JSON.stringify([
    restaurantId, state.customerId, state.whatsappPhone, state.cart.list(), state.fulfillmentMode,
    state.pickupAddress, state.confirmedAddress, state.deliveryRegion,
  ]);
}
