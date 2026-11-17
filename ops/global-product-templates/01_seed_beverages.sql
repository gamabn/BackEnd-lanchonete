-- Execute this ENTIRE file, from BEGIN through COMMIT, in the Neon SQL Editor.
-- RETURNING ... INTO is PL/pgSQL: never execute it outside DO $seed$ ... $seed$.
-- DATA ONLY. Execute manually as the platform owner, never as the application role.
-- No existing template/version is updated, reactivated or deleted, including slug collisions.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $seed$
DECLARE
    item JSONB;
    template_id public.product_templates.id%TYPE;
    relation RECORD;
    missing_columns TEXT;
BEGIN
    FOR relation IN
        SELECT oid, relname, relowner FROM pg_catalog.pg_class
        WHERE oid IN ('public.product_templates'::regclass, 'public.product_template_versions'::regclass)
    LOOP
        IF NOT pg_catalog.pg_has_role(current_user, relation.relowner, 'USAGE') THEN
            RAISE EXCEPTION 'Execute this data load as the platform table owner';
        END IF;

        -- Fail before writing if the real schema requires another column without a default.
        SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing_columns
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = relation.oid AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attnotnull AND NOT a.atthasdef
          AND a.attidentity = '' AND a.attgenerated = ''
          AND NOT (a.attname = ANY (
            CASE WHEN relation.relname = 'product_templates'
              THEN ARRAY['name', 'slug', 'active']
              ELSE ARRAY['template_id', 'version', 'configuration', 'active']
            END
          ));
        IF missing_columns IS NOT NULL THEN
            RAISE EXCEPTION 'Required columns without defaults in public.%: %. Review the schema before loading data.',
                relation.relname, missing_columns;
        END IF;
    END LOOP;

    -- Serialize data loads without introducing tables or relying on version uniqueness.
    LOCK TABLE public.product_templates, public.product_template_versions IN SHARE ROW EXCLUSIVE MODE;

    FOR item IN SELECT value FROM jsonb_array_elements($beverages$
    [
      {
        "slug": "bebida-refrigerante-cola-350ml",
        "configuration": {
          "name": "Refrigerante de cola",
          "description": "Refrigerante de cola, lata de 350 ml. Preço ilustrativo e editável.",
          "variants": [{ "name": "350 ml", "price": 6.00 }],
          "optionGroups": [],
          "variantGroupLimits": {}
        }
      },
      {
        "slug": "bebida-suco-laranja-300ml",
        "configuration": {
          "name": "Suco de laranja",
          "description": "Suco de laranja, copo de 300 ml. Preço ilustrativo e editável.",
          "variants": [{ "name": "300 ml", "price": 8.00 }],
          "optionGroups": [],
          "variantGroupLimits": {}
        }
      },
      {
        "slug": "bebida-agua-mineral-sem-gas-500ml",
        "configuration": {
          "name": "Água mineral sem gás",
          "description": "Água mineral sem gás, garrafa de 500 ml. Preço ilustrativo e editável.",
          "variants": [{ "name": "500 ml", "price": 4.00 }],
          "optionGroups": [],
          "variantGroupLimits": {}
        }
      },
      {
        "slug": "bebida-cerveja-long-neck-330ml",
        "configuration": {
          "name": "Cerveja long neck",
          "description": "Cerveja, garrafa long neck de 330 ml. Preço ilustrativo e editável.",
          "variants": [{ "name": "330 ml", "price": 10.00 }],
          "optionGroups": [],
          "variantGroupLimits": {}
        }
      }
    ]
    $beverages$::jsonb)
    LOOP
        template_id := NULL;
        INSERT INTO public.product_templates (name, slug, active)
        VALUES (item -> 'configuration' ->> 'name', item ->> 'slug', TRUE)
        ON CONFLICT (slug) DO NOTHING
        RETURNING id INTO template_id; -- Valid only inside this DO block.

        IF template_id IS NOT NULL THEN
            INSERT INTO public.product_template_versions (template_id, version, configuration, active)
            VALUES (template_id, 1, item -> 'configuration', TRUE);
            RAISE NOTICE 'Created beverage template: %', item ->> 'slug';
        ELSE
            RAISE NOTICE 'Preserved existing template (no changes): %', item ->> 'slug';
        END IF;
    END LOOP;
END
$seed$;
COMMIT;
