INSERT INTO orders (restaurant_id, customer_id, status, total_price, payment_method, change_for, delivery_address)
VALUES ($1, $2, 'pending', $3::numeric, $4, $5::numeric, $6::jsonb)
RETURNING id, restaurant_id, customer_id, status, total_price::text AS total_price, payment_method, change_for::text AS change_for
