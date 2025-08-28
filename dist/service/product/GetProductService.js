"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetProductService = void 0;
const database_1 = require("../../database");
class GetProductService {
    async execute(restaurant_id) {
        const products = await database_1.pool.query('SELECT * FROM products WHERE restaurant_id = $1', [restaurant_id]);
        return products.rows;
    }
}
exports.GetProductService = GetProductService;
