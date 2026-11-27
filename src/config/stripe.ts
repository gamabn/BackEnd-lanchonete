import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

if (
  !secretKey ||
  (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("sk_live_"))
) {
  throw new Error("STRIPE_SECRET_KEY inválida ou não configurada.");
}

export const stripe = new Stripe(secretKey, {
  apiVersion: "2026-11-18.endive",
});
