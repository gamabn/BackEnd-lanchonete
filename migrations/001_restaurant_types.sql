-- Version 001: establishment types. Apply once, only after authorization.
BEGIN;

-- The repository has no authoritative schema dump. Never convert an existing ID.
DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute
        WHERE attrelid = pg_catalog.to_regclass('public.restaurants')
          AND attname = 'id'
          AND atttypid = 'pg_catalog.uuid'::regtype
          AND attnum > 0
          AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42804',
            MESSAGE = 'Migration 001 requires public.restaurants.id with type UUID; no existing table will be converted.';
    END IF;
END
$migration$;

CREATE TABLE public.restaurant_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE public.restaurant_type_links (
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    type_id UUID NOT NULL REFERENCES public.restaurant_types(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (restaurant_id, type_id)
);

CREATE UNIQUE INDEX restaurant_type_links_one_primary_per_restaurant
    ON public.restaurant_type_links (restaurant_id)
    WHERE is_primary;

INSERT INTO public.restaurant_types (name, slug, active)
VALUES
    ('Pizzaria', 'pizzaria', TRUE),
    ('Lanchonete', 'lanchonete', TRUE),
    ('Hamburgueria', 'hamburgueria', TRUE),
    ('Pastelaria', 'pastelaria', TRUE),
    ('Restaurante', 'restaurante', TRUE),
    ('Açaiteria', 'acaiteria', TRUE),
    ('Outros', 'outros', TRUE)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
