-- Manual execution only, as the migration owner. No customer email is backfilled.
BEGIN;
ALTER TABLE public.customers
    ADD COLUMN email TEXT NULL,
    ADD COLUMN email_verified_at TIMESTAMPTZ NULL,
    ADD CONSTRAINT customers_email_consistency CHECK (
        (email IS NULL AND email_verified_at IS NULL) OR
        (email IS NOT NULL AND email_verified_at IS NOT NULL AND email <> '' AND email = lower(btrim(email)))
    ),
    ADD CONSTRAINT customers_email_owner_key UNIQUE (id, restaurant_id);

CREATE UNIQUE INDEX customers_verified_email_per_restaurant
    ON public.customers (restaurant_id, email) WHERE email_verified_at IS NOT NULL;

CREATE TABLE public.customer_email_challenges (
    id UUID PRIMARY KEY,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL,
    email TEXT NOT NULL CHECK (email <> '' AND email = lower(btrim(email))),
    code_hash TEXT NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NULL,
    consumed_at TIMESTAMPTZ NULL,
    CONSTRAINT customer_email_challenge_owner_fk FOREIGN KEY (customer_id, restaurant_id)
        REFERENCES public.customers(id, restaurant_id) ON DELETE RESTRICT,
    CONSTRAINT customer_email_challenge_expiry CHECK (
        expires_at > created_at AND expires_at <= created_at + INTERVAL '5 minutes'
    )
);
CREATE INDEX customer_email_challenges_owner_created
    ON public.customer_email_challenges (restaurant_id, customer_id, created_at);

GRANT UPDATE (email, email_verified_at) ON public.customers TO gama_app;
GRANT SELECT ON public.customer_email_challenges TO gama_app;
GRANT INSERT (id, restaurant_id, customer_id, email, code_hash, expires_at)
    ON public.customer_email_challenges TO gama_app;
GRANT UPDATE (attempts, sent_at, consumed_at)
    ON public.customer_email_challenges TO gama_app;
COMMIT;
