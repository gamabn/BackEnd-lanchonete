"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessagePostController = void 0;
const CreateMessageService_1 = require("../../service/message/CreateMessageService");
const chat_1 = require("../../socket/chat");
const server_1 = require("../../server");
class MessagePostController {
    async handle(req, res) {
        const { message } = req.body;
        const chat = res.locals.authorizedChat;
        const actor = res.locals.chatActor;
        const chat_id = chat.chat_id;
        const sender_type = actor.type;
        const sender_id = actor.id;
        const name = actor.type === "customer" ? chat.customer_name : chat.restaurant_name;
        if (typeof message !== "string" || !message.trim() || message.length > 10000) {
            return res.status(400).json({ message: "Mensagem obrigatória, com até 10000 caracteres." });
        }
        try {
            const createMessageService = new CreateMessageService_1.CreateMessageService();
            const newMessage = await createMessageService.execute({
                chat_id,
                sender_type, // "customer" ou "restaurant"
                sender_id, // uuid do cliente ou restaurante
                message,
                name
            });
            server_1.io.to((0, chat_1.chatRoom)(chat_id)).emit("newMessage", newMessage.rows[0]);
            return res.status(201).json(newMessage);
        }
        catch (error) {
            console.error("Erro ao criar mensagem:", error);
            return res.status(500).json({ message: "Erro interno no servidor." });
        }
    }
}
exports.MessagePostController = MessagePostController;
