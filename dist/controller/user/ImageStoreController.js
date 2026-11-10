"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageStoreController = void 0;
const ImageStoreService_1 = require("../../service/user/ImageStoreService");
const cloudinaryUploader_1 = require("../../lib/cloudinaryUploader");
class ImageStoreController {
    async handle(req, res) {
        const restaurant_id = req.user_id;
        if (req.params.id !== restaurant_id)
            return res.status(403).json({ error: "Estabelecimento não autorizado." });
        if (!req.file) {
            throw new Error("Imagem é obrigatória");
        }
        const imageStorageService = new ImageStoreService_1.ImageStorageService();
        if (!await imageStorageService.exists(restaurant_id))
            return res.status(404).json({ error: "Estabelecimento não encontrado." });
        const resultFile = await (0, cloudinaryUploader_1.uploadToCloudinary)(req.file.buffer);
        const updatedStore = await imageStorageService.execute(restaurant_id, resultFile.url);
        return res.json(updatedStore);
    }
}
exports.ImageStoreController = ImageStoreController;
