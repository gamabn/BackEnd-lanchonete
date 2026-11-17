import type {
  Channel,
  RestaurantContext,
  ExternalIdentity,
  IncomingMessage,
} from "./contracts";
import type { NumericMenu, MenuTarget } from "./core/menus";
import type {
  ConversationCart,
  DeliveryAddress,
  OrderDeliverySelection,
} from "./checkout/contracts";
import type { RestaurantSession } from "./sessions/contracts";
import type { Conversation } from "./conversations/contracts";
import type { OutgoingMessage } from "./channels/contracts";

export const VALIDATION_LIMITS = Object.freeze({
  text: 4096,
  externalId: 256,
  profileName: 120,
  label: 200,
  menuOptions: 50,
  cartLines: 100,
  quantity: 32767,
  optionsPerLine: 100,
  city: 120,
  street: 200,
  number: 40,
  neighborhood: 120,
  complement: 300,
});

/** No payload values in errors: they may contain personal data or secrets. */
export class MessagingValidationError extends Error {
  constructor(
    public readonly path: string,
    public readonly code: string = "INVALID_PAYLOAD",
  ) {
    super(`Messaging validation failed at ${path}: ${code}`);
    this.name = "MessagingValidationError";
  }
}
function fail(path: string, code?: string): never {
  throw new MessagingValidationError(path, code);
}
function object(
  value: unknown,
  required: string[],
  optional: string[] = [],
  path = "payload",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path);
  const data = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(data).some(
      (key) =>
        typeof key !== "string" || ![...required, ...optional].includes(key),
    )
  )
    fail(path, "UNEXPECTED_FIELD");
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(data, key)))
    fail(path, "MISSING_FIELD");
  return data;
}
function text(
  value: unknown,
  max: number,
  path: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    fail(path);
}
function opaque(value: unknown, path: string) {
  text(value, VALIDATION_LIMITS.externalId, path);
  if (/\s/u.test(value)) fail(path);
}
function uuid(value: unknown, path: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    fail(path);
}
function integer(value: unknown, min: number, max: number, path: string) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    fail(path);
}
function instant(value: unknown, path: string): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  )
    fail(path);
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value)
    fail(path);
  return time;
}
function nowTime(now: number) {
  if (!Number.isFinite(now)) fail("now");
  return now;
}
function oneOf(value: unknown, values: readonly unknown[], path: string) {
  if (!values.includes(value)) fail(path);
}
function list(value: unknown, max: number, path: string): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    fail(path);
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) fail(path);
  }
  return value;
}
function ids(value: unknown, path: string) {
  const entries = list(value, VALIDATION_LIMITS.optionsPerLine, path);
  entries.forEach((id) => uuid(id, path));
  if (new Set(entries).size !== entries.length) fail(path, "DUPLICATE_ID");
}

export function validateChannel(value: unknown): Channel {
  oneOf(value, ["whatsapp", "telegram"], "channel");
  return value as Channel;
}
export function validateRestaurantContext(value: unknown): RestaurantContext {
  const data = object(value, ["restaurant_id", "session_id", "channel"]);
  uuid(data.restaurant_id, "restaurant_id");
  uuid(data.session_id, "session_id");
  validateChannel(data.channel);
  return value as RestaurantContext;
}
export function validateExternalIdentity(value: unknown): ExternalIdentity {
  const data = object(value, ["channel", "account_id", "subject_id"]);
  validateChannel(data.channel);
  opaque(data.account_id, "account_id");
  opaque(data.subject_id, "subject_id");
  return value as ExternalIdentity;
}
/** expected must come from trusted infrastructure, never from the same payload. */
export function assertSameContext(
  expected: RestaurantContext,
  actual: RestaurantContext,
): void {
  validateRestaurantContext(expected);
  validateRestaurantContext(actual);
  for (const key of ["restaurant_id", "session_id", "channel"] as const) {
    if (expected[key] !== actual[key]) fail(key, "CONTEXT_MISMATCH");
  }
}
export function validateIncomingMessage(value: unknown): IncomingMessage {
  const data = object(
    value,
    [
      "schema_version",
      "context",
      "message_id",
      "sender",
      "chat_id",
      "received_at",
      "content",
    ],
    ["profile_name", "occurred_at", "reply_to_message_id"],
  );
  oneOf(data.schema_version, [1], "schema_version");
  const context = validateRestaurantContext(data.context),
    sender = validateExternalIdentity(data.sender);
  if (context.channel !== sender.channel)
    fail("sender.channel", "CONTEXT_MISMATCH");
  opaque(data.message_id, "message_id");
  opaque(data.chat_id, "chat_id");
  instant(data.received_at, "received_at");
  if ("occurred_at" in data) instant(data.occurred_at, "occurred_at");
  if ("reply_to_message_id" in data)
    opaque(data.reply_to_message_id, "reply_to_message_id");
  if ("profile_name" in data) {
    const profile = object(data.profile_name, [
      "value",
      "requires_confirmation",
    ]);
    text(profile.value, VALIDATION_LIMITS.profileName, "profile_name.value");
    oneOf(profile.requires_confirmation, [true], "requires_confirmation");
  }
  const content = object(data.content, ["kind"], ["text", "media_type"]);
  if (content.kind === "text") {
    object(content, ["kind", "text"]);
    text(content.text, VALIDATION_LIMITS.text, "content.text");
  } else {
    object(content, ["kind"], ["media_type"]);
    oneOf(content.kind, ["unsupported"], "content.kind");
    if ("media_type" in content) text(content.media_type, 100, "media_type");
  }
  return value as IncomingMessage;
}

const actions = [
  "main_menu",
  "back",
  "cancel",
  "next_page",
  "previous_page",
  "finish_selection",
  "view_cart",
  "checkout",
  "confirm_order",
  "lookup_order",
  "human_handoff",
  "use_saved_address",
  "new_address",
];
function target(value: unknown): void {
  const data = object(
    value,
    ["kind"],
    [
      "category",
      "product_id",
      "variant_id",
      "group_id",
      "option_id",
      "neighborhood_id",
      "line_id",
      "method",
      "action",
    ],
  );
  const keys: Record<string, string> = {
    product: "product_id",
    variant: "variant_id",
    group: "group_id",
    option: "option_id",
    neighborhood: "neighborhood_id",
    cart_line: "line_id",
  };
  if (
    typeof data.kind !== "string" ||
    !Object.prototype.hasOwnProperty.call(keys, data.kind)
  ) {
    if (data.kind === "category") {
      object(data, ["kind", "category"]);
      if (data.category !== null) text(data.category, 120, "category");
    } else if (data.kind === "payment") {
      object(data, ["kind", "method"]);
      oneOf(data.method, ["Dinheiro", "Cartao", "Pix"], "method");
    } else {
      object(data, ["kind", "action"]);
      oneOf(data.kind, ["action"], "target.kind");
      oneOf(data.action, actions, "action");
    }
  } else {
    const key = keys[data.kind];
    object(data, ["kind", key]);
    uuid(data[key], key);
  }
}
/** Structural validation allows expired persisted menus; selection checks freshness. */
export function validateNumericMenu(value: unknown): NumericMenu {
  const data = object(value, [
    "id",
    "context",
    "revision",
    "text",
    "options",
    "expires_at",
  ]);
  uuid(data.id, "menu.id");
  validateRestaurantContext(data.context);
  integer(data.revision, 0, Number.MAX_SAFE_INTEGER, "revision");
  text(data.text, VALIDATION_LIMITS.text, "menu.text");
  instant(data.expires_at, "expires_at");
  const options = list(data.options, VALIDATION_LIMITS.menuOptions, "options");
  if (!options.length) fail("options");
  const seen = new Set<number>();
  for (const entry of options) {
    const option = object(entry, ["number", "label", "target"]);
    integer(option.number, 1, 999, "option.number");
    text(option.label, VALIDATION_LIMITS.label, "label");
    target(option.target);
    if (seen.has(option.number as number)) fail("options", "DUPLICATE_NUMBER");
    seen.add(option.number as number);
  }
  return value as NumericMenu;
}
export function resolveMenuChoice(
  menu: unknown,
  choice: unknown,
  expected: {
    readonly context: RestaurantContext;
    readonly menu_id: string;
    readonly revision: number;
  },
  now: number,
): MenuTarget {
  const validated = validateNumericMenu(menu);
  assertSameContext(expected.context, validated.context);
  uuid(expected.menu_id, "expected.menu_id");
  integer(expected.revision, 0, Number.MAX_SAFE_INTEGER, "expected.revision");
  if (
    validated.id !== expected.menu_id ||
    validated.revision !== expected.revision
  )
    fail("menu", "STALE_MENU");
  if (instant(validated.expires_at, "expires_at") <= nowTime(now))
    fail("menu", "EXPIRED_MENU");
  if (typeof choice !== "string" || !/^[1-9]\d{0,2}$/.test(choice))
    fail("choice", "INVALID_CHOICE");
  const option = validated.options.find(
    (entry) => entry.number === Number(choice),
  );
  if (!option) fail("choice", "INVALID_CHOICE");
  return option.target;
}

export function validateConversationCart(value: unknown): ConversationCart {
  const data = object(value, [
    "context",
    "conversation_id",
    "revision",
    "lines",
  ]);
  validateRestaurantContext(data.context);
  uuid(data.conversation_id, "conversation_id");
  integer(data.revision, 0, Number.MAX_SAFE_INTEGER, "revision");
  const lines = list(data.lines, VALIDATION_LIMITS.cartLines, "lines"),
    seen = new Set<unknown>();
  for (const entry of lines) {
    const line = object(
      entry,
      ["line_id", "product_id", "quantity", "kind"],
      ["variant_id", "option_ids"],
    );
    uuid(line.line_id, "line_id");
    uuid(line.product_id, "product_id");
    integer(line.quantity, 1, VALIDATION_LIMITS.quantity, "quantity");
    if (seen.has(line.line_id)) fail("line_id", "DUPLICATE_ID");
    seen.add(line.line_id);
    if (line.kind === "simple")
      object(line, ["line_id", "product_id", "quantity", "kind"]);
    else {
      object(line, [
        "line_id",
        "product_id",
        "quantity",
        "kind",
        "variant_id",
        "option_ids",
      ]);
      oneOf(line.kind, ["configured"], "line.kind");
      uuid(line.variant_id, "variant_id");
      ids(line.option_ids, "option_ids");
    }
  }
  return value as ConversationCart;
}
/** Shape only: strings do not authorize delivery, even when city_source is set. */
export function validateDeliveryAddress(value: unknown): DeliveryAddress {
  const data = object(value, [
    "city",
    "street",
    "number",
    "neighborhood",
    "complement",
  ]);
  for (const key of ["city", "street", "number", "neighborhood"] as const)
    text(data[key], VALIDATION_LIMITS[key], key);
  if (data.complement !== null) {
    if (data.complement !== "")
      text(data.complement, VALIDATION_LIMITS.complement, "complement");
  }
  return value as DeliveryAddress;
}
export function validateOrderDeliverySelection(
  value: unknown,
): OrderDeliverySelection {
  const data = object(value, [
    "context",
    "neighborhood_id",
    "address",
    "city_source",
    "customer_address_update",
  ]);
  validateRestaurantContext(data.context);
  uuid(data.neighborhood_id, "neighborhood_id");
  validateDeliveryAddress(data.address);
  oneOf(data.city_source, ["restaurant"], "city_source");
  oneOf(data.customer_address_update, ["none"], "customer_address_update");
  return value as OrderDeliverySelection;
}
export function validateRestaurantSession(value: unknown): RestaurantSession {
  const data = object(value, [
    "context",
    "account_id",
    "connection",
    "automation",
    "lease",
  ]);
  validateRestaurantContext(data.context);
  if (data.account_id !== null) opaque(data.account_id, "account_id");
  oneOf(
    data.connection,
    [
      "disconnected",
      "connecting",
      "pairing",
      "connected",
      "reconnect_wait",
      "reauth_required",
    ],
    "connection",
  );
  oneOf(data.automation, ["enabled", "paused"], "automation");
  if (data.lease !== null) {
    const lease = object(data.lease, ["owner_id", "fence", "expires_at"]);
    uuid(lease.owner_id, "owner_id");
    instant(lease.expires_at, "lease.expires_at");
    if (
      typeof lease.fence !== "string" ||
      !/^(0|[1-9]\d{0,18})$/.test(lease.fence) ||
      BigInt(lease.fence) > 9223372036854775807n
    )
      fail("fence");
  }
  return value as RestaurantSession;
}

function checkout(value: unknown, context: RestaurantContext) {
  const data = object(value, ["customer", "delivery", "payment"]);
  const customer = object(data.customer, ["name", "phone", "email_candidate"]);
  if (customer.name !== null) {
    const name = object(customer.name, ["value", "confirmed"]);
    text(name.value, 120, "name");
    oneOf(name.confirmed, [true], "confirmed");
  }
  if (customer.phone !== null) text(customer.phone, 40, "phone");
  if (customer.email_candidate !== null)
    text(customer.email_candidate, 254, "email_candidate");
  if (data.delivery !== null)
    assertSameContext(
      context,
      validateOrderDeliverySelection(data.delivery).context,
    );
  if (data.payment !== null) {
    const payment = object(data.payment, ["method", "change_for"]);
    oneOf(payment.method, ["Dinheiro", "Cartao", "Pix"], "method");
    if (
      typeof payment.change_for !== "string" ||
      !/^\d{1,12}\.\d{2}$/.test(payment.change_for)
    )
      fail("change_for");
    if (payment.method !== "Dinheiro" && !/^0+\.00$/.test(payment.change_for))
      fail("change_for");
  }
}
export function validateConversation(value: unknown): Conversation {
  const data = object(value, [
    "schema_version",
    "id",
    "context",
    "identity",
    "chat_id",
    "customer_id",
    "version",
    "control",
    "step",
    "cart",
    "active_menu",
    "expires_at",
  ]);
  oneOf(data.schema_version, [1], "schema_version");
  uuid(data.id, "conversation.id");
  const context = validateRestaurantContext(data.context),
    identity = validateExternalIdentity(data.identity);
  if (context.channel !== identity.channel)
    fail("identity.channel", "CONTEXT_MISMATCH");
  opaque(data.chat_id, "chat_id");
  if (data.customer_id !== null) uuid(data.customer_id, "customer_id");
  integer(data.version, 0, Number.MAX_SAFE_INTEGER, "version");
  instant(data.expires_at, "expires_at");
  const control = object(data.control, ["mode", "epoch"]);
  oneOf(control.mode, ["bot", "human"], "mode");
  integer(control.epoch, 0, Number.MAX_SAFE_INTEGER, "epoch");
  const cart = validateConversationCart(data.cart);
  assertSameContext(context, cart.context);
  if (cart.conversation_id !== data.id)
    fail("cart.conversation_id", "CONTEXT_MISMATCH");
  if (data.active_menu !== null)
    assertSameContext(context, validateNumericMenu(data.active_menu).context);
  const step = object(
    data.step,
    ["name"],
    [
      "product_id",
      "variant_id",
      "group_id",
      "selected_option_ids",
      "configuration",
      "draft",
      "quote_id",
      "cart_revision",
      "quote_expires_at",
      "confirmation_id",
      "idempotency_key",
    ],
  );
  const fields: Record<string, string[]> = {
    MAIN_MENU: [],
    BROWSE_CATALOG: [],
    SELECT_PRODUCT: [],
    CART: [],
    LOOKUP_ORDER: [],
    HUMAN: [],
    SELECT_VARIANT: ["product_id"],
    SELECT_GROUP: ["product_id", "variant_id"],
    SELECT_OPTIONS: [
      "product_id",
      "variant_id",
      "group_id",
      "selected_option_ids",
    ],
    SELECT_QUANTITY: ["product_id", "configuration"],
    CHECKOUT: ["draft"],
    CONFIRM_ORDER: [
      "quote_id",
      "cart_revision",
      "quote_expires_at",
      "confirmation_id",
    ],
    ORDER_SUBMISSION_PENDING: ["idempotency_key"],
  };
  if (
    typeof step.name !== "string" ||
    !Object.prototype.hasOwnProperty.call(fields, step.name)
  )
    fail("step.name");
  object(step, ["name", ...fields[step.name]]);
  for (const key of [
    "product_id",
    "variant_id",
    "group_id",
    "quote_id",
    "confirmation_id",
  ])
    if (key in step) uuid(step[key], key);
  if ("selected_option_ids" in step)
    ids(step.selected_option_ids, "selected_option_ids");
  if ("configuration" in step && step.configuration !== null) {
    const config = object(step.configuration, ["variant_id", "option_ids"]);
    uuid(config.variant_id, "variant_id");
    ids(config.option_ids, "option_ids");
  }
  if ("draft" in step) checkout(step.draft, context);
  if ("cart_revision" in step) {
    integer(step.cart_revision, 0, Number.MAX_SAFE_INTEGER, "cart_revision");
    if (step.cart_revision !== cart.revision)
      fail("cart_revision", "STALE_CART");
    instant(step.quote_expires_at, "quote_expires_at");
  }
  if ("idempotency_key" in step)
    opaque(step.idempotency_key, "idempotency_key");
  if ((step.name === "HUMAN") !== (control.mode === "human"))
    fail("control.mode", "CONTROL_MISMATCH");
  return value as Conversation;
}
/** Both session and expected context must be loaded by trusted infrastructure. */
export function assertConversationSession(
  expected: RestaurantContext,
  conversation: unknown,
  session: unknown,
): void {
  const current = validateConversation(conversation),
    connection = validateRestaurantSession(session);
  assertSameContext(expected, current.context);
  assertSameContext(expected, connection.context);
  if (
    !connection.account_id ||
    connection.account_id !== current.identity.account_id
  )
    fail("account_id", "CONTEXT_MISMATCH");
}
export function assertMessageConversation(
  message: unknown,
  conversation: unknown,
  session: unknown,
  expected: RestaurantContext,
): void {
  assertConversationSession(expected, conversation, session);
  const incoming = validateIncomingMessage(message),
    current = validateConversation(conversation);
  assertSameContext(expected, incoming.context);
  if (
    incoming.sender.account_id !== current.identity.account_id ||
    incoming.sender.subject_id !== current.identity.subject_id ||
    incoming.chat_id !== current.chat_id
  )
    fail("sender", "CONTEXT_MISMATCH");
}
export function validateOutgoingMessage(value: unknown): OutgoingMessage {
  const data = object(value, [
    "delivery_id",
    "context",
    "conversation_id",
    "chat_id",
    "expected_control_epoch",
    "content",
  ]);
  uuid(data.delivery_id, "delivery_id");
  const context = validateRestaurantContext(data.context);
  uuid(data.conversation_id, "conversation_id");
  opaque(data.chat_id, "chat_id");
  integer(
    data.expected_control_epoch,
    0,
    Number.MAX_SAFE_INTEGER,
    "expected_control_epoch",
  );
  const content = object(data.content, ["kind"], ["text", "menu"]);
  if (content.kind === "text") {
    object(content, ["kind", "text"]);
    text(content.text, VALIDATION_LIMITS.text, "content.text");
  } else {
    object(content, ["kind", "menu"]);
    oneOf(content.kind, ["menu"], "content.kind");
    assertSameContext(context, validateNumericMenu(content.menu).context);
  }
  return value as OutgoingMessage;
}

/** Final local routing/control guard; does not check lease ownership or API access. */
export function assertOutgoingConversation(
  message: unknown,
  conversation: unknown,
  session: unknown,
  expected: RestaurantContext,
): void {
  assertConversationSession(expected, conversation, session);
  const outgoing = validateOutgoingMessage(message),
    current = validateConversation(conversation);
  assertSameContext(expected, outgoing.context);
  if (
    outgoing.conversation_id !== current.id ||
    outgoing.chat_id !== current.chat_id
  )
    fail("destination", "CONTEXT_MISMATCH");
  if (
    current.control.mode !== "bot" ||
    outgoing.expected_control_epoch !== current.control.epoch
  )
    fail("control", "CONTROL_MISMATCH");
}
