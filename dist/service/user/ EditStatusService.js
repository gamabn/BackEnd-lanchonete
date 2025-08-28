"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditStatusService = void 0;
const database_1 = require("../../database");
class EditStatusService {
    async execute({ id, status }) {
        const updatedStore = await database_1.pool.query(`UPDATE restaurants SET 
        status = $1
      WHERE id = $2 RETURNING *`, [status, id]);
        return updatedStore.rows[0];
    }
}
exports.EditStatusService = EditStatusService;
