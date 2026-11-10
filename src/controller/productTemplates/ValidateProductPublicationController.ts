import type { Request, Response } from "express";

import { ValidateProductPublicationService } from "../../service/productTemplates/ValidateProductPublicationService";

export class ValidateProductPublicationController {
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

      const service = new ValidateProductPublicationService();

      const result = await service.execute({
        restaurantId,
        productId,
      });

      if (
        !result.product &&
        result.errors.includes("Produto não encontrado.")
      ) {
        res.status(404).json(result);
        return;
      }

      res.status(200).json(result);
    } catch (error) {
      console.error("Erro ao validar publicação:", error);

      res.status(500).json({
        error: "Erro interno ao validar publicação.",
      });
    }
  }
}
