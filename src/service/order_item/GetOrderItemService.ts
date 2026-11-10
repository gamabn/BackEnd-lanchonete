import type { PoolClient } from "pg";
import { pool } from "../../database";

export interface OrderItemOption {
  id: string;
  option_id: string | null;
  option_name: string;
  group_name: string;
  additional_price: number;
}

export interface FullOrderItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  item_price: number;
  variant_id: string | null;
  variant_name: string | null;
  options: OrderItemOption[];
}

export interface FullOrder {
  order_id: string;
  restaurant_id: string;
  status: string;
  total_price: number;
  created_at: Date | string;
  payment_method: string;
  change_for: string | number | null;

  customer: {
    id: string;
    name: string;
    phone: string;
    city: string;
    street: string | null;
    number: string | null;
    neighborhood: string | null;
    complement: string | null;
  };

  items: FullOrderItem[];
}

class GetOrderItemService {
  private readonly baseQuery = `
    SELECT
      o.id AS order_id,
      o.restaurant_id,
      o.status,
      o.total_price::float8 AS total_price,
      o.created_at,
      o.payment_method,
      o.change_for,

      json_build_object(
        'id', c.id,
        'name', c.name,
        'phone', c.phone,
        'city', c.city,
        'street', c.street,
        'number', c.number,
        'neighborhood', c.neighborhood,
        'complement', c.complement
      ) AS customer,

      COALESCE(
        json_agg(
          json_build_object(
            'id', oi.id,
            'product_id', p.id,
            'product_name', p.name,
            'quantity', oi.quantity::int,
            'item_price', oi.item_price::float8,
            'variant_id', oi.variant_id,
            'variant_name', oi.variant_name,
            'options', COALESCE(item_options.options, '[]'::json)
          )
          ORDER BY oi.created_at, oi.id
        ) FILTER (WHERE oi.id IS NOT NULL),
        '[]'::json
      ) AS items

    FROM public.orders o

    INNER JOIN public.customers c
      ON c.id = o.customer_id

    LEFT JOIN public.order_items oi
      ON oi.order_id = o.id

    LEFT JOIN public.products p
      ON p.id = oi.product_id

    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          json_agg(
            json_build_object(
              'id', oio.id,
              'option_id', oio.option_id,
              'option_name', oio.option_name,
              'group_name', oio.group_name,
              'additional_price', oio.additional_price::float8
            )
            ORDER BY oio.group_name, oio.option_name, oio.id
          ),
          '[]'::json
        ) AS options
      FROM public.order_item_options oio
      WHERE oio.order_item_id = oi.id
    ) item_options ON TRUE
  `;

  async execute(restaurant_id: string): Promise<FullOrder[]> {
    const result = await pool.query<FullOrder>(
      `
      ${this.baseQuery}

      WHERE o.restaurant_id = $1

      GROUP BY
        o.id,
        c.id,
        o.payment_method,
        o.change_for

      ORDER BY o.created_at DESC
      `,
      [restaurant_id],
    );

    return result.rows;
  }

  async findByOrderId(
    order_id: string,
    client: Pick<PoolClient, "query"> = pool,
  ): Promise<FullOrder | null> {
    const result = await client.query<FullOrder>(
      `
      ${this.baseQuery}

      WHERE o.id = $1

      GROUP BY
        o.id,
        c.id,
        o.payment_method,
        o.change_for

      LIMIT 1
      `,
      [order_id],
    );

    return result.rows[0] ?? null;
  }
}

export { GetOrderItemService };
