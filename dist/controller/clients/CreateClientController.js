"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateClientController = void 0;
const CreateClientService_1 = require("../../service/clients/CreateClientService");
class CreateClientController {
    async handle(req, res) {
        const { name, city, phone, street, number, neighborhood, complement } = req.body;
        const restaurant_id = req.params.id;
        const clients = new CreateClientService_1.CreateClientService();
        const client = await clients.execute({ name, phone, city, street, number, neighborhood, complement, restaurant_id });
        return res.json(client);
    }
}
exports.CreateClientController = CreateClientController;
