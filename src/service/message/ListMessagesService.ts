import { pool } from "../../database";

class ListMessagesService {
  async execute(chat_id: string) {
    const query = `
      SELECT id, chat_id, sender_type, sender_id, message, read, created_at, name
      FROM chat_messages
      WHERE chat_id = $1
      ORDER BY created_at ASC;
    `;
    return await pool.query(query, [chat_id]);
  }
}

export { ListMessagesService };
