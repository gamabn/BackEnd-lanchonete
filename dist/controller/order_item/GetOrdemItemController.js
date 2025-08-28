"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetOrdemItemController = void 0;
const GetOrderItemService_1 = require("../../service/order_item/GetOrderItemService");
class GetOrdemItemController {
    async handle(req, res) {
        const restaurant_id = req.user_id;
        const getOrderItemService = new GetOrderItemService_1.GetOrderItemService();
        const orderItem = await getOrderItemService.execute(restaurant_id);
        return res.json(orderItem);
    }
}
exports.GetOrdemItemController = GetOrdemItemController;
