{ /*import { pool } from "../../database"

interface OrderSales {
   restaurant_id: string;
    customer_id : string;
    status: string;
    total_price: number;
    payment_method?: string;
    change_for?: number;
}

class OrderSalesService {
    async execute({ restaurant_id, customer_id, status, total_price,payment_method, change_for }: OrderSales) {
        const orderSales = await pool.query(
            'INSERT INTO orders(restaurant_id, customer_id, status, total_price,payment_method, change_for) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [restaurant_id, customer_id, status, total_price,payment_method, change_for]
        );

        const order =  orderSales.rows[0];
            const chatQuery = `
                    INSERT INTO chats (order_id)
                    VALUES ($1)
                    RETURNING *;
                `;
                const chatResult = await pool.query(chatQuery, [order.id]);
                const chat = chatResult.rows[0];

           return { order, chat }; // ✅ retorna o chat junto do pedido
    }

    
}

export { OrderSalesService }*/}

import { pool } from "../../database"

interface OrderSales {
   restaurant_id: string;
   customer_id : string;
   status: string;
   total_price: number;
   payment_method?: string;
   change_for?: number;
}

class OrderSalesService {
    async execute({ restaurant_id, customer_id, status, total_price, payment_method, change_for }: OrderSales) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const orderSales = await client.query(
                'INSERT INTO orders(restaurant_id, customer_id, status, total_price, payment_method, change_for) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
                [restaurant_id, customer_id, status, total_price, payment_method, change_for]
            );

            const order = orderSales.rows[0];
           // console.log('Order do pedido:',order)

            const chatQuery = `
                INSERT INTO chats (order_id,restaurant_id)
                VALUES ($1, $2)
                RETURNING *;
            `;
            const chatResult = await client.query(chatQuery, [order.id, order.restaurant_id]);
            const chat = chatResult.rows[0];

            await client.query('COMMIT');

            return { order, chat };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Erro ao criar pedido/chat:", error);
            throw new Error("Erro ao criar pedido/chat");
        } finally {
            client.release();
        }
    }
}

export { OrderSalesService }
