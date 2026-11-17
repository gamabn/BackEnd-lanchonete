import type { PoolClient } from "pg";
import { restaurantPickupAddress, type PickupAddressSnapshot } from "./pickupAddress";
import type { PricedOrderItem } from "../order_item/CreateOrderItemSerice";
import { parseOrder, moneyCents, moneyText, OrderValidationError } from "./orderValidation";
import { ValidateAndPriceConfiguredProductService } from "../productTemplates/ValidateAndPriceConfiguredProductService";

/** Read/lock/price only. Caller owns the transaction and must keep this client through persistence. */
export async function validateOrderCheckout(
  client: Pick<PoolClient, "query">,
  { restaurant_id, customer_id, input }: { restaurant_id: string; customer_id: string; input: unknown },
) {
  const data = parseOrder(input);
  const store = await client.query<{
    status: boolean;
    name: unknown;
    street: unknown;
    number: unknown;
    neighborhood: unknown;
    city: unknown;
  }>(
    'SELECT status, name, street, "number", neighborhood, city FROM restaurants WHERE id::text = $1 FOR SHARE',
    [restaurant_id],
  );
  if (!store.rows[0] || store.rows[0].status !== true)
    throw new OrderValidationError("Estabelecimento indisponível.");
  const customer = await client.query<{
    city: string;
    street: string | null;
    number: string | null;
    neighborhood: string | null;
    complement: string | null;
  }>(
    "SELECT city, street, number, neighborhood, complement FROM customers WHERE id::text = $1 AND restaurant_id::text = $2 FOR SHARE",
    [customer_id, restaurant_id],
  );
  if (!customer.rows[0])
    throw new OrderValidationError(
      "Cliente não autorizado para este estabelecimento.",
      403,
    );
  let fee = 0n;
  let pickup: PickupAddressSnapshot | null = null;
  if (data.fulfillment_type === "DELIVERY") {
    if (!customer.rows[0].neighborhood?.trim())
      throw new OrderValidationError("Endereço sem bairro de entrega.");
    const delivery = await client.query<{ delivery_fee: string }>(
      `SELECT CASE WHEN frete::numeric >= 0 THEN round(frete::numeric, 2)::text END AS delivery_fee FROM bairros
       WHERE id::text = $1 AND lanchonete_id::text = $2
       AND lower(btrim(bairro)) = lower(btrim($3::text)) FOR SHARE`,
      [data.bairro_id, restaurant_id, customer.rows[0].neighborhood],
    );
    if (!delivery.rows[0])
      throw new OrderValidationError("Bairro não autorizado para o endereço e estabelecimento.");
    fee = moneyCents(delivery.rows[0].delivery_fee);
  } else {
    pickup = restaurantPickupAddress(store.rows[0]);
  }

  const products = await client.query<{
    id: string;
    name: string;
    item_price: string;
    available: boolean;
    has_variants: boolean;
  }>(
    `
  SELECT
p.id,
p.name,
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

  const total = subtotal + fee;
  const tender = moneyCents(data.change_for);
  if (data.payment_method === "Dinheiro" && tender > 0n && tender < total) {
    throw new OrderValidationError(
      "O valor para troco deve cobrir o total atual do pedido.",
    );
  }
  return {
    restaurant_id, customer_id, data, priced, subtotal, fee, total, tender, pickup,
    deliveryAddress: data.fulfillment_type === "DELIVERY" ? {
      city: customer.rows[0].city,
      street: customer.rows[0].street,
      number: customer.rows[0].number,
      neighborhood: customer.rows[0].neighborhood,
      complement: customer.rows[0].complement,
    } : null,
    productNames: products.rows.map(product => ({ id: product.id, name: product.name })),
  };
}
