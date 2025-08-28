"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardService = void 0;
const database_1 = require("../../database");
class DashboardService {
    async execute(restaurant_id) {
        const totalSales = await database_1.pool.query(`SELECT COALESCE(SUM(total_price), 0) AS sum 
       FROM orders 
       WHERE status = 'completed' AND restaurant_id = $1`, [restaurant_id]);
        const totalOrders = await database_1.pool.query(`SELECT COUNT(*) 
       FROM orders 
       WHERE restaurant_id = $1`, [restaurant_id]);
        const pendingOrders = await database_1.pool.query(`SELECT COUNT(*) 
       FROM orders 
       WHERE status = 'pending' AND restaurant_id = $1`, [restaurant_id]);
        const allClient = await database_1.pool.query(`SELECT COUNT(*) 
       FROM customers 
       WHERE restaurant_id = $1`, [restaurant_id]);
        const allProduct = await database_1.pool.query(`SELECT COUNT(*) 
       FROM products 
       WHERE restaurant_id = $1`, [restaurant_id]);
        return {
            totalSales: totalSales.rows[0].sum || 0,
            totalOrders: totalOrders.rows[0].count || 0,
            pendingOrders: pendingOrders.rows[0].count || 0,
            allClient: allClient.rows[0].count || 0,
            allProduct: allProduct.rows[0].count || 0,
        };
    }
}
exports.DashboardService = DashboardService;
