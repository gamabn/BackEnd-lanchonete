"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetChatService = void 0;
const database_1 = require("../../database");
class GetChatService {
    async execute(order_id) {
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
        const result = await database_1.pool.query(query, [order_id]);
        console.log(result.rows[0]);
        return result.rows[0];
    }
}
exports.GetChatService = GetChatService;
