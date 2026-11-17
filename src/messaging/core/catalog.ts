import { GetProductIdService } from "../../service/product/GetProductIdService";

export interface CatalogProduct {
  id: string;
  name: string;
  category: string | null;
  price: number | string;
  has_variants: boolean;
}

export interface CatalogCategory {
  name: string;
  products: CatalogProduct[];
}

export async function getCatalogProducts(
  restaurantId: string,
): Promise<CatalogProduct[]> {
  return (await new GetProductIdService().execute(
    restaurantId,
  )) as CatalogProduct[];
}

export function groupProductsByCategory(
  products: CatalogProduct[],
): CatalogCategory[] {
  const categories = new Map<string, CatalogProduct[]>();

  for (const product of products) {
    const category = product.category?.trim() || "Outros produtos";

    const current = categories.get(category) ?? [];
    current.push(product);
    categories.set(category, current);
  }

  return Array.from(categories, ([name, items]) => ({
    name,
    products: items,
  })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function formatCategories(categories: CatalogCategory[]): string {
  if (categories.length === 0) {
    return "🍽️ Nenhum produto disponível no momento.\n\n0 - Voltar ao menu";
  }

  return [
    "🍽️ *CARDÁPIO*",
    "",
    "Escolha uma categoria:",
    "",
    ...categories.map((category, index) => {
      const quantidade = category.products.length;

      return `${index + 1} - ${category.name} (${quantidade} ${
        quantidade === 1 ? "produto" : "produtos"
      })`;
    }),
    //  ...categories.map(
    //  (category, index) =>
    //   `${index + 1} - ${category.name} (${category.products.length} produtos)`,
    //  ),
    "",
    "0 - Voltar ao menu inicial",
  ].join("\n");
}

export function formatCategoryProducts(category: CatalogCategory): string {
  const items = category.products.map((product, index) => {
    const preco = Number(product.price).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

    const descricaoPreco = product.has_variants
      ? `A partir de ${preco}\n    ⚙️ Possui opções`
      : preco;

    return `${index + 1} - ${product.name}\n    ${descricaoPreco}`;
  });

  return [
    `🍽️ *${category.name.toUpperCase()}*`,
    "",
    ...items,
    "",
    "Digite o número do produto desejado.",
    "0 - Voltar às categorias",
  ].join("\n");
}

export function formatProductDetails(product: CatalogProduct): string {
  const price = Number(product.price).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  return [
    `🍽️ *${product.name}*`,
    "",
    `Preço: ${price}`,
    product.has_variants
      ? "⚙️ Este produto possui opções de personalização."
      : "✅ Produto simples.",
    "",
    "A seleção e o carrinho serão implementados na próxima etapa.",
    "0 - Voltar aos produtos",
  ].join("\n");
}
