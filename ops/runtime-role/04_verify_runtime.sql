-- Read-only acceptance gate. Connect AS gama_app (real login), NOT gamabn/SET ROLE.
BEGIN READ ONLY;
SELECT current_database() AS database_name,current_user AS effective_role,session_user,
       has_database_privilege(current_user,current_database(),'TEMP') AS inherited_temp_privilege;
DO $verify$
DECLARE app OID; entry RECORD; target OID; col RECORD; wanted BOOLEAN; seq RECORD;
BEGIN
    IF current_database()<>'neondb' OR current_user<>'gama_app' OR session_user<>'gama_app' THEN
        RAISE EXCEPTION 'Use a real gama_app login to neondb'; END IF;
    SELECT oid INTO app FROM pg_roles WHERE rolname=current_user AND rolcanlogin
        AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolinherit;
    IF app IS NULL THEN RAISE EXCEPTION 'Runtime role flags invalid'; END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=app) THEN RAISE EXCEPTION 'Unexpected role membership'; END IF;
    IF EXISTS (SELECT 1 FROM pg_class WHERE relowner=app) OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=app)
       OR EXISTS (SELECT 1 FROM pg_database WHERE datdba=app) THEN RAISE EXCEPTION 'Runtime must not own objects'; END IF;
    IF has_database_privilege(app,current_database(),'CREATE') OR has_schema_privilege(app,'public','CREATE') THEN RAISE EXCEPTION 'Unexpected effective CREATE privilege'; END IF;
    IF NOT has_database_privilege(app,current_database(),'CONNECT') OR NOT has_schema_privilege(app,'public','USAGE') THEN RAISE EXCEPTION 'Missing CONNECT/USAGE'; END IF;
    FOR entry IN SELECT key,value FROM jsonb_each($manifest${"restaurants": {"insert": ["name", "email", "password", "phone", "city", "neighborhood", "street", "number"], "update": ["name", "email", "password", "phone", "city", "neighborhood", "street", "number", "image_url", "status"], "delete": false}, "restaurant_types": {"insert": [], "update": [], "delete": false}, "restaurant_type_links": {"insert": ["restaurant_id", "type_id", "is_primary"], "update": [], "delete": true}, "products": {"insert": ["restaurant_id", "name", "description", "price", "image_url", "public_id", "available", "published", "category"], "update": ["name", "description", "price", "image_url", "public_id", "available", "published", "category"], "delete": true}, "product_variants": {"insert": ["product_id", "name", "price", "available"], "update": ["name", "price", "available"], "delete": true}, "product_option_groups": {"insert": ["product_id", "name", "required", "min_select", "max_select"], "update": ["name", "required", "min_select", "max_select"], "delete": true}, "product_options": {"insert": ["group_id", "name", "additional_price", "available"], "update": ["name", "additional_price", "available"], "delete": true}, "product_variant_group_limits": {"insert": ["variant_id", "group_id", "min_select", "max_select"], "update": ["min_select", "max_select"], "delete": true}, "product_templates": {"insert": [], "update": [], "delete": false}, "product_template_versions": {"insert": [], "update": [], "delete": false}, "customers": {"insert": ["name", "phone", "city", "street", "number", "neighborhood", "complement", "restaurant_id"], "update": ["name", "phone", "city", "street", "number", "neighborhood", "complement"], "delete": true}, "bairros": {"insert": ["bairro", "frete", "lanchonete_id"], "update": ["bairro", "frete"], "delete": true}, "orders": {"insert": ["restaurant_id", "customer_id", "status", "total_price", "payment_method", "change_for", "delivery_address", "bairro_id", "fulfillment_type", "subtotal", "delivery_fee", "pickup_address"], "update": ["status"], "delete": true}, "order_items": {"insert": ["order_id", "product_id", "quantity", "item_price", "variant_id", "variant_name"], "update": [], "delete": true}, "order_item_options": {"insert": ["order_item_id", "option_id", "option_name", "group_name", "additional_price"], "update": [], "delete": false}, "chats": {"insert": ["order_id", "restaurant_id"], "update": [], "delete": true}, "chat_messages": {"insert": ["chat_id", "sender_type", "sender_id", "message", "name"], "update": [], "delete": true}, "password_tokens": {"insert": ["email", "token", "expires_at"], "update": ["token", "expires_at"], "delete": true}, "restaurant_product_templates": {"insert": ["restaurant_id", "name", "description"], "update": ["name", "description", "updated_at"], "delete": true, "private": true}, "restaurant_product_template_versions": {"insert": ["template_id", "restaurant_id", "version", "configuration", "active"], "update": ["active"], "delete": true, "private": true}}$manifest$::jsonb) LOOP
        target:=to_regclass(format('public.%I',entry.key));
        IF target IS NULL THEN RAISE EXCEPTION 'Missing table public.%',entry.key; END IF;
        IF NOT has_table_privilege(app,target,'SELECT') THEN RAISE EXCEPTION 'Missing SELECT on %',entry.key; END IF;
        IF has_table_privilege(app,target,'INSERT') OR has_table_privilege(app,target,'UPDATE')
           OR has_table_privilege(app,target,'TRUNCATE,REFERENCES,TRIGGER') THEN
            RAISE EXCEPTION 'Unexpected table-level privilege on %; inspect direct/PUBLIC grants',entry.key; END IF;
        IF has_table_privilege(app,target,'DELETE') IS DISTINCT FROM (entry.value->>'delete')::boolean THEN RAISE EXCEPTION 'DELETE mismatch on %',entry.key; END IF;
        FOR col IN SELECT attname FROM pg_attribute WHERE attrelid=target AND attnum>0 AND NOT attisdropped LOOP
            wanted:=EXISTS(SELECT 1 FROM jsonb_array_elements_text(entry.value->'insert') x WHERE x=col.attname);
            IF has_column_privilege(app,target,col.attname,'INSERT') IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'INSERT mismatch on %.%',entry.key,col.attname; END IF;
            wanted:=EXISTS(SELECT 1 FROM jsonb_array_elements_text(entry.value->'update') x WHERE x=col.attname);
            IF has_column_privilege(app,target,col.attname,'UPDATE') IS DISTINCT FROM wanted THEN RAISE EXCEPTION 'UPDATE mismatch on %.%',entry.key,col.attname; END IF;
        END LOOP;
        IF COALESCE((entry.value->>'private')::boolean,false) THEN
            IF NOT row_security_active(target) OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=target AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'RLS must be active/forced on %',entry.key; END IF;
        ELSIF EXISTS (SELECT 1 FROM pg_class WHERE oid=target AND relrowsecurity) THEN
            RAISE EXCEPTION 'Existing RLS on % requires separate compatibility review',entry.key;
        END IF;
    END LOOP;
    FOR col IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND c.relname NOT IN ('restaurants', 'restaurant_types', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'product_templates', 'product_template_versions', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens', 'restaurant_product_templates', 'restaurant_product_template_versions') LOOP
        IF has_table_privilege(app,col.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR has_any_column_privilege(app,col.oid,'SELECT,INSERT,UPDATE,REFERENCES') THEN
            RAISE EXCEPTION 'Unexpected access to public.% via PUBLIC/other ACL',col.relname; END IF;
    END LOOP;
    FOR seq IN
        WITH inserted_tables AS (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('restaurants', 'restaurant_type_links', 'products', 'product_variants', 'product_option_groups', 'product_options', 'product_variant_group_limits', 'customers', 'bairros', 'orders', 'order_items', 'order_item_options', 'chats', 'chat_messages', 'password_tokens', 'restaurant_product_templates', 'restaurant_product_template_versions')),
        required AS (
            SELECT to_regclass(pg_get_serial_sequence(format('%I.%I',n.nspname,c.relname),a.attname)) AS oid
            FROM inserted_tables t JOIN pg_class c ON c.oid=t.oid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped
            UNION SELECT dep.refobjid FROM inserted_tables t JOIN pg_attrdef d ON d.adrelid=t.oid
            JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid AND dep.refclassid='pg_class'::regclass
            JOIN pg_class s ON s.oid=dep.refobjid AND s.relkind='S'
        ) SELECT s.oid,n.nspname,s.relname FROM required r JOIN pg_class s ON s.oid=r.oid JOIN pg_namespace n ON n.oid=s.relnamespace
    LOOP
        IF seq.nspname<>'public' OR NOT has_sequence_privilege(app,seq.oid,'USAGE') OR has_sequence_privilege(app,seq.oid,'UPDATE,SELECT') THEN
            RAISE EXCEPTION 'Sequence privilege mismatch on %.%',seq.nspname,seq.relname; END IF;
    END LOOP;
    IF NOT has_function_privilege(app,'pg_catalog.gen_random_uuid()','EXECUTE')
       OR NOT has_function_privilege(app,'pg_catalog.set_config(text,text,boolean)','EXECUTE')
       OR NOT has_function_privilege(app,'pg_catalog.current_setting(text,boolean)','EXECUTE')
       OR NOT has_function_privilege(app,'pg_catalog.row_security_active(oid)','EXECUTE') THEN RAISE EXCEPTION 'Missing required built-in function EXECUTE'; END IF;
END
$verify$;
SELECT 'gama_app role/ACL/RLS metadata verified; behavioral tests remain mandatory' AS result;
ROLLBACK;
