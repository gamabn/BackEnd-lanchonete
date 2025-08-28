"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditStoreController = void 0;
const EditStoreService_1 = require("../../service/user/EditStoreService");
class EditStoreController {
    async handle(req, res) {
        const { name, email, phone, city, neighborhood, street, number } = req.body;
        const user_id = req.user_id; // Obtido do middleware de autenticação
        console.log("neighborhood recebido:", neighborhood);
        console.log({ name, email, phone, city, neighborhood, street, number });
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
        return res.json(updatedStore);
    }
}
exports.EditStoreController = EditStoreController;
