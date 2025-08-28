"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetIdStoreService = void 0;
const database_1 = require("../../database");
class GetIdStoreService {
    async execute(id) {
        const store = await database_1.pool.query('SELECT * FROM restaurants WHERE id = $1', [id]);
        return store.rows[0];
    }
}
exports.GetIdStoreService = GetIdStoreService;
