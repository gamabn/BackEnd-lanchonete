import type { PoolClient } from "pg";
import { pool } from "../../database";

interface ValidatePublicationRequest {
  restaurantId: string;
  productId: string;
  client?: PoolClient;
}

export class ValidateProductPublicationService {
  async execute({
    restaurantId,
    productId,
    client,
  }: ValidatePublicationRequest) {
    const db = client ?? pool;
    const productResult = await db.query(
      `SELECT id, name, published
       FROM public.products
       WHERE id = $1
         AND restaurant_id = $2`,
      [productId, restaurantId],
    );

    if (productResult.rowCount === 0) {
      return {
        valid: false,
        errors: ["Produto não encontrado."],
      };
    }

    const errors: string[] = [];

    const variantsResult = await db.query(
      `SELECT id, name, price
       FROM public.product_variants
       WHERE product_id = $1
         AND available = TRUE`,
      [productId],
    );

    if (variantsResult.rowCount === 0) {
      errors.push("O produto precisa ter pelo menos um tamanho ativo.");
    }

    const groupsResult = await db.query(
      `SELECT
         pog.id,
         pog.name,
         pog.required,
         pog.min_select,
         pog.max_select,
         COUNT(po.id)::integer AS available_options
       FROM public.product_option_groups pog
       LEFT JOIN public.product_options po
         ON po.group_id = pog.id
         AND po.available = TRUE
       WHERE pog.product_id = $1
       GROUP BY pog.id`,
      [productId],
    );

    if (groupsResult.rowCount === 0) {
      errors.push("O produto precisa ter pelo menos um grupo de escolhas.");
    }

    const limitsResult = await db.query(
      `SELECT
         pvgl.variant_id,
         pvgl.group_id,
         pvgl.min_select,
         pvgl.max_select
       FROM public.product_variant_group_limits pvgl
       INNER JOIN public.product_variants pv
         ON pv.id = pvgl.variant_id
       INNER JOIN public.product_option_groups pog
         ON pog.id = pvgl.group_id
       WHERE pv.product_id = $1
         AND pog.product_id = $1`,
      [productId],
    );

    const limitsMap = new Map<
      string,
      {
        min_select: number;
        max_select: number;
      }
    >();

    for (const limit of limitsResult.rows) {
      limitsMap.set(`${limit.variant_id}:${limit.group_id}`, limit);
    }

    for (const variant of variantsResult.rows) {
      if (
        !Number.isFinite(Number(variant.price)) ||
        Number(variant.price) < 0
      ) {
        errors.push(`Tamanho ${variant.name}: preço inválido.`);
      }

      for (const group of groupsResult.rows) {
        const limit = limitsMap.get(`${variant.id}:${group.id}`);

        if (!limit) {
          errors.push(
            `Tamanho ${variant.name}: grupo ${group.name} sem limites configurados.`,
          );
          continue;
        }

        if (limit.min_select < 0 || limit.max_select < limit.min_select) {
          errors.push(
            `Tamanho ${variant.name}: limites inválidos no grupo ${group.name}.`,
          );
          continue;
        }

        if (group.required && limit.min_select === 0) {
          errors.push(
            `Tamanho ${variant.name}: grupo obrigatório ${group.name} deve exigir pelo menos uma escolha.`,
          );
        }

        if (group.available_options < limit.min_select) {
          errors.push(
            `Tamanho ${variant.name}: o grupo ${group.name} exige no mínimo ${limit.min_select} ingrediente(s), mas possui apenas ${group.available_options} disponível(is).`,
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      product: productResult.rows[0],
      errors,
    };
  }
}
