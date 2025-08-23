
import { EditStoreService } from "../../service/user/EditStoreService";
import type { Request, Response } from "express";
class EditStoreController {

  async handle(req: Request, res: Response) {
    const { name, email, phone, city,  neighborhood, street, number } = req.body;
    const user_id = req.user_id; // Obtido do middleware de autenticação

    console.log("neighborhood recebido:", neighborhood);
     console.log({name, email, phone, city, neighborhood, street, number});
    const editStoreService = new EditStoreService();

    const updatedStore = await editStoreService.execute({
      id: user_id,
      name,
      email,
      phone,
      city,
      neighborhood,
      street,
      number,
    });

    return res.json(updatedStore);
  }

}
export { EditStoreController }