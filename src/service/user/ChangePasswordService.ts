import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import { pool } from '../../database'; // sua conexão

interface ChangePasswordRequest {
  email: string;
}

class ChangePasswordService {

  async execute({ email }: ChangePasswordRequest ) {
    const user = await pool.query('SELECT * FROM restaurants WHERE email = $1', [email]);
    if (user.rows.length === 0) {
       throw new Error('Email incorreto')
    }

    const token = uuidv4();
    const expires = new Date(Date.now() + 3600 * 1000); // expira em 1h

    // Armazena token em uma tabela (ex: password_tokens)
    await pool.query(
      `INSERT INTO password_tokens (email, token, expires_at) 
       VALUES ($1, $2, $3)
       ON CONFLICT (email) 
       DO UPDATE SET 
         token = EXCLUDED.token, 
         expires_at = EXCLUDED.expires_at;`,
      [email, token, expires]
    );

    // Enviar e-mail com o link
    const transporter = nodemailer.createTransport({
      service: 'gmail', // ou outro (Mailtrap, SendGrid, etc.)
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`; // frontend

    await transporter.sendMail({
      to: email,
      subject: 'Redefinição de senha',
      html: `<p>Clique no link para redefinir sua senha:</p><a href="${resetLink}">${resetLink}</a>`
    });

    return email
  }
}  

export { ChangePasswordService }