import { pool } from "../../database";
import {
  CreateOrderItemService,
  type PricedOrderItem,
} from "../order_item/CreateOrderItemSerice";
import { GetOrderItemService } from "../order_item/GetOrderItemService";
import {
  parseOrder,
  moneyCents,
  moneyText,
  OrderValidationError,
} from "./orderValidation";
import { ValidateAndPriceConfiguredProductService } from "../productTemplates/ValidateAndPriceConfiguredProductService";

interface PersistedOrder {
  id: string;
  restaurant_id: string;
  customer_id: string;
  status: string;
  total_price: string;
  payment_method: string;
  change_for: string;
}
class OrderSalesService {
  async execute({
    restaurant_id,
    customer_id,
    input,
  }: {
    restaurant_id: string;
    customer_id: string;
    input: unknown;
  }) {
    const data = parseOrder(input);

    /*  if (
      data.items.some(
        (item) =>
          item.variant_id !== undefined || item.option_ids !== undefined,
      )
    ) {
      throw new OrderValidationError(
        "Pedidos configuráveis ainda não estão habilitados.",
      );
    }*/

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const store = await client.query<{ status: boolean }>(
        "SELECT status FROM restaurants WHERE id::text = $1 FOR SHARE",
        [restaurant_id],
      );
      if (!store.rows[0] || store.rows[0].status !== true)
        throw new OrderValidationError("Estabelecimento indisponível.");
      const customer = await client.query<{ neighborhood: string | null }>(
        "SELECT neighborhood FROM customers WHERE id::text = $1 AND restaurant_id::text = $2 FOR SHARE",
        [customer_id, restaurant_id],
      );
      if (!customer.rows[0])
        throw new OrderValidationError(
          "Cliente não autorizado para este estabelecimento.",
          403,
        );
      if (!customer.rows[0].neighborhood?.trim())
        throw new OrderValidationError("Endereço sem bairro de entrega.");
      const delivery = await client.query<{ delivery_fee: string }>(
        `SELECT CASE WHEN frete::numeric >= 0 THEN round(frete::numeric, 2)::text END AS delivery_fee FROM bairros
         WHERE id::text = $1 AND lanchonete_id::text = $2
         AND lower(btrim(bairro)) = lower(btrim($3::text)) FOR SHARE`,
        [data.bairro_id, restaurant_id, customer.rows[0].neighborhood],
      );
      if (!delivery.rows[0])
        throw new OrderValidationError(
          "Bairro não autorizado para o endereço e estabelecimento.",
        );
      const fee = moneyCents(delivery.rows[0].delivery_fee);

      /* const products = await client.query<{ id: string; item_price: string; available: unknown }>(
        `SELECT p.id, CASE WHEN p.price::numeric >= 0 THEN round(p.price::numeric, 2)::text END AS item_price,
          CASE WHEN to_jsonb(p) ? 'available' THEN to_jsonb(p)->'available' ELSE 'true'::jsonb END AS available
         FROM products p WHERE p.restaurant_id::text = $1 AND p.id::text = ANY($2::text[])
         ORDER BY p.id FOR SHARE`, [restaurant_id, data.items.map(item => item.product_id)],
      );*/

      const products = await client.query<{
        id: string;
        item_price: string;
        available: boolean;
        has_variants: boolean;
      }>(
        `
  SELECT
    p.id,
    CASE
      WHEN p.price::numeric >= 0
      THEN round(p.price::numeric, 2)::text
    END AS item_price,
    p.available,
    EXISTS (
      SELECT 1
      FROM public.product_variants pv
      WHERE pv.product_id = p.id
    ) AS has_variants
  FROM public.products p
  WHERE p.restaurant_id::text = $1
    AND p.id::text = ANY($2::text[])
    AND p.published = TRUE
  ORDER BY p.id
  FOR SHARE OF p
  `,
        [
          restaurant_id,
          [...new Set(data.items.map((item) => item.product_id))],
        ],
      );

      const uniqueProductIds = new Set(
        data.items.map((item) => item.product_id),
      );

      if (products.rows.length !== uniqueProductIds.size) {
        throw new OrderValidationError(
          "Produto inexistente, não publicado ou de outro estabelecimento.",
        );
      }

      let subtotal = 0n;

      const priced: PricedOrderItem[] = [];

      const configuredProductService =
        new ValidateAndPriceConfiguredProductService();

      for (const item of data.items) {
        const product = products.rows.find((row) => row.id === item.product_id);

        if (!product || product.available !== true) {
          throw new OrderValidationError("Produto indisponível.");
        }

        // Produto configurável
        if (product.has_variants) {
          if (!item.variant_id || !item.option_ids) {
            throw new OrderValidationError(
              "Selecione o tamanho e os ingredientes do produto.",
            );
          }

          const configured = await configuredProductService.execute({
            client,
            restaurantId: restaurant_id,
            productId: item.product_id,
            variantId: item.variant_id,
            optionIds: item.option_ids,
          });

          const cents = moneyCents(configured.item_price);

          subtotal += cents * BigInt(item.quantity);

          priced.push({
            product_id: item.product_id,
            quantity: item.quantity,
            item_price: configured.item_price,
            variant_id: configured.variant_id,
            variant_name: configured.variant_name,
            options: configured.options,
          });

          continue;
        }

        // Produto tradicional
        if (item.variant_id !== undefined || item.option_ids !== undefined) {
          throw new OrderValidationError(
            "Este produto não possui configurações.",
          );
        }

        const cents = moneyCents(product.item_price);

        subtotal += cents * BigInt(item.quantity);

        priced.push({
          product_id: item.product_id,
          quantity: item.quantity,
          item_price: moneyText(cents),
        });
      }

      //====================================
      // let subtotal = 0n;
      /*  const priced: PricedOrderItem[] = data.items.map((item) => {
        const product = products.rows.find((row) => row.id === item.product_id);
        if (!product || product.available !== true)
          throw new OrderValidationError("Produto indisponível.");
        const cents = moneyCents(product.item_price);
        subtotal += cents * BigInt(item.quantity);
        return { ...item, item_price: moneyText(cents) };
      });*/
      //==================================================================
      const total = subtotal + fee;
      const tender = moneyCents(data.change_for);
      if (data.payment_method === "Dinheiro" && tender > 0n && tender < total) {
        throw new OrderValidationError(
          "O valor para troco deve cobrir o total atual do pedido.",
        );
      }
      const saved = await client.query<PersistedOrder>(
        `INSERT INTO orders (restaurant_id, customer_id, status, total_price, payment_method, change_for)
         VALUES ($1, $2, 'pending', $3::numeric, $4, $5::numeric)
         RETURNING id, restaurant_id, customer_id, status, total_price::text AS total_price, payment_method, change_for::text AS change_for`,
        [
          restaurant_id,
          customer_id,
          moneyText(total),
          data.payment_method,
          data.change_for,
        ],
      );
      const order = saved.rows[0];
      await new CreateOrderItemService().execute(client, order.id, priced);
      const chatResult = await client.query<{
        id: string;
        order_id: string;
        restaurant_id: string;
      }>(
        "INSERT INTO chats (order_id, restaurant_id) VALUES ($1, $2) RETURNING id, order_id, restaurant_id",
        [order.id, order.restaurant_id],
      );
      if (!chatResult.rows[0]) throw new Error("Chat não persistido.");
      const fullOrder = await new GetOrderItemService().findByOrderId(
        order.id,
        client,
      );
      if (!fullOrder) throw new Error("Pedido persistido incompleto");
      await client.query("COMMIT");
      return {
        order,
        chat: chatResult.rows[0],
        fullOrder,
        subtotal: moneyText(subtotal),
        delivery_fee: moneyText(fee),
        change_due: moneyText(tender > total ? tender - total : 0n),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
export { OrderSalesService };
