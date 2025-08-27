import { Request, Response } from "express";
import { CreateMessageService } from "../../service/message/CreateMessageService";
import { io } from "../../server";


class MessagePostController {
  async handle(req: Request, res: Response) {
    const { chat_id, sender_type, sender_id, message, name } = req.body;

    if (!chat_id || !sender_type || !sender_id || !message || !name) {
      return res.status(400).json({ message: "chat_id, sender_type, sender_id e message são obrigatórios." });
    }

    try {
      const createMessageService = new CreateMessageService();
      const newMessage = await createMessageService.execute({
        chat_id,
        sender_type, // "customer" ou "restaurant"
        sender_id,   // uuid do cliente ou restaurante
        message,
        name
      });
      console.log("Nova mensagem emitida:", newMessage);
     io.to(chat_id).emit("newMessage", newMessage.rows[0]);

      return res.status(201).json(newMessage);
    } catch (error) {
      console.error("Erro ao criar mensagem:", error);
      return res.status(500).json({ message: "Erro interno no servidor." });
    }
  }
}

export { MessagePostController };
