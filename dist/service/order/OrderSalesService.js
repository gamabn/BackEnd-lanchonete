"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderSalesService = void 0;
const database_1 = require("../../database");
const CreateOrderItemSerice_1 = require("../order_item/CreateOrderItemSerice");
const GetOrderItemService_1 = require("../order_item/GetOrderItemService");
const orderValidation_1 = require("./orderValidation");
class OrderSalesService {
    async execute({ restaurant_id, customer_id, input }) {
        const data = (0, orderValidation_1.parseOrder)(input);
        const client = await database_1.pool.connect();
        try {
            await client.query("BEGIN");
            const store = await client.query("SELECT status FROM restaurants WHERE id::text = $1 FOR SHARE", [restaurant_id]);
            if (!store.rows[0] || store.rows[0].status !== true)
                throw new orderValidation_1.OrderValidationError("Estabelecimento indisponível.");
            const customer = await client.query("SELECT neighborhood FROM customers WHERE id::text = $1 AND restaurant_id::text = $2 FOR SHARE", [customer_id, restaurant_id]);
            if (!customer.rows[0])
                throw new orderValidation_1.OrderValidationError("Cliente não autorizado para este estabelecimento.", 403);
            if (!customer.rows[0].neighborhood?.trim())
                throw new orderValidation_1.OrderValidationError("Endereço sem bairro de entrega.");
            const delivery = await client.query(`SELECT CASE WHEN frete::numeric >= 0 THEN round(frete::numeric, 2)::text END AS delivery_fee FROM bairros
         WHERE id::text = $1 AND lanchonete_id::text = $2
         AND lower(btrim(bairro)) = lower(btrim($3::text)) FOR SHARE`, [data.bairro_id, restaurant_id, customer.rows[0].neighborhood]);
            if (!delivery.rows[0])
                throw new orderValidation_1.OrderValidationError("Bairro não autorizado para o endereço e estabelecimento.");
            const fee = (0, orderValidation_1.moneyCents)(delivery.rows[0].delivery_fee);
            const products = await client.query(`SELECT p.id, CASE WHEN p.price::numeric >= 0 THEN round(p.price::numeric, 2)::text END AS item_price,
          CASE WHEN to_jsonb(p) ? 'available' THEN to_jsonb(p)->'available' ELSE 'true'::jsonb END AS available
         FROM products p WHERE p.restaurant_id::text = $1 AND p.id::text = ANY($2::text[])
         ORDER BY p.id FOR SHARE`, [restaurant_id, data.items.map(item => item.product_id)]);
            if (products.rows.length !== data.items.length)
                throw new orderValidation_1.OrderValidationError("Produto inexistente ou de outro estabelecimento.");
            let subtotal = 0n;
            const priced = data.items.map(item => {
                const product = products.rows.find(row => row.id === item.product_id);
                if (!product || product.available !== true)
                    throw new orderValidation_1.OrderValidationError("Produto indisponível.");
                const cents = (0, orderValidation_1.moneyCents)(product.item_price);
                subtotal += cents * BigInt(item.quantity);
                return { ...item, item_price: (0, orderValidation_1.moneyText)(cents) };
            });
            const total = subtotal + fee;
            const tender = (0, orderValidation_1.moneyCents)(data.change_for);
            if (data.payment_method === "Dinheiro" && tender > 0n && tender < total) {
                throw new orderValidation_1.OrderValidationError("O valor para troco deve cobrir o total atual do pedido.");
            }
            const saved = await client.query(`INSERT INTO orders (restaurant_id, customer_id, status, total_price, payment_method, change_for)
         VALUES ($1, $2, 'pending', $3::numeric, $4, $5::numeric)
         RETURNING id, restaurant_id, customer_id, status, total_price::text AS total_price, payment_method, change_for::text AS change_for`, [restaurant_id, customer_id, (0, orderValidation_1.moneyText)(total), data.payment_method, data.change_for]);
            const order = saved.rows[0];
            await new CreateOrderItemSerice_1.CreateOrderItemService().execute(client, order.id, priced);
            const chatResult = await client.query("INSERT INTO chats (order_id, restaurant_id) VALUES ($1, $2) RETURNING id, order_id, restaurant_id", [order.id, order.restaurant_id]);
            if (!chatResult.rows[0])
                throw new Error("Chat não persistido.");
            const fullOrder = await new GetOrderItemService_1.GetOrderItemService().findByOrderId(order.id, client);
            if (!fullOrder)
                throw new Error("Pedido persistido incompleto");
            await client.query("COMMIT");
            return { order, chat: chatResult.rows[0], fullOrder, subtotal: (0, orderValidation_1.moneyText)(subtotal), delivery_fee: (0, orderValidation_1.moneyText)(fee), change_due: (0, orderValidation_1.moneyText)(tender > total ? tender - total : 0n) };
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
}
exports.OrderSalesService = OrderSalesService;
