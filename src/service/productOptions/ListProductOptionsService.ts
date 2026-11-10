import { pool } from "../../database";

interface ListProductOptionsRequest {
  restaurantId: string;
  productId: string;
}

export class ListProductOptionsService {
  async execute({ restaurantId, productId }: ListProductOptionsRequest) {
    const result = await pool.query(
      `
      SELECT
        pog.id AS group_id,
        pog.name AS group_name,
        pog.required,
        pog.min_select,
        pog.max_select,
        po.id AS option_id,
        po.name AS option_name,
        po.additional_price,
        po.available
      FROM public.product_option_groups pog

      INNER JOIN public.products p
        ON p.id = pog.product_id

      LEFT JOIN public.product_options po
        ON po.group_id = pog.id

      WHERE p.id = $1
        AND p.restaurant_id = $2

      ORDER BY
        pog.name,
        po.name
      `,
      [productId, restaurantId],
    );

    const groups = new Map<string, any>();

    for (const row of result.rows) {
      if (!groups.has(row.group_id)) {
        groups.set(row.group_id, {
          id: row.group_id,
          name: row.group_name,
          required: row.required,
          minSelect: row.min_select,
          maxSelect: row.max_select,
          options: [],
        });
      }

      if (row.option_id) {
        groups.get(row.group_id).options.push({
          id: row.option_id,
          name: row.option_name,
          additionalPrice: Number(row.additional_price),
          available: row.available,
        });
      }
    }

    return Array.from(groups.values());
  }
}
