import { ProductInputError, normalizeProductCategory } from "../../service/product/productValidation";
import type { Request, Response } from "express";

import {
  CreateProductFromTemplateService,
  ProductTemplateError,
} from "../../service/productTemplates/CreateProductFromTemplateService";

export class CreateProductFromTemplateController {
  async handle(req: Request, res: Response): Promise<void> {
    try {
      const restaurantId = req.user_id;
      const { templateSlug } = req.body ?? {};

      if (!restaurantId) {
        res.status(401).json({
          error: "Estabelecimento não autenticado.",
        });
        return;
      }

      if (typeof templateSlug !== "string" || !templateSlug.trim()) {
        res.status(400).json({
          error: "Informe um modelo válido.",
        });
        return;
      }

      const service = new CreateProductFromTemplateService();

      const result = await service.execute({
        restaurantId,
        templateSlug: templateSlug.trim(),
        category: normalizeProductCategory(req.body?.category),
      });

      res.status(201).json(result);
    } catch (error) {
      if (error instanceof ProductInputError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof ProductTemplateError) {
        res.status(error.statusCode).json({
          error: error.message,
        });
        return;
      }

      console.error("Erro ao criar produto pelo modelo:", error);

      res.status(500).json({
        error: "Erro interno ao criar produto pelo modelo.",
      });
    }
  }
}
