"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateClientController = void 0;
const CreateClientService_1 = require("../../service/clients/CreateClientService");
const customerAccess_1 = require("../../security/customerAccess");
class CreateClientController {
    async handle(req, res) {
        res.set("Cache-Control", "no-store");
        const data = (0, customerAccess_1.readCustomerData)(req.body);
        if (!data)
            return res.status(400).json({ error: "Dados do cliente inválidos." });
        try {
            const client = await new CreateClientService_1.CreateClientService().execute({ ...data, restaurant_id: req.params.id });
            if (!client)
                return res.status(404).json({ error: "Estabelecimento não encontrado." });
            // Never upsert or issue a credential for a record found by phone.
            return res.status(201).json({ ...client, customer_credential: (0, customerAccess_1.issueCustomerCredential)(client) });
        }
        catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === "23505") {
                return res.status(409).json({ error: "Não foi possível criar um novo cadastro. Recuperação verificada pode ser necessária." });
            }
            return res.status(503).json({ error: "Não foi possível cadastrar o cliente." });
        }
    }
}
exports.CreateClientController = CreateClientController;
