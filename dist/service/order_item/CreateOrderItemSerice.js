"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateOrderItemService = void 0;
class CreateOrderItemService {
    // Called only within the checkout transaction with prices loaded from PostgreSQL.
    async execute(client, order_id, items) {
        for (const item of items) {
            const result = await client.query("INSERT INTO order_items (order_id, product_id, quantity, item_price) VALUES ($1, $2, $3, $4::numeric)", [order_id, item.product_id, item.quantity, item.item_price]);
            if (result.rowCount !== 1)
                throw new Error("Item não persistido.");
        }
    }
}
exports.CreateOrderItemService = CreateOrderItemService;
