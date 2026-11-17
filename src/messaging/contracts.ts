/** Transport identifiers are opaque strings, never proof of phone ownership. */
export type Channel = "whatsapp" | "telegram";
export type Id = string;
export type Instant = string;

/** Resolved by trusted infrastructure, never from a customer's message. */
export interface RestaurantContext {
  readonly restaurant_id: Id;
  readonly session_id: Id;
  readonly channel: Channel;
}

export interface ExternalIdentity {
  readonly channel: Channel;
  readonly account_id: string;
  readonly subject_id: string;
}

export interface ProfileNameSuggestion {
  readonly value: string;
  readonly requires_confirmation: true;
}

export interface IncomingMessage {
  readonly schema_version: 1;
  readonly context: RestaurantContext;
  readonly message_id: string;
  readonly sender: ExternalIdentity;
  /** A transport destination is distinct from the sender identity. */
  readonly chat_id: string;
  readonly profile_name?: ProfileNameSuggestion;
  readonly received_at: Instant;
  readonly occurred_at?: Instant;
  readonly reply_to_message_id?: string;
  readonly content:
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "unsupported"; readonly media_type?: string };
}
