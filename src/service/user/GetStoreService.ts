import { pool } from "../../database";

class GetStoreService {

  async execute() {
   const store = await pool.query(
     'SELECT id, name, phone, city, neighborhood, street, "number", image_url, status FROM restaurants'
   )

   return store.rows

  }
}

export { GetStoreService }
