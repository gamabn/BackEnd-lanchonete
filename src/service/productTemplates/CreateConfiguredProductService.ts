import { productTransaction } from "../product/productTransaction";
import { ProductInputError, normalizeProductCategory } from "../product/productValidation";
import type { NewConfiguredProductInput } from "./configuredProductInput";

export class CreateConfiguredProductService {
  async execute(restaurantId: string, input: NewConfiguredProductInput) {
    return productTransaction(async (client) => {
      const restaurant = await client.query("SELECT id FROM public.restaurants WHERE id = $1 FOR SHARE", [restaurantId]);
      if (!restaurant.rows.length) throw new ProductInputError("Estabelecimento não encontrado.", 404);
      const { rows: [product] } = await client.query(
        `INSERT INTO public.products (restaurant_id, name, description, price, available, published, category)
         VALUES ($1, $2, $3, $4, TRUE, FALSE, $5) RETURNING id, name, published, available, category`,
        [restaurantId, input.name, input.description, input.price, normalizeProductCategory(input.category) ?? null],
      );
      await client.query(`INSERT INTO public.product_variants (product_id, name, price, available)
        VALUES ($1, $2, $3, TRUE)`, [product.id, input.variantName, input.price]);
      return { product };
    });
  }
}
