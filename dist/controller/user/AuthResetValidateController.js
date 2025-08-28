"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthResetValidateController = void 0;
const database_1 = require("../../database");
class AuthResetValidateController {
    async handle(req, res) {
        try {
            const { token } = req.query;
            if (!token)
                return res.status(400).json({ error: "Token ausente" });
            const tokenResult = await database_1.pool.query("SELECT * FROM password_tokens WHERE token = $1 AND expires_at > NOW()", [token]);
            const tokenData = tokenResult.rows[0];
            if (!tokenData)
                return res.status(400).json({ error: "Token inválido ou expirado" });
            return res.json({ email: tokenData.email });
        }
        catch (err) {
            return res.status(400).json({ error: err.message });
        }
    }
}
exports.AuthResetValidateController = AuthResetValidateController;
