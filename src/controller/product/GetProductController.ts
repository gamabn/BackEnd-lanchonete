import type { Request, Response } from "express";
import { GetProductIdService } from "../../service/product/GetProductIdService";
import { GetProductService } from "../../service/product/GetProductService";

class GetProductController {
  async handle(req: Request, res: Response) {
    if (req.user_id) {
      try {
        const products = await new GetProductService().execute(req.user_id, req.query.configured === "true");
        return res.json(products);
      } catch (error) {
        console.error("Erro ao listar produtos:", error);
        return res.status(500).json({ error: "Erro ao listar produtos." });
      }
    }

    const restaurantId = req.query.restaurant_id;
    if (typeof restaurantId !== "string" || !restaurantId) {
      return res.status(400).json({ error: "Estabelecimento obrigatório." });
    }

    const products = await new GetProductIdService().execute(restaurantId);
    return res.json(products);
  }
}

export { GetProductController };
