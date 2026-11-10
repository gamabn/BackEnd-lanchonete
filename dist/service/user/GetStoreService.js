"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetStoreService = void 0;
const database_1 = require("../../database");
class GetStoreService {
    async execute() {
        const store = await database_1.pool.query('SELECT id, name, phone, city, neighborhood, street, "number", image_url, status FROM restaurants');
        return store.rows;
    }
}
exports.GetStoreService = GetStoreService;
