
import { ImageStorageService } from "../../service/user/ImageStoreService";
import type { Request, Response } from "express";
import { uploadToCloudinary } from "../../lib/cloudinaryUploader";

class ImageStoreController {

  async handle(req: Request, res: Response) {
    const restaurant_id = req.params.id;


    if (!req.file) {
      throw new Error("Imagem é obrigatória");
    }

    const resultFile = await uploadToCloudinary(req.file.buffer);

    const imageStorageService = new ImageStorageService();
    const updatedStore = await imageStorageService.execute(
      restaurant_id,
      resultFile.url
    );

    return res.json(updatedStore);
  }

}
export { ImageStoreController };