import { pool } from "../../database";


class DeleteChatService{

  async execute(order_id: string) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Excluir mensagens associadas ao chat
      await client.query(
        `DELETE FROM chat_messages WHERE chat_id IN (SELECT id FROM chats WHERE order_id = $1)`,
        [order_id]
      );

      // Excluir o chat
      const deleteChatResult = await client.query(
        `DELETE FROM chats WHERE order_id = $1 RETURNING *`,
        [order_id]
      );

      if (deleteChatResult.rowCount === 0) {
        throw new Error("Chat não encontrado.");
      }

      await client.query('COMMIT');
      return { message: "Chat e mensagens associadas deletados com sucesso." };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

}
export { DeleteChatService }