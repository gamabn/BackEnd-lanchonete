import { Request, Response } from "express";
import { GetAllChatService } from "../../service/message/GetAllChatService";

class GetAllChatController{

  async handle(req: Request, res: Response) {
   

   

    try {
      const getAllChatService = new GetAllChatService();
      const chats = await getAllChatService.execute();

      return res.status(200).json(chats);
    } catch (error) {
      console.error("Erro ao buscar todos os chats:", error);
      return res.status(500).json({ message: "Erro interno no servidor." });
    }
  }

}
export { GetAllChatController }