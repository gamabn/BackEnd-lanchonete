import { pool } from "../../database";

class GetProductIdService{

  async execute(id: string) {
    const products = await pool.query('SELECT * FROM products WHERE restaurant_id = $1', [id]);
    return products.rows;
  }

}
export { GetProductIdService }