"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthResetService = void 0;
// service/user/AuthResetService.ts
const database_1 = require("../../database");
const bcryptjs_1 = require("bcryptjs");
class AuthResetService {
    async execute({ token, password }) {
        if (!password)
            throw new Error("Senha é obrigatória");
        // Verifica se o token é válido e não expirou
        const tokenResult = await database_1.pool.query("SELECT * FROM password_tokens WHERE token = $1 AND expires_at > NOW()", [token]);
        const tokenData = tokenResult.rows[0];
        if (!tokenData)
            throw new Error("Token inválido ou expirado");
        // Faz hash da senha
        const hashedPassword = await (0, bcryptjs_1.hash)(password, 8);
        // Atualiza a senha do usuário
        await database_1.pool.query("UPDATE restaurants SET password = $1 WHERE email = $2", [hashedPassword, tokenData.email]);
        // Remove o token da tabela
        await database_1.pool.query("DELETE FROM password_tokens WHERE token = $1", [token]);
        return { message: "Senha redefinida com sucesso." };
    }
}
exports.AuthResetService = AuthResetService;
