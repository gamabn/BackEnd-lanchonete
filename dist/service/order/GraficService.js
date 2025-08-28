"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraficService = void 0;
const database_1 = require("../../database");
class GraficService {
    async execute(restaurant_id) {
        const salesByMonth = await database_1.pool.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COALESCE(SUM(total_price), 0) AS total_sales
      FROM
        orders
      WHERE
        status = 'completed'
        AND restaurant_id = $1
      GROUP BY
        month
      ORDER BY
        month;
      `, [restaurant_id]);
        return salesByMonth.rows;
    }
}
exports.GraficService = GraficService;
