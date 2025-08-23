import { pool } from "../../database";

class DeleteProductService {

  async execute(product_id: string, restaurant_id: string) {
    await pool.query('DELETE FROM products WHERE id = $1 AND restaurant_id = $2', [product_id, restaurant_id]);
    return { message: 'Produto deletado com sucesso.' };
  }


}
export { DeleteProductService }