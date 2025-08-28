"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteProductController = void 0;
const DeleteProductService_1 = require("../../service/product/DeleteProductService");
class DeleteProductController {
    async handle(req, res) {
        const { product_id } = req.body;
        const restaurant_id = req.user_id;
        const deleteStoreService = new DeleteProductService_1.DeleteProductService();
        const product = await deleteStoreService.execute(product_id, restaurant_id);
        return res.json(product);
    }
}
exports.DeleteProductController = DeleteProductController;
