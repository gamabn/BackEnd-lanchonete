"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteClientService = void 0;
const database_1 = require("../../database");
class DeleteClientService {
    async execute(id, restaurant_id) {
        const client = await database_1.pool.query("DELETE FROM customers WHERE id = $1 AND restaurant_id = $2 RETURNING id, name, phone, city, street, number, neighborhood, complement, restaurant_id", [id, restaurant_id]);
        return client.rows[0];
    }
}
exports.DeleteClientService = DeleteClientService;
