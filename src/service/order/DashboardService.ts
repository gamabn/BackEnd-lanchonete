import { pool } from "../../database";

class DashboardService {
  async execute(restaurant_id: string) {
    const totalSales = await pool.query(
      `SELECT COALESCE(SUM(total_price), 0) AS sum 
       FROM orders 
       WHERE status = 'completed' AND restaurant_id = $1`,
      [restaurant_id]
    );

    const totalOrders = await pool.query(
      `SELECT COUNT(*) 
       FROM orders 
       WHERE restaurant_id = $1`,
      [restaurant_id]
    );

    const pendingOrders = await pool.query(
      `SELECT COUNT(*) 
       FROM orders 
       WHERE status = 'pending' AND restaurant_id = $1`,
      [restaurant_id]
    );

    const allClient = await pool.query(
      `SELECT COUNT(*) 
       FROM customers 
       WHERE restaurant_id = $1`,
      [restaurant_id]
    );

    const allProduct = await pool.query(
      `SELECT COUNT(*) 
       FROM products 
       WHERE restaurant_id = $1`,
      [restaurant_id]
    );

    return {
      totalSales: totalSales.rows[0].sum || 0,
      totalOrders: totalOrders.rows[0].count || 0,
      pendingOrders: pendingOrders.rows[0].count || 0,
      allClient: allClient.rows[0].count || 0,
      allProduct: allProduct.rows[0].count || 0,
    };
  }
}

export { DashboardService };
