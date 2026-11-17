export const CHECKOUT_UNAVAILABLE = "Não foi possível confirmar o pedido. Tente novamente para consultar a mesma intenção; não refaça o pedido.";
export const POST_CHECKOUT_OPTIONS = "1 - Fazer novo pedido\n2 - Consultar meus pedidos\n3 - Ver cardápio\n0 - Menu principal";
export const checkoutSuccess = (id: string) => `✅ Pedido confirmado! Código: ${id}.\n\n${POST_CHECKOUT_OPTIONS}`;
