"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateOrderController = void 0;
const UpdateOrderService_1 = require("../../service/order/UpdateOrderService");
class UpdateOrderController {
    async handle(req, res) {
        const { id, status } = req.body;
        if (typeof id !== "string" || !id || !["pending", "enviado", "completed"].includes(status))
            return res.status(400).json({ error: "Pedido/status inválido." });
        const order = await new UpdateOrderService_1.UpdateOrderService().execute({ id, status, restaurant_id: req.user_id });
        if (!order)
            return res.status(404).json({ error: "Pedido não encontrado." });
        return res.json(order);
    }
}
exports.UpdateOrderController = UpdateOrderController;
