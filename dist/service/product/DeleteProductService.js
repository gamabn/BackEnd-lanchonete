"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteProductService = void 0;
const database_1 = require("../../database");
class DeleteProductService {
    async execute(product_id, restaurant_id) {
        const result = await database_1.pool.query('DELETE FROM products WHERE id = $1 AND restaurant_id = $2', [product_id, restaurant_id]);
        if (!result.rowCount)
            return undefined;
        return { message: 'Produto deletado com sucesso.' };
    }
}
exports.DeleteProductService = DeleteProductService;
