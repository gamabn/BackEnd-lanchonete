import { pool } from "../../database";

interface ProductRequest {
  name: string;
  description: string;
  price: number;
  restaurant_id: string;
  public_id: string; // agora é obrigatório se houver imagem
  image_url: string;
}

class CreateProductService {
  async execute({ name, description, price, image_url, public_id, restaurant_id }: ProductRequest) {
    const product = await pool.query(
      `INSERT INTO products (name, description, price, image_url, public_id, restaurant_id) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [name, description, price, image_url, public_id, restaurant_id]
    );

    return product.rows[0];
  }
}

export { CreateProductService };
