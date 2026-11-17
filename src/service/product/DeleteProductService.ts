import { productTransaction } from "./productTransaction";
import { ProductInputError } from "./productValidation";

class DeleteProductService {
  async deactivate(product_id: string, restaurant_id: string) {
    return productTransaction(async (client) => {
      const result = await client.query(
        `UPDATE public.products SET available = FALSE
         WHERE id = $1 AND restaurant_id = $2 RETURNING id, available, published`,
        [product_id, restaurant_id],
      );
      return result.rows[0];
    });
  }

  async execute(product_id: string, restaurant_id: string) {
    return productTransaction(async (client) => {
      const owned = await client.query(
        "SELECT id, published FROM public.products WHERE id = $1 AND restaurant_id = $2 FOR UPDATE",
        [product_id, restaurant_id],
      );
      if (!owned.rows[0]) return undefined;
      if (owned.rows[0].published !== false) {
        throw new ProductInputError("Produtos publicados não podem ser excluídos. Desative o produto.", 409);
      }
      // Lock children before checking references. Order creation locks the product too.
      await client.query("SELECT id FROM public.product_variants WHERE product_id = $1 ORDER BY id FOR UPDATE", [product_id]);
      await client.query("SELECT id FROM public.product_option_groups WHERE product_id = $1 ORDER BY id FOR UPDATE", [product_id]);
      await client.query(`SELECT o.id FROM public.product_options o JOIN public.product_option_groups g ON g.id = o.group_id
        WHERE g.product_id = $1 ORDER BY o.id FOR UPDATE OF o`, [product_id]);
      const history = await client.query(`SELECT 1 FROM public.order_items i
        WHERE i.product_id = $1
          OR i.variant_id IN (SELECT id FROM public.product_variants WHERE product_id = $1)
          OR EXISTS (SELECT 1 FROM public.order_item_options io
            JOIN public.product_options o ON o.id = io.option_id
            JOIN public.product_option_groups g ON g.id = o.group_id
            WHERE io.order_item_id = i.id AND g.product_id = $1)
        LIMIT 1`, [product_id]);
      if (history.rows.length) throw new ProductInputError("Produto com histórico de pedidos não pode ser excluído. Desative o produto.", 409);
      const inconsistent = await client.query(`SELECT 1 FROM public.product_variant_group_limits l
        LEFT JOIN public.product_variants v ON v.id = l.variant_id
        LEFT JOIN public.product_option_groups g ON g.id = l.group_id
        WHERE (v.product_id = $1 OR g.product_id = $1)
          AND (v.product_id IS DISTINCT FROM $1 OR g.product_id IS DISTINCT FROM $1)
        LIMIT 1`, [product_id]);
      if (inconsistent.rows.length) throw new ProductInputError("Há dependências de outros produtos. A exclusão foi bloqueada.", 409);
      await client.query(`DELETE FROM public.product_variant_group_limits
        WHERE variant_id IN (SELECT id FROM public.product_variants WHERE product_id = $1)
          AND group_id IN (SELECT id FROM public.product_option_groups WHERE product_id = $1)`, [product_id]);
      await client.query(`DELETE FROM public.product_options WHERE group_id IN
        (SELECT id FROM public.product_option_groups WHERE product_id = $1)`, [product_id]);
      await client.query("DELETE FROM public.product_option_groups WHERE product_id = $1", [product_id]);
      await client.query("DELETE FROM public.product_variants WHERE product_id = $1", [product_id]);
      await client.query("DELETE FROM public.products WHERE id = $1 AND restaurant_id = $2", [product_id, restaurant_id]);
      return { message: "Rascunho excluído com sucesso." };
    });
  }
}
export { DeleteProductService };
