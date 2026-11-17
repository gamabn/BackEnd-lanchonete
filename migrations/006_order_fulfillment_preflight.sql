-- Read only. Save output securely before review/application; no customer rows.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT current_database(), current_user, version();
SELECT column_name, data_type, udt_name, is_nullable, column_default,
       numeric_precision, numeric_scale, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders'
ORDER BY ordinal_position;
SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'public.orders'::regclass ORDER BY conname;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'orders' ORDER BY indexname;
SELECT pg_get_userbyid(relowner) AS owner, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE oid = 'public.orders'::regclass;
SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger
WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal;
-- Supports the current manually cleaned schema and detects partial/legacy states.
SELECT to_regclass('public.frete') IS NOT NULL AS frete_table_present,
       EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.orders'::regclass
               AND conname = 'fk_orders_frete') AS frete_fk_present,
       EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.orders'::regclass
               AND attname = 'fulfillment_type' AND NOT attisdropped) AS fulfillment_type_present;
-- JSON lookup avoids referencing a removed column; presence is explicit.
SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.orders'::regclass
               AND attname = 'frete_id' AND NOT attisdropped) AS frete_id_present;
SELECT count(*) AS historical_orders, count(bairro_id) AS with_bairro,
       count(*) FILTER (WHERE to_jsonb(orders)->>'frete_id' IS NOT NULL) AS with_frete, count(delivery_address) AS with_address,
       count(*) FILTER (WHERE total_price IS NULL) AS without_total,
       count(*) FILTER (WHERE total_price < 0) AS negative_total
FROM public.orders;
-- Address/bairro absence DOES NOT prove PICKUP or DELIVERY. Confirm history
-- independently before setting gama.orders_history_delivery_confirmed.
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
