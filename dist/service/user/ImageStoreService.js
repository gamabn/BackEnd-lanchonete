"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageStorageService = void 0;
const database_1 = require("../../database");
class ImageStorageService {
    async execute(restaurant_id, image_url) {
        const updatedStore = await database_1.pool.query(`UPDATE restaurants SET 
        image_url = $1
      WHERE id = $2 RETURNING *`, [image_url, restaurant_id]);
        return updatedStore.rows[0];
    }
}
exports.ImageStorageService = ImageStorageService;
