"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetProductController = void 0;
const GetProductIdService_1 = require("../../service/product/GetProductIdService");
const GetProductService_1 = require("../../service/product/GetProductService");
class GetProductController {
    async handle(req, res) {
        const restaurant_id = req.user_id || req.query.restaurant_id;
        if (typeof restaurant_id !== "string" || !restaurant_id)
            return res.status(400).json({ error: "Estabelecimento obrigatório." });
        const getStoreProduct = new GetProductService_1.GetProductService();
        const products = req.user_id
            ? await getStoreProduct.execute(restaurant_id)
            : await new GetProductIdService_1.GetProductIdService().execute(restaurant_id);
        return res.json(products);
    }
}
exports.GetProductController = GetProductController;
