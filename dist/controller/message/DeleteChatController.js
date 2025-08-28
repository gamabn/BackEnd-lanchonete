"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteChatController = void 0;
const DeleteChatService_1 = require("../../service/message/DeleteChatService");
class DeleteChatController {
    async handle(req, res) {
        const { order_id } = req.params;
        try {
            const deleteChatService = new DeleteChatService_1.DeleteChatService();
            await deleteChatService.execute(order_id);
            return res.status(200).json({ message: "Chat deletado com sucesso." });
        }
        catch (error) {
            console.error("Erro ao deletar chat:", error);
            return res.status(500).json({ message: "Erro interno no servidor." });
        }
    }
}
exports.DeleteChatController = DeleteChatController;
