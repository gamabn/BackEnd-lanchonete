import  { GetProductIdService} from "../../service/product/GetProductIdService";
import type { Request, Response } from "express";

class GetProductIdController{

  async handle(req: Request, res: Response) {
   const id = req.params.id

    const getStoreProduct = new GetProductIdService();
    const products = await getStoreProduct.execute(id);

    return res.json(products);
  }

}
export { GetProductIdController }