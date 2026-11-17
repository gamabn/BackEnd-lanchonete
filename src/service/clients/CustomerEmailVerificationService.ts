import { createHmac, randomInt, randomUUID, timingSafeEqual } from "crypto";
import isEmail from "validator/lib/isEmail";
import type { PoolClient } from "pg";
import { productTransaction } from "../product/productTransaction";
import { sendCustomerEmailCode } from "./CustomerEmailSender";

export class CustomerEmailError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Owner = { customerId: string; restaurantId: string };
const invalid = () => new CustomerEmailError(400, "Código inválido, expirado ou indisponível.");
function digest(owner: Owner, id: string, email: string, code: string) {
  if (!process.env.JWT_SECRET) throw new Error("Customer email signing unavailable");
  return createHmac("sha256", process.env.JWT_SECRET)
    .update(JSON.stringify(["gama:customer-email:verify:v1", owner.restaurantId, owner.customerId, id, email, code]))
    .digest("hex");
}
async function lockOwner(client: PoolClient, owner: Owner) {
  const result = await client.query(
    "SELECT id FROM public.customers WHERE id = $1 AND restaurant_id = $2 FOR UPDATE",
    [owner.customerId, owner.restaurantId],
  );
  if (!result.rows.length) throw new CustomerEmailError(404, "Cadastro não encontrado.");
}

export class CustomerEmailVerificationService {
  async request(owner: Owner, input: unknown) {
    if (typeof input !== 'string') throw new CustomerEmailError(400, "Informe um e-mail válido.");
    const email = input.trim().toLowerCase();
    if (email.length > 254 || !isEmail(email)) throw new CustomerEmailError(400, "Informe um e-mail válido.");
    const id = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const hash = digest(owner, id, email, code);
    await productTransaction(async client => {
      await lockOwner(client, owner);
      const { rows: [limits] } = await client.query<{ recent: string; cooldown: boolean }>(
        `SELECT count(*)::text AS recent,
          COALESCE(bool_or(created_at > now() - INTERVAL '60 seconds'), FALSE) AS cooldown
         FROM public.customer_email_challenges
         WHERE restaurant_id = $1 AND customer_id = $2 AND purpose = 'verification' AND created_at > now() - INTERVAL '15 minutes'`,
        [owner.restaurantId, owner.customerId],
      );
      if (Number(limits.recent) >= 3 || limits.cooldown) throw new CustomerEmailError(429, "Aguarde antes de solicitar outro código.");
      await client.query(
        `UPDATE public.customer_email_challenges SET consumed_at = now()
         WHERE restaurant_id = $1 AND customer_id = $2 AND purpose = 'verification' AND consumed_at IS NULL`,
        [owner.restaurantId, owner.customerId],
      );
      await client.query(
        `INSERT INTO public.customer_email_challenges (id, restaurant_id, customer_id, email, code_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + INTERVAL '5 minutes')`,
        [id, owner.restaurantId, owner.customerId, email, hash],
      );
    });
    // Do not keep a transaction/row lock open while contacting the mail provider.
    // A failed/uncertain send leaves sent_at NULL, so its code cannot be accepted.
    try {
      await sendCustomerEmailCode(email, code);
    } catch {
      throw new CustomerEmailError(503, "Não foi possível enviar o código. Tente novamente mais tarde.");
    }
    await productTransaction(async client => {
      await client.query(
        `UPDATE public.customer_email_challenges SET sent_at = now()
         WHERE id = $1 AND restaurant_id = $2 AND customer_id = $3 AND purpose = 'verification' AND consumed_at IS NULL`,
        [id, owner.restaurantId, owner.customerId],
      );
    });
    return { challengeId: id, message: "Código enviado. Ele expira em 5 minutos." };
  }

  async confirm(owner: Owner, id: unknown, code: unknown) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
        typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalid();
    const result = await productTransaction(async client => {
      await lockOwner(client, owner);
      const { rows: [challenge] } = await client.query<{
        email: string; code_hash: string; attempts: number; usable: boolean;
      }>(`SELECT email, code_hash, attempts,
          (expires_at > clock_timestamp() AND consumed_at IS NULL AND sent_at IS NOT NULL) AS usable
          FROM public.customer_email_challenges
          WHERE id = $1 AND restaurant_id = $2 AND customer_id = $3 AND purpose = 'verification' FOR UPDATE`,
        [id, owner.restaurantId, owner.customerId]);
      if (!challenge || !challenge.usable || challenge.attempts >= 5) return { ok: false };
      const expected = Buffer.from(challenge.code_hash, 'hex');
      const actual = Buffer.from(digest(owner, id, challenge.email, code), 'hex');
      const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
      await client.query(
        `UPDATE public.customer_email_challenges SET attempts = attempts + 1,
          consumed_at = CASE WHEN $4::boolean OR attempts + 1 >= 5 THEN now() ELSE consumed_at END
         WHERE id = $1 AND restaurant_id = $2 AND customer_id = $3 AND purpose = 'verification'`,
        [id, owner.restaurantId, owner.customerId, matches],
      );
      if (!matches) return { ok: false }; // Commit the failed attempt, then return HTTP 400 outside the transaction.
      await client.query('SAVEPOINT verified_email');
      try {
        await client.query(
          `UPDATE public.customers SET email = $1, email_verified_at = now()
           WHERE id = $2 AND restaurant_id = $3`,
          [challenge.email, owner.customerId, owner.restaurantId]);
      } catch (error) {
        if ((error as { code?: string })?.code !== '23505') throw error;
        await client.query('ROLLBACK TO SAVEPOINT verified_email');
        return { ok: false }; // Consume this code without exposing another customer's email ownership.
      }
      return { ok: true };
    });
    if (!result.ok) throw invalid();
    return { verified: true, message: "E-mail verificado." };
  }
}
