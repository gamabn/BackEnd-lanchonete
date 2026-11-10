"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteClientController = void 0;
const DeleteClientService_1 = require("../../service/clients/DeleteClientService");
class DeleteClientController {
    async handle(req, res) {
        const { id } = req.body;
        const deleteClientService = new DeleteClientService_1.DeleteClientService();
        const client = await deleteClientService.execute(id, req.user_id);
        if (!client)
            return res.status(404).json({ error: "Cliente não encontrado." });
        return res.json(client);
    }
}
exports.DeleteClientController = DeleteClientController;
