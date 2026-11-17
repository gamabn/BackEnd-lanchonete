-- Read-only inventory after the already committed manual cleanup.
-- Works before or after 006; never reruns cleanup. Compare saved snapshots.
BEGIN READ ONLY;
SELECT current_database(), current_user;
SELECT to_regclass('public.frete') IS NULL AS frete_removed,
       NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.orders'::regclass
                   AND attname = 'frete_id' AND NOT attisdropped) AS frete_id_removed,
       NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.orders'::regclass
                   AND conname = 'fk_orders_frete') AS fk_removed;
SELECT count(*) AS orders FROM public.orders;
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'
ORDER BY ordinal_position;
SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'public.orders'::regclass ORDER BY conname;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'orders' ORDER BY indexname;
ROLLBACK;
