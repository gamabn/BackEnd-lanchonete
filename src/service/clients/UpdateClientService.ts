
import { pool } from "../../database";  

class UpdateClientService{

  async execute({ id, name, phone, city,street, number, neighborhood, complement }: 
    { id: string, name: string, phone: string, city: string, street?: string, number?: string, neighborhood?: string, complement?: string }) {
    const client = await pool.query(
      `UPDATE customers 
   SET 
     name = $1, 
     phone = $2, 
     city = $3, 
     street = $4, 
     number = $5, 
     neighborhood = $6, 
     complement = $7
   WHERE id = $8 
   RETURNING *`,
  [name, phone, city, street, number, neighborhood, complement, id]
);
    return client.rows[0];
  }

}
export { UpdateClientService }