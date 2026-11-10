"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditStoreController = void 0;
const EditStoreService_1 = require("../../service/user/EditStoreService");
class EditStoreController {
    async handle(req, res) {
        const { name, email, phone, city, neighborhood, street, number } = req.body;
        const user_id = req.user_id; // Obtido do middleware de autenticação
        const editStoreService = new EditStoreService_1.EditStoreService();
        const updatedStore = await editStoreService.execute({
            id: user_id,
            name,
            email,
            phone,
            city,
            neighborhood,
            street,
            number,
        });
        if (!updatedStore)
            return res.status(404).json({ error: "Estabelecimento não encontrado." });
        return res.json(updatedStore);
    }
}
exports.EditStoreController = EditStoreController;
