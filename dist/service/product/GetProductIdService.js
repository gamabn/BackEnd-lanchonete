"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetProductIdService = void 0;
const database_1 = require("../../database");
class GetProductIdService {
    async execute(id) {
        const products = await database_1.pool.query('SELECT * FROM products WHERE restaurant_id = $1', [id]);
        return products.rows;
    }
}
exports.GetProductIdService = GetProductIdService;
