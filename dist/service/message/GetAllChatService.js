"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetAllChatService = void 0;
const database_1 = require("../../database");
class GetAllChatService {
    async execute() {
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
      JOIN customers cu ON cu.id = o.customer_id;
    `;
        const result = await database_1.pool.query(query);
        return result.rows; // retorna todos os chats já com restaurant_id
    }
}
exports.GetAllChatService = GetAllChatService;
//GetAllChatService
