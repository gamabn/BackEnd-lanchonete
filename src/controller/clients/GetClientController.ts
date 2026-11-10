import { GetClientService } from "../../service/clients/GetClientService";
import type { CustomerPrincipal } from "../../security/customerAccess";
import type { Request, Response } from "express";

class GetClientController {
  async handle(req: Request, res: Response) {
    const actor = res.locals.customerPrincipal as CustomerPrincipal;
    const phone = req.query.phone;
    if ((phone !== undefined && typeof phone !== "string") || (actor.type === "restaurant" && !phone)) {
      return res.status(400).json({ error: "Telefone válido obrigatório na consulta administrativa." });
    }
    const clients = await new GetClientService().execute({
      restaurant_id: actor.restaurantId, phone,
      customer_id: actor.type === "customer" ? actor.customerId : undefined,
    });
    if (actor.type === "customer" && !clients.length) return res.status(404).json({ error: "Cadastro não encontrado." });
    return res.json(clients);
  }
}
export { GetClientController };
