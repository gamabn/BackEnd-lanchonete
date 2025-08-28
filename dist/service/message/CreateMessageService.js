"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateMessageService = void 0;
const database_1 = require("../../database");
class CreateMessageService {
    async execute({ chat_id, sender_type, sender_id, message, name }) {
        const query = `
      INSERT INTO chat_messages (chat_id, sender_type, sender_id, message, name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
        const values = [chat_id, sender_type, sender_id, message, name];
        return await database_1.pool.query(query, values);
    }
}
exports.CreateMessageService = CreateMessageService;
