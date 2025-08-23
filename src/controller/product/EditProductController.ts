import type { Request, Response } from "express";
import { EditProductService } from "../../service/product/EditProductService";
import { updateCloudinaryImage } from "../../lib/cloudinaryUploader";
import fs from "fs";

class EditProductController {
  async handle(req: Request, res: Response) {
    try {
      const { product_id, name, description, restaurant_id, old_public_id } = req.body;

      // Converte preço
      const price = req.body.price !== undefined ? Number(req.body.price) : undefined;

      // Validação de campos obrigatórios (price === undefined, não !price)
      if (!product_id || !name || !description || price === undefined || !restaurant_id) {
        return res.status(400).json({ error: "Campos obrigatórios faltando." });
      }

      if (isNaN(price)) {
        return res.status(400).json({ error: "Preço inválido." });
      }

      let updatedImage;

      // Caso o usuário envie um novo arquivo
      if (req.file) {
        let fileBuffer: Buffer;

        if (req.file.buffer) {
          // memoryStorage
          fileBuffer = req.file.buffer;
        } else if (req.file.path) {
          // diskStorage
          fileBuffer = fs.readFileSync(req.file.path);
        } else {
          return res.status(400).json({ error: "Arquivo inválido." });
        }

        updatedImage = await updateCloudinaryImage(
          old_public_id, // public_id antigo vindo do formulário
          fileBuffer,
          { folder: "produtos" }
        );
      }

      const editProductService = new EditProductService();
      const updatedProduct = await editProductService.execute({
        product_id,
        name,
        description,
        price,
        image_url: updatedImage?.url, // undefined se não houver novo arquivo
        public_id: updatedImage?.public_id,
        restaurant_id,
      });

      return res.status(200).json(updatedProduct);
    } catch (error) {
      return res.status(500).json({
        error: "Erro ao editar produto",
        details: (error as Error).message,
      });
    }
  }
}

export { EditProductController };
