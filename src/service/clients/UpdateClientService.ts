import { pool } from "../../database";
import { customerColumns, type CustomerData, type CustomerRecord } from "../../security/customerAccess";

class UpdateClientService {
  async execute({ id, name, phone, city, street, number, neighborhood, complement, restaurant_id }: CustomerData & { id: string; restaurant_id: string }) {
    const client = await pool.query<CustomerRecord>(
      `UPDATE customers SET name = $1, phone = $2, city = $3, street = $4,
       number = $5, neighborhood = $6, complement = $7
       WHERE id = $8 AND restaurant_id = $9 RETURNING ${customerColumns}`,
      [name, phone, city, street, number, neighborhood, complement, id, restaurant_id],
    );
    return client.rows[0];
  }
}
export { UpdateClientService };
