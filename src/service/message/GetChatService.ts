
import { pool } from "../../database";

class GetChatService {
  async execute(order_id: string) {
    const query = `
      SELECT 
        c.id AS chat_id,
        c.created_at,
        o.id AS order_id,
        cu.id AS customer_id,
        cu.name AS customer_name
      FROM chats c
      JOIN orders o ON o.id = c.order_id
      JOIN customers cu ON cu.id = o.customer_id
      WHERE o.id = $1;
    `;

    const result = await pool.query(query, [order_id]);
    console.log(result.rows[0]);
    return result.rows[0];
  }
}

export { GetChatService };
