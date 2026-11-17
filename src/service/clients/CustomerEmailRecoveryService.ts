import { createHmac, randomInt, randomUUID, timingSafeEqual } from "crypto";
import isEmail from "validator/lib/isEmail";
import { productTransaction } from "../product/productTransaction";
import { issueCustomerCredential } from "../../security/customerAccess";
import { sendCustomerEmailCode } from "./CustomerEmailSender";
import { CustomerEmailError } from "./CustomerEmailVerificationService";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new CustomerEmailError(400, "Código inválido, expirado ou indisponível.");
export const recoveryMessage = "Se houver um cadastro com este e-mail verificado nesta loja, você receberá um código válido por 5 minutos.";
function digest(restaurant: string, customer: string, id: string, email: string, code: string) {
  if (!process.env.JWT_SECRET) throw new Error("Customer email signing unavailable");
  return createHmac("sha256", process.env.JWT_SECRET)
    .update(JSON.stringify(["gama:customer-email:recovery:v1", restaurant, customer, id, email, code]))
    .digest("hex");
}

export class CustomerEmailRecoveryService {
  async request(restaurant: string, input: unknown) {
    if (!uuid.test(restaurant) || typeof input !== 'string' || input.trim().length > 254 || !isEmail(input.trim())) {
      throw new CustomerEmailError(400, "Informe um e-mail válido.");
    }
    const email = input.trim().toLowerCase();
    // A random opaque ID is returned for every valid request, even without an eligible account.
    const id = randomUUID();
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    if (!process.env.JWT_SECRET) throw new Error("Customer email signing unavailable");
    // Both database work and SMTP run after the neutral response, for every address.
    // No account lookup or provider latency can distinguish eligible addresses here.
    setImmediate(() => { void this.prepareAndDeliver(restaurant, id, email, code); });
    return { challengeId: id, message: recoveryMessage };
  }

  private async prepareAndDeliver(restaurant: string, id: string, email: string, code: string) {
    // Runs in the long-lived Express process. A restart may drop pending work;
    // without sent_at, a challenge can never authenticate a customer.
    try {
      const customer = await productTransaction(async client => {
        const { rows: [owner] } = await client.query<{ id: string }>(
          `SELECT id FROM public.customers
           WHERE restaurant_id = $1 AND email = $2 AND email_verified_at IS NOT NULL FOR UPDATE`, [restaurant, email]);
        if (!owner) return undefined;
        const { rows: [limits] } = await client.query<{ recent: string; cooldown: boolean }>(
          `SELECT count(*)::text AS recent,
            COALESCE(bool_or(created_at > now() - INTERVAL '60 seconds'), FALSE) AS cooldown
           FROM public.customer_email_challenges
           WHERE restaurant_id = $1 AND customer_id = $2 AND purpose = 'recovery'
             AND created_at > now() - INTERVAL '15 minutes'`, [restaurant, owner.id]);
        // Silently throttle to avoid turning the quota into an account-existence oracle.
        if (Number(limits.recent) >= 3 || limits.cooldown) return undefined;
        await client.query(
          `UPDATE public.customer_email_challenges SET consumed_at = now()
           WHERE restaurant_id = $1 AND customer_id = $2 AND purpose = 'recovery' AND consumed_at IS NULL`,
          [restaurant, owner.id]);
        await client.query(
          `INSERT INTO public.customer_email_challenges (id, restaurant_id, customer_id, email, code_hash, expires_at, purpose)
           VALUES ($1, $2, $3, $4, $5, now() + INTERVAL '5 minutes', 'recovery')`,
          [id, restaurant, owner.id, email, digest(restaurant, owner.id, id, email, code)]);
        return owner.id;
      });
      if (!customer) return;
      await sendCustomerEmailCode(email, code);
      await productTransaction(async client => {
        await client.query(
          `UPDATE public.customer_email_challenges SET sent_at = now()
           WHERE id = $1 AND restaurant_id = $2 AND customer_id = $3
             AND purpose = 'recovery' AND consumed_at IS NULL AND expires_at > clock_timestamp()`,
          [id, restaurant, customer]);
      });
    } catch {
      // Never log provider/database errors, recipient addresses or codes.
      // A failed or uncertain send leaves sent_at NULL and the challenge unusable.
    }
  }

  async confirm(restaurant: string, id: unknown, code: unknown) {
    if (!uuid.test(restaurant) || typeof id !== 'string' || !uuid.test(id) ||
        typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalid();
    const credential = await productTransaction(async client => {
      // Lock the customer first, as in verification/request, to avoid reversed lock order.
      const { rows: [owner] } = await client.query<{ id: string; email: string }>(
        `SELECT c.id, c.email FROM public.customers c
         WHERE c.restaurant_id = $1 AND c.email_verified_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.customer_email_challenges h
             WHERE h.id = $2 AND h.restaurant_id = c.restaurant_id AND h.customer_id = c.id
               AND h.purpose = 'recovery' AND h.email = c.email) FOR UPDATE OF c`, [restaurant, id]);
      if (!owner) return undefined;
      const { rows: [challenge] } = await client.query<{ code_hash: string; attempts: number; usable: boolean }>(
        `SELECT code_hash, attempts,
          (expires_at > clock_timestamp() AND consumed_at IS NULL AND sent_at IS NOT NULL) AS usable
         FROM public.customer_email_challenges
         WHERE id = $1 AND restaurant_id = $2 AND customer_id = $3 AND purpose = 'recovery' FOR UPDATE`,
        [id, restaurant, owner.id]);
      if (!challenge || !challenge.usable || challenge.attempts >= 5) return undefined;
      const expected = Buffer.from(challenge.code_hash, 'hex');
      const actual = Buffer.from(digest(restaurant, owner.id, id, owner.email, code), 'hex');
      const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
      await client.query(
        `UPDATE public.customer_email_challenges SET attempts = attempts + 1,
          consumed_at = CASE WHEN $4::boolean OR attempts + 1 >= 5 THEN now() ELSE consumed_at END
         WHERE id = $1 AND restaurant_id = $2 AND customer_id = $3 AND purpose = 'recovery'`,
        [id, restaurant, owner.id, matches]);
      if (!matches) return undefined; // Commit failed attempts before returning a generic error.
      return issueCustomerCredential({ id: owner.id, restaurant_id: restaurant });
    });
    if (!credential) throw invalid();
    return { restaurant_id: restaurant, customer_credential: credential };
  }
}
