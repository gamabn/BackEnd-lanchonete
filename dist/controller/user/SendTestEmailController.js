"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendTestEmailController = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
class SendTestEmailController {
    async handle(req, res) {
        const { to } = req.body;
        if (!to) {
            return res.status(400).json({ error: 'Destinatário não informado.' });
        }
        try {
            const transporter = nodemailer_1.default.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });
            const info = await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to,
                subject: 'Teste de envio de e-mail',
                html: `<h2>Funcionou!</h2><p>Este é um e-mail de teste enviado com Nodemailer.</p>`
            });
            return res.json({ message: 'E-mail enviado com sucesso.', info });
        }
        catch (err) {
            console.error(err);
            return res.status(500).json({ error: 'Erro ao enviar e-mail.' });
        }
    }
}
exports.SendTestEmailController = SendTestEmailController;
