"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateClientService = void 0;
const database_1 = require("../../database");
class CreateClientService {
    async execute({ name, phone, city, restaurant_id, street, number, neighborhood, complement }) {
        const clients = await database_1.pool.query("INSERT INTO customers (name, phone, city, street, number, neighborhood, complement, restaurant_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *", [name, phone, city, street, number, neighborhood, complement, restaurant_id]);
        return clients.rows[0];
    }
}
exports.CreateClientService = CreateClientService;
