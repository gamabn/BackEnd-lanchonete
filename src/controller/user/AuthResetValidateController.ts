// controllers/AuthResetValidateController.ts
import { Request, Response } from "express";
import { pool } from "../../database";

class AuthResetValidateController {
  async handle(req: Request, res: Response) {
    try {
      const { token } = req.query as { token?: string };
      if (!token) return res.status(400).json({ error: "Token ausente" });

      const tokenResult = await pool.query(
        "SELECT * FROM password_tokens WHERE token = $1 AND expires_at > NOW()",
        [token]
      );

      const tokenData = tokenResult.rows[0];
      if (!tokenData) return res.status(400).json({ error: "Token inválido ou expirado" });

      return res.json({ email: tokenData.email });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }
}

export { AuthResetValidateController };
