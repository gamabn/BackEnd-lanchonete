"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateOrderService = void 0;
const database_1 = require("../../database");
class UpdateOrderService {
    async execute({ id, status }) {
        const orderUpdate = await database_1.pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    }
}
exports.UpdateOrderService = UpdateOrderService;
