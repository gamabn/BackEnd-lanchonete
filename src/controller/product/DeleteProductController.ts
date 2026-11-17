import { DeleteProductService } from "../../service/product/DeleteProductService";
import { ProductInputError } from "../../service/product/productValidation";
import type { Request, Response } from "express";

class DeleteProductController {
  handle = async (req: Request, res: Response) => {
    return this.perform(req, res, false);
  }

  deactivate = async (req: Request, res: Response) => {
    return this.perform(req, res, true);
  }

  private async perform(req: Request, res: Response, deactivate: boolean) {
    if (!req.user_id) return res.status(401).json({ error: "Estabelecimento não autenticado." });
    const productId = deactivate ? req.params.productId : req.body?.product_id;
    if (typeof productId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) {
      return res.status(400).json({ error: "ID do produto inválido." });
    }
    res.set("Cache-Control", "no-store");
    try {
      const service = new DeleteProductService();
      const result = deactivate
        ? await service.deactivate(productId, req.user_id)
        : await service.execute(productId, req.user_id);
      if (!result) return res.status(404).json({ error: "Produto não encontrado." });
      return res.json(result);
    } catch (error) {
      if (error instanceof ProductInputError) return res.status(error.status).json({ error: error.message });
      if ((error as { code?: string })?.code === "23503") return res.status(409).json({ error: "Produto possui dependências e não pode ser excluído. Desative o produto." });
      return res.status(500).json({ error: "Não foi possível concluir a operação de produto." });
    }
  }
}
export { DeleteProductController };
