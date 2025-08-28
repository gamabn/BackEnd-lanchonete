"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChangePasswordService = void 0;
const uuid_1 = require("uuid");
const nodemailer_1 = __importDefault(require("nodemailer"));
const database_1 = require("../../database"); // sua conexão
class ChangePasswordService {
    async execute({ email }) {
        const user = await database_1.pool.query('SELECT * FROM restaurants WHERE email = $1', [email]);
        if (user.rows.length === 0) {
            throw new Error('Email incorreto');
        }
        const token = (0, uuid_1.v4)();
        const expires = new Date(Date.now() + 3600 * 1000); // expira em 1h
        // Armazena token em uma tabela (ex: password_tokens)
        await database_1.pool.query(`INSERT INTO password_tokens (email, token, expires_at) 
       VALUES ($1, $2, $3)
       ON CONFLICT (email) 
       DO UPDATE SET 
         token = EXCLUDED.token, 
         expires_at = EXCLUDED.expires_at;`, [email, token, expires]);
        // Enviar e-mail com o link
        const transporter = nodemailer_1.default.createTransport({
            service: 'gmail', // ou outro (Mailtrap, SendGrid, etc.)
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        // const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`; // frontend
        //const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
        //const resetLink = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
        const resetLink = `http://localhost:3000/reset-password?token=${token}`;
        await transporter.sendMail({
            from: process.env.EMAIL_USER, // importante definir o remetente
            to: email,
            subject: 'Redefinição de senha',
            html: `<p>Clique no link para redefinir sua senha:</p><a href="${resetLink}">${resetLink}</a>`
        }).then(info => {
            console.log("E-mail enviado:", info.response);
        }).catch(err => {
            console.error("Erro ao enviar e-mail:", err);
        });
        return email;
    }
}
exports.ChangePasswordService = ChangePasswordService;
