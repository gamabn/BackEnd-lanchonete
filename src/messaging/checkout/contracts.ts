import type { Id, RestaurantContext } from "../contracts";

interface CartLineBase {
  readonly line_id: Id;
  readonly product_id: Id;
  /** API must validate integer range and current availability. */
  readonly quantity: number;
}

export type CartLine =
  | (CartLineBase & { readonly kind: "simple" })
  | (CartLineBase & {
      readonly kind: "configured";
      readonly variant_id: Id;
      readonly option_ids: readonly Id[];
    });

/** No authoritative prices: quote and order validation belong to the API. */
export interface ConversationCart {
  readonly context: RestaurantContext;
  readonly conversation_id: Id;
  readonly revision: number;
  readonly lines: readonly CartLine[];
}

/** Exact keys of the existing orders.delivery_address JSON snapshot. */
export interface DeliveryAddress {
  readonly city: string;
  readonly street: string;
  readonly number: string;
  readonly neighborhood: string;
  readonly complement: string | null;
}

/** Only the API can validate city against restaurants.city and bairro ownership. */
export interface OrderDeliverySelection {
  readonly context: RestaurantContext;
  readonly neighborhood_id: Id;
  readonly address: DeliveryAddress;
  readonly city_source: "restaurant";
  /** Per-order selection never implicitly updates customers. */
  readonly customer_address_update: "none";
}

/** Draft gathered only after checkout starts; never an authentication proof. */
export interface CheckoutCustomerDraft {
  readonly name: { readonly value: string; readonly confirmed: true } | null;
  readonly phone: string | null;
  /** Optional input, not a verified customers.email value. */
  readonly email_candidate: string | null;
}

export interface CheckoutDraft {
  readonly customer: CheckoutCustomerDraft;
  readonly delivery: OrderDeliverySelection | null;
  readonly payment: {
    readonly method: "Dinheiro" | "Cartao" | "Pix";
    readonly change_for: string;
  } | null;
}
