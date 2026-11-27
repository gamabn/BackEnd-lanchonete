import { Request, Response, NextFunction } from "express";
import { PoolClient } from "pg";
import { pool } from "../database";
import { checkSubscription } from "../service/stripe/checkSubscription";

export async function verifySubscription(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let client: PoolClient | undefined;
  let subscriptionCheck;

  try {
    const restaurantId = req.user_id;

    if (!restaurantId) {
      return res.status(401).json({
        error: "Não autenticado.",
      });
    }

    client = await pool.connect();

    const dbInfo = await client.query(`
      SELECT
        current_user,
        current_database(),
        current_schema(),
        has_table_privilege(
          current_user,
          'public.subscriptions',
          'SELECT'
        ) AS can_select,
        has_table_privilege(
          current_user,
          'public.subscriptions',
          'UPDATE'
        ) AS can_update
    `);

    console.log("DADOS DA CONEXÃO DO BACKEND:", dbInfo.rows[0]);

    // console.log("RESTAURANT ID:", restaurantId);

    subscriptionCheck = await checkSubscription(client, restaurantId);
  } catch (err) {
    console.error("ERRO VERIFY SUBSCRIPTION:", err);

    return res.status(500).json({
      error: "Erro ao verificar assinatura.",
    });
  } finally {
    client?.release();
  }

  if (!subscriptionCheck.allowed) {
    return res.status(403).json({
      error: "Acesso bloqueado.",
      reason: subscriptionCheck.reason,
    });
  }

  return next();
}
