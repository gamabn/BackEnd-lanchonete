import type { PoolClient } from "pg";

import {
  moneyCents,
  moneyText,
  OrderValidationError,
} from "../order/orderValidation";

interface ValidateConfiguredProductRequest {
  client: PoolClient;
  restaurantId: string;
  productId: string;
  variantId: string;
  optionIds: string[];
}

interface ProductRow {
  id: string;
}

interface VariantRow {
  id: string;
  name: string;
  price: string;
}

interface GroupRow {
  id: string;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number;
}

interface LimitRow {
  group_id: string;
  min_select: number;
  max_select: number;
}

interface OptionRow {
  id: string;
  group_id: string;
  name: string;
  group_name: string;
  additional_price: string;
}

export class ValidateAndPriceConfiguredProductService {
  async execute({
    client,
    restaurantId,
    productId,
    variantId,
    optionIds,
  }: ValidateConfiguredProductRequest) {
    // 1. Verificar produto e estabelecimento
    const productResult = await client.query<ProductRow>(
      `
      SELECT id
      FROM public.products
      WHERE id = $1
        AND restaurant_id = $2
        AND published = TRUE
        AND available = TRUE
      FOR SHARE
      `,
      [productId, restaurantId],
    );

    if (!productResult.rows[0]) {
      throw new OrderValidationError("Produto inexistente ou indisponível.");
    }

    // 2. Verificar variante
    const variantResult = await client.query<VariantRow>(
      `
      SELECT
        id,
        name,
        price::text AS price
      FROM public.product_variants
      WHERE id = $1
        AND product_id = $2
        AND available = TRUE
      FOR SHARE
      `,
      [variantId, productId],
    );

    const variant = variantResult.rows[0];

    if (!variant) {
      throw new OrderValidationError("Tamanho inválido ou indisponível.");
    }

    // 3. Consultar grupos
    const groupsResult = await client.query<GroupRow>(
      `
      SELECT
        id,
        name,
        required,
        min_select,
        max_select
      FROM public.product_option_groups
      WHERE product_id = $1
      ORDER BY id
      FOR SHARE
      `,
      [productId],
    );

    const groups = groupsResult.rows;

    // 4. Consultar limites por variante
    const limitsResult = await client.query<LimitRow>(
      `
      SELECT
        group_id,
        min_select,
        max_select
      FROM public.product_variant_group_limits
      WHERE variant_id = $1
      ORDER BY group_id
      FOR SHARE
      `,
      [variantId],
    );

    const limits = new Map(
      limitsResult.rows.map((limit) => [limit.group_id, limit]),
    );

    // 5. Consultar ingredientes selecionados
    const optionsResult = await client.query<OptionRow>(
      `
      SELECT
        po.id,
        po.group_id,
        po.name,
        pog.name AS group_name,
        po.additional_price::text AS additional_price
      FROM public.product_options po
      INNER JOIN public.product_option_groups pog
        ON pog.id = po.group_id
      WHERE pog.product_id = $1
        AND po.available = TRUE
        AND po.id = ANY($2::uuid[])
     ORDER BY po.id
   FOR SHARE OF po, pog
      `,
      [productId, optionIds],
    );

    if (optionsResult.rows.length !== optionIds.length) {
      throw new OrderValidationError(
        "Um ou mais ingredientes são inválidos ou indisponíveis.",
      );
    }

    // 6. Validar limites de cada grupo
    for (const group of groups) {
      const limit = limits.get(group.id);

      if (!limit) {
        throw new OrderValidationError(
          `Configuração incompleta para o grupo ${group.name}.`,
        );
      }

      const selectedCount = optionsResult.rows.filter(
        (option) => option.group_id === group.id,
      ).length;

      if (
        selectedCount < limit.min_select ||
        selectedCount > limit.max_select
      ) {
        throw new OrderValidationError(
          `O grupo ${group.name} permite entre ${limit.min_select} e ${limit.max_select} escolhas para o tamanho ${variant.name}.`,
        );
      }
    }

    // 7. Calcular preço unitário
    let totalCents = moneyCents(variant.price);

    const options = optionsResult.rows.map((option) => {
      totalCents += moneyCents(option.additional_price);

      return {
        option_id: option.id,
        option_name: option.name,
        group_name: option.group_name,
        additional_price: option.additional_price,
      };
    });

    return {
      product_id: productId,
      variant_id: variant.id,
      variant_name: variant.name,
      item_price: moneyText(totalCents),
      options,
    };
  }
}
