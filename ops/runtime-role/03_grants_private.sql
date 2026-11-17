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
    FOR rel IN SELECT unnest(ARRAY['restaurant_product_templates', 'restaurant_product_template_versions']::text[]) AS name LOOP
        IF to_regclass(format('public.%I',rel.name)) IS NULL THEN RAISE EXCEPTION 'Required table public.% missing; do not run unrelated migrations automatically',rel.name; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(format('public.%I',rel.name)) AND relrowsecurity AND relforcerowsecurity) THEN
            RAISE EXCEPTION 'Required RLS ENABLE/FORCE missing on public.%',rel.name;
        END IF;
    END LOOP;
END
$guard$;

GRANT SELECT ON TABLE public.restaurant_product_templates TO gama_app;
GRANT INSERT ("restaurant_id", "name", "description") ON TABLE public.restaurant_product_templates TO gama_app;
GRANT UPDATE ("name", "description", "updated_at") ON TABLE public.restaurant_product_templates TO gama_app;
GRANT DELETE ON TABLE public.restaurant_product_templates TO gama_app;

GRANT SELECT ON TABLE public.restaurant_product_template_versions TO gama_app;
GRANT INSERT ("template_id", "restaurant_id", "version", "configuration", "active") ON TABLE public.restaurant_product_template_versions TO gama_app;
GRANT UPDATE ("active") ON TABLE public.restaurant_product_template_versions TO gama_app;
GRANT DELETE ON TABLE public.restaurant_product_template_versions TO gama_app;

-- nextval/currval need USAGE; backend never calls setval, so no sequence UPDATE/SELECT grant.
DO $sequences$
DECLARE seq RECORD;
BEGIN
    FOR seq IN
        WITH inserted_tables AS (
            SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relname IN ('restaurant_product_templates', 'restaurant_product_template_versions')
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
