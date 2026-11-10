import { pool } from "../../database";
import { customerColumns, type CustomerRecord } from "../../security/customerAccess";

class GetClientService {
  async execute({ restaurant_id, phone, customer_id }: { restaurant_id: string; phone?: string; customer_id?: string }) {
    const clients = await pool.query<CustomerRecord>(
      `SELECT ${customerColumns} FROM customers WHERE restaurant_id = $1
       AND ($2::text IS NULL OR phone::text = $2)
       ${customer_id === undefined ? "" : "AND id = $3"}`,
      customer_id === undefined ? [restaurant_id, phone || null] : [restaurant_id, phone || null, customer_id],
    );
    return clients.rows;
  }
}
export { GetClientService };
