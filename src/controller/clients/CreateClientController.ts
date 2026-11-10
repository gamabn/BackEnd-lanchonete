import { CreateClientService } from "../../service/clients/CreateClientService";
import { issueCustomerCredential, readCustomerData } from "../../security/customerAccess";
import type { Request, Response } from "express";

class CreateClientController {
  async handle(req: Request, res: Response) {
    res.set("Cache-Control", "no-store");
    const data = readCustomerData(req.body);
    if (!data) return res.status(400).json({ error: "Dados do cliente inválidos." });
    try {
      const client = await new CreateClientService().execute({ ...data, restaurant_id: req.params.id });
      if (!client) return res.status(404).json({ error: "Estabelecimento não encontrado." });
      // Never upsert or issue a credential for a record found by phone.
      return res.status(201).json({ ...client, customer_credential: issueCustomerCredential(client) });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        return res.status(409).json({ error: "Não foi possível criar um novo cadastro. Recuperação verificada pode ser necessária." });
      }
      return res.status(503).json({ error: "Não foi possível cadastrar o cliente." });
    }
  }
}
export { CreateClientController };
