import type { Request, Response } from "express";

import { PublishProductService } from "../../service/productTemplates/PublishProductService";

export class PublishProductController {
  async handle(req: Request, res: Response): Promise<void> {
    try {
      const restaurantId = req.user_id;
      const { productId } = req.params;

      if (!restaurantId) {
        res.status(401).json({
          error: "Estabelecimento não autenticado.",
        });
        return;
      }

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (typeof productId !== "string" || !uuidRegex.test(productId)) {
        res.status(400).json({
          error: "ID do produto inválido.",
        });
        return;
      }

      const service = new PublishProductService();

      const result = await service.execute({
        restaurantId,
        productId,
      });

      res.status(result.status).json(result.data);
    } catch (error) {
      console.error("Erro ao publicar produto:", error);

      res.status(500).json({
        error: "Erro interno ao publicar produto.",
      });
    }
  }
}
