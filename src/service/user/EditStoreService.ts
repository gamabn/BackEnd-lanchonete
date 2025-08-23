
import { pool } from "../../database";

class EditStoreService {
  async execute({
    id,
    name,
    email,
    phone,
    city,
    neighborhood,  // corrigido aqui
    street,
    number
  }: {
    id: string,
    name: string,
    email: string,
    phone: string,
    city: string,
   neighborhood: string,
    street: string,
    number: string
  }) {
    const updatedStore = await pool.query(
      `UPDATE restaurants SET 
        name = $1,
        email = $2,
        phone = $3,
        city = $4,
        neighborhood = $5,
        street = $6,
        number = $7
      WHERE id = $8 RETURNING *`,
      [name, email, phone, city, neighborhood, street, number, id]
    );

    return updatedStore.rows[0];
  }
}
export { EditStoreService }


