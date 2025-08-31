"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateOrderItemController = void 0;
const CreateOrderItemSerice_1 = require("../../service/order_item/CreateOrderItemSerice");
const server_1 = require("../../server");
class CreateOrderItemController {
    async handle(req, res) {
        // Aceita tanto array direto quanto { items: [...] }
        const items = Array.isArray(req.body) ? req.body : req.body.items;
        console.log('Item dos pedidos', items);
        if (!items || !items.length) {
            return res.status(400).json({ message: "Array de itens é obrigatório." });
        }
        try {
            const service = new CreateOrderItemSerice_1.CreateOrderItemService();
            const insertedItems = await service.execute(items);
            server_1.io.emit("newOrderItem", insertedItems);
            console.log("Emitindo newOrderItem:", insertedItems);
            return res.status(201).json(insertedItems);
        }
        catch (error) {
            console.error("Erro ao inserir itens do pedido:", error);
            return res.status(500).json({ message: "Erro interno ao inserir itens." });
        }
    }
}
exports.CreateOrderItemController = CreateOrderItemController;
