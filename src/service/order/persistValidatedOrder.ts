import type { PoolClient } from "pg";
import type { PickupAddressSnapshot } from "./pickupAddress";
import type { validateOrderCheckout } from "./validateOrderCheckout";
import { CreateOrderItemService } from "../order_item/CreateOrderItemSerice";
import { GetOrderItemService } from "../order_item/GetOrderItemService";
import { moneyText } from "./orderValidation";

interface PersistedOrder {
  id: string;
  restaurant_id: string;
  customer_id: string;
  status: string;
  total_price: string;
  fulfillment_type: "DELIVERY" | "PICKUP";
  subtotal: string;
  delivery_fee: string;
  pickup_address: PickupAddressSnapshot | null;
  payment_method: string;
  change_for: string;
}
/** Persist only a result validated/locked on this same client in the current transaction. */
export async function persistValidatedOrder(
  client: Pick<PoolClient, "query">,
  validated: Awaited<ReturnType<typeof validateOrderCheckout>>,
) {
  const { restaurant_id, customer_id, data, priced, subtotal, fee, total, tender, pickup, deliveryAddress } = validated;
  const saved = await client.query<PersistedOrder>(
    `INSERT INTO orders (restaurant_id, customer_id, status, total_price, payment_method, change_for, delivery_address, fulfillment_type, subtotal, delivery_fee, bairro_id, pickup_address)
     VALUES ($1, $2, 'pending', $3::numeric, $4, $5::numeric, $6::jsonb, $7, $8::numeric, $9::numeric, $10, $11::jsonb)
     RETURNING id, restaurant_id, customer_id, status, total_price::text AS total_price, payment_method, change_for::text AS change_for,
               fulfillment_type, subtotal::text AS subtotal, delivery_fee::text AS delivery_fee, pickup_address`,
    [
      restaurant_id,
      customer_id,
      moneyText(total),
      data.payment_method,
      data.change_for,
      deliveryAddress ? JSON.stringify(deliveryAddress) : null,
      data.fulfillment_type,
      moneyText(subtotal),
      moneyText(fee),
      data.bairro_id,
      pickup ? JSON.stringify(pickup) : null,
    ],
  );
  const order = saved.rows[0];
  if (!order) throw new Error("Pedido não persistido.");
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
  return {
    order,
    chat: chatResult.rows[0],
    fullOrder,
    subtotal: moneyText(subtotal),
    delivery_fee: moneyText(fee),
    change_due: moneyText(tender > total ? tender - total : 0n),
  };
}
