"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderSalesController = void 0;
const chat_1 = require("../../socket/chat");
const orders_1 = require("../../socket/orders");
const server_1 = require("../../server");
const OrderSalesService_1 = require("../../service/order/OrderSalesService");
const orderValidation_1 = require("../../service/order/orderValidation");
class OrderSalesController {
    async handle(req, res) {
        res.set("Cache-Control", "no-store");
        const actor = res.locals.customerPrincipal;
        if (actor.type !== "customer" || actor.restaurantId !== req.params.id)
            return res.status(403).json({ error: "Cliente não autorizado." });
        try {
            const result = await new OrderSalesService_1.OrderSalesService().execute({ restaurant_id: actor.restaurantId, customer_id: actor.customerId, input: req.body });
            // execute returns only after COMMIT. Never emit from the legacy item endpoint.
            try {
                server_1.io.of("/orders").to((0, orders_1.restaurantRoom)(result.order.restaurant_id)).emit("newOrder", result.fullOrder);
            }
            catch {
                console.error("Pedido confirmado, mas a notificação em tempo real falhou.");
            }
            return res.status(201).json({ ...result, chat_credential: (0, chat_1.customerChatCredential)(result.order.id, result.order.customer_id) });
        }
        catch (error) {
            if (error instanceof orderValidation_1.OrderValidationError)
                return res.status(error.status).json({ error: error.message });
            return res.status(503).json({ error: "Não foi possível confirmar o pedido." });
        }
    }
}
exports.OrderSalesController = OrderSalesController;
