-- Read-only inspection. No customer rows, writes, or schema changes.
SELECT column_name, data_type, character_maximum_length, is_nullable, column_default, is_identity, is_generated
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers'
ORDER BY ordinal_position;

SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.customers'::regclass
ORDER BY conname;

SELECT tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.customers'::regclass AND NOT tgisinternal
ORDER BY tgname;
