import { pool } from "../../database";
import type { PoolClient } from "pg";

interface ListProductOptionsRequest {
  restaurantId: string;
  productId: string;
}

interface ProductOptionGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: {
    id: string;
    name: string;
    additionalPrice: number | string;
    available: boolean | null;
  }[];
}

export class ListProductOptionsService {
  async execute({ restaurantId, productId }: ListProductOptionsRequest, db: Pick<PoolClient, "query"> = pool, exactPrices = false) {
    const result = await db.query(
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

    const groups = new Map<string, ProductOptionGroup>();

    for (const row of result.rows) {
      let group = groups.get(row.group_id);
      if (!group) {
        group = {
          id: row.group_id,
          name: row.group_name,
          required: row.required,
          minSelect: row.min_select,
          maxSelect: row.max_select,
          options: [],
        };
        groups.set(row.group_id, group);
      }

      if (row.option_id) {
        group.options.push({
          id: row.option_id,
          name: row.option_name,
          additionalPrice: exactPrices ? String(row.additional_price) : Number(row.additional_price),
          available: row.available,
        });
      }
    }

    return Array.from(groups.values());
  }
}
