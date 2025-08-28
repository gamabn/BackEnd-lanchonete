"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetAllChatController = void 0;
const GetAllChatService_1 = require("../../service/message/GetAllChatService");
class GetAllChatController {
    async handle(req, res) {
        try {
            const getAllChatService = new GetAllChatService_1.GetAllChatService();
            const chats = await getAllChatService.execute();
            return res.status(200).json(chats);
        }
        catch (error) {
            console.error("Erro ao buscar todos os chats:", error);
            return res.status(500).json({ message: "Erro interno no servidor." });
        }
    }
}
exports.GetAllChatController = GetAllChatController;
