import { pool } from "../../database";

interface ClientRequest {
  name: string;
  phone: string;
  city: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  complement?: string;
  restaurant_id: string;
}
class CreateClientService{

  async execute( { name, phone, city, restaurant_id, street, number, neighborhood, complement }: ClientRequest) {
     const clients = await pool.query(
        "INSERT INTO customers (name, phone, city, street, number, neighborhood, complement, restaurant_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
        [name, phone, city, street, number, neighborhood, complement, restaurant_id]
      
     )
  
    return clients.rows[0];
  }

}
export { CreateClientService }