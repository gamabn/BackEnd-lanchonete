"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetClientController = void 0;
const GetClientService_1 = require("../../service/clients/GetClientService");
class GetClientController {
    async handle(req, res) {
        const actor = res.locals.customerPrincipal;
        const phone = req.query.phone;
        if ((phone !== undefined && typeof phone !== "string") || (actor.type === "restaurant" && !phone)) {
            return res.status(400).json({ error: "Telefone válido obrigatório na consulta administrativa." });
        }
        const clients = await new GetClientService_1.GetClientService().execute({
            restaurant_id: actor.restaurantId, phone,
            customer_id: actor.type === "customer" ? actor.customerId : undefined,
        });
        if (actor.type === "customer" && !clients.length)
            return res.status(404).json({ error: "Cadastro não encontrado." });
        return res.json(clients);
    }
}
exports.GetClientController = GetClientController;
