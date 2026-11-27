import type { PoolClient } from "pg";

export enum SubscriptionStatus {
  TRIALING = "trialing",
  ACTIVE = "active",
  PAST_DUE = "past_due",
  CANCELED = "canceled",
}

interface SubscriptionCheckResult {
  allowed: boolean;
  reason?: string;
}

export async function checkSubscription(
  client: PoolClient,
  restaurantId: string,
): Promise<SubscriptionCheckResult> {
  const result = await client.query(
    `
      SELECT
        id,
        status,
        trial_end_date,
        end_date
      FROM subscriptions
      WHERE restaurant_id = $1
      ORDER BY created_at DESC NULLS LAST, id DESC
      LIMIT 1
    `,
    [restaurantId],
  );

  if (result.rows.length === 0) {
    return {
      allowed: false,
      reason: "no_subscription",
    };
  }

  const subscription = result.rows[0];

  console.log("ASSINATURA ENCONTRADA:", {
    id: subscription.id,
    status: subscription.status,
    trial_end_date: subscription.trial_end_date,
    end_date: subscription.end_date,
  });

  const now = new Date();

  // Verifica o período de teste.
  if (subscription.status === SubscriptionStatus.TRIALING) {
    const trialEnd = subscription.trial_end_date
      ? new Date(subscription.trial_end_date)
      : null;

    if (!trialEnd || now >= trialEnd) {
      await client.query(
        `
          UPDATE subscriptions
          SET
            status = $1,
            updated_at = NOW()
          WHERE id = $2
            AND status = $3
        `,
        [
          SubscriptionStatus.PAST_DUE,
          subscription.id,
          SubscriptionStatus.TRIALING,
        ],
      );

      return {
        allowed: false,
        reason: "trial_expired",
      };
    }

    return {
      allowed: true,
    };
  }

  // Verifica o período pago.
  if (subscription.status === SubscriptionStatus.ACTIVE) {
    const endDate = subscription.end_date
      ? new Date(subscription.end_date)
      : null;

    if (!endDate || now >= endDate) {
      await client.query(
        `
          UPDATE subscriptions
          SET
            status = $1,
            updated_at = NOW()
          WHERE id = $2
            AND status = $3
        `,
        [
          SubscriptionStatus.PAST_DUE,
          subscription.id,
          SubscriptionStatus.ACTIVE,
        ],
      );

      return {
        allowed: false,
        reason: "payment_expired",
      };
    }

    return {
      allowed: true,
    };
  }

  if (subscription.status === SubscriptionStatus.PAST_DUE) {
    return {
      allowed: false,
      reason: subscription.trial_end_date ? "trial_expired" : "payment_expired",
    };
  }

  // Qualquer outro status não permite acesso.
  return {
    allowed: false,
    reason: "inactive",
  };
}
