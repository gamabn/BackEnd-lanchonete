
import { GetProductIdService } from "../../service/product/GetProductIdService";
import { GetProductService } from "../../service/product/GetProductService";
import type { Request, Response } from "express";

class GetProductController{

  async handle(req: Request, res: Response) {
    const restaurant_id = req.user_id || req.query.restaurant_id;
    if (typeof restaurant_id !== "string" || !restaurant_id) return res.status(400).json({ error: "Estabelecimento obrigatório." });

    const getStoreProduct = new GetProductService();
    const products = req.user_id
      ? await getStoreProduct.execute(restaurant_id)
      : await new GetProductIdService().execute(restaurant_id);

    return res.json(products);
  }

}
export { GetProductController }