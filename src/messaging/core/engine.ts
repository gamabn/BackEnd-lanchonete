import type { Id, IncomingMessage, Instant, RestaurantContext } from "../contracts";
import type { Conversation } from "../conversations/contracts";
import type { OutgoingContent } from "../channels/contracts";

/** Commercial requests/results will receive typed contracts in a later stage. */
export type EngineEvent =
  | { readonly kind: "message"; readonly message: IncomingMessage }
  | { readonly kind: "timeout"; readonly context: RestaurantContext; readonly conversation_id: Id }
  | { readonly kind: "human_resumed"; readonly context: RestaurantContext; readonly conversation_id: Id; readonly expected_control_epoch: number };

export type EngineEffect =
  | { readonly kind: "send"; readonly content: OutgoingContent }
  | { readonly kind: "request_handoff" };

export interface EngineResponse {
  readonly context: RestaurantContext;
  readonly conversation_id: Id;
  readonly expected_version: number;
  readonly next: Conversation;
  readonly effects: readonly EngineEffect[];
}

/** Pure transition boundary: no I/O, transport SDK, persistence or price rules. */
export interface AttendanceEngine {
  transition(
    current: Conversation,
    event: EngineEvent,
    now: Instant,
  ): EngineResponse;
}
