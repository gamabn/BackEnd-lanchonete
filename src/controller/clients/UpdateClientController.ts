import { UpdateClientService } from "../../service/clients/UpdateClientService";
import type { Request, Response } from "express";

class UpdateClientController{

  async handle(req: Request, res: Response) {
    const { id, name, phone, city, street, number, neighborhood, complement } = req.body;

    const updateClientService = new UpdateClientService();
    const client = await updateClientService.execute({ id, name, phone, city, street, number, neighborhood, complement });

    return res.json(client);
  }

}
export { UpdateClientController }