-- PREPARED ONLY. Apply once, manually, as owner/grantor after reviewing preflight.
-- Compatible with the current post-cleanup schema: no frete table/frete_id required.
-- For a nonempty orders table, the operator must independently confirm that ALL
-- historical orders are DELIVERY, then set in the SAME session before this file:
-- SET gama.orders_history_delivery_confirmed = 'true';
-- Use a fresh session and pause order writes while verifying historical orders.
-- Never set this flag before that review, or infer modality from missing addresses.
-- This is an explicit operator assertion, not an automatic inference from NULLs.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;
DO $history$
BEGIN
    IF EXISTS (SELECT 1 FROM public.orders)
       AND current_setting('gama.orders_history_delivery_confirmed', true)
           IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Confirm historical orders are DELIVERY before applying migration 006';
    END IF;
END
$history$;

-- Constant default classifies legacy rows; no historical amount is reconstructed.
ALTER TABLE public.orders
    ADD COLUMN fulfillment_type VARCHAR(10) NOT NULL DEFAULT 'DELIVERY',
    ADD COLUMN subtotal NUMERIC(12,2) NULL,
    ADD COLUMN delivery_fee NUMERIC(12,2) NULL,
    ADD COLUMN pickup_address JSONB NULL,
    ADD CONSTRAINT orders_fulfillment_type_check
        CHECK (fulfillment_type IN ('DELIVERY', 'PICKUP')),
    ADD CONSTRAINT orders_pickup_no_delivery_check
        CHECK (fulfillment_type <> 'PICKUP'
            OR (bairro_id IS NULL AND delivery_address IS NULL)),
    ADD CONSTRAINT orders_pickup_fee_check
        CHECK (fulfillment_type <> 'PICKUP'
            OR (delivery_fee IS NOT NULL AND delivery_fee = 0)),
    ADD CONSTRAINT orders_subtotal_nonnegative_check
        CHECK (subtotal IS NULL OR (subtotal >= 0 AND subtotal <> 'NaN'::numeric)),
    ADD CONSTRAINT orders_delivery_fee_nonnegative_check
        CHECK (delivery_fee IS NULL OR (delivery_fee >= 0 AND delivery_fee <> 'NaN'::numeric)),
    ADD CONSTRAINT orders_total_components_check
        -- Legacy DELIVERY may have unknown components. PICKUP requires all amounts.
        CHECK ((fulfillment_type = 'DELIVERY'
                AND (subtotal IS NULL OR delivery_fee IS NULL))
            OR (subtotal IS NOT NULL AND delivery_fee IS NOT NULL
                AND total_price IS NOT NULL
                AND total_price = subtotal + delivery_fee));

-- GetOrderItemService lists a restaurant's orders newest first. The leading
-- restaurant_id also serves restaurant counts; no redundant standalone index.
CREATE INDEX orders_restaurant_created_at_idx
    ON public.orders (restaurant_id, created_at DESC);

-- Keep UPDATE restricted to the existing status grant. No table-wide grants.
-- bairro_id is needed for future DELIVERY inserts; no legacy freight objects required.
GRANT INSERT (delivery_address, bairro_id, fulfillment_type, subtotal, delivery_fee, pickup_address)
    ON TABLE public.orders TO gama_app;

COMMIT;
