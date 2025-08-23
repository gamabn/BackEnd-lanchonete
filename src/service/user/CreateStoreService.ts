import { pool } from "../../database";
import validator from 'validator'
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

  async execute({ name, email, password, phone, city,  neighborhood, street, number }: StoreRequest) {

  if(!email){
    throw new Error('Email incorreto')
  }
  const existEmail = await pool.query('SELECT * FROM restaurants WHERE email = $1', [email])

  if(existEmail.rows.length > 0){
    throw new Error('Email já cadastrado')
  }


if (!validator.isEmail(email)) {
  throw new Error('Email inválido');
}
 const hashedPassword = await hash(password, 8);

  const store = await pool.query(
      `INSERT INTO restaurants 
        (name, email, password, phone, city, neighborhood, street, "number") 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [name, email, hashedPassword, phone, city,  neighborhood, street, number]
    );

    return store.rows[0];
  }
}
export { CreateStoreService }