"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthResetController = void 0;
const _AuthResetService_1 = require("../../service/user/ AuthResetService");
class AuthResetController {
    async handle(req, res) {
        try {
            const { token, password } = req.body;
            if (!token)
                return res.status(400).json({ error: 'Token ausente' });
            if (!password)
                return res.status(400).json({ error: 'Senha ausente' });
            const resetService = new _AuthResetService_1.AuthResetService();
            const result = await resetService.execute({ token, password });
            return res.json(result); // <<< retorna { message: "Senha redefinida com sucesso." }
        }
        catch (err) {
            return res.status(400).json({ error: err.message });
        }
    }
}
exports.AuthResetController = AuthResetController;
