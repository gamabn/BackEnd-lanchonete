
import { GetClientService } from "../../service/clients/GetClientService";
import type { Request, Response } from "express";

class GetClientController {

  async handle(req: Request, res: Response) {
    const restaurant_id = req.params.id;
    const phone = req.query.phone as string; // <- pegar do query param
    console.log("restaurant_id:", restaurant_id, "phone:", phone);

  if (!phone) {
      return res.status(400).json({ error: "Telefone não fornecido" });
    }


    const getClientService = new GetClientService();
    const clients = await getClientService.execute({restaurant_id, phone});

    return res.json(clients);
  }

}
export { GetClientController }