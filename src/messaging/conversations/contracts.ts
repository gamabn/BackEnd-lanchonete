import type { ExternalIdentity, Id, Instant, RestaurantContext } from "../contracts";
import type { CheckoutDraft, ConversationCart } from "../checkout/contracts";
import type { NumericMenu } from "../core/menus";

export type ConversationStep =
  | { readonly name: "MAIN_MENU" }
  | { readonly name: "BROWSE_CATALOG" }
  | { readonly name: "SELECT_PRODUCT" }
  | { readonly name: "SELECT_VARIANT"; readonly product_id: Id }
  | { readonly name: "SELECT_GROUP"; readonly product_id: Id; readonly variant_id: Id }
  | {
      readonly name: "SELECT_OPTIONS";
      readonly product_id: Id;
      readonly variant_id: Id;
      readonly group_id: Id;
      readonly selected_option_ids: readonly Id[];
    }
  | {
      readonly name: "SELECT_QUANTITY";
      readonly product_id: Id;
      readonly configuration: {
        readonly variant_id: Id;
        readonly option_ids: readonly Id[];
      } | null;
    }
  | { readonly name: "CART" }
  | { readonly name: "CHECKOUT"; readonly draft: CheckoutDraft }
  | {
      readonly name: "CONFIRM_ORDER";
      readonly quote_id: Id;
      readonly cart_revision: number;
      readonly quote_expires_at: Instant;
      readonly confirmation_id: Id;
    }
  | { readonly name: "ORDER_SUBMISSION_PENDING"; readonly idempotency_key: string }
  | { readonly name: "LOOKUP_ORDER" }
  | { readonly name: "HUMAN" };

export type ConversationState = ConversationStep["name"];

export interface Conversation {
  readonly schema_version: 1;
  readonly id: Id;
  readonly context: RestaurantContext;
  readonly identity: ExternalIdentity;
  readonly chat_id: string;
  /** Established by the API during checkout/linking, never by phone matching. */
  readonly customer_id: Id | null;
  readonly version: number;
  readonly control: {
    readonly mode: "bot" | "human";
    readonly epoch: number;
  };
  readonly step: ConversationStep;
  readonly cart: ConversationCart;
  readonly active_menu: NumericMenu | null;
  readonly expires_at: Instant;
}
