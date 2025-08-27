
// controllers/AuthResetController.ts
import { Request, Response } from "express";
import { AuthResetService } from "../../service/user/ AuthResetService";

class AuthResetController {
  async handle(req: Request, res: Response) {
    try {
      const { token, password } = req.body;
      if (!token) return res.status(400).json({ error: 'Token ausente' });
      if (!password) return res.status(400).json({ error: 'Senha ausente' });

      const resetService = new AuthResetService();
      const result = await resetService.execute({ token, password });

      return res.json(result); // <<< retorna { message: "Senha redefinida com sucesso." }
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }
}

export { AuthResetController };
