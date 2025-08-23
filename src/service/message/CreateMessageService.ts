import { pool } from "../../database";
    

interface IMessage {
  chat_id: string;
  sender_type: "customer" | "restaurant";
  sender_id: string;
  message: string;
}

class CreateMessageService {
  async execute({ chat_id, sender_type, sender_id, message }: IMessage) {
    const query = `
      INSERT INTO chat_messages (chat_id, sender_type, sender_id, message)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;

    const values = [chat_id, sender_type, sender_id, message];
    return await pool.query(query, values);
  }
}

export { CreateMessageService };
