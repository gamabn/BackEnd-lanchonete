"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetClientController = void 0;
const GetClientService_1 = require("../../service/clients/GetClientService");
class GetClientController {
    async handle(req, res) {
        const restaurant_id = req.params.id;
        const phone = req.query.phone; // <- pegar do query param
        console.log("restaurant_id:", restaurant_id, "phone:", phone);
        if (!phone) {
            return res.status(400).json({ error: "Telefone não fornecido" });
        }
        const getClientService = new GetClientService_1.GetClientService();
        const clients = await getClientService.execute({ restaurant_id, phone });
        return res.json(clients);
    }
}
exports.GetClientController = GetClientController;
