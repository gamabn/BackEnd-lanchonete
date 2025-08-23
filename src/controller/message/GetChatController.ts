import { Request, Response } from "express";
import { GetChatService } from "../../service/message/GetChatService";

class GetChatController {
    
  async handle(req: Request, res: Response) {
    const { order_id } = req.params;

    if (!order_id) {
      return res.status(400).json({ message: "customer_id e restaurant_id são obrigatórios." });
    }

    try {
      const getChatService = new GetChatService();
      const chat = await getChatService.execute(order_id);

      return res.status(200).json(chat);
    } catch (error) {
      console.error("Erro ao buscar chat:", error);
      return res.status(500).json({ message: "Erro interno no servidor." });
    }
  }


}

export { GetChatController };