import { pool } from "../../database";
class UpdateOrderService {
  async execute({ id, status, restaurant_id }: { id: string; status: string; restaurant_id: string }) {
    const result = await pool.query("UPDATE orders SET status = $1 WHERE id = $2 AND restaurant_id = $3 RETURNING id, status", [status, id, restaurant_id]);
    return result.rows[0];
  }
}
export { UpdateOrderService };
