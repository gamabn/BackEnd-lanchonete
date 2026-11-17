
import { pool } from "../../database";

class GetProductService{

  async execute(restaurant_id: string, configuredOnly = false) {
    const filter = configuredOnly
      ? "AND EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id)"
      : "";
    const products = await pool.query(
      `SELECT p.*, EXISTS (SELECT 1 FROM public.product_variants v WHERE v.product_id = p.id) AS has_variants
       FROM products p WHERE p.restaurant_id = $1 ${filter}`,
      [restaurant_id],
    );
    return products.rows;
  }

}
export { GetProductService }