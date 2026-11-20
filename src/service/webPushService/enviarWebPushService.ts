import { pool } from "../../database";
import webpush from "web-push";

interface EnviarWebPushData {
  lanchonete_id: string;
  titulo: string;
  mensagem: string;
  url?: string;
}

class EnviarWebPushService {
  async handle({
    lanchonete_id,
    titulo,
    mensagem,
    url = "/dashboard",
  }: EnviarWebPushData) {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    if (!publicKey || !privateKey || !subject) {
      throw new Error("Variáveis VAPID não configuradas.");
    }

    const vapidSubject = subject.startsWith("mailto:")
      ? subject
      : `mailto:${subject}`;

    webpush.setVapidDetails(vapidSubject, publicKey, privateKey);

    const resultado = await pool.query(
      `SELECT id, endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE lanchonete_id = $1`,
      [lanchonete_id],
    );

    const inscricoes = resultado.rows;

    console.log(`🔔 Encontradas ${inscricoes.length} inscrições Web Push`);

    let enviados = 0;
    let falhas = 0;

    const payload = JSON.stringify({
      title: titulo,
      body: mensagem,
      url,
    });

    for (const inscricao of inscricoes) {
      const subscription = {
        endpoint: inscricao.endpoint,
        keys: {
          p256dh: inscricao.p256dh,
          auth: inscricao.auth,
        },
      };

      try {
        await webpush.sendNotification(subscription, payload);
        enviados++;
        console.log(`✅ Web Push enviado: ${inscricao.id}`);
      } catch (error: unknown) {
        falhas++;

        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error
            ? Number(error.statusCode)
            : undefined;

        console.error(`❌ Falha na inscrição ${inscricao.id}:`, error);

        if (statusCode === 404 || statusCode === 410) {
          await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [
            inscricao.id,
          ]);

          console.log("🗑️ Inscrição inválida removida");
        }
      }
    }

    console.log(
      `📊 Resultado Web Push: ${enviados} enviados, ${falhas} falhas`,
    );

    return {
      total: inscricoes.length,
      enviados,
      falhas,
    };
  }
}

export { EnviarWebPushService };
