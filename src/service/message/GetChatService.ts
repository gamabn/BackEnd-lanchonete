import { pool } from "../../database";

class GetChatService{

  async execute(order_id: string) {
    const query = `
      SELECT id, order_id, created_at
      FROM chats
      WHERE order_id = $1;
    `;
    const result = await pool.query(query, [order_id]);
    return result.rows[0];
  }

}
export { GetChatService }

