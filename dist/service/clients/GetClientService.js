"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetClientService = void 0;
const database_1 = require("../../database");
const customerAccess_1 = require("../../security/customerAccess");
class GetClientService {
    async execute({ restaurant_id, phone, customer_id }) {
        const clients = await database_1.pool.query(`SELECT ${customerAccess_1.customerColumns} FROM customers WHERE restaurant_id = $1
       AND ($2::text IS NULL OR phone::text = $2)
       ${customer_id === undefined ? "" : "AND id = $3"}`, customer_id === undefined ? [restaurant_id, phone || null] : [restaurant_id, phone || null, customer_id]);
        return clients.rows;
    }
}
exports.GetClientService = GetClientService;
