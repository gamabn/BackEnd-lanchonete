import type { Request, Response } from "express";

import { GetPublicProductConfigurationService } from "../../service/productTemplates/GetPublicProductConfigurationService";

export class GetPublicProductConfigurationController {
  async handle(req: Request, res: Response): Promise<void> {
    try {
      const { productId } = req.params;

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      if (typeof productId !== "string" || !uuidRegex.test(productId)) {
        res.status(400).json({
          error: "ID do produto inválido.",
        });
        return;
      }

      const service = new GetPublicProductConfigurationService();

      const configuration = await service.execute({
        productId,
      });

      if (!configuration) {
        res.status(404).json({
          error: "Produto não encontrado ou indisponível.",
        });
        return;
      }

      res.status(200).json(configuration);
    } catch (error) {
      console.error("Erro ao consultar configuração pública:", error);

      res.status(500).json({
        error: "Erro interno ao consultar configuração do produto.",
      });
    }
  }
}
