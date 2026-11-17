import type { WAMessage } from "@whiskeysockets/baileys";

/** Transport evidence only; never authorizes access to a Delivery customer record. */
export interface WhatsAppPhoneIdentity {
  readonly phone: string;
  readonly source: "remoteJidAlt" | "remoteJid" | "senderPn" | "phoneNumberShare";
}

export function trustedWhatsAppPhone(identity: WhatsAppPhoneIdentity | undefined): string | undefined {
  if (!identity || !["remoteJidAlt", "remoteJid", "senderPn", "phoneNumberShare"].includes(identity.source)) return undefined;
  return typeof identity.phone === "string" && /^[1-9][0-9]{6,14}$/.test(identity.phone) ? identity.phone : undefined;
}

export function phoneFromJid(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^([1-9][0-9]{6,14})@s\.whatsapp\.net$/.exec(value)?.[1];
}

/** Owned by one restaurant/session processor. No disk persistence or global cache. */
export class WhatsAppPhoneResolver {
  private readonly shared = new Map<string, WhatsAppPhoneIdentity>();

  recordShare(accountId: string, lid: string, jid: string): boolean {
    const phone = phoneFromJid(jid);
    if (!accountId || !/^[^\s@]+@lid$/.test(lid) || !phone) return false;
    const key = JSON.stringify([accountId, lid]);
    if (!this.shared.has(key) && this.shared.size >= 10_000) return false;
    this.shared.set(key, { phone, source: "phoneNumberShare" });
    return true;
  }

  resolve(raw: WAMessage, accountId: string): WhatsAppPhoneIdentity | undefined {
    // 6.7.23 does not declare this field. Runtime narrowing also rejects malformed data.
    const key: WAMessage["key"] & { remoteJidAlt?: unknown } = raw.key;
    for (const source of ["remoteJidAlt", "remoteJid", "senderPn"] as const) {
      const phone = phoneFromJid(key[source]);
      if (phone) return { phone, source };
    }
    return this.shared.get(JSON.stringify([accountId, key.remoteJid]));
  }
}
