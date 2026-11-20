import { pool } from "../../database";

interface SalvarPushSubscriptionData {
  lanchonete_id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

class SalvarWebPushService {
  async execute({ lanchonete_id, endpoint, keys }: SalvarPushSubscriptionData) {
    if (!lanchonete_id || !endpoint || !keys.auth || !keys.p256dh) {
      throw new Error("Dados da inscrição Web Push incompletos");
    }

    const result = await pool.query(
      `
      INSERT INTO push_subscriptions (
        barbearia_id,
        endpoint,
        p256dh,
        auth
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (endpoint)
      DO UPDATE SET
        lanchonete_id = EXCLUDED.barbearia_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth
      RETURNING id, lanchonete_id, created_at
      `,
      [lanchonete_id, endpoint, keys.p256dh, keys.auth],
    );

    return result.rows[0];
  }
}
export { SalvarWebPushService };
