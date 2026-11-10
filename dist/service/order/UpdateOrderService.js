"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateOrderService = void 0;
const database_1 = require("../../database");
class UpdateOrderService {
    async execute({ id, status, restaurant_id }) {
        const result = await database_1.pool.query("UPDATE orders SET status = $1 WHERE id = $2 AND restaurant_id = $3 RETURNING id, status", [status, id, restaurant_id]);
        return result.rows[0];
    }
}
exports.UpdateOrderService = UpdateOrderService;
