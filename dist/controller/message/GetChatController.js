"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetChatController = void 0;
const GetChatService_1 = require("../../service/message/GetChatService");
class GetChatController {
    async handle(req, res) {
        const { order_id } = req.params;
        if (!order_id) {
            return res.status(400).json({ message: "customer_id e restaurant_id são obrigatórios." });
        }
        try {
            const getChatService = new GetChatService_1.GetChatService();
            const chat = await getChatService.execute(order_id);
            return res.status(200).json(chat);
        }
        catch (error) {
            console.error("Erro ao buscar chat:", error);
            return res.status(500).json({ message: "Erro interno no servidor." });
        }
    }
}
exports.GetChatController = GetChatController;
