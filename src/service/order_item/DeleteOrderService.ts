import { pool } from "../../database";
class DeleteOrderService {
  async execute(order_id: string, restaurant_id: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query("SELECT id FROM orders WHERE id = $1 AND restaurant_id = $2 FOR UPDATE", [order_id, restaurant_id]);
      if (!order.rows.length) { await client.query("ROLLBACK"); return undefined; }
      await client.query("DELETE FROM chat_messages WHERE chat_id IN (SELECT id FROM chats WHERE order_id = $1 AND restaurant_id = $2)", [order_id, restaurant_id]);
      await client.query("DELETE FROM chats WHERE order_id = $1 AND restaurant_id = $2", [order_id, restaurant_id]);
      await client.query("DELETE FROM order_items WHERE order_id = $1 AND EXISTS (SELECT 1 FROM orders WHERE id = $1 AND restaurant_id = $2)", [order_id, restaurant_id]);
      const removed = await client.query("DELETE FROM orders WHERE id = $1 AND restaurant_id = $2", [order_id, restaurant_id]);
      if (removed.rowCount !== 1) throw new Error("Pedido não excluído.");
      await client.query("COMMIT");
      return { message: "Pedido excluído com sucesso" };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
export { DeleteOrderService };
