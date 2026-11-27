import { pool } from "../../database";

class GetIdStoreService {
  async execute(id: string) {
    const store = await pool.query(
      'SELECT id, name, phone, email, city, neighborhood, street, "number", image_url, status FROM restaurants WHERE id = $1',
      [id],
    );

    return store.rows[0];
  }
}
export { GetIdStoreService };
