"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetOrderItemService = void 0;
const database_1 = require("../../database");
class GetOrderItemService {
    async execute(restaurant_id) {
        const orderItems = await database_1.pool.query(`SELECT 
          o.id AS order_id,
          o.status,
          (o.total_price)::float8 AS total_price,
          o.created_at,
          o.payment_method,
          o.change_for,
          json_build_object(
            'id', c.id,
            'name', c.name,
            'phone', c.phone,
            'city', c.city,
            'street', c.street,
            'number', c.number,
            'neighborhood', c.neighborhood,
            'complement', c.complement
           
          ) AS customer,
          json_agg(
            json_build_object(
              'id', oi.id,
              'product_id', p.id,
              'product_name', p.name,
              'quantity', (oi.quantity)::int,
              'item_price', (oi.item_price)::float8
            )
          ) AS items
        FROM orders o
        INNER JOIN customers c ON c.id = o.customer_id
        INNER JOIN order_items oi ON oi.order_id = o.id
        INNER JOIN products p ON p.id = oi.product_id
        WHERE o.restaurant_id = $1
        GROUP BY o.id, c.id, o.payment_method, o.change_for
        ORDER BY o.created_at DESC;
            
      `, [restaurant_id]);
        return orderItems.rows;
    }
}
exports.GetOrderItemService = GetOrderItemService;
