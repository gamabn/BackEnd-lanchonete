import { pool } from "../../database";

class DetailStoreService {
  async execute(user_id: string) {
    const store = await pool.query(
      `SELECT
        id,
        name,
        email,
        phone,
        city,
        neighborhood,
        street,
        "number",
        image_url,
        public_id
      FROM restaurants
      WHERE id = $1`,
      [user_id],
    );

    if (store.rows.length === 0) {
      throw new Error("User not found.");
    }

    return store.rows[0];
  }
}

export { DetailStoreService };
