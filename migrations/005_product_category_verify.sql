-- Read-only verification after manually applying 005_product_category.sql.
BEGIN READ ONLY;
SELECT current_database(), current_user;

SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'category';

SELECT pg_get_userbyid(relowner) AS owner, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE oid = 'public.products'::regclass;

SELECT has_table_privilege('gama_app', 'public.products', 'SELECT') AS table_select,
       has_table_privilege('gama_app', 'public.products', 'INSERT') AS table_insert,
       has_table_privilege('gama_app', 'public.products', 'UPDATE') AS table_update,
       has_column_privilege('gama_app', 'public.products', 'category', 'INSERT') AS category_insert,
       has_column_privilege('gama_app', 'public.products', 'category', 'UPDATE') AS category_update,
       has_column_privilege('gama_app', 'public.products', 'restaurant_id', 'INSERT') AS tenant_insert,
       has_column_privilege('gama_app', 'public.products', 'restaurant_id', 'UPDATE') AS tenant_update;

-- Immediately after migration and before category writes: categorized_products = 0.
SELECT count(*) AS products, count(category) AS categorized_products,
       count(*) FILTER (WHERE category IS NULL) AS uncategorized_products
FROM public.products;

-- Compare with the pre-migration inventory to confirm existing column grants.
SELECT a.attname AS column_name,
       has_column_privilege('gama_app', a.attrelid, a.attnum, 'SELECT') AS can_select,
       has_column_privilege('gama_app', a.attrelid, a.attnum, 'INSERT') AS can_insert,
       has_column_privilege('gama_app', a.attrelid, a.attnum, 'UPDATE') AS can_update
FROM pg_attribute a
WHERE a.attrelid = 'public.products'::regclass AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;
ROLLBACK;
