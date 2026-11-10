"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateClientController = void 0;
const UpdateClientService_1 = require("../../service/clients/UpdateClientService");
const customerAccess_1 = require("../../security/customerAccess");
class UpdateClientController {
    async handle(req, res) {
        const actor = res.locals.customerPrincipal;
        let id;
        let input = req.body;
        if (actor.type === "restaurant") {
            if (!input || typeof input !== "object" || Array.isArray(input) || !("id" in input) || typeof input.id !== "string" || !input.id) {
                return res.status(400).json({ error: "Cliente obrigatório." });
            }
            const { id: target, ...details } = input;
            id = target;
            input = details;
        }
        else {
            id = actor.customerId;
        }
        const data = (0, customerAccess_1.readCustomerData)(input);
        if (!data)
            return res.status(400).json({ error: "Somente dados de contato e endereço podem ser atualizados." });
        const client = await new UpdateClientService_1.UpdateClientService().execute({ ...data, id, restaurant_id: actor.restaurantId });
        if (!client)
            return res.status(404).json({ error: "Cadastro não encontrado." });
        return res.json(client);
    }
}
exports.UpdateClientController = UpdateClientController;
