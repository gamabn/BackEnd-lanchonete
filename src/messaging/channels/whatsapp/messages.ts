import { randomUUID } from "crypto";
import type { WAMessage } from "@whiskeysockets/baileys";
import type { IncomingMessage, RestaurantContext } from "../../contracts";
import type { ChannelAdapter, OutgoingMessage } from "../contracts";
import {
  assertSameContext,
  validateIncomingMessage,
  validateOutgoingMessage,
} from "../../validation";
import { ConversationMenu } from "../../core/conversationMenu";
import { WhatsAppPhoneResolver } from "./phoneIdentity";
export function isIndividualJid(jid: unknown): jid is string {
  return (
    typeof jid === "string" && /^[^\s@]+@(s\.whatsapp\.net|lid)$/.test(jid)
  );
}

/** Only live direct text. Preserve opaque routing; phone evidence stays out of the envelope. */
export function normalizeWhatsAppMessage(
  raw: WAMessage,
  context: RestaurantContext,
  accountId: string,
  startedAt: number,
  now: number,
): IncomingMessage | null {
  const jid = raw.key?.remoteJid;
  if (
    raw.key?.fromMe ||
    raw.key?.participant ||
    !isIndividualJid(jid) ||
    !raw.key.id
  )
    return null;
  const seconds =
    typeof raw.messageTimestamp === "number"
      ? raw.messageTimestamp
      : raw.messageTimestamp?.toNumber();
  if (
    !seconds ||
    !Number.isFinite(seconds) ||
    seconds < Math.floor(startedAt / 1000) ||
    seconds * 1000 < now - 120_000 ||
    seconds * 1000 > now + 30_000
  )
    return null;
  const text =
    raw.message?.conversation ?? raw.message?.extendedTextMessage?.text;
  if (typeof text !== "string") return null;
  try {
    return validateIncomingMessage({
      schema_version: 1,
      context,
      message_id: raw.key.id,
      sender: { channel: "whatsapp", account_id: accountId, subject_id: jid },
      chat_id: jid,
      received_at: new Date(now).toISOString(),
      occurred_at: new Date(seconds * 1000).toISOString(),
      content: { kind: "text", text },
      ...(raw.pushName && raw.pushName.length <= 120
        ? { profile_name: { value: raw.pushName, requires_confirmation: true } }
        : {}),
    });
  } catch {
    return null;
  }
}

export type SendText = (
  jid: string,
  content: { text: string },
) => Promise<{ key?: { id?: string | null } } | undefined>;

/** A one-shot capability restricted to the validated incoming message destination. */
class ReplyOnlyAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;
  private used = false;
  constructor(
    private readonly incoming: IncomingMessage,
    private readonly sendText: SendText,
  ) {}
  async send(message: OutgoingMessage) {
    validateOutgoingMessage(message);

    assertSameContext(this.incoming.context, message.context);

    if (
      this.used ||
      message.chat_id !== this.incoming.chat_id ||
      !isIndividualJid(message.chat_id) ||
      message.content.kind !== "text"
    )
      throw new Error("Destino de resposta não autorizado.");
    this.used = true;
    try {
      const result = await this.sendText(message.chat_id, {
        text: message.content.text,
      });
      return {
        outcome: "accepted" as const,
        ...(result?.key?.id ? { provider_message_id: result.key.id } : {}),
      };
    } catch {
      return { outcome: "unknown" as const };
    }
  }
}

/** Bounded, fail-closed deduplication for this process, including across reconnects. */
export class LocalMessageProcessor {
  readonly phoneResolver = new WhatsAppPhoneResolver();
  private readonly seen = new Set<string>();

  constructor(
    private readonly context: RestaurantContext,
    private readonly startedAt: number,
    private readonly maxSeen = 10_000,
    private readonly conversationMenu = new ConversationMenu(),
  ) {}
  async process(
    batch: { type: string; requestId?: string; messages: WAMessage[] },
    accountId: string,
    sendText: SendText,
    now = Date.now(),
  ): Promise<void> {
    if (batch.type !== "notify" || batch.requestId !== undefined) return;
    for (const raw of batch.messages) {
      const incoming = normalizeWhatsAppMessage(
        raw,
        this.context,
        accountId,
        this.startedAt,
        now,
      );

      if (!incoming || incoming.content.kind !== "text") continue;

      const jid = incoming.sender.subject_id;

      process.stdout.write(
        `[bot:sender] tipo=${jid.endsWith("@lid") ? "LID" : "PHONE_JID"}\n`,
      );

      const key = JSON.stringify([
        incoming.context.session_id,
        incoming.sender.account_id,
        incoming.chat_id,
        incoming.message_id,
      ]);
      if (this.seen.has(key)) continue;
      if (this.seen.size >= this.maxSeen)
        throw new Error(
          "Limite de deduplicação atingido; reinicie o teste local.",
        );
      // Mark before await: concurrent deliveries and ambiguous sends cannot retry.
      this.seen.add(key);
      const adapter = new ReplyOnlyAdapter(incoming, sendText);

      const conversationKey = JSON.stringify([
        this.context.restaurant_id,
        this.context.session_id,
        incoming.sender.account_id,
        incoming.chat_id,
      ]);

      const resposta = await this.conversationMenu.handle(
        conversationKey,
        this.context.restaurant_id,
        incoming.content.text,
        incoming.sender.subject_id,
        this.phoneResolver.resolve(raw, accountId),
        { context: incoming.context, sender: incoming.sender },
      );

      const result = await adapter.send({
        delivery_id: randomUUID(),
        context: this.context,
        conversation_id: randomUUID(),
        chat_id: incoming.chat_id,
        expected_control_epoch: 0,
        content: {
          kind: "text",
          text: resposta,
        },
      });

      if (result.outcome === "unknown")
        throw new Error(
          "Envio com resultado incerto; não será repetido automaticamente.",
        );
    }
  }
}
