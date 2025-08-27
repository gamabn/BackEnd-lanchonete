import { pool } from "../../database";
import { hash } from "bcryptjs";

class  AuthResetService{
    

  async execute({ token, password }: { token: string; password?: string }) {
    if (!password) {
      throw new Error('Senha é obrigatória');
    }

    const tokenResult = await pool.query(
      'SELECT * FROM password_tokens WHERE token = $1 AND expires_at > NOW()',
      [token]
    );

    const tokenData = tokenResult.rows[0];

    if (!tokenData) {
      throw new Error('Token inválido ou expirado');
    }

    const hashedPassword = await hash(password, 8);

    await pool.query(
      'UPDATE restaurants SET password = $1 WHERE email = $2',
      [hashedPassword, tokenData.email]
    );

    await pool.query(
      'DELETE FROM password_tokens WHERE token = $1',
      [token]
    );

    return { message: 'Senha redefinida com sucesso.' };
  }

}
export  { AuthResetService }