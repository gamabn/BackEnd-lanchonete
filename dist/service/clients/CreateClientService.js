"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateClientService = void 0;
const database_1 = require("../../database");
const customerAccess_1 = require("../../security/customerAccess");
class CreateClientService {
    async execute({ name, phone, city, street, number, neighborhood, complement, restaurant_id }) {
        const clients = await database_1.pool.query(`INSERT INTO customers (name, phone, city, street, number, neighborhood, complement, restaurant_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, r.id FROM restaurants r WHERE r.id = $8
       RETURNING ${customerAccess_1.customerColumns}`, [name, phone, city, street, number, neighborhood, complement, restaurant_id]);
        return clients.rows[0];
    }
}
exports.CreateClientService = CreateClientService;
