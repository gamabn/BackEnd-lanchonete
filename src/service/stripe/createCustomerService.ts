import { stripe } from "../../config/stripe";
import { pool } from "../../database";

class CreateCustomerService {
  async execulte(email: string, restaurant_id: string) {
    if (!restaurant_id) {
      throw new Error("Restaurante inválido.");
    }

    const priceId = process.env.STRIPE_PRICE_ID;
    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, "");

    if (!priceId) {
      throw new Error("STRIPE_PRICE_ID não configurada.");
    }

    if (!frontendUrl) {
      throw new Error("FRONTEND_URL não configurada.");
    }

    try {
      // 1. Busca o restaurante, mesmo que ainda não tenha assinatura.
      const result = await pool.query(
        `
          SELECT
            id,
            name,
            email,
            stripe_customer_id
          FROM restaurants
          WHERE id = $1
          LIMIT 1
        `,
        [restaurant_id],
      );

      const restaurant = result.rows[0];

      if (!restaurant) {
        throw new Error("Restaurante não encontrado.");
      }

      const customerEmail = restaurant.email || email;

      if (!customerEmail) {
        throw new Error("E-mail do restaurante não encontrado.");
      }

      const price = await stripe.prices.retrieve(priceId);

      console.log("PREÇO ENCONTRADO NA STRIPE:", {
        id: price.id,
        active: price.active,
        currency: price.currency,
        unit_amount: price.unit_amount,
        type: price.type,
      });

      // 2. Reutiliza o Customer ou cria um novo na Stripe.
      let stripeCustomerId: string | null = restaurant.stripe_customer_id;

      if (!stripeCustomerId) {
        const customer = await stripe.customers.create(
          {
            name: restaurant.name,
            email: customerEmail,
            metadata: {
              restaurant_id: String(restaurant.id),
            },
          },
          {
            idempotencyKey: `customer:${restaurant.id}`,
          },
        );

        stripeCustomerId = customer.id;

        // 3. Salva o Customer na tabela restaurants.
        await pool.query(
          `
            UPDATE restaurants
            SET stripe_customer_id = $1
            WHERE id = $2
          `,
          [stripeCustomerId, restaurant.id],
        );
      }

      // 4. Cria Checkout para pagamento avulso.
      const session = await stripe.checkout.sessions.create({
        mode: "payment",

        customer: stripeCustomerId,

        client_reference_id: String(restaurant.id),

        metadata: {
          restaurant_id: String(restaurant.id),
          plan: "BASICO",
        },

        payment_intent_data: {
          metadata: {
            restaurant_id: String(restaurant.id),
            plan: "BASICO",
          },
        },

        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],

        success_url: `${frontendUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}`,

        cancel_url: `${frontendUrl}/expired`,
      });

      if (!session.url) {
        throw new Error("Não foi possível gerar o Checkout.");
      }

      return {
        destination: "checkout" as const,
        url: session.url,
      };
    } catch (err) {
      console.error("Erro ao iniciar pagamento Stripe:", err);

      throw new Error("Não foi possível iniciar o pagamento. Tente novamente.");
    }
  }
}

export { CreateCustomerService };
