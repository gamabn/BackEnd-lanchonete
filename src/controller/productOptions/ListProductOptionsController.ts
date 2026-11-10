import type { Request, Response } from "express";
import { ListProductOptionsService } from "../../service/productOptions/ListProductOptionsService";

export class ListProductOptionsController {
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

      if (
        typeof productId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          productId,
        )
      ) {
        res.status(400).json({
          error: "ID do produto inválido.",
        });
        return;
      }

      const service = new ListProductOptionsService();

      const groups = await service.execute({
        restaurantId,
        productId,
      });

      res.status(200).json(groups);
    } catch (error) {
      console.error("Erro ao listar ingredientes:", error);

      res.status(500).json({
        error: "Erro interno ao listar ingredientes.",
      });
    }
  }
}
