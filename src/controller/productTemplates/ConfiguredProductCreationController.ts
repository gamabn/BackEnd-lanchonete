import type { Request, Response } from "express";
import { ProductInputError } from "../../service/product/productValidation";
import { parseNewConfiguredProduct, parseStructureChange, productUuid } from "../../service/productTemplates/configuredProductInput";
import { CreateConfiguredProductService } from "../../service/productTemplates/CreateConfiguredProductService";
import { ChangeConfiguredProductStructureService } from "../../service/productTemplates/ChangeConfiguredProductStructureService";

export class ConfiguredProductCreationController {
  create = async (req: Request, res: Response) => this.perform(req, res, false);
  structure = async (req: Request, res: Response) => this.perform(req, res, true);

  private async perform(req: Request, res: Response, structure: boolean) {
    if (!req.user_id) return res.status(401).json({ error: "Estabelecimento não autenticado." });
    res.set("Cache-Control", "no-store");
    try {
      if (structure) {
        const { productId } = req.params;
        if (typeof productId !== "string" || !productUuid.test(productId)) throw new ProductInputError("ID do produto inválido.");
        const result = await new ChangeConfiguredProductStructureService().execute(req.user_id, productId, parseStructureChange(req.body));
        return res.json(result);
      }
      const result = await new CreateConfiguredProductService().execute(req.user_id, parseNewConfiguredProduct(req.body));
      return res.status(201).json(result);
    } catch (error) {
      if (error instanceof ProductInputError) return res.status(error.status).json({ error: error.message, details: error.details });
      const code = (error as { code?: string })?.code;
      if (code === '23505') return res.status(409).json({ error: "Já existe um item com esse nome na configuração." });
      if (code === '23503') return res.status(409).json({ error: "O item possui dependências e não pode ser removido." });
      return res.status(500).json({ error: "Não foi possível salvar o produto configurável." });
    }
  }
}
