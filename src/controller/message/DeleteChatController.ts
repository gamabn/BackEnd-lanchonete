import { Request, Response } from "express";
import { DeleteChatService } from "../../service/message/DeleteChatService";

class DeleteChatController {

  async handle(req: Request, res: Response) {
    const { order_id } = req.params;

    try {
      const deleteChatService = new DeleteChatService();
      await deleteChatService.execute(order_id);

      return res.status(200).json({ message: "Chat deletado com sucesso." });
    } catch (error) {
      console.error("Erro ao deletar chat:", error);
      return res.status(500).json({ message: "Erro interno no servidor." });
    }
  }

}

export { DeleteChatController };