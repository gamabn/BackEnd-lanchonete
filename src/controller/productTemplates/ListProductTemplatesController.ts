
import type { Request, Response } from "express";

import { ListProductTemplatesService } from "../../service/productTemplates/ListProductTemplatesService";

export class ListProductTemplatesController {
  async handle(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user_id) {
        res.status(401).json({
          error: "Estabelecimento não autenticado.",
        });
        return;
      }

      const service = new ListProductTemplatesService();

      const templates = await service.execute();

      res.status(200).json(templates);
    } catch (error) {
      console.error("Erro ao listar templates:", error);

      res.status(500).json({
        error: "Erro interno ao listar modelos de produtos.",
      });
    }
  }
}
