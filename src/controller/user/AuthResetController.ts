
import { Request, Response } from "express";
import { AuthResetService } from "../../service/user/ AuthResetService";

class AuthResetController {
  async handle(req: Request, res: Response) {
    try {
    const { token } = req.query as { token?: string };
      const { password } = req.body;

        if (!token) return res.status(400).json({ error: 'Token ausente' });
        if (!password) return res.status(400).json({ error: 'Senha ausente' });


      const resetService = new AuthResetService();
      const result = await resetService.execute({ token, password });

      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }
}

export { AuthResetController };