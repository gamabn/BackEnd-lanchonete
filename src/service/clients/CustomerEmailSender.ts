import nodemailer from "nodemailer";

export async function sendCustomerEmailCode(email: string, code: string): Promise<void> {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error("Customer email sender unavailable");

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
      logger: false,
      debug: false,
    });
    const result = await transporter.sendMail({
      from: { name: "Gama Delivery", address: user },
      to: email,
      subject: "Confirme seu e-mail — Gama Delivery",
      text: `Seu código de verificação é ${code}. Ele expira em 5 minutos. Se você não solicitou, ignore esta mensagem.`,
    });
    if (!result.accepted?.includes(email) || result.rejected?.length) {
      throw new Error("Customer email delivery failed");
    }
  } catch {
    throw new Error("Customer email delivery failed");
  }
}
