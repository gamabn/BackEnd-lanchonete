
import { pool } from "../../database";

class GetProductService{

  async execute(restaurant_id: string) {
    const products = await pool.query('SELECT * FROM products WHERE restaurant_id = $1', [restaurant_id]);
    return products.rows;
  }

}
export { GetProductService }