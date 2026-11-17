-- Read-only. Run as administrative role in neondb BEFORE provisioning; review every result.
BEGIN READ ONLY;
SELECT current_database() AS database_name,current_user AS effective_role,session_user,current_setting('server_version') AS server_version;
SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit
FROM pg_roles WHERE rolname IN ('gamabn','gama_app');
WITH RECURSIVE memberships AS (
 SELECT roleid,member FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='gama_app')
 UNION SELECT m.roleid,m.member FROM pg_auth_members m JOIN memberships p ON m.member=p.roleid
) SELECT parent.rolname AS granted_role,child.rolname AS member FROM memberships m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles child ON child.oid=m.member;
SELECT d.datname,pg_get_userbyid(d.datdba) AS owner,d.datacl FROM pg_database d WHERE d.datname=current_database();
SELECT n.nspname,pg_get_userbyid(n.nspowner) AS owner,n.nspacl FROM pg_namespace n WHERE n.nspname='public';
WITH expected(name) AS (VALUES ('restaurants'),('restaurant_types'),('restaurant_type_links'),('products'),('product_variants'),('product_option_groups'),('product_options'),('product_variant_group_limits'),('product_templates'),('product_template_versions'),('customers'),('bairros'),('orders'),('order_items'),('order_item_options'),('chats'),('chat_messages'),('password_tokens'),('restaurant_product_templates'),('restaurant_product_template_versions'))
SELECT e.name,c.oid::regclass AS relation,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM expected e LEFT JOIN pg_class c ON c.oid=to_regclass(format('public.%I',e.name)) ORDER BY e.name;
SELECT table_name,column_name,data_type,is_identity,
       CASE WHEN column_name ILIKE '%password%' OR column_name ILIKE '%token%' THEN NULL ELSE column_default END AS column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('restaurants', 'restaurant_types', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'product_templates', 'product_template_versions', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens', 'restaurant_product_templates', 'restaurant_product_template_versions')
ORDER BY table_name,ordinal_position;
SELECT c.relname,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con
JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('restaurants', 'restaurant_types', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'product_templates', 'product_template_versions', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens', 'restaurant_product_templates', 'restaurant_product_template_versions') ORDER BY c.relname,con.conname;
SELECT tablename,policyname,roles,cmd,permissive,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
-- All owned serial/identity sequences and sequences directly referenced by INSERT-table defaults.
WITH inserted_tables AS (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('restaurants', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens', 'restaurant_product_templates', 'restaurant_product_template_versions')),
required AS (
 SELECT to_regclass(pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname)) AS oid FROM inserted_tables t
 JOIN pg_class c ON c.oid=t.oid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
 UNION SELECT dep.refobjid FROM inserted_tables t JOIN pg_attrdef d ON d.adrelid=t.oid
 JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid AND dep.refclassid='pg_class'::regclass
 JOIN pg_class s ON s.oid=dep.refobjid AND s.relkind='S'
) SELECT s.oid::regclass AS sequence,pg_get_userbyid(s.relowner) AS owner,s.relacl FROM required r JOIN pg_class s ON s.oid=r.oid;
-- Trigger functions and non-system functions referenced by defaults: review separately, no blanket EXECUTE.
WITH functions AS (
 SELECT tg.tgfoid AS oid FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE NOT tg.tgisinternal AND n.nspname='public' AND c.relname IN ('restaurants', 'restaurant_types', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'product_templates', 'product_template_versions', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens', 'restaurant_product_templates', 'restaurant_product_template_versions')
 UNION SELECT dep.refobjid FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid AND dep.refclassid='pg_proc'::regclass
 WHERE n.nspname='public' AND c.relname IN ('restaurants', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens', 'restaurant_product_templates', 'restaurant_product_template_versions')
) SELECT p.oid::regprocedure AS function,p.prosecdef AS security_definer,pg_get_userbyid(p.proowner) AS owner,p.proacl
FROM functions f JOIN pg_proc p ON p.oid=f.oid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname <> 'pg_catalog';
-- Review every callable non-system SECURITY DEFINER function; PUBLIC EXECUTE can be inherited.
SELECT p.oid::regprocedure AS function,pg_get_userbyid(p.proowner) AS owner,p.proacl,
       CASE WHEN EXISTS(SELECT 1 FROM pg_roles WHERE rolname='gama_app')
            THEN has_function_privilege('gama_app',p.oid,'EXECUTE') ELSE NULL END AS gama_app_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY n.nspname,p.proname;
ROLLBACK;
