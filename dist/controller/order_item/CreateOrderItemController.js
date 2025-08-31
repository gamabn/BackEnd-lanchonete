"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateOrderItemController = void 0;
const CreateOrderItemSerice_1 = require("../../service/order_item/CreateOrderItemSerice");
const GetOrderItemService_1 = require("../../service/order_item/GetOrderItemService");
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
            const orderId = insertedItems[0]?.order_id;
            if (!orderId) {
                console.error("Não foi possível determinar order_id:", insertedItems);
                return res.status(500).json({ message: "Erro ao identificar pedido inserido." });
            }
            const getOrderService = new GetOrderItemService_1.GetOrderItemService();
            const fullOrder = await getOrderService.findByOrderId(orderId);
            if (!fullOrder) {
                return res.status(404).json({ message: "Pedido não encontrado." });
            }
            // emite o pedido completo
            server_1.io.emit("newOrder", fullOrder);
            console.log("Emitindo newOrder:", fullOrder.order_id);
            return res.status(201).json(fullOrder);
        }
        catch (error) {
            console.error("Erro ao inserir itens do pedido:", error);
            return res.status(500).json({ message: "Erro interno ao inserir itens." });
        }
    }
}
exports.CreateOrderItemController = CreateOrderItemController;
