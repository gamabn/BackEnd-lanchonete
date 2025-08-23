import { pool } from "../../database";

class GetStoreService {

  async execute() {
   const store = await pool.query('SELECT * FROM restaurants')

   return store.rows

  }
}

export { GetStoreService }