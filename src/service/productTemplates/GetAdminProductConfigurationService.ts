import { pool } from "../../database";
import type { PoolClient } from "pg";
import { ListProductOptionsService } from "../productOptions/ListProductOptionsService";

interface ProductConfigurationRequest {
  productId: string;
  restaurantId: string;
}

interface ProductRow {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: string;
  image_url: string | null;
  published: boolean;
  available: boolean | null;
}

interface VariantRow {
  id: string;
  name: string;
  price: string;
  available: boolean | null;
  groupLimits: { groupId: string; minSelect: number; maxSelect: number }[];
}

export class GetAdminProductConfigurationService {
  async execute({ productId, restaurantId }: ProductConfigurationRequest, db: Pick<PoolClient, "query"> = pool, exactPrices = false) {
    const values = [productId, restaurantId];
    const { rows: [product] } = await db.query<ProductRow>(
      `SELECT id, restaurant_id, name, description, category, price, image_url, published, available
       FROM public.products
       WHERE id = $1 AND restaurant_id = $2`,
      values,
    );

    if (!product) return null;

    const [{ rows: variants }, groups] = await Promise.all([
      db.query<VariantRow>(
        `SELECT v.id, v.name, v.price, v.available,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'groupId', g.id,
                    'minSelect', l.min_select,
                    'maxSelect', l.max_select
                  ) ORDER BY g.name, g.id)
                  FROM public.product_variant_group_limits l
                  JOIN public.product_option_groups g
                    ON g.id = l.group_id AND g.product_id = v.product_id
                  WHERE l.variant_id = v.id
                ), '[]'::json) AS "groupLimits"
         FROM public.product_variants v
         JOIN public.products p ON p.id = v.product_id
         WHERE p.id = $1 AND p.restaurant_id = $2
         ORDER BY v.price, v.name, v.id`,
        values,
      ),
      new ListProductOptionsService().execute({ productId, restaurantId }, db, exactPrices),
    ]);

    return { product, variants, groups };
  }
}
