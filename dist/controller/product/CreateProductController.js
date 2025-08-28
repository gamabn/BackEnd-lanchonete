"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateProductController = void 0;
const CreateProductService_1 = require("../../service/product/CreateProductService");
const cloudinaryUploader_1 = require("../../lib/cloudinaryUploader");
class CreateProductController {
    async handle(req, res) {
        const { name, description, price } = req.body;
        const restaurant_id = req.user_id;
        const createProductService = new CreateProductService_1.CreateProductService();
        if (!req.file) {
            throw new Error("Erro no upload do arquivo");
        }
        const uploadResult = await (0, cloudinaryUploader_1.uploadToCloudinary)(req.file.buffer, { folder: "produtos" });
        const product = await createProductService.execute({
            name,
            description,
            price,
            image_url: uploadResult.url,
            public_id: uploadResult.public_id,
            restaurant_id,
        });
        return res.json(product);
    }
}
exports.CreateProductController = CreateProductController;
