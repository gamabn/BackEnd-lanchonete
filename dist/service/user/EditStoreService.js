"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditStoreService = void 0;
const database_1 = require("../../database");
class EditStoreService {
    async execute({ id, name, email, phone, city, neighborhood, // corrigido aqui
    street, number }) {
        const updatedStore = await database_1.pool.query(`UPDATE restaurants SET 
        name = $1,
        email = $2,
        phone = $3,
        city = $4,
        neighborhood = $5,
        street = $6,
        number = $7
      WHERE id = $8 RETURNING *`, [name, email, phone, city, neighborhood, street, number, id]);
        return updatedStore.rows[0];
    }
}
exports.EditStoreService = EditStoreService;
