import { GetClientService } from "../../service/clients/GetClientService";
import { brazilianNationalPhone } from "../../security/customerPhone";
import { trustedWhatsAppPhone, type WhatsAppPhoneIdentity } from "../channels/whatsapp/phoneIdentity";

export type CustomerLookupResult =
  | { kind: "found"; customerId: string }
  | { kind: "not_found" | "unverified" | "ambiguous" | "error" };

export type CustomerReader = Pick<GetClientService, "findByWhatsAppPhone">;

/** The identity argument is internal transport metadata, never customer input. */
export async function identifyCustomer(
  restaurantId: string,
  identity: WhatsAppPhoneIdentity | undefined,
  reader: CustomerReader,
): Promise<CustomerLookupResult> {
  const phone = trustedWhatsAppPhone(identity);
  if (!phone) return { kind: "unverified" };
  if (!restaurantId.trim()) return { kind: "error" };
  try {
    const rows = await reader.findByWhatsAppPhone({ restaurant_id: restaurantId, phone });
    if (rows.some(row => row.restaurant_id !== restaurantId || !row.id)) return { kind: "error" };
    if (rows.length > 1) return { kind: "ambiguous" };
    // The national exception is restricted to valid Brazilian transport identities.
    if (rows.length === 1 && rows[0].international_format !== true &&
        !(rows[0].national_format === true && brazilianNationalPhone(phone))) return { kind: "ambiguous" };
    return rows.length === 1 ? { kind: "found", customerId: rows[0].id } : { kind: "not_found" };
  } catch {
    // Never emit SQL errors, connection strings or customer records into diagnostics.
    return { kind: "error" };
  }
}

export function customerIdentificationReply(kind: CustomerLookupResult["kind"]): string {
  const message = {
    found: "✅ Encontramos seu cadastro!\n\nVamos continuar com os dados necessários para finalizar seu pedido.",
    not_found: "👤 Vamos realizar seu cadastro!\n\nQual é o seu nome?",
    unverified: "📱 Precisamos confirmar seu telefone antes de consultar um cadastro existente.",
    ambiguous: "📱 Precisamos confirmar sua identificação antes de continuar com o cadastro.",
    error: "⚠️ Não foi possível consultar seu cadastro agora. Volte ao carrinho e tente novamente.",
  }[kind];
  return message + "\n\n0 - Voltar ao carrinho";
}

export function createCustomerReader(): CustomerReader {
  return new GetClientService();
}
