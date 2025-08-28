"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetProductController = void 0;
const GetProductService_1 = require("../../service/product/GetProductService");
class GetProductController {
    async handle(req, res) {
        const restaurant_id = req.user_id;
        const getStoreProduct = new GetProductService_1.GetProductService();
        const products = await getStoreProduct.execute(restaurant_id);
        return res.json(products);
    }
}
exports.GetProductController = GetProductController;
