
import { pool } from "../../database";

class DetailStoreService {
    async execute(user_id: string){
   
      try {
        const store = await pool.query('SELECT * FROM restaurants WHERE id = $1', [user_id])
         

        if (store.rows.length === 0) {
          // Lança um erro se o usuário não for encontrado.
          // Isso será capturado pelo seu middleware de erro no server.ts.
          throw new Error("User not found.");
        }

        // A query já seleciona apenas os campos seguros.
        // Retorna o primeiro usuário encontrado.
        return {
          id: store.rows[0].id,
          name: store.rows[0].name,
          email: store.rows[0].email,
          phone: store.rows[0].phone,
          city: store.rows[0].city,
          neighborhood: store.rows[0].neighborhood,
          street: store.rows[0].street,
          number: store.rows[0].number,
          image_url: store.rows[0]?.image_url,
          public_id: store.rows[0]?.public_id,
        }
      } catch (error) {
     
    }
  }
}
export { DetailStoreService }