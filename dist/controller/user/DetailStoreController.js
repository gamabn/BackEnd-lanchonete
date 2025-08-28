"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DetailStoreController = void 0;
const DetailStoreService_1 = require("../../service/user/DetailStoreService");
class DetailStoreController {
    async handle(req, res) {
        // Agora o TypeScript reconhece `user_id` porque o tsconfig.json está correto.
        // Este ID é adicionado pelo middleware de autenticação.
        const user_id = req.user_id;
        const detailStoreService = new DetailStoreService_1.DetailStoreService();
        const user = await detailStoreService.execute(user_id);
        return res.json(user);
    }
}
exports.DetailStoreController = DetailStoreController;
