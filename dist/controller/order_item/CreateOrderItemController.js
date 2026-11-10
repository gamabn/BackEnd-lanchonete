"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateOrderItemController = void 0;
class CreateOrderItemController {
    async handle(_req, res) {
        return res.status(409).json({ error: "Envie os itens junto ao pedido em POST /order/:id. Itens não podem ser adicionados separadamente." });
    }
}
exports.CreateOrderItemController = CreateOrderItemController;
