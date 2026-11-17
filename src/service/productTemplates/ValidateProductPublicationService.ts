import type { PoolClient } from "pg";
import { pool } from "../../database";
import { moneyCents } from "../order/orderValidation";

interface ValidatePublicationRequest {
  restaurantId: string;
  productId: string;
  client?: PoolClient;
}

function validBounds(min: number, max: number) {
  return Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min && max <= 100;
}

function priceCents(price: unknown): bigint | null {
  if (!Number.isFinite(Number(price))) return null;
  try {
    return moneyCents(price);
  } catch {
    return null;
  }
}

export class ValidateProductPublicationService {
  async execute({ restaurantId, productId, client }: ValidatePublicationRequest) {
    const db = client ?? pool;
    const productResult = await db.query<{
      id: string; name: string; published: boolean; price: string;
    }>(
      `SELECT id, name, published, price::text AS price
       FROM public.products
       WHERE id = $1 AND restaurant_id = $2`,
      [productId, restaurantId],
    );

    const product = productResult.rows[0];
    if (!product) return { valid: false, errors: ["Produto não encontrado."] };

    const errors: string[] = [];
    if (!product.name?.trim()) errors.push("Informe o nome do produto.");

    const variantsResult = await db.query<{ id: string; name: string; price: string }>(
      `SELECT id, name, price::text AS price
       FROM public.product_variants
       WHERE product_id = $1 AND available = TRUE`,
      [productId],
    );
    if (!variantsResult.rows.length) {
      errors.push("O produto precisa ter pelo menos um tamanho ativo.");
    }

    const groupsResult = await db.query<{
      id: string; name: string; required: boolean; min_select: number; max_select: number; available_options: number;
    }>(
      `SELECT pog.id, pog.name, pog.required, pog.min_select, pog.max_select,
              COUNT(po.id)::integer AS available_options
       FROM public.product_option_groups pog
       LEFT JOIN public.product_options po ON po.group_id = pog.id AND po.available = TRUE
       WHERE pog.product_id = $1
       GROUP BY pog.id`,
      [productId],
    );
    for (const group of groupsResult.rows) {
      if (!validBounds(group.min_select, group.max_select) ||
          typeof group.required !== "boolean" || (group.required && group.min_select === 0)) {
        errors.push(`Grupo ${group.name}: obrigatoriedade ou limites gerais inválidos.`);
      }
    }

    const optionsResult = await db.query<{ name: string; additional_price: string }>(
      `SELECT po.name, po.additional_price::text AS additional_price
       FROM public.product_options po
       JOIN public.product_option_groups pog ON pog.id = po.group_id
       WHERE pog.product_id = $1 AND po.available = TRUE`,
      [productId],
    );
    for (const option of optionsResult.rows) {
      if (priceCents(option.additional_price) === null) {
        errors.push(`Opção ${option.name}: preço adicional inválido.`);
      }
    }

    const limitsResult = await db.query<{
      variant_id: string; group_id: string; min_select: number; max_select: number;
      variant_product_id: string | null; group_product_id: string | null;
    }>(
      `SELECT l.variant_id, l.group_id, l.min_select, l.max_select,
              v.product_id AS variant_product_id, g.product_id AS group_product_id
       FROM public.product_variant_group_limits l
       LEFT JOIN public.product_variants v ON v.id = l.variant_id
       LEFT JOIN public.product_option_groups g ON g.id = l.group_id
       WHERE v.product_id = $1 OR g.product_id = $1`,
      [productId],
    );
    const limits = new Map<string, { min_select: number; max_select: number }>();
    for (const limit of limitsResult.rows) {
      if (limit.variant_product_id !== product.id || limit.group_product_id !== product.id) {
        errors.push("Há limites vinculando tamanhos e grupos de produtos diferentes ou inexistentes.");
        continue;
      }
      const key = `${limit.variant_id}:${limit.group_id}`;
      if (limits.has(key)) errors.push("Há limites duplicados para um tamanho e grupo.");
      limits.set(key, limit);
    }

    let minimumPrice: bigint | null = null;
    for (const variant of variantsResult.rows) {
      const amount = priceCents(variant.price);
      if (amount === null) {
        errors.push(`Tamanho ${variant.name}: preço inválido.`);
      } else if (minimumPrice === null || amount < minimumPrice) {
        minimumPrice = amount;
      }
      let minimumChoices = 0;
      for (const group of groupsResult.rows) {
        const limit = limits.get(`${variant.id}:${group.id}`);
        if (!limit) {
          errors.push(`Tamanho ${variant.name}: grupo ${group.name} sem limites configurados.`);
          continue;
        }
        if (!validBounds(limit.min_select, limit.max_select)) {
          errors.push(`Tamanho ${variant.name}: limites inválidos no grupo ${group.name}.`);
          continue;
        }
        minimumChoices += limit.min_select;
        if (group.required && limit.min_select === 0) {
          errors.push(`Tamanho ${variant.name}: grupo obrigatório ${group.name} deve exigir pelo menos uma escolha.`);
        }
        if (group.available_options < limit.min_select) {
          errors.push(`Tamanho ${variant.name}: o grupo ${group.name} exige no mínimo ${limit.min_select} ingrediente(s), mas possui apenas ${group.available_options} disponível(is).`);
        }
      }
      if (minimumChoices > 100) {
        errors.push(`Tamanho ${variant.name}: o mínimo total ultrapassa as 100 escolhas aceitas no pedido.`);
      }
    }

    const basePrice = priceCents(product.price);
    if (basePrice === null) {
      errors.push("O preço base do produto é inválido.");
    } else if (minimumPrice !== null && basePrice !== minimumPrice) {
      errors.push("Salve a configuração para atualizar o preço base pelo menor tamanho ativo.");
    }

    return { valid: errors.length === 0, product, errors };
  }
}
