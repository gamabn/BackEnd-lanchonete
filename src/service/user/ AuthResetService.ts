// service/user/AuthResetService.ts
import { pool } from "../../database";
import { hash } from "bcryptjs";

interface AuthResetRequest {
  token: string;
  password: string;
}

class AuthResetService {
  async execute({ token, password }: AuthResetRequest) {
    if (!password) throw new Error("Senha é obrigatória");

    // Verifica se o token é válido e não expirou
    const tokenResult = await pool.query(
      "SELECT * FROM password_tokens WHERE token = $1 AND expires_at > NOW()",
      [token]
    );

    const tokenData = tokenResult.rows[0];
    if (!tokenData) throw new Error("Token inválido ou expirado");

    // Faz hash da senha
    const hashedPassword = await hash(password, 8);

    // Atualiza a senha do usuário
    await pool.query(
      "UPDATE restaurants SET password = $1 WHERE email = $2",
      [hashedPassword, tokenData.email]
    );

    // Remove o token da tabela
    await pool.query(
      "DELETE FROM password_tokens WHERE token = $1",
      [token]
    );

    return { message: "Senha redefinida com sucesso." };
  }
}

export { AuthResetService };
