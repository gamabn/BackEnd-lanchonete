
import { pool } from "../../database";class DeleteClientService{

  async execute(id: string, restaurant_id: string) {
    const client = await pool.query("DELETE FROM customers WHERE id = $1 AND restaurant_id = $2 RETURNING id, name, phone, city, street, number, neighborhood, complement, restaurant_id", [id, restaurant_id]);
    return client.rows[0];
  }

}
export { DeleteClientService }