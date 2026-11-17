export type FulfillmentMode = "DELIVERY" | "PICKUP";

export const FULFILLMENT_MENU = [
  "🚚 COMO DESEJA RECEBER SEU PEDIDO?",
  "",
  "1 - Entrega",
  "2 - Retirada no estabelecimento",
  "",
  "0 - Voltar ao carrinho",
].join("\n");

export function fulfillmentReply(mode: FulfillmentMode): string {
  return (mode === "DELIVERY"
    ? "✅ Você escolheu ENTREGA.\n\nNa próxima etapa, vamos confirmar seu endereço e verificar a taxa de entrega."
    : "✅ Você escolheu RETIRADA NO ESTABELECIMENTO.\n\nNa próxima etapa, vamos continuar a finalização do seu pedido."
  ) + "\n\n0 - Voltar ao carrinho";
}
