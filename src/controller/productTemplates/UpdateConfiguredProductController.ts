import type { Request, Response } from "express";
import { ProductInputError } from "../../service/product/productValidation";
import { parseConfiguredProduct, productUuid } from "../../service/productTemplates/configuredProductInput";
import { UpdateConfiguredProductService } from "../../service/productTemplates/UpdateConfiguredProductService";

export class UpdateConfiguredProductController {
  async handle(req: Request, res: Response) {
    const restaurantId = req.user_id;
    if (!restaurantId) return res.status(401).json({ error: "Estabelecimento não autenticado." });

    const { productId } = req.params;
    if (typeof productId !== "string" || !productUuid.test(productId)) {
      return res.status(400).json({ error: "ID do produto inválido." });
    }

    try {
      const input = parseConfiguredProduct(req.body);
      const product = await new UpdateConfiguredProductService().execute(restaurantId, productId, input);
      return res.json({ product });
    } catch (error) {
      if (error instanceof ProductInputError) {
        return res.status(error.status).json({ error: error.message, details: error.details });
      }
      if ((error as { code?: string } | null)?.code === "23505") {
        return res.status(409).json({ error: "Já existe um item com esse nome na configuração." });
      }
      console.error("Erro ao atualizar configuração do produto:", error);
      return res.status(500).json({ error: "Não foi possível salvar a configuração do produto." });
    }
  }
}
