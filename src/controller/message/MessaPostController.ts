import { Request, Response } from "express";
import { CreateMessageService } from "../../service/message/CreateMessageService";
import { chatRoom } from "../../socket/chat";
import { io } from "../../server";


class MessagePostController {
  async handle(req: Request, res: Response) {
    const { message } = req.body;
    const chat = res.locals.authorizedChat as { chat_id: string; customer_name: string; restaurant_name: string };
    const actor = res.locals.chatActor as { type: "customer" | "restaurant"; id: string };
    const chat_id = chat.chat_id;
    const sender_type = actor.type;
    const sender_id = actor.id;
    const name = actor.type === "customer" ? chat.customer_name : chat.restaurant_name;

    if (typeof message !== "string" || !message.trim() || message.length > 10000) {
      return res.status(400).json({ message: "Mensagem obrigatória, com até 10000 caracteres." });
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
     io.to(chatRoom(chat_id)).emit("newMessage", newMessage.rows[0]);

      return res.status(201).json(newMessage);
    } catch (error) {
      console.error("Erro ao criar mensagem:", error);
      return res.status(500).json({ message: "Erro interno no servidor." });
    }
  }
}

export { MessagePostController };
