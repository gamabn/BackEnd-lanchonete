"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateClientService = void 0;
const database_1 = require("../../database");
class UpdateClientService {
    async execute({ id, name, phone, city, street, number, neighborhood, complement }) {
        const client = await database_1.pool.query(`UPDATE customers 
   SET 
     name = $1, 
     phone = $2, 
     city = $3, 
     street = $4, 
     number = $5, 
     neighborhood = $6, 
     complement = $7
   WHERE id = $8 
   RETURNING *`, [name, phone, city, street, number, neighborhood, complement, id]);
        return client.rows[0];
    }
}
exports.UpdateClientService = UpdateClientService;
