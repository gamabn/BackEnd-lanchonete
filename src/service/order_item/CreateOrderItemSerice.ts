import type { PoolClient } from "pg";

export interface PricedOrderOption {
  option_id: string;
  option_name: string;
  group_name: string;
  additional_price: string;
}

export interface PricedOrderItem {
  product_id: string;
  quantity: number;
  item_price: string;

  variant_id?: string;
  variant_name?: string;

  options?: PricedOrderOption[];
}

class CreateOrderItemService {
  async execute(
    client: Pick<PoolClient, "query">,
    order_id: string,
    items: PricedOrderItem[],
  ) {
    for (const item of items) {
      // Salva o item principal do pedido
      const result = await client.query<{ id: string }>(
        `
        INSERT INTO public.order_items (
          order_id,
          product_id,
          quantity,
          item_price,
          variant_id,
          variant_name
        )
        VALUES (
          $1,
          $2,
          $3,
          $4::numeric,
          $5,
          $6
        )
        RETURNING id
        `,
        [
          order_id,
          item.product_id,
          item.quantity,
          item.item_price,
          item.variant_id ?? null,
          item.variant_name ?? null,
        ],
      );

      const orderItem = result.rows[0];

      if (!orderItem) {
        throw new Error("Item não persistido.");
      }

      // Salva os ingredientes escolhidos
      for (const option of item.options ?? []) {
        const optionResult = await client.query(
          `
          INSERT INTO public.order_item_options (
            order_item_id,
            option_id,
            option_name,
            group_name,
            additional_price
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5::numeric
          )
          `,
          [
            orderItem.id,
            option.option_id,
            option.option_name,
            option.group_name,
            option.additional_price,
          ],
        );

        if (optionResult.rowCount !== 1) {
          throw new Error("Ingrediente do pedido não persistido.");
        }
      }
    }
  }
}

export { CreateOrderItemService };
