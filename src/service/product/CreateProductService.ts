import { pool } from "../../database";
import { ProductInputError, validateProductFields } from "./productValidation";

interface ProductRequest {
  category?: string | null;
  name: string;
  description: string;
  price: string | number;
  restaurant_id: string;
  public_id: string;
  image_url: string;
}

class CreateProductService {
  async execute(input: ProductRequest) {
    const { name, description, price, category } = validateProductFields(input);
    const { image_url, public_id, restaurant_id } = input;

    if (!restaurant_id) {
      throw new ProductInputError("Estabelecimento não autenticado.", 401);
    }
    if (!image_url?.trim() || !public_id?.trim()) {
      throw new ProductInputError("A imagem do produto é obrigatória.");
    }

    const product = await pool.query(
      `INSERT INTO products (name, description, price, image_url, public_id, restaurant_id, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, description, price, image_url, public_id, restaurant_id, category ?? null],
    );

    return product.rows[0];
  }
}

export { CreateProductService };
