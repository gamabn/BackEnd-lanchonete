import type { Id, Instant, RestaurantContext } from "../contracts";

export type MenuAction =
  | "main_menu" | "back" | "cancel" | "next_page" | "previous_page"
  | "finish_selection" | "view_cart" | "checkout" | "confirm_order"
  | "lookup_order" | "human_handoff" | "use_saved_address" | "new_address";

export type MenuTarget =
  // Categories currently have a text value, not a database UUID.
  | { readonly kind: "category"; readonly category: string | null }
  | { readonly kind: "product"; readonly product_id: Id }
  | { readonly kind: "variant"; readonly variant_id: Id }
  | { readonly kind: "group"; readonly group_id: Id }
  | { readonly kind: "option"; readonly option_id: Id }
  | { readonly kind: "neighborhood"; readonly neighborhood_id: Id }
  | { readonly kind: "cart_line"; readonly line_id: Id }
  | { readonly kind: "payment"; readonly method: "Dinheiro" | "Cartao" | "Pix" }
  | { readonly kind: "action"; readonly action: MenuAction };

export interface NumericMenuOption {
  readonly number: number;
  readonly label: string;
  readonly target: MenuTarget;
}

/** Persist the displayed mapping before sending; never reconstruct it on reply. */
export interface NumericMenu {
  readonly id: Id;
  readonly context: RestaurantContext;
  readonly revision: number;
  readonly text: string;
  readonly options: readonly NumericMenuOption[];
  readonly expires_at: Instant;
}

/** Effective limits supplied by the API for a specific product/size/group. */
export interface SelectionLimits {
  readonly product_id: Id;
  readonly variant_id: Id;
  readonly group_id: Id;
  readonly min_select: number;
  readonly max_select: number;
}
