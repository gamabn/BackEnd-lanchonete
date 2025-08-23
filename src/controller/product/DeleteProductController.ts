
import { DeleteProductService } from "../../service/product/DeleteProductService";
import type { Request, Response } from "express";

class DeleteProductController{

  async handle(req: Request, res: Response) {
    const { product_id } = req.body;
    const restaurant_id = req.user_id;

    const deleteStoreService = new DeleteProductService();
    const product = await deleteStoreService.execute(product_id, restaurant_id);

    return res.json(product);
  }

}

export { DeleteProductController }