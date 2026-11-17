-- BASELINE ONLY: equivalent cleanup was already committed manually on Neon,
-- as reported by the operator. Never replay the former destructive proposal.
-- This file only asserts the resulting state; it creates/removes nothing.
-- May run BEFORE or AFTER 006. Save its output in the deployment record.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
DO $baseline$
BEGIN
    IF to_regclass('public.orders') IS NULL THEN
        RAISE EXCEPTION 'public.orders is missing; cannot validate cleanup baseline';
    END IF;
    IF to_regclass('public.frete') IS NOT NULL THEN
        RAISE EXCEPTION 'public.frete still exists; manual cleanup baseline not satisfied';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute
               WHERE attrelid = 'public.orders'::regclass
               AND attname = 'frete_id' AND NOT attisdropped) THEN
        RAISE EXCEPTION 'orders.frete_id still exists; manual cleanup baseline not satisfied';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint
               WHERE conrelid = 'public.orders'::regclass
               AND conname = 'fk_orders_frete') THEN
        RAISE EXCEPTION 'fk_orders_frete still exists; manual cleanup baseline not satisfied';
    END IF;
END
$baseline$;
SELECT '007_remove_legacy_frete' AS migration,
       'already_applied_manually_state_verified' AS status,
       current_database() AS database_name, current_user AS verified_by,
       current_timestamp AS verified_at;
COMMIT;
