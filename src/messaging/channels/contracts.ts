import type { Channel, Id, RestaurantContext } from "../contracts";
import type { NumericMenu } from "../core/menus";

export type OutgoingContent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "menu"; readonly menu: NumericMenu };

export interface OutgoingMessage {
  readonly delivery_id: Id;
  readonly context: RestaurantContext;
  readonly conversation_id: Id;
  readonly chat_id: string;
  readonly expected_control_epoch: number;
  readonly content: OutgoingContent;
}

export type SendResult =
  | { readonly outcome: "accepted"; readonly provider_message_id?: string }
  | { readonly outcome: "unknown" }
  | { readonly outcome: "failed"; readonly retryable: boolean; readonly code: string };

/** No connection implementation here. Accepted does not mean delivered/read. */
export interface ChannelAdapter {
  readonly channel: Channel;
  send(message: OutgoingMessage): Promise<SendResult>;
}
