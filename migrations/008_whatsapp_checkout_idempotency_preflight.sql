-- READ ONLY. Prepared for a future authorized operator; not executed in production here.
SELECT current_database(), current_user, version();
SHOW fsync;
SHOW synchronous_commit;
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'restaurants' AND column_name = 'id')
    OR (table_name = 'customers' AND column_name IN ('id','restaurant_id'))
    OR (table_name = 'orders' AND column_name IN ('id','restaurant_id','customer_id')))
ORDER BY table_name, column_name;
SELECT conrelid::regclass AS parent_table, conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid IN ('public.restaurants'::regclass,'public.customers'::regclass,'public.orders'::regclass)
ORDER BY parent_table, conname;
SELECT rolname FROM pg_roles WHERE rolname = 'gama_app';
SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public;
SELECT to_regclass('public.whatsapp_checkout_intents') AS existing_intents,
       to_regclass('public.customers_email_owner_key') AS reused_customer_index,
       to_regclass('public.orders_checkout_owner_idx') AS existing_order_index,
       to_regprocedure('public.guard_whatsapp_checkout_intent()') AS existing_guard;
-- All six parent columns must be UUID; id columns must have unique/primary keys.
-- Inspect ownership/grant authority and object-name collisions before applying 008.
SELECT c.conname, c.contype, c.convalidated, c.condeferrable,
       pg_get_constraintdef(c.oid), i.indisvalid, i.indisready, i.indimmediate
FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
WHERE c.conrelid = 'public.customers'::regclass AND c.conname = 'customers_email_owner_key';
-- DDL prerequisite: exactly the compatible owner key supplied by migration 003.
-- Runtime prerequisite: independently verify migration 006 fields/constraints/grants.
SELECT column_name, data_type, udt_name, numeric_precision, numeric_scale
FROM information_schema.columns WHERE table_schema='public' AND table_name='orders'
  AND column_name IN ('delivery_address','bairro_id','fulfillment_type','subtotal','delivery_fee','pickup_address')
ORDER BY column_name;
SELECT to_regclass('public.frete') AS legacy_frete_table,
       EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.orders'::regclass
               AND attname='frete_id' AND NOT attisdropped) AS legacy_frete_column;
-- Reconcile migrations 006/007 with actual metadata and deployment records. Never infer application.
-- Review write-blocking time/capacity for the remaining non-concurrent orders parent index.

-- H.6C proposed 008: if any intent object already exists, STOP and compare its DDL.
-- This file is not an upgrade script for an older applied 008.
SELECT to_regclass('public.whatsapp_checkout_one_active_scope_idx') AS existing_active_index;
SELECT column_name, data_type, is_generated, generation_expression, column_default
FROM information_schema.columns WHERE table_schema='public' AND table_name='whatsapp_checkout_intents'
ORDER BY ordinal_position;
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename='whatsapp_checkout_intents';
