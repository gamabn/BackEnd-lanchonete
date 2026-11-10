import { UpdateClientService } from "../../service/clients/UpdateClientService";
import { readCustomerData, type CustomerPrincipal } from "../../security/customerAccess";
import type { Request, Response } from "express";

class UpdateClientController {
  async handle(req: Request, res: Response) {
    const actor = res.locals.customerPrincipal as CustomerPrincipal;
    let id: string;
    let input: unknown = req.body;
    if (actor.type === "restaurant") {
      if (!input || typeof input !== "object" || Array.isArray(input) || !("id" in input) || typeof input.id !== "string" || !input.id) {
        return res.status(400).json({ error: "Cliente obrigatório." });
      }
      const { id: target, ...details } = input;
      id = target;
      input = details;
    } else {
      id = actor.customerId;
    }
    const data = readCustomerData(input);
    if (!data) return res.status(400).json({ error: "Somente dados de contato e endereço podem ser atualizados." });
    const client = await new UpdateClientService().execute({ ...data, id, restaurant_id: actor.restaurantId });
    if (!client) return res.status(404).json({ error: "Cadastro não encontrado." });
    return res.json(client);
  }
}
export { UpdateClientController };
