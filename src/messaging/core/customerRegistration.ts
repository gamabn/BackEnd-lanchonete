import { CreateClientService, type InitialCustomerResult } from "../../service/clients/CreateClientService";
import { normalizeCustomerName } from "../../security/customerName";
import { trustedWhatsAppPhone, type WhatsAppPhoneIdentity } from "../channels/whatsapp/phoneIdentity";

export type CustomerWriter = Pick<CreateClientService, "createInitialForWhatsApp">;
export type RegistrationResult = InitialCustomerResult | { kind: "unverified" };

export async function registerCustomer(
  restaurantId: string, identity: WhatsAppPhoneIdentity | undefined,
  confirmedName: string, writer: CustomerWriter,
): Promise<RegistrationResult> {
  const phone = trustedWhatsAppPhone(identity);
  if (!phone) return { kind: "unverified" };
  if (!restaurantId.trim() || normalizeCustomerName(confirmedName) !== confirmedName) return { kind: "error" };
  try {
    return await writer.createInitialForWhatsApp({ restaurant_id: restaurantId, phone, name: confirmedName });
  } catch {
    return { kind: "error" };
  }
}

export function registrationReply(kind: RegistrationResult["kind"]): string {
  const message = {
    created: "✅ Cadastro inicial concluído!\n\nSeu nome e telefone foram registrados. O endereço será solicitado posteriormente.",
    existing: "✅ Encontramos seu cadastro!\n\nVamos continuar com os dados necessários para finalizar seu pedido.",
    unverified: "📱 Precisamos confirmar seu telefone antes de realizar o cadastro.",
    ambiguous: "📱 Precisamos confirmar sua identificação antes de continuar com o cadastro.",
    schema_unsupported: "⚠️ O cadastro inicial sem endereço ainda não está disponível nesta loja. Seu carrinho está preservado.",
    error: "⚠️ Não foi possível concluir o cadastro agora. Volte ao carrinho e tente novamente. Seu carrinho está preservado.",
  }[kind];
  return message + "\n\n0 - Voltar ao carrinho";
}

export function createCustomerWriter(): CustomerWriter { return new CreateClientService(); }
