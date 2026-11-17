import type { Request, Response } from "express";
import { CustomerEmailError } from "../../service/clients/CustomerEmailVerificationService";
import { CustomerEmailRecoveryService } from "../../service/clients/CustomerEmailRecoveryService";

export class CustomerEmailRecoveryController {
  request = (req: Request, res: Response) => this.handle(req, res, false);
  confirm = (req: Request, res: Response) => this.handle(req, res, true);
  private async handle(req: Request, res: Response, confirm: boolean) {
    res.set('Cache-Control', 'no-store');
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !(confirm ? ['challengeId', 'code'] : ['email']).includes(key))) {
        return res.status(400).json({ error: "Dados inválidos." });
      }
      const service = new CustomerEmailRecoveryService();
      const result = confirm ? await service.confirm(req.params.id, body.challengeId, body.code)
        : await service.request(req.params.id, body.email);
      return res.status(confirm ? 200 : 202).json(result);
    } catch (error) {
      if (error instanceof CustomerEmailError) return res.status(error.status).json({ error: error.message });
      return res.status(503).json({ error: "Recuperação indisponível. Tente novamente mais tarde." });
    }
  }
}
