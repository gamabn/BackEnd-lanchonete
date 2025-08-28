"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderSalesController = void 0;
const OrderSalesService_1 = require("../../service/order/OrderSalesService");
class OrderSalesController {
    async handle(req, res) {
        const { customer_id, status, total_price, payment_method, change_for } = req.body;
        const restaurant_id = req.params.id;
        const orderSalesService = new OrderSalesService_1.OrderSalesService();
        const order = await orderSalesService.execute({
            restaurant_id,
            customer_id,
            status,
            total_price,
            payment_method,
            change_for
        });
        return res.json(order);
    }
}
exports.OrderSalesController = OrderSalesController;
