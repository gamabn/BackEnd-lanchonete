"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardController = void 0;
const DashboardService_1 = require("../../service/order/DashboardService");
class DashboardController {
    async handle(req, res) {
        const restaurant_id = req.user_id;
        const dashboardService = new DashboardService_1.DashboardService();
        const dashboard = await dashboardService.execute(restaurant_id);
        return res.json(dashboard);
    }
}
exports.DashboardController = DashboardController;
