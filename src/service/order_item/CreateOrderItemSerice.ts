import { pool } from "../../database";

interface IOrderItem {
  order_id: string;
  product_id: string;
  quantity: number;
  item_price: number;
}

class CreateOrderItemService {
  async execute(items: IOrderItem[]) {
    if (!items || !items.length) throw new Error("Array de itens é obrigatório.");

    const client = await pool.connect();
    const insertedItems: any[] = [];

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
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Erro ao inserir itens do pedido:", error);
      throw new Error("Erro ao inserir itens do pedido");
    } finally {
      client.release();
    }
  }
}

export { CreateOrderItemService };
