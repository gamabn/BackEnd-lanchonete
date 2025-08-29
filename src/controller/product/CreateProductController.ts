import type { Request, Response } from "express";
import { CreateProductService } from "../../service/product/CreateProductService";
import { uploadToCloudinary } from "../../lib/cloudinaryUploader";


class CreateProductController{

  async handle(req: Request, res: Response) {
    const { name, description, price} = req.body;
    const restaurant_id = req.user_id;

    const createProductService = new CreateProductService();

    if (!req.file) {
      throw new Error("Erro no upload do arquivo");
    }
try{
 const uploadResult = await uploadToCloudinary(req.file.buffer, { folder: "produtos" });

    const product = await createProductService.execute({
      name,
      description,
      price,
      image_url: uploadResult.url,
      public_id: uploadResult.public_id,
      restaurant_id,
    });

    return res.json(product)
    }catch(err){
      console.error("Erro ao criar produto:", err);
      return res.status(500).json({ error: "Erro ao criar produto" });
    }
   
  }

}
export { CreateProductController }