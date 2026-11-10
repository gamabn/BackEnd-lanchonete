"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditProductController = void 0;
const EditProductService_1 = require("../../service/product/EditProductService");
const cloudinaryUploader_1 = require("../../lib/cloudinaryUploader");
class EditProductController {
    async handle(req, res) {
        try {
            const { product_id, name, description } = req.body;
            const restaurant_id = req.user_id;
            const price = Number(req.body.price);
            if (typeof product_id !== "string" || !product_id || !name || !description ||
                req.body.price === undefined || !Number.isFinite(price) || price <= 0) {
                return res.status(400).json({ error: "Dados do produto inválidos." });
            }
            const service = new EditProductService_1.EditProductService();
            const current = await service.findOwned(product_id, restaurant_id);
            if (!current)
                return res.status(404).json({ error: "Produto não encontrado." });
            // Both ownership and the old image ID come from the database, before external side effects.
            const image = req.file
                ? await (0, cloudinaryUploader_1.updateCloudinaryImage)(current.public_id || "", req.file.buffer, { folder: "produtos" })
                : undefined;
            const product = await service.execute({
                product_id, restaurant_id, name, description, price,
                image_url: image?.url, public_id: image?.public_id,
            });
            if (!product)
                return res.status(404).json({ error: "Produto não encontrado." });
            return res.json(product);
        }
        catch {
            return res.status(500).json({ error: "Erro ao editar produto." });
        }
    }
}
exports.EditProductController = EditProductController;
