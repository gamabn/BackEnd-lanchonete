-- Apply once, manually, in neondb as gamabn (owner of public.products).
-- Additive only: no backfill, default, RLS change or table-wide write grant.
-- Existing products remain NULL. A repeated execution fails and rolls back.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.products
    ADD COLUMN category VARCHAR(80) NULL;

GRANT INSERT (category), UPDATE (category) ON TABLE public.products TO gama_app;

COMMIT;
