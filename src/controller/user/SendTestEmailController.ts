import type { Request, Response } from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

class SendTestEmailController {
  async handle(req: Request, res: Response) {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: 'Destinatário não informado.' });
    }

    try {
      const transporter = nodemailer.createTransport({
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
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Erro ao enviar e-mail.' });
    }
  }
}

export { SendTestEmailController };
