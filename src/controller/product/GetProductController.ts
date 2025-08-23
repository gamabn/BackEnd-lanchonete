
import { GetProductService } from "../../service/product/GetProductService";
import type { Request, Response } from "express";

class GetProductController{

  async handle(req: Request, res: Response) {
    const restaurant_id = req.user_id;

    const getStoreProduct = new GetProductService();
    const products = await getStoreProduct.execute(restaurant_id);

    return res.json(products);
  }

}
export { GetProductController }