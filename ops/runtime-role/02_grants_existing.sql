-- PREPARED ONLY. Run manually as the owner/grantor of these objects, in neondb.
-- Applies explicit grants only; does not alter PUBLIC, ownership, RLS, default privileges or data.
BEGIN;
DO $guard$
DECLARE app OID; rel RECORD;
BEGIN
    IF current_database() <> 'neondb' THEN RAISE EXCEPTION 'Expected database neondb'; END IF;
    SELECT oid INTO app FROM pg_roles WHERE rolname = 'gama_app'
        AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit;
    IF app IS NULL THEN RAISE EXCEPTION 'gama_app missing or privileged'; END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=app) THEN RAISE EXCEPTION 'gama_app must not be a member of another role'; END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relowner=app)
       OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=app)
       OR EXISTS (SELECT 1 FROM pg_database WHERE datdba=app) THEN
        RAISE EXCEPTION 'Runtime role must not own database/schema/relations';
    END IF;
    IF has_schema_privilege('gama_app','public','CREATE') OR has_database_privilege('gama_app',current_database(),'CREATE') THEN
        RAISE EXCEPTION 'Runtime inherits CREATE; review PUBLIC and role grants explicitly before proceeding';
    END IF;
    FOR rel IN SELECT unnest(ARRAY['restaurants', 'restaurant_types', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'product_templates', 'product_template_versions', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens']::text[]) AS name LOOP
        IF to_regclass(format('public.%I',rel.name)) IS NULL THEN RAISE EXCEPTION 'Required table public.% missing; do not run unrelated migrations automatically',rel.name; END IF;
        IF EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(format('public.%I',rel.name)) AND relrowsecurity) THEN
            RAISE EXCEPTION 'Existing RLS on public.% requires separate compatibility review for gama_app',rel.name;
        END IF;
    END LOOP;
END
$guard$;
GRANT CONNECT ON DATABASE neondb TO gama_app;
GRANT USAGE ON SCHEMA public TO gama_app;

GRANT SELECT ON TABLE public.restaurants TO gama_app;
GRANT INSERT ("name", "email", "password", "phone", "city", "neighborhood", "street", "number") ON TABLE public.restaurants TO gama_app;
GRANT UPDATE ("name", "email", "password", "phone", "city", "neighborhood", "street", "number", "image_url", "status") ON TABLE public.restaurants TO gama_app;

GRANT SELECT ON TABLE public.restaurant_types TO gama_app;

GRANT SELECT ON TABLE public.restaurant_type_links TO gama_app;
GRANT INSERT ("restaurant_id", "type_id", "is_primary") ON TABLE public.restaurant_type_links TO gama_app;
GRANT DELETE ON TABLE public.restaurant_type_links TO gama_app;

GRANT SELECT ON TABLE public.products TO gama_app;
GRANT INSERT ("restaurant_id", "name", "description", "price", "image_url", "public_id", "available", "published") ON TABLE public.products TO gama_app;
GRANT UPDATE ("name", "description", "price", "image_url", "public_id", "available", "published") ON TABLE public.products TO gama_app;
GRANT DELETE ON TABLE public.products TO gama_app;

GRANT SELECT ON TABLE public.product_variants TO gama_app;
GRANT INSERT ("product_id", "name", "price", "available") ON TABLE public.product_variants TO gama_app;
GRANT UPDATE ("name", "price", "available") ON TABLE public.product_variants TO gama_app;
GRANT DELETE ON TABLE public.product_variants TO gama_app;

GRANT SELECT ON TABLE public.product_option_groups TO gama_app;
GRANT INSERT ("product_id", "name", "required", "min_select", "max_select") ON TABLE public.product_option_groups TO gama_app;
GRANT UPDATE ("name", "required", "min_select", "max_select") ON TABLE public.product_option_groups TO gama_app;
GRANT DELETE ON TABLE public.product_option_groups TO gama_app;

GRANT SELECT ON TABLE public.product_options TO gama_app;
GRANT INSERT ("group_id", "name", "additional_price", "available") ON TABLE public.product_options TO gama_app;
GRANT UPDATE ("name", "additional_price", "available") ON TABLE public.product_options TO gama_app;
GRANT DELETE ON TABLE public.product_options TO gama_app;

GRANT SELECT ON TABLE public.product_variant_group_limits TO gama_app;
GRANT INSERT ("variant_id", "group_id", "min_select", "max_select") ON TABLE public.product_variant_group_limits TO gama_app;
GRANT UPDATE ("min_select", "max_select") ON TABLE public.product_variant_group_limits TO gama_app;
GRANT DELETE ON TABLE public.product_variant_group_limits TO gama_app;

GRANT SELECT ON TABLE public.product_templates TO gama_app;

GRANT SELECT ON TABLE public.product_template_versions TO gama_app;

GRANT SELECT ON TABLE public.customers TO gama_app;
GRANT INSERT ("name", "phone", "city", "street", "number", "neighborhood", "complement", "restaurant_id") ON TABLE public.customers TO gama_app;
GRANT UPDATE ("name", "phone", "city", "street", "number", "neighborhood", "complement") ON TABLE public.customers TO gama_app;
GRANT DELETE ON TABLE public.customers TO gama_app;

GRANT SELECT ON TABLE public.bairros TO gama_app;
GRANT INSERT ("bairro", "frete", "lanchonete_id") ON TABLE public.bairros TO gama_app;
GRANT UPDATE ("bairro", "frete") ON TABLE public.bairros TO gama_app;
GRANT DELETE ON TABLE public.bairros TO gama_app;

GRANT SELECT ON TABLE public.orders TO gama_app;
-- Existing columns only; migration 006 separately grants its new columns.
GRANT INSERT ("restaurant_id", "customer_id", "status", "total_price", "payment_method", "change_for", "delivery_address", "bairro_id") ON TABLE public.orders TO gama_app;
GRANT UPDATE ("status") ON TABLE public.orders TO gama_app;
GRANT DELETE ON TABLE public.orders TO gama_app;

GRANT SELECT ON TABLE public.order_items TO gama_app;
GRANT INSERT ("order_id", "product_id", "quantity", "item_price", "variant_id", "variant_name") ON TABLE public.order_items TO gama_app;
GRANT DELETE ON TABLE public.order_items TO gama_app;

GRANT SELECT ON TABLE public.order_item_options TO gama_app;
GRANT INSERT ("order_item_id", "option_id", "option_name", "group_name", "additional_price") ON TABLE public.order_item_options TO gama_app;

GRANT SELECT ON TABLE public.chats TO gama_app;
GRANT INSERT ("order_id", "restaurant_id") ON TABLE public.chats TO gama_app;
GRANT DELETE ON TABLE public.chats TO gama_app;

GRANT SELECT ON TABLE public.chat_messages TO gama_app;
GRANT INSERT ("chat_id", "sender_type", "sender_id", "message", "name") ON TABLE public.chat_messages TO gama_app;
GRANT DELETE ON TABLE public.chat_messages TO gama_app;

GRANT SELECT ON TABLE public.password_tokens TO gama_app;
GRANT INSERT ("email", "token", "expires_at") ON TABLE public.password_tokens TO gama_app;
GRANT UPDATE ("token", "expires_at") ON TABLE public.password_tokens TO gama_app;
GRANT DELETE ON TABLE public.password_tokens TO gama_app;

-- nextval/currval need USAGE; backend never calls setval, so no sequence UPDATE/SELECT grant.
DO $sequences$
DECLARE seq RECORD;
BEGIN
    FOR seq IN
        WITH inserted_tables AS (
            SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname IN ('restaurants', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens')
        ), required AS (
            SELECT to_regclass(pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname)) AS oid
            FROM inserted_tables t JOIN pg_class c ON c.oid=t.oid JOIN pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
            UNION
            SELECT dep.refobjid FROM inserted_tables t JOIN pg_attrdef d ON d.adrelid=t.oid
            JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid AND dep.refclassid='pg_class'::regclass
            JOIN pg_class s ON s.oid=dep.refobjid AND s.relkind='S'
        )
        SELECT s.oid,n.nspname,s.relname FROM required r JOIN pg_class s ON s.oid=r.oid JOIN pg_namespace n ON n.oid=s.relnamespace
    LOOP
        IF seq.nspname <> 'public' THEN RAISE EXCEPTION 'Sequence outside public needs explicit review: %.%',seq.nspname,seq.relname; END IF;
        EXECUTE format('GRANT USAGE ON SEQUENCE %I.%I TO gama_app',seq.nspname,seq.relname);
    END LOOP;
END
$sequences$;
COMMIT;
