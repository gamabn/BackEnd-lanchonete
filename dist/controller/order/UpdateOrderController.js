"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateOrderController = void 0;
const UpdateOrderService_1 = require("../../service/order/UpdateOrderService");
class UpdateOrderController {
    async handle(req, res) {
        const { id, status } = req.body;
        const updateOrderService = new UpdateOrderService_1.UpdateOrderService();
        const order = await updateOrderService.execute({ id, status });
        return res.json(order);
    }
}
exports.UpdateOrderController = UpdateOrderController;
