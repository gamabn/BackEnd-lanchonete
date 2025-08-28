"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthStoreService = void 0;
const jsonwebtoken_1 = require("jsonwebtoken");
const database_1 = require("../../database");
const bcryptjs_1 = require("bcryptjs");
class AuthStoreService {
    async execute({ email, password }) {
        if (!email || !password) {
            throw new Error('Digie email e senha!');
        }
        const result = await database_1.pool.query('SELECT * FROM restaurants WHERE email = $1', [email]);
        const user = result.rows[0];
        if (!user) {
            throw new Error('Email incorreto');
        }
        const passwordHash = await (0, bcryptjs_1.compare)(password, user.password);
        if (!passwordHash) {
            throw new Error('Senha incorreta incorreto');
        }
        const token = (0, jsonwebtoken_1.sign)({
            name: user.name,
            email: user.email,
        }, process.env.JWT_SECRET, {
            subject: user.id,
            expiresIn: '30d'
        });
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            token: token
        };
    }
}
exports.AuthStoreService = AuthStoreService;
