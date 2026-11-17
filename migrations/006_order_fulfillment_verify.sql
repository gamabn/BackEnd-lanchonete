-- Read only, AFTER manually applying 006; compare preflight FKs and privileges.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT current_database(), current_user;
SELECT column_name, data_type, is_nullable, column_default,
       numeric_precision, numeric_scale, character_maximum_length
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'
ORDER BY ordinal_position;
SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'public.orders'::regclass ORDER BY conname;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'orders' ORDER BY indexname;
SELECT fulfillment_type, count(*) AS orders, count(subtotal) AS known_subtotal,
       count(delivery_fee) AS known_fee, count(pickup_address) AS pickup_snapshots
FROM public.orders GROUP BY fulfillment_type;
-- Expected zero; explicit NULL checks avoid UNKNOWN hiding violations.
SELECT count(*) AS invalid_pickup_orders FROM public.orders
WHERE fulfillment_type = 'PICKUP'
AND (bairro_id IS NOT NULL OR delivery_address IS NOT NULL
     OR delivery_fee IS DISTINCT FROM 0::numeric
     OR subtotal IS NULL OR total_price IS NULL
     OR total_price IS DISTINCT FROM subtotal + delivery_fee);
-- OID-based privilege checks remain safe when gama_app does not exist.
SELECT r.oid IS NOT NULL AS gama_app_exists, r.rolcanlogin,
       has_table_privilege(r.oid, 'public.orders'::regclass, 'INSERT') AS table_insert,
       has_table_privilege(r.oid, 'public.orders'::regclass, 'UPDATE') AS table_update
FROM (VALUES ('gama_app')) AS expected(name)
LEFT JOIN pg_roles r ON r.rolname = expected.name;
SELECT a.attname AS column_name, r.oid IS NOT NULL AS gama_app_exists,
       has_column_privilege(r.oid, a.attrelid, a.attnum, 'INSERT') AS can_insert,
       has_column_privilege(r.oid, a.attrelid, a.attnum, 'UPDATE') AS can_update
FROM pg_attribute a
LEFT JOIN pg_roles r ON r.rolname = 'gama_app'
WHERE a.attrelid = 'public.orders'::regclass
AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum;
ROLLBACK;
