import type { Id, Instant, RestaurantContext } from "../contracts";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "pairing"
  | "connected"
  | "reconnect_wait"
  | "reauth_required";

export interface SessionLease {
  readonly owner_id: Id;
  /** Decimal bigint string; do not convert to a JavaScript number. */
  readonly fence: string;
  readonly expires_at: Instant;
}

/** One logical session per restaurant/channel; no credentials in this DTO. */
export interface RestaurantSession {
  readonly context: RestaurantContext;
  readonly account_id: string | null;
  readonly connection: ConnectionState;
  readonly automation: "enabled" | "paused";
  readonly lease: SessionLease | null;
}
