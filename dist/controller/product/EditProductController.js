"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditProductController = void 0;
const EditProductService_1 = require("../../service/product/EditProductService");
const cloudinaryUploader_1 = require("../../lib/cloudinaryUploader");
const fs_1 = __importDefault(require("fs"));
class EditProductController {
    async handle(req, res) {
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
                let fileBuffer;
                if (req.file.buffer) {
                    // memoryStorage
                    fileBuffer = req.file.buffer;
                }
                else if (req.file.path) {
                    // diskStorage
                    fileBuffer = fs_1.default.readFileSync(req.file.path);
                }
                else {
                    return res.status(400).json({ error: "Arquivo inválido." });
                }
                updatedImage = await (0, cloudinaryUploader_1.updateCloudinaryImage)(old_public_id, // public_id antigo vindo do formulário
                fileBuffer, { folder: "produtos" });
            }
            const editProductService = new EditProductService_1.EditProductService();
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
        }
        catch (error) {
            return res.status(500).json({
                error: "Erro ao editar produto",
                details: error.message,
            });
        }
    }
}
exports.EditProductController = EditProductController;
