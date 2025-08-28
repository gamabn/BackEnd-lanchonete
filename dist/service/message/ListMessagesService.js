"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListMessagesService = void 0;
const database_1 = require("../../database");
class ListMessagesService {
    async execute(chat_id) {
        const query = `
      SELECT id, chat_id, sender_type, sender_id, message, read, created_at, name
      FROM chat_messages
      WHERE chat_id = $1
      ORDER BY created_at ASC;
    `;
        return await database_1.pool.query(query, [chat_id]);
    }
}
exports.ListMessagesService = ListMessagesService;
