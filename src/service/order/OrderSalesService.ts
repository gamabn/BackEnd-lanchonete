import { pool } from "../../database";
import { parseOrder } from "./orderValidation";
import { validateOrderCheckout } from "./validateOrderCheckout";
import { persistValidatedOrder } from "./persistValidatedOrder";

class OrderSalesService {
  async execute({
    restaurant_id,
    customer_id,
    input,
  }: {
    restaurant_id: string;
    customer_id: string;
    input: unknown;
  }) {
    const parsed = parseOrder(input);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const validated = await validateOrderCheckout(client, { restaurant_id, customer_id, input: parsed });
      const result = await persistValidatedOrder(client, validated);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
export { OrderSalesService };
