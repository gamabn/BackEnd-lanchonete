import type { Request, Response } from "express";
import type { CustomerPrincipal } from "../../security/customerAccess";
import { CustomerEmailError, CustomerEmailVerificationService } from "../../service/clients/CustomerEmailVerificationService";

export class CustomerEmailVerificationController {
  request = (req: Request, res: Response) => this.handle(req, res, false);
  confirm = (req: Request, res: Response) => this.handle(req, res, true);
  private async handle(req: Request, res: Response, confirm: boolean) {
    res.set('Cache-Control', 'no-store');
    const actor = res.locals.customerPrincipal as CustomerPrincipal | undefined;
    if (!actor || actor.type !== 'customer') return res.status(403).json({ error: "Sessão de cliente obrigatória." });
    try {
      const service = new CustomerEmailVerificationService();
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).some(key => !(confirm ? ['challengeId', 'code'] : ['email']).includes(key))) {
        return res.status(400).json({ error: "Dados inválidos." });
      }
      const result = confirm ? await service.confirm(actor, body.challengeId, body.code) : await service.request(actor, body.email);
      return res.status(confirm ? 200 : 202).json(result);
    } catch (error) {
      if (error instanceof CustomerEmailError) return res.status(error.status).json({ error: error.message });
      return res.status(503).json({ error: "Verificação de e-mail indisponível. Você pode continuar comprando sem e-mail." });
    }
  }
}
