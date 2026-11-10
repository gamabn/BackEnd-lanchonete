"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EditStatusController = void 0;
const _EditStatusService_1 = require("../../service/user/ EditStatusService");
const server_1 = require("../../server");
class EditStatusController {
    async handle(req, res) {
        const { status } = req.body;
        const user_id = req.user_id;
        if (typeof status !== "boolean")
            return res.status(400).json({ error: "Status inválido." });
        const editStatusService = new _EditStatusService_1.EditStatusService();
        const updatedStore = await editStatusService.execute({
            id: user_id,
            status,
        });
        if (!updatedStore)
            return res.status(404).json({ error: "Estabelecimento não encontrado." });
        // 🔥 Emite o evento de status atualizado
        console.log("Emitindo statusUpdated:", updatedStore);
        server_1.io.emit("statusUpdated", {
            id: updatedStore.id,
            status: updatedStore.status,
        });
        return res.json(updatedStore);
    }
}
exports.EditStatusController = EditStatusController;
