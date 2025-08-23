
import { pool } from "../../database";

class ImageStorageService{

  async execute(restaurant_id: string, image_url: string) {
    const updatedStore = await pool.query(
      `UPDATE restaurants SET 
        image_url = $1
      WHERE id = $2 RETURNING *`,
      [image_url, restaurant_id]
    );

    return updatedStore.rows[0];
  }

}
export { ImageStorageService }