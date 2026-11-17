import type { Pool } from "pg";
import type { Server } from "socket.io";
import type { PersistentWhatsAppCheckout } from "../checkout/whatsappPersistentCheckout";
import { BotDiagnosticError } from "./diagnostics";
import type { LocalBotConfig } from "./config";
import { connectLocalWhatsApp } from "./connection";

export interface CheckoutHost {
  readonly database: Pool;
  /** The host's existing, configured Socket.IO server. Never create one here. */
  readonly io: Server;
}

async function existingHost(): Promise<CheckoutHost> {
  const { getSocketInstance } = await import("../../socket/socketInstance");
  const io = getSocketInstance();
  const { pool } = await import("../../database");
  return { database: pool, io };
}

/** Read-only preflight. Customer ownership is checked per message by the authorizer. */
export async function prepareWorkerCheckout(
  config: LocalBotConfig,
  host: () => Promise<CheckoutHost> = existingHost,
): Promise<PersistentWhatsAppCheckout | undefined> {
  if (!config.realCheckoutEnabled) return undefined;
  try {
    const { database, io } = await host();
    if (!database || !io || !io._nsps?.has("/orders")) throw new Error("Missing orders namespace");
    const orders = io.of("/orders");
    if (typeof orders.to !== "function" || typeof orders.emit !== "function") throw new Error("Invalid orders namespace");
    const client = await database.connect();
    try {
      const { rows } = await client.query(`SELECT current_user AS role, session_user AS login,
        rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
        FROM pg_roles WHERE rolname = current_user`);
      const role = rows[0];
      if (!role || role.role !== "gama_app" || role.login !== "gama_app" ||
          role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole)
        throw new Error("Invalid runtime role");
      const privileges = await client.query(`SELECT
        has_table_privilege(current_user, 'public.whatsapp_checkout_intents', 'SELECT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'intent_id', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'restaurant_id', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'customer_id', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'session_id', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'account_id', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'sender_id', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'whatsapp_phone', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'canonical_checkout', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'checkout_hash', 'INSERT') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'state', 'UPDATE') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'order_id', 'UPDATE') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'failure_code', 'UPDATE') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'active', 'UPDATE') AND
        has_column_privilege(current_user, 'public.whatsapp_checkout_intents', 'retired_at', 'UPDATE') AS allowed`);
      if (privileges.rows[0]?.allowed !== true) throw new Error("Missing intent grants");
      await client.query("SELECT id, restaurant_id, phone FROM public.customers LIMIT 0");
      await client.query("SELECT id, fulfillment_type, subtotal, delivery_fee, pickup_address, delivery_address, bairro_id FROM public.orders LIMIT 0");
    } finally { client.release(); }
    const { createPersistentWhatsAppCheckout } = await import("../checkout/whatsappPersistentCheckout");
    return createPersistentWhatsAppCheckout(database, io);
  } catch {
    throw new BotDiagnosticError("configuration", "REAL_CHECKOUT_UNAVAILABLE",
      "Checkout real indisponível: confira pool gama_app, migration 008 e Socket.IO /orders no mesmo processo. Sem fallback para simulação.");
  }
}

/** Single startup path shared by the CLI and an explicitly configured host. */
export async function startConfiguredWhatsApp(
  config: LocalBotConfig,
  renderQr: (qr: string) => void,
  log: (text: string) => void,
  host?: () => Promise<CheckoutHost>,
  connect: typeof connectLocalWhatsApp = connectLocalWhatsApp,
) {
  const checkout = await prepareWorkerCheckout(config, host);
  return connect(config, renderQr, log, undefined, checkout);
}
