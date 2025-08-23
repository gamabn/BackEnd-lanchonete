import { pool } from "../../database";

class GraficService {
  async execute(restaurant_id: string) {
    const salesByMonth = await pool.query(
      `
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
      `,
      [restaurant_id]
    );

    return salesByMonth.rows;
  }
}

export { GraficService };
