import { pool } from "../../database";
import validator from "validator";
import { hash } from "bcryptjs";

interface StoreRequest {
  name: string;
  email: string;
  password: string;
  phone: string;
  city: string;
  neighborhood: string;
  street: string;
  number: string;
}

class CreateStoreService {
  async execute({
    name,
    email,
    password,
    phone,
    city,
    neighborhood,
    street,
    number,
  }: StoreRequest) {
    if (!email) {
      throw new Error("Email incorreto");
    }

    if (!validator.isEmail(email)) {
      throw new Error("Email inválido");
    }

    const hashedPassword = await hash(password, 8);

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existEmail = await client.query(
        "SELECT id FROM restaurants WHERE email = $1",
        [email],
      );

      if (existEmail.rows.length > 0) {
        throw new Error("Email já cadastrado");
      }

      const store = await client.query(
        `INSERT INTO restaurants
          (name, email, password, phone, city, neighborhood, street, "number")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, phone, city, neighborhood, street,
                   "number", image_url, status`,
        [
          name,
          email,
          hashedPassword,
          phone,
          city,
          neighborhood,
          street,
          number,
        ],
      );

      const restaurant = store.rows[0];

      await client.query(
        `INSERT INTO subscriptions (
          restaurant_id,
          status,
          start_date,
          trial_end_date,
          plan
        )
        VALUES (
          $1,
          'trialing',
          NOW(),
          NOW() + INTERVAL '30 days',
          'BASICO'
        )`,
        [restaurant.id],
      );

      await client.query("COMMIT");

      return restaurant;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export { CreateStoreService };
