import { pool } from "../../database";

class GetProductIdService {
  async execute(restaurantId: string) {
    const products = await pool.query(
      `
      SELECT
        p.id,
        p.restaurant_id,
        p.name,
        p.description,
        p.category,

        COALESCE(
          (
            SELECT MIN(v.price)
            FROM public.product_variants v
            WHERE v.product_id = p.id
              AND v.available = TRUE
          ),
          p.price
        ) AS price,

        p.image_url,

        EXISTS (
          SELECT 1
          FROM public.product_variants v
          WHERE v.product_id = p.id
            AND v.available = TRUE
        ) AS has_variants

      FROM public.products p

      WHERE p.restaurant_id = $1
        AND p.published = TRUE
        AND p.available = TRUE

      ORDER BY p.created_at DESC
      `,
      [restaurantId],
    );

    return products.rows;
  }
}

export { GetProductIdService };
