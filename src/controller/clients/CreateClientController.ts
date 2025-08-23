import { CreateClientService } from "../../service/clients/CreateClientService";
import type { Request, Response } from "express";

class CreateClientController {
    async handle(req: Request, res: Response) {
      const { name, city, phone, street, number, neighborhood, complement } = req.body;
      const restaurant_id = req.params.id
  

      const clients = new CreateClientService();
      const client = await clients.execute({ name, phone, city, street, number, neighborhood, complement ,restaurant_id});
  
      return res.json(client);
  
  }
}
export { CreateClientController}