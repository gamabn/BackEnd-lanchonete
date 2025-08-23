
import { pool } from "../../database";class DeleteClientService{

  async execute(id: string) {
    const client = await pool.query("DELETE FROM customers WHERE id = $1 RETURNING *", [id]);
    return client.rows[0];
  }

}
export { DeleteClientService }