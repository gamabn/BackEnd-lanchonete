"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteClientService = void 0;
const database_1 = require("../../database");
class DeleteClientService {
    async execute(id) {
        const client = await database_1.pool.query("DELETE FROM customers WHERE id = $1 RETURNING *", [id]);
        return client.rows[0];
    }
}
exports.DeleteClientService = DeleteClientService;
