import { pool } from "../../database";
    

interface IMessage {
  chat_id: string;
  sender_type: "customer" | "restaurant";
  sender_id: string;
  message: string;
  name: string;
}

class CreateMessageService {
  async execute({ chat_id, sender_type, sender_id, message, name }: IMessage) {
    const query = `
      INSERT INTO chat_messages (chat_id, sender_type, sender_id, message, name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const values = [chat_id, sender_type, sender_id, message, name];
    return await pool.query(query, values);
  }
}

export { CreateMessageService };
