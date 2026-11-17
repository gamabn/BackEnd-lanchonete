import { GetPublicProductConfigurationService } from "../../service/productTemplates/GetPublicProductConfigurationService";

export async function getBotProductConfiguration(
  restaurantId: string,
  productId: string,
) {
  const configuration =
    await new GetPublicProductConfigurationService().execute({
      productId,
    });

  if (!configuration || configuration.product.restaurant_id !== restaurantId) {
    return null;
  }

  return configuration;
}

export type BotProductConfiguration = NonNullable<
  Awaited<ReturnType<typeof getBotProductConfiguration>>
>;

export function formatVariantMenu(
  configuration: BotProductConfiguration,
): string {
  const { product, variants } = configuration;

  if (variants.length === 0) {
    return "⚠️ Nenhuma variante disponível para este produto.\n\n0 - Voltar aos produtos";
  }

  const items = variants.map((variant, index) => {
    const price = Number(variant.price).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

    return `${index + 1} - ${variant.name} — ${price}`;
  });

  return [
    `🍽️ *${product.name.toUpperCase()}*`,
    "",
    "Escolha uma opção:",
    "",
    ...items,
    "",
    "0 - Voltar aos produtos",
  ].join("\n");
}
