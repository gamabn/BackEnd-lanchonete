"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraficController = void 0;
const GraficService_1 = require("../../service/order/GraficService");
class GraficController {
    async handle(req, res) {
        const restaurant_id = req.user_id;
        const graficService = new GraficService_1.GraficService();
        const salesByMonth = await graficService.execute(restaurant_id);
        return res.json(salesByMonth);
    }
}
exports.GraficController = GraficController;
