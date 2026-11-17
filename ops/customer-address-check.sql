-- Read-only metadata inspection. No customer rows or changes to schema/data.
SELECT table_name, column_name, data_type, character_maximum_length, is_nullable,
       is_generated, is_identity, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('customers', 'bairros')
ORDER BY table_name, ordinal_position;

SELECT conrelid::regclass AS relation, conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.customers'::regclass, 'public.bairros'::regclass)
ORDER BY relation, conname;

SELECT tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.customers'::regclass AND NOT tgisinternal
ORDER BY tgname;
