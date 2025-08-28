"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateProductService = void 0;
const database_1 = require("../../database");
class CreateProductService {
    async execute({ name, description, price, image_url, public_id, restaurant_id }) {
        const product = await database_1.pool.query(`INSERT INTO products (name, description, price, image_url, public_id, restaurant_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`, [name, description, price, image_url, public_id, restaurant_id]);
        return product.rows[0];
    }
}
exports.CreateProductService = CreateProductService;
