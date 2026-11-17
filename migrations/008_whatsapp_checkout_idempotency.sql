-- PREPARED ONLY. Apply manually after preflight/approval. Never run on app startup.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Reuse migration 003's non-deferrable owner key; never create a duplicate index.
-- Fail before DDL if the parent types or that previously versioned constraint differ.
DO $parents$
DECLARE field RECORD;
BEGIN
    FOR field IN SELECT * FROM (VALUES
        ('restaurants','id'), ('customers','id'), ('customers','restaurant_id'),
        ('orders','id'), ('orders','restaurant_id'), ('orders','customer_id')
    ) AS fields(table_name,column_name) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = to_regclass(format('public.%I',field.table_name))
              AND a.attname = field.column_name AND NOT a.attisdropped
              AND a.atttypid = 'uuid'::regtype
        ) THEN
            RAISE EXCEPTION 'Expected UUID public.%.%; inspect the schema before migration 008',field.table_name,field.column_name;
        END IF;
    END LOOP;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
        WHERE c.conrelid = 'public.customers'::regclass
          AND c.conname = 'customers_email_owner_key' AND c.contype = 'u'
          AND c.convalidated AND NOT c.condeferrable
          AND i.indisvalid AND i.indisready AND i.indimmediate
          AND c.conkey = ARRAY[
              (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'id'),
              (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attname = 'restaurant_id')
          ]::smallint[]
    ) THEN
        RAISE EXCEPTION 'Migration 003 owner key customers_email_owner_key(id, restaurant_id) is required; do not apply older migrations automatically';
    END IF;
END
$parents$;

-- This additional parent index is required for the order/owner composite FK.
CREATE UNIQUE INDEX orders_checkout_owner_idx ON public.orders (id, restaurant_id, customer_id);

CREATE TABLE public.whatsapp_checkout_intents (
    intent_id UUID PRIMARY KEY,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL,
    session_id UUID NOT NULL,
    account_id TEXT NOT NULL CHECK (length(account_id) BETWEEN 1 AND 256),
    sender_id TEXT NOT NULL CHECK (length(sender_id) BETWEEN 1 AND 256),
    whatsapp_phone TEXT NOT NULL CHECK (whatsapp_phone ~ '^[1-9][0-9]{6,14}$'),
    canonical_checkout TEXT NOT NULL CHECK (jsonb_typeof(canonical_checkout::jsonb) = 'object'),
    checkout_hash TEXT NOT NULL CHECK (checkout_hash ~ '^[0-9a-f]{64}$'),
    state TEXT NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'COMPLETED', 'RECOVERABLE_FAILURE')),
    order_id UUID NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    retired_at TIMESTAMPTZ NULL,
    identity_revision BIGINT GENERATED ALWAYS AS (
        CASE WHEN jsonb_typeof(canonical_checkout::jsonb->'identityRevision') = 'number'
                  AND canonical_checkout::jsonb->>'identityRevision' ~ '^[0-9]+$'
             THEN (canonical_checkout::jsonb->>'identityRevision')::bigint ELSE NULL END
    ) STORED,
    CHECK (identity_revision IS NULL OR identity_revision BETWEEN 0 AND 9007199254740991),
    CHECK (NOT active OR (retired_at IS NULL AND identity_revision IS NOT NULL)),
    failure_code TEXT NULL CHECK (failure_code IN ('TRANSACTION_ABORTED', 'REVALIDATION_REQUIRED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (customer_id, restaurant_id) REFERENCES public.customers(id, restaurant_id) ON DELETE RESTRICT,
    FOREIGN KEY (order_id, restaurant_id, customer_id) REFERENCES public.orders(id, restaurant_id, customer_id) ON DELETE RESTRICT,
    CHECK (checkout_hash = encode(sha256(convert_to(canonical_checkout, 'UTF8')), 'hex')),
    CHECK (((canonical_checkout::jsonb)->>'version' = '1') IS TRUE),
    CHECK ((canonical_checkout::jsonb)->'scope' IS NOT DISTINCT FROM
        jsonb_build_array(restaurant_id::text, customer_id::text, session_id::text, account_id, sender_id, whatsapp_phone)),
    CHECK ((state = 'COMPLETED' AND order_id IS NOT NULL AND failure_code IS NULL)
        OR (state = 'PENDING' AND order_id IS NULL AND failure_code IS NULL)
        OR (state = 'RECOVERABLE_FAILURE' AND order_id IS NULL AND failure_code IS NOT NULL))
);

CREATE INDEX whatsapp_checkout_scope_created_idx ON public.whatsapp_checkout_intents
    (restaurant_id, customer_id, session_id, account_id, sender_id, whatsapp_phone, created_at DESC, intent_id);

-- All persistent states participate while active, including COMPLETED (lost-response recovery).
-- Excluding phone/generation deliberately prevents two active identities/epochs in one logical scope.
CREATE UNIQUE INDEX whatsapp_checkout_one_active_scope_idx ON public.whatsapp_checkout_intents
    (restaurant_id, customer_id, session_id, account_id, sender_id) WHERE active;

CREATE FUNCTION public.guard_whatsapp_checkout_intent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $guard$
BEGIN
    IF ROW(NEW.intent_id, NEW.restaurant_id, NEW.customer_id, NEW.session_id,
           NEW.account_id, NEW.sender_id, NEW.whatsapp_phone, NEW.canonical_checkout, NEW.checkout_hash, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.intent_id, OLD.restaurant_id, OLD.customer_id, OLD.session_id,
           OLD.account_id, OLD.sender_id, OLD.whatsapp_phone, OLD.canonical_checkout, OLD.checkout_hash, OLD.created_at) THEN
        RAISE EXCEPTION 'Checkout intent binding is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'COMPLETED' AND ROW(NEW.state, NEW.order_id, NEW.failure_code, NEW.active, NEW.retired_at)
       IS DISTINCT FROM ROW(OLD.state, OLD.order_id, OLD.failure_code, OLD.active, OLD.retired_at) THEN
        RAISE EXCEPTION 'Completed checkout intent is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.retired_at IS NOT NULL AND ROW(NEW.active, NEW.retired_at, NEW.state, NEW.order_id, NEW.failure_code)
       IS DISTINCT FROM ROW(OLD.active, OLD.retired_at, OLD.state, OLD.order_id, OLD.failure_code) THEN
        RAISE EXCEPTION 'Retired checkout intent cannot be reused' USING ERRCODE = '23514';
    END IF;
    IF OLD.active AND NOT NEW.active AND NEW.retired_at IS NULL THEN
        RAISE EXCEPTION 'Deactivation must retain retirement history' USING ERRCODE = '23514';
    END IF;
    IF OLD.state = 'RECOVERABLE_FAILURE' AND NEW.state = 'COMPLETED' THEN
        RAISE EXCEPTION 'Recoverable intent must be claimed before completion' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END
$guard$;
CREATE TRIGGER whatsapp_checkout_intent_guard BEFORE UPDATE ON public.whatsapp_checkout_intents
    FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_checkout_intent();

GRANT SELECT ON public.whatsapp_checkout_intents TO gama_app;
GRANT INSERT (intent_id, restaurant_id, customer_id, session_id, account_id, sender_id,
              whatsapp_phone, canonical_checkout, checkout_hash) ON public.whatsapp_checkout_intents TO gama_app;
GRANT UPDATE (state, order_id, failure_code, active, retired_at) ON public.whatsapp_checkout_intents TO gama_app;
-- No DELETE grant. A completion is retained for replay/recovery.
COMMIT;
