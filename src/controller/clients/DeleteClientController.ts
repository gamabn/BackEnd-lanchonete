import { DeleteClientService } from "../../service/clients/DeleteClientService";
import type { Request, Response } from "express";

class DeleteClientController{

  async handle(req: Request, res: Response) {
    const { id } = req.body;

    const deleteClientService = new DeleteClientService();
    const client = await deleteClientService.execute(id);

    return res.json(client);
  }

}
export { DeleteClientController }