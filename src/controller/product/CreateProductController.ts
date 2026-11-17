import type { Request, Response } from "express";
import { CreateProductService } from "../../service/product/CreateProductService";
import { ProductInputError, validateProductFields, validateProductImage } from "../../service/product/productValidation";
import { handleFailedProductImageWrite, uploadProductImage } from "../../service/product/productImages";

class CreateProductController {
  async handle(req: Request, res: Response) {
    const restaurant_id = req.user_id;
    if (!restaurant_id) {
      return res.status(401).json({ error: "Estabelecimento não autenticado." });
    }

    let uploadedId: string | undefined;
    try {
      const fields = validateProductFields(req.body ?? {});
      if (!req.file) {
        throw new ProductInputError("A imagem do produto é obrigatória.");
      }
      validateProductImage(req.file);

      const image = await uploadProductImage(req.file.buffer);
      uploadedId = image.public_id;
      const product = await new CreateProductService().execute({
        ...fields,
        image_url: image.secure_url || image.url,
        public_id: image.public_id,
        restaurant_id,
      });
      uploadedId = undefined;

      return res.json(product);
    } catch (error) {
      if (uploadedId) {
        await handleFailedProductImageWrite(uploadedId, error);
      }
      if (error instanceof ProductInputError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Erro ao criar produto:", error);
      return res.status(500).json({ error: "Erro ao criar produto." });
    }
  }
}

export { CreateProductController };
