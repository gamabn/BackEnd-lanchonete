import { productTransaction } from "../product/productTransaction";
import { ProductInputError } from "../product/productValidation";
import { ensurePublishedProductValid } from "./ensurePublishedProductValid";
import type { StructureChange } from "./configuredProductInput";

export class ChangeConfiguredProductStructureService {
  async execute(restaurantId: string, productId: string, change: StructureChange) {
    return productTransaction(async (client) => {
      const { rows: [product] } = await client.query(
        "SELECT published FROM public.products WHERE id = $1 AND restaurant_id = $2 FOR UPDATE", [productId, restaurantId]);
      if (!product) throw new ProductInputError("Produto não encontrado.", 404);
      const variants = await client.query("SELECT id, available FROM public.product_variants WHERE product_id = $1 ORDER BY id FOR UPDATE", [productId]);
      if (!variants.rows.length) throw new ProductInputError("O produto não é configurável.", 409);
      const groups = await client.query("SELECT id, min_select, max_select FROM public.product_option_groups WHERE product_id = $1 ORDER BY id FOR UPDATE", [productId]);
      if (change.action === 'addVariant') {
        const { rows: [variant] } = await client.query(`INSERT INTO public.product_variants (product_id, name, price, available)
          VALUES ($1, $2, $3, TRUE) RETURNING id`, [productId, change.name, change.price]);
        for (const group of groups.rows) {
          await client.query(`INSERT INTO public.product_variant_group_limits (variant_id, group_id, min_select, max_select)
            VALUES ($1, $2, $3, $4)`, [variant.id, group.id, group.min_select, group.max_select]);
        }
      } else if (change.action === 'addGroup') {
        const { rows: [group] } = await client.query(`INSERT INTO public.product_option_groups (product_id, name, required, min_select, max_select)
          VALUES ($1, $2, $3, $4, $5) RETURNING id`, [productId, change.name, change.required, change.minSelect, change.maxSelect]);
        for (const variant of variants.rows) {
          await client.query(`INSERT INTO public.product_variant_group_limits (variant_id, group_id, min_select, max_select)
            VALUES ($1, $2, $3, $4)`, [variant.id, group.id, change.minSelect, change.maxSelect]);
        }
      } else if (change.action === 'removeVariant') {
        const variant = variants.rows.find(row => row.id === change.id);
        if (!variant) throw new ProductInputError("Tamanho não encontrado no produto.", 404);
        if (!variants.rows.some(row => row.id !== change.id && row.available === true)) {
          throw new ProductInputError("Mantenha pelo menos um tamanho ativo.", 409);
        }
        const history = await client.query("SELECT 1 FROM public.order_items WHERE variant_id = $1 LIMIT 1", [change.id]);
        if (history.rows.length) throw new ProductInputError("Tamanho com pedidos não pode ser removido. Desative-o na configuração.", 409);
        // Do not remove foreign limits, even if old data contains inconsistent links.
        const cross = await client.query(`SELECT 1 FROM public.product_variant_group_limits l LEFT JOIN public.product_option_groups g ON g.id = l.group_id
          WHERE l.variant_id = $1 AND g.product_id IS DISTINCT FROM $2 LIMIT 1`, [change.id, productId]);
        if (cross.rows.length) throw new ProductInputError("Há dependências de outro produto.", 409);
        await client.query("DELETE FROM public.product_variant_group_limits WHERE variant_id = $1", [change.id]);
        await client.query("DELETE FROM public.product_variants WHERE id = $1 AND product_id = $2", [change.id, productId]);
      } else {
        if (!groups.rows.some(row => row.id === change.id)) throw new ProductInputError("Grupo não encontrado no produto.", 404);
        await client.query("SELECT id FROM public.product_options WHERE group_id = $1 ORDER BY id FOR UPDATE", [change.id]);
        const history = await client.query(`SELECT 1 FROM public.order_item_options io JOIN public.product_options o ON o.id = io.option_id
          WHERE o.group_id = $1 LIMIT 1`, [change.id]);
        if (history.rows.length) throw new ProductInputError("Grupo com opções usadas em pedidos não pode ser removido. Desative as opções.", 409);
        const cross = await client.query(`SELECT 1 FROM public.product_variant_group_limits l LEFT JOIN public.product_variants v ON v.id = l.variant_id
          WHERE l.group_id = $1 AND v.product_id IS DISTINCT FROM $2 LIMIT 1`, [change.id, productId]);
        if (cross.rows.length) throw new ProductInputError("Há dependências de outro produto.", 409);
        await client.query("DELETE FROM public.product_variant_group_limits WHERE group_id = $1", [change.id]);
        await client.query("DELETE FROM public.product_options WHERE group_id = $1", [change.id]);
        await client.query("DELETE FROM public.product_option_groups WHERE id = $1 AND product_id = $2", [change.id, productId]);
      }
      await client.query(`UPDATE public.products SET price = (SELECT MIN(price) FROM public.product_variants WHERE product_id = $1 AND available IS TRUE)
        WHERE id = $1 AND restaurant_id = $2`, [productId, restaurantId]);
      await ensurePublishedProductValid(client, restaurantId, productId, product.published);
      return { message: "Estrutura atualizada." };
    });
  }
}
