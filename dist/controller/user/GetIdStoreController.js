"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetIdStoreController = void 0;
const GetIdStoreService_1 = require("../../service/user/GetIdStoreService");
class GetIdStoreController {
    async handle(req, res) {
        try {
            const id = req.params.id;
            if (!id) {
                return res.status(400).json({ error: 'ID é obrigatório' });
            }
            const getIdStore = new GetIdStoreService_1.GetIdStoreService();
            const store = await getIdStore.execute(id);
            if (!store) {
                return res.status(404).json({ error: 'Loja não encontrada' });
            }
            return res.json(store);
        }
        catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }
}
exports.GetIdStoreController = GetIdStoreController;
