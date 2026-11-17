import { CustomerAddressService, type AddressOwner } from "../../service/clients/CustomerAddressService";
import {
  type AddressField, type AddressLimits, type DeliveryAddress, type AddressErrorKind,
} from "../../security/customerAddress";
import { trustedWhatsAppPhone, type WhatsAppPhoneIdentity } from "../channels/whatsapp/phoneIdentity";

export type AddressGateway = Pick<CustomerAddressService, "load" | "save">;
export function createAddressGateway(): AddressGateway { return new CustomerAddressService(); }

export function addressOwner(restaurantId: string, customerId: string | undefined, identity: WhatsAppPhoneIdentity | undefined): AddressOwner | undefined {
  const phone = trustedWhatsAppPhone(identity);
  return phone && customerId && restaurantId.trim() ? { restaurant_id: restaurantId, customer_id: customerId, phone } : undefined;
}

export const ADDRESS_SAVED = "✅ Endereço salvo com sucesso!\n\nSeu endereço ficará disponível para os próximos pedidos.\n\n0 - Voltar ao carrinho";
export const ADDRESS_CONFIRMED = "✅ Endereço confirmado!\n\n0 - Voltar ao carrinho";

export function addressErrorReply(kind: AddressErrorKind): string {
  const message = {
    invalid: "⚠️ Não foi possível validar o endereço. Volte ao carrinho e tente novamente.",
    unsupported: "⚠️ O cadastro de endereço não está disponível para esta loja no momento.",
    forbidden: "📱 Não foi possível verificar o vínculo com seu cadastro. Volte ao carrinho e identifique-se novamente.",
    conflict: "⚠️ Seu endereço mudou desde a consulta. Volte ao carrinho para conferir o endereço atual antes de salvar.",
    region_changed: "⚠️ O bairro ou a taxa mudou. Selecione novamente o bairro antes de salvar.",
    error: "⚠️ Não foi possível concluir a operação de endereço. Volte ao carrinho e tente novamente.",
  }[kind];
  return message + "\n\nSeu carrinho está preservado.\n\n0 - Voltar ao carrinho";
}

export function addressPrompt(field: AddressField, limits: AddressLimits): string {
  const prompts: Record<AddressField, string> = {
    street: "📍 Qual é a rua do endereço de entrega?",
    number: limits.number.kind === "integer" ? "Qual é o número? Informe apenas dígitos." : "Qual é o número? Ex.: 12, 12A ou S/N.",
    neighborhood: "Escolha um bairro cadastrado na lista.",
    city: "Qual é a cidade?",
    complement: "Qual é o complemento? Digite P para pular este campo opcional.",
  };
  return prompts[field] + `\n\nMáximo de ${limits[field].maxLength} caracteres.\n\nB - Escolher outro bairro\n0 - Voltar ao carrinho`;
}

export function addressSummary(address: DeliveryAddress, existing: boolean): string {
  return [
    existing ? "📍 ENDEREÇO CADASTRADO" : "📍 CONFIRME SEU ENDEREÇO",
    "",
    `Rua: ${address.street}`,
    `Número: ${address.number}`,
    `Bairro: ${address.neighborhood}`,
    `Cidade: ${address.city}`,
    ...(address.complement ? [`Complemento: ${address.complement}`] : existing ? [] : ["Complemento: Não informado"]),
    "",
    existing ? "1 - Confirmar endereço" : "1 - Confirmar e salvar",
    existing ? "2 - Alterar endereço" : "2 - Corrigir endereço",
    "B - Escolher outro bairro",
    "0 - Voltar ao carrinho",
  ].join("\n");
}
