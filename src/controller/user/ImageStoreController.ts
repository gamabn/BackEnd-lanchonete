
import { ImageStorageService } from "../../service/user/ImageStoreService";
import type { Request, Response } from "express";
import { uploadToCloudinary } from "../../lib/cloudinaryUploader";

class ImageStoreController {

  async handle(req: Request, res: Response) {
    const restaurant_id = req.user_id;
    if (req.params.id !== restaurant_id) return res.status(403).json({ error: "Estabelecimento não autorizado." });


    if (!req.file) {
      throw new Error("Imagem é obrigatória");
    }

    const imageStorageService = new ImageStorageService();
    if (!await imageStorageService.exists(restaurant_id)) return res.status(404).json({ error: "Estabelecimento não encontrado." });
    const resultFile = await uploadToCloudinary(req.file.buffer);

    const updatedStore = await imageStorageService.execute(
      restaurant_id,
      resultFile.url
    );

    return res.json(updatedStore);
  }

}
export { ImageStoreController };