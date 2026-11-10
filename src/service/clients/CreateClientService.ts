import { pool } from "../../database";
import { customerColumns, type CustomerData, type CustomerRecord } from "../../security/customerAccess";

class CreateClientService {
  async execute({ name, phone, city, street, number, neighborhood, complement, restaurant_id }: CustomerData & { restaurant_id: string }) {
    const clients = await pool.query<CustomerRecord>(
      `INSERT INTO customers (name, phone, city, street, number, neighborhood, complement, restaurant_id)
       SELECT $1, $2, $3, $4, $5, $6, $7, r.id FROM restaurants r WHERE r.id = $8
       RETURNING ${customerColumns}`,
      [name, phone, city, street, number, neighborhood, complement, restaurant_id],
    );
    return clients.rows[0];
  }
}
export { CreateClientService };
