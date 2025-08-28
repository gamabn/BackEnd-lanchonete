"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateOrderItemService = void 0;
const database_1 = require("../../database");
class CreateOrderItemService {
    async execute(items) {
        if (!items || !items.length)
            throw new Error("Array de itens é obrigatório.");
        const client = await database_1.pool.connect();
        const insertedItems = [];
        try {
            await client.query("BEGIN");
            for (const item of items) {
                const query = `
          INSERT INTO order_items (order_id, product_id, quantity, item_price)
          VALUES ($1, $2, $3, $4)
          RETURNING *;
        `;
                const result = await client.query(query, [
                    item.order_id,
                    item.product_id,
                    item.quantity,
                    item.item_price,
                ]);
                insertedItems.push(result.rows[0]);
            }
            await client.query("COMMIT");
            return insertedItems;
        }
        catch (error) {
            await client.query("ROLLBACK");
            console.error("Erro ao inserir itens do pedido:", error);
            throw new Error("Erro ao inserir itens do pedido");
        }
        finally {
            client.release();
        }
    }
}
exports.CreateOrderItemService = CreateOrderItemService;
