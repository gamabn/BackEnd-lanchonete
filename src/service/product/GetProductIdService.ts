import { pool } from "../../database";

class GetProductIdService {
  async execute(restaurantId: string) {
    const products = await pool.query(
      `
      SELECT
        id,
        restaurant_id,
        name,
        description,
        price,
        image_url
      FROM public.products
      WHERE restaurant_id = $1
        AND published = TRUE
        AND available = TRUE
      ORDER BY created_at DESC
      `,
      [restaurantId],
    );

    return products.rows;
  }
}

export { GetProductIdService };
