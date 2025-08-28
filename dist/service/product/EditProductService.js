"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditProductService = void 0;
const database_1 = require("../../database");
class EditProductService {
    async execute({ product_id, name, description, price, image_url, public_id, restaurant_id, }) {
        // 1. Busca o produto existente
        const currentProductResult = await database_1.pool.query("SELECT * FROM products WHERE id = $1 AND restaurant_id = $2", [product_id, restaurant_id]);
        if (currentProductResult.rows.length === 0) {
            throw new Error("Produto não encontrado ou não pertence ao restaurante.");
        }
        const currentProduct = currentProductResult.rows[0];
        // 2. Atualiza apenas campos informados
        const updatedName = name ?? currentProduct.name;
        const updatedDescription = description ?? currentProduct.description;
        const updatedPrice = price ?? currentProduct.price;
        const updatedImageUrl = image_url ?? currentProduct.image_url;
        const updatedPublicId = public_id ?? currentProduct.public_id;
        // 3. Executa UPDATE
        const product = await database_1.pool.query(`UPDATE products 
       SET name = $1, description = $2, price = $3, image_url = $4, public_id = $5 
       WHERE id = $6 AND restaurant_id = $7 
       RETURNING *`, [
            updatedName,
            updatedDescription,
            updatedPrice,
            updatedImageUrl,
            updatedPublicId,
            product_id,
            restaurant_id,
        ]);
        return product.rows[0];
    }
}
exports.EditProductService = EditProductService;
