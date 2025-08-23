import type { Request, Response } from "express";
import { DetailStoreService } from "../../service/user/DetailStoreService";

class DetailStoreController {

  async handle(req: Request, res: Response) {

    // Agora o TypeScript reconhece `user_id` porque o tsconfig.json está correto.
    // Este ID é adicionado pelo middleware de autenticação.
    const user_id = req.user_id;
    
    const detailStoreService  =  new DetailStoreService();
    
    const user = await detailStoreService.execute(user_id);

    return res.json(user);
  }
}

export { DetailStoreController }