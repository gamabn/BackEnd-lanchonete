"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageStorageService = void 0;
const database_1 = require("../../database");
class ImageStorageService {
    async exists(restaurant_id) {
        const result = await database_1.pool.query("SELECT id FROM restaurants WHERE id = $1", [restaurant_id]);
        return result.rows.length > 0;
    }
    async execute(restaurant_id, image_url) {
        const updatedStore = await database_1.pool.query(`UPDATE restaurants SET 
        image_url = $1
      WHERE id = $2
      RETURNING id, name, phone, city, neighborhood, street, "number", image_url, status`, [image_url, restaurant_id]);
        return updatedStore.rows[0];
    }
}
exports.ImageStorageService = ImageStorageService;
