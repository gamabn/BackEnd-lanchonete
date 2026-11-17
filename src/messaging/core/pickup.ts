export interface PickupStoreReader {
  execute(restaurantId: string): Promise<unknown>;
}

export interface PickupAddress {
  restaurantId: string;
  name: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
}

export function pickupAddress(
  store: Record<string, unknown>,
  restaurantId: string,
): PickupAddress | undefined {
  const address: PickupAddress = {
    restaurantId,
    name: "",
    street: "",
    number: "",
    neighborhood: "",
    city: "",
  };
  for (const field of [
    "name",
    "street",
    "number",
    "neighborhood",
    "city",
  ] as const) {
    const value = store[field];
    if (
      typeof value !== "string" &&
      !(
        field === "number" &&
        typeof value === "number" &&
        Number.isFinite(value)
      )
    )
      return;
    const clean = String(value).trim();
    if (
      !clean ||
      /^(null|undefined|\[object Object\])$/i.test(clean) ||
      /[\r\n\x00-\x1f]/.test(clean)
    )
      return;
    address[field] = clean;
  }
  return address;
}

export function pickupPreview(a: PickupAddress): string {
  return `🏪 RETIRADA NO ESTABELECIMENTO\n\nRestaurante: ${a.name}\n\n📍 Endereço para retirada:\nRua: ${a.street}\nNúmero: ${a.number}\nBairro: ${a.neighborhood}\nCidade: ${a.city}\n\n1 - Confirmar retirada\n0 - Voltar ao carrinho`;
}

export function pickupConfirmed(a: PickupAddress): string {
  return [
    "✅ RETIRADA CONFIRMADA!",
    "",
    `🏪 Restaurante: ${a.name}`,
    "",
    "📍 Endereço para retirada:",
    `${a.street}, ${a.number}`,
    `Bairro: ${a.neighborhood}`,
    `Cidade: ${a.city}`,
    "",
    "Vamos continuar com o pagamento.",
    "",
    "💳 ESCOLHA A FORMA DE PAGAMENTO",
    "",
    "1 - PIX",
    "2 - Dinheiro",
    "3 - Cartão de débito",
    "4 - Cartão de crédito",
    "",
    "0 - Voltar",
  ].join("\n");
}

/*export function pickupConfirmed(a: PickupAddress): string {
  return `✅ RETIRADA CONFIRMADA!\n\n🏪 Restaurante: ${a.name}\n\n📍 Endereço: ${a.street}, ${a.number}\nBairro: ${a.neighborhood}\nCidade: ${a.city}\n\nSeu pedido será preparado para retirada no estabelecimento quando a etapa de criação de pedidos estiver disponível.\n\n0 - Voltar ao carrinho`;
}*/
