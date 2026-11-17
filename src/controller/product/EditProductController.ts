import type { Request, Response } from "express";
import { EditProductService } from "../../service/product/EditProductService";
import { ProductInputError, validateProductFields, validateProductImage } from "../../service/product/productValidation";
import {
  handleFailedProductImageWrite,
  removeUnreferencedProductImage,
  uploadProductImage,
} from "../../service/product/productImages";

class EditProductController {
  async handle(req: Request, res: Response) {
    const restaurant_id = req.user_id;
    if (!restaurant_id) {
      return res.status(401).json({ error: "Estabelecimento não autenticado." });
    }

    let uploadedId: string | undefined;
    try {
      const body = req.body ?? {};
      const { product_id } = body;
      if (typeof product_id !== "string" || !product_id.trim() || product_id.includes("\0")) {
        throw new ProductInputError("ID do produto inválido.");
      }
      const imageOnly = body.imageOnly === "true";
      const fields = imageOnly ? {} : validateProductFields(body);
      const service = new EditProductService();
      const current = await service.findOwned(product_id, restaurant_id);
      if (!current) {
        return res.status(404).json({ error: "Produto não encontrado." });
      }

      if (imageOnly && (!current.has_variants || !req.file)) {
        throw new ProductInputError("Selecione uma imagem para um produto configurável.");
      }
      if (req.file) {
        validateProductImage(req.file);
      }
      const image = req.file ? await uploadProductImage(req.file.buffer) : undefined;
      uploadedId = image?.public_id;
      const product = await service.execute({
        ...fields,
        product_id,
        restaurant_id,
        image_url: image && (image.secure_url || image.url),
        public_id: image?.public_id,
        expectedPublicId: image ? current.public_id : undefined,
      });

      if (!product) {
        if (uploadedId) {
          await removeUnreferencedProductImage(uploadedId);
          uploadedId = undefined;
          const stillOwned = await service.findOwned(product_id, restaurant_id);
          if (stillOwned) {
            return res.status(409).json({ error: "A imagem foi alterada em outra edição. Recarregue o produto." });
          }
        }
        return res.status(404).json({ error: "Produto não encontrado." });
      }

      uploadedId = undefined;
      if (image && current.public_id) {
        await removeUnreferencedProductImage(current.public_id);
      }
      return res.json(product);
    } catch (error) {
      if (uploadedId) {
        await handleFailedProductImageWrite(uploadedId, error);
      }
      if (error instanceof ProductInputError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Erro ao editar produto:", error);
      return res.status(500).json({ error: "Erro ao editar produto." });
    }
  }
}

export { EditProductController };
