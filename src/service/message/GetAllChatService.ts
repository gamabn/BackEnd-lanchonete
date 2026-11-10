import { pool } from "../../database";

class GetAllChatService {
  async execute(restaurant_id: string) {
    const query = `
      SELECT 
        c.id AS chat_id,
        c.created_at,
        o.id AS order_id,
        o.restaurant_id,            -- aqui pega o restaurante
        cu.id AS customer_id,
        cu.name AS customer_name
      FROM chats c
      JOIN orders o ON o.id = c.order_id
      JOIN customers cu ON cu.id = o.customer_id AND cu.restaurant_id = o.restaurant_id
      WHERE o.restaurant_id = $1 AND c.restaurant_id = o.restaurant_id;
    `;

    const result = await pool.query(query, [restaurant_id]);
    return result.rows; // retorna todos os chats já com restaurant_id
  }
}

export { GetAllChatService };

//GetAllChatService
