import { pool } from "../../database";

interface GetPublicProductConfigurationRequest {
  productId: string;
}

export class GetPublicProductConfigurationService {
  async execute({ productId }: GetPublicProductConfigurationRequest) {
    const productResult = await pool.query(
      `
      SELECT
        id,
        restaurant_id,
        name,
        description,
        price,
        image_url
      FROM public.products
      WHERE id = $1
        AND published = TRUE
        AND available = TRUE
      `,
      [productId],
    );

    if (productResult.rowCount === 0) {
      return null;
    }

    const product = productResult.rows[0];

    const variantsResult = await pool.query(
      `
      SELECT
        id,
        name,
        price
      FROM public.product_variants
      WHERE product_id = $1
        AND available = TRUE
      ORDER BY price ASC, name ASC
      `,
      [productId],
    );

    const groupsResult = await pool.query(
      `
      SELECT
        id,
        name,
        required,
        min_select,
        max_select
      FROM public.product_option_groups
      WHERE product_id = $1
      ORDER BY name ASC
      `,
      [productId],
    );

    const optionsResult = await pool.query(
      `
      SELECT
        po.id,
        po.group_id,
        po.name,
        po.additional_price
      FROM public.product_options po
      INNER JOIN public.product_option_groups pog
        ON pog.id = po.group_id
      WHERE pog.product_id = $1
        AND po.available = TRUE
      ORDER BY po.name ASC
      `,
      [productId],
    );

    const limitsResult = await pool.query(
      `
      SELECT
        variant_id,
        group_id,
        min_select,
        max_select
      FROM public.product_variant_group_limits
      WHERE variant_id IN (
        SELECT id
        FROM public.product_variants
        WHERE product_id = $1
          AND available = TRUE
      )
      `,
      [productId],
    );

    const groups = groupsResult.rows.map((group) => ({
      ...group,
      options: optionsResult.rows.filter(
        (option) => option.group_id === group.id,
      ),
    }));

    const variants = variantsResult.rows.map((variant) => ({
      ...variant,
      groupLimits: limitsResult.rows
        .filter((limit) => limit.variant_id === variant.id)
        .map((limit) => ({
          groupId: limit.group_id,
          minSelect: limit.min_select,
          maxSelect: limit.max_select,
        })),
    }));

    return {
      product,
      variants,
      groups,
    };
  }
}
