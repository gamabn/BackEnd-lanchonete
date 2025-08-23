import { Request, Response } from "express";
import { ListMessagesService } from "../../service/message/ListMessagesService";



class MessageGetController {
  async handle(req: Request, res: Response) {
    const { chat_id } = req.params;

    if (!chat_id) {
      return res.status(400).json({ message: "chat_id é obrigatório." });
    }

    try {
      const listMessagesService = new ListMessagesService();
      const messages = await listMessagesService.execute(chat_id);
      

      return res.status(200).json(messages.rows);
    } catch (error) {
      console.error("Erro ao buscar mensagens:", error);
      return res.status(500).json({ message: "Erro interno no servidor." });
    }
  }
}

export { MessageGetController };
