import { pool } from "../../database";

class DeleteProductService {

  async execute(product_id: string, restaurant_id: string) {
    const result = await pool.query('DELETE FROM products WHERE id = $1 AND restaurant_id = $2', [product_id, restaurant_id]);
    if (!result.rowCount) return undefined;
    return { message: 'Produto deletado com sucesso.' };
  }


}
export { DeleteProductService }