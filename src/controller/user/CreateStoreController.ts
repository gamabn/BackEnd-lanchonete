import type { Request, Response } from "express";
import { uploadToCloudinary } from "../../lib/cloudinaryUploader";
import { ImageStorageService } from "../../service/user/ImageStoreService";
import { CreateStoreService } from "../../service/user/CreateStoreService";
import { pool } from "../../database";

class CreateUserController {
  async handle(req: Request, res: Response) {
    const { name, email, password, phone, city, neighborhood, street, number } =
      req.body;

    const createStore = new CreateStoreService();

    const store = await createStore.execute({
      name,
      email,
      password,
      phone,
      city,
      neighborhood,
      street,
      number,
    });

    let result = store;

    if (req.file) {
      const image = await uploadToCloudinary(req.file.buffer);

      const updated = await new ImageStorageService().execute(
        store.id,
        image.url,
      );
      return res.json(updated);
    }

    return res.json(result);
  }
}

export { CreateUserController };
