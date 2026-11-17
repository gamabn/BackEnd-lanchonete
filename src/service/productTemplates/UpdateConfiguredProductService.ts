import { productTransaction } from "../product/productTransaction";
import { ProductInputError, normalizeProductCategory } from "../product/productValidation";
import type { ConfiguredProductInput } from "./configuredProductInput";
import { ensurePublishedProductValid } from "./ensurePublishedProductValid";

export class UpdateConfiguredProductService {
  async execute(restaurantId: string, productId: string, input: ConfiguredProductInput) {
    const category = normalizeProductCategory(input.category);
    return productTransaction(async (client) => {
      const owned = await client.query<{ published: boolean; available: boolean | null }>(
        "SELECT published, available FROM public.products WHERE id = $1 AND restaurant_id = $2 FOR UPDATE",
        [productId, restaurantId],
      );
      const product = owned.rows[0];
      if (!product) throw new ProductInputError("Produto não encontrado.", 404);


      const { rows: [counts] } = await client.query<{ variants: number; groups: number }>(
        `SELECT (SELECT count(*)::integer FROM public.product_variants WHERE product_id = $1) AS variants,
                (SELECT count(*)::integer FROM public.product_option_groups WHERE product_id = $1) AS groups`,
        [productId],
      );
      if (!counts.variants) throw new ProductInputError("O produto não possui tamanhos configuráveis.", 409);
      if (counts.variants !== input.variants.length || counts.groups !== input.groups.length) {
        throw new ProductInputError("A estrutura do produto mudou. Recarregue a configuração.", 409);
      }

      for (const group of input.groups) {
        const result = await client.query(
          `UPDATE public.product_option_groups
           SET name = $3, required = $4, min_select = $5, max_select = $6
           WHERE id = $1 AND product_id = $2`,
          [group.id, productId, group.name, group.required, group.minSelect, group.maxSelect],
        );
        if (result.rowCount !== 1) throw new ProductInputError("Grupo não encontrado no produto.", 404);
      }

      for (const variant of input.variants) {
        const result = await client.query(
          `UPDATE public.product_variants
           SET name = $3, price = $4, available = $5
           WHERE id = $1 AND product_id = $2`,
          [variant.id, productId, variant.name, variant.price, variant.available],
        );
        if (result.rowCount !== 1) throw new ProductInputError("Tamanho não encontrado no produto.", 404);

        // Both IDs were validated against this product. The product lock serializes writes to missing limits.
        for (const limit of variant.groupLimits) {
          const values = [variant.id, limit.id, limit.minSelect, limit.maxSelect];
          const updated = await client.query(
            `UPDATE public.product_variant_group_limits SET min_select = $3, max_select = $4
             WHERE variant_id = $1 AND group_id = $2`,
            values,
          );
          if (updated.rowCount === 0) {
            await client.query(
              `INSERT INTO public.product_variant_group_limits (variant_id, group_id, min_select, max_select)
               VALUES ($1, $2, $3, $4)`,
              values,
            );
          } else if (updated.rowCount !== 1) {
            throw new ProductInputError("Há limites duplicados no produto.", 409);
          }
        }
      }

      const updated = await client.query(
        `UPDATE public.products
         SET name = $3, description = $4, available = $5,
             category = CASE WHEN $6::boolean THEN $7::varchar(80) ELSE category END,
             price = (SELECT MIN(price) FROM public.product_variants WHERE product_id = $1 AND available IS TRUE)
         WHERE id = $1 AND restaurant_id = $2
         RETURNING id, name, description, available, published, price, category`,
        [productId, restaurantId, input.name, input.description, input.available, category !== undefined, category ?? null],
      );
      await ensurePublishedProductValid(client, restaurantId, productId, product.published);
      return updated.rows[0];
    });
  }
}
