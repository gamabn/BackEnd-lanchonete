import { sign } from "jsonwebtoken";
import { pool } from "../../database";
import { compare } from "bcryptjs";


interface AuthRequest {
  email: string;
  password: string;
}


class AuthStoreService {

  async execute({ email , password}: AuthRequest) {

    if(!email || !password){
    throw new Error('Digie email e senha!')
  }
  const result = await pool.query('SELECT * FROM restaurants WHERE email = $1', [email]);
  const user = result.rows[0]

  if(!user){
    throw new Error('Email incorreto')
  
  }
  const passwordHash = await compare(password, user.password)


  if(!passwordHash){
    throw new Error('Senha incorreta incorreto')
  }

   const token = sign( 
    {  
    name: user.name,
    email: user.email,
   
   },
   process.env.JWT_SECRET as string,{
    subject: user.id,
    expiresIn: '30d'
   }
  )
   return {
    id: user.id,
    name: user.name,
    email: user.email,
    token: token
   }
   
  }

}

export { AuthStoreService }