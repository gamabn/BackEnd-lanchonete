"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetClientService = void 0;
const database_1 = require("../../database");
class GetClientService {
    async execute({ restaurant_id, phone }) {
        const clients = await database_1.pool.query("SELECT * FROM customers WHERE restaurant_id = $1 AND phone = $2", [restaurant_id, phone]);
        return clients.rows;
    }
}
exports.GetClientService = GetClientService;
