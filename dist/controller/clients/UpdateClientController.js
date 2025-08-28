"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateClientController = void 0;
const UpdateClientService_1 = require("../../service/clients/UpdateClientService");
class UpdateClientController {
    async handle(req, res) {
        const { id, name, phone, city, street, number, neighborhood, complement } = req.body;
        const updateClientService = new UpdateClientService_1.UpdateClientService();
        const client = await updateClientService.execute({ id, name, phone, city, street, number, neighborhood, complement });
        return res.json(client);
    }
}
exports.UpdateClientController = UpdateClientController;
