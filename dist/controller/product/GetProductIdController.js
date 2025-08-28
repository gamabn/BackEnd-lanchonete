"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetProductIdController = void 0;
const GetProductIdService_1 = require("../../service/product/GetProductIdService");
class GetProductIdController {
    async handle(req, res) {
        const id = req.params.id;
        const getStoreProduct = new GetProductIdService_1.GetProductIdService();
        const products = await getStoreProduct.execute(id);
        return res.json(products);
    }
}
exports.GetProductIdController = GetProductIdController;
