import Stripe from "stripe";
import { Request } from "express";
import { pool } from "../../database";

const getStripeClient = (): Stripe => {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error("A variável STRIPE_SECRET_KEY não está configurada.");
  }

  return new Stripe(secretKey);
};

/** Valida a assinatura e converte o corpo bruto em um evento confiável. */
export const verifyStripeWebhook = (
  rawBody: Buffer | string,
  signature: string | undefined,
): Stripe.Event => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET não configurado.");
  }

  if (!signature) {
    throw new Error("Assinatura do webhook não informada.");
  }

  try {
    return getStripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro desconhecido";

    throw new Error(`Falha na validação do webhook: ${message}`);
  }
};

/** Valida e classifica o evento. */
export const processStripeWebhook = (
  rawBody: Buffer | string,
  signature: string | undefined,
) => {
  const event = verifyStripeWebhook(rawBody, signature);

  return {
    received: true as const,
    eventId: event.id,
    eventType: event.type,
    data: event.data,
  };
};

class WebhookStripe {
  async execulte(req: Request) {
    const signature = req.headers["stripe-signature"];

    if (typeof signature !== "string") {
      throw new Error("Assinatura do webhook Stripe inválida.");
    }

    if (!Buffer.isBuffer(req.body)) {
      throw new Error(
        "Corpo bruto do webhook não encontrado. Verifique express.raw().",
      );
    }

    const event = verifyStripeWebhook(req.body, signature);

    const supportedEvents = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
    ];

    // Eventos que não fazem parte do nosso fluxo são ignorados.
    if (!supportedEvents.includes(event.type)) {
      return {
        received: true,
        ignored: true,
        eventType: event.type,
      };
    }

    const session = event.data.object as Stripe.Checkout.Session;

    // Nosso modelo utiliza pagamentos avulsos, nunca assinaturas recorrentes.
    if (session.mode !== "payment") {
      return {
        received: true,
        ignored: true,
        reason: "Checkout não é um pagamento avulso.",
      };
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Registra o evento. A chave primária impede processamento duplicado.
      const eventResult = await client.query(
        `
          INSERT INTO stripe_webhook_events (
            event_id,
            event_type
          )
          VALUES ($1, $2)
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id
        `,
        [event.id, event.type],
      );

      // O evento já foi processado anteriormente.
      if (eventResult.rowCount === 0) {
        await client.query("COMMIT");

        return {
          received: true,
          duplicate: true,
          eventId: event.id,
        };
      }

      // Pagamento falhou: registra o evento, mas não libera acesso.
      if (event.type === "checkout.session.async_payment_failed") {
        await client.query("COMMIT");

        return {
          received: true,
          paid: false,
          eventId: event.id,
        };
      }

      // checkout.session.completed também pode chegar com pagamento pendente.
      // Nesse caso, aguardamos checkout.session.async_payment_succeeded.
      if (session.payment_status !== "paid") {
        await client.query("COMMIT");

        return {
          received: true,
          pending: true,
          eventId: event.id,
        };
      }

      const restaurantId =
        session.metadata?.restaurant_id || session.client_reference_id;

      if (!restaurantId) {
        throw new Error("ID do restaurante não encontrado no Checkout.");
      }

      const stripeCustomerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id || null;

      // Impede duas renovações simultâneas de criarem assinaturas duplicadas
      // para o mesmo restaurante.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        restaurantId,
      ]);

      // Localiza a assinatura mais recente do restaurante.
      const subscriptionResult = await client.query(
        `
          SELECT id
          FROM subscriptions
          WHERE restaurant_id = $1
          ORDER BY created_at DESC NULLS LAST,
                   start_date DESC NULLS LAST,
                   id DESC
          LIMIT 1
          FOR UPDATE
        `,
        [restaurantId],
      );

      let subscriptionId: string;

      if (subscriptionResult.rows.length > 0) {
        subscriptionId = subscriptionResult.rows[0].id;

        // Renova a assinatura existente por mais 30 dias.
        await client.query(
          `
            UPDATE subscriptions
            SET
              status = 'active',
              end_date = GREATEST(
                COALESCE(end_date, NOW()),
                NOW()
              ) + INTERVAL '30 days',
              stripe_customer_id = COALESCE($1, stripe_customer_id),
              stripe_subscription_id = NULL,
              plan = 'BASICO',
              updated_at = NOW()
            WHERE id = $2
          `,
          [stripeCustomerId, subscriptionId],
        );
      } else {
        // Primeiro pagamento: cria a assinatura.
        const insertResult = await client.query(
          `
            INSERT INTO subscriptions (
              restaurant_id,
              status,
              start_date,
              end_date,
              stripe_customer_id,
              stripe_subscription_id,
              plan,
              created_at,
              updated_at
            )
            VALUES (
              $1,
              'active',
              NOW(),
              NOW() + INTERVAL '30 days',
              $2,
              NULL,
              'BASICO',
              NOW(),
              NOW()
            )
            RETURNING id
          `,
          [restaurantId, stripeCustomerId],
        );

        subscriptionId = insertResult.rows[0].id;
      }

      await client.query("COMMIT");

      return {
        received: true,
        paid: true,
        eventId: event.id,
        restaurantId,
        subscriptionId,
        plan: "BASICO",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export { WebhookStripe };
