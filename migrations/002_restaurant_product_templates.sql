-- Approved architecture; application to Neon remains pending explicit authorization and schema/role review.
-- Apply once manually. Never run from application startup or remote integration tests.
-- Does not alter global templates, products, orders, or their relationships.
BEGIN;

DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = pg_catalog.to_regclass('public.restaurants')
          AND attname = 'id' AND atttypid = 'pg_catalog.uuid'::regtype
          AND attnum > 0 AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42804',
            MESSAGE = 'Migration 002 requires public.restaurants.id as UUID; existing schema will not be converted.';
    END IF;
END
$migration$;

CREATE TABLE public.restaurant_product_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Required target for the composite ownership FK below.
    UNIQUE (id, restaurant_id)
);

CREATE UNIQUE INDEX restaurant_product_templates_owner_name
    ON public.restaurant_product_templates (restaurant_id, lower(btrim(name)));

CREATE TABLE public.restaurant_product_template_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL,
    restaurant_id UUID NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    configuration JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT restaurant_product_template_versions_owner_fk
        FOREIGN KEY (template_id, restaurant_id)
        REFERENCES public.restaurant_product_templates (id, restaurant_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    UNIQUE (template_id, version),
    -- Basic envelope only; API must validate prices, choices, keys and limits.
    CONSTRAINT restaurant_product_template_versions_snapshot_shape CHECK (
        jsonb_typeof(configuration) = 'object'
        AND configuration ?& ARRAY['schemaVersion', 'product', 'variants', 'groups', 'variantGroupLimits']
        AND configuration -> 'schemaVersion' = '1'::jsonb
        AND jsonb_typeof(configuration -> 'product') = 'object'
        AND jsonb_typeof(configuration -> 'variants') = 'array'
        AND jsonb_typeof(configuration -> 'groups') = 'array'
        AND jsonb_typeof(configuration -> 'variantGroupLimits') = 'array'
        AND octet_length(configuration::text) <= 1048576
    )
);

-- At most one current version. API creates/switches versions atomically under a parent lock.
CREATE UNIQUE INDEX restaurant_product_template_versions_one_active
    ON public.restaurant_product_template_versions (template_id) WHERE active;

CREATE INDEX restaurant_product_template_versions_owner_history
    ON public.restaurant_product_template_versions (restaurant_id, template_id, version DESC);

-- Fail closed when no tenant was set in the current transaction.
-- API uses set_config('gama.restaurant_id', authenticated req.user_id, true) on the same transaction/client.
-- Role must be NOSUPERUSER NOBYPASSRLS; no permissions or roles are changed here.
ALTER TABLE public.restaurant_product_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_product_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY restaurant_product_templates_owner
    ON public.restaurant_product_templates FOR ALL
    USING (restaurant_id = NULLIF(current_setting('gama.restaurant_id', true), '')::uuid)
    WITH CHECK (restaurant_id = NULLIF(current_setting('gama.restaurant_id', true), '')::uuid);

ALTER TABLE public.restaurant_product_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_product_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY restaurant_product_template_versions_owner
    ON public.restaurant_product_template_versions FOR ALL
    USING (restaurant_id = NULLIF(current_setting('gama.restaurant_id', true), '')::uuid)
    WITH CHECK (restaurant_id = NULLIF(current_setting('gama.restaurant_id', true), '')::uuid);

-- No seeds, product links, cascade deletion or modifications to existing tables.
COMMIT;
