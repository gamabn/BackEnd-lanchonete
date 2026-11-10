
import { pool } from "../../database";

class ImageStorageService{
  async exists(restaurant_id: string) {
    const result = await pool.query("SELECT id FROM restaurants WHERE id = $1", [restaurant_id]);
    return result.rows.length > 0;
  }


  async execute(restaurant_id: string, image_url: string) {
    const updatedStore = await pool.query(
      `UPDATE restaurants SET 
        image_url = $1
      WHERE id = $2
      RETURNING id, name, phone, city, neighborhood, street, "number", image_url, status`,
      [image_url, restaurant_id]
    );

    return updatedStore.rows[0];
  }

}
export { ImageStorageService }
