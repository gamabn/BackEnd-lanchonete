import type { Request, Response } from "express";
import { GetAdminProductConfigurationService } from "../../service/productTemplates/GetAdminProductConfigurationService";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GetAdminProductConfigurationController {
  async handle(req: Request, res: Response) {
    const restaurantId = req.user_id;
    const { productId } = req.params;

    if (!restaurantId) {
      return res.status(401).json({ error: "Estabelecimento não autenticado." });
    }
    if (typeof productId !== "string" || !uuidPattern.test(productId)) {
      return res.status(400).json({ error: "ID do produto inválido." });
    }

    try {
      const configuration = await new GetAdminProductConfigurationService().execute({ productId, restaurantId });
      if (!configuration) {
        return res.status(404).json({ error: "Produto não encontrado." });
      }
      return res.json(configuration);
    } catch (error) {
      console.error("Erro ao consultar configuração administrativa:", error);
      return res.status(500).json({ error: "Não foi possível carregar a configuração do produto." });
    }
  }
}
