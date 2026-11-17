-- Execute manually in Neon as the migration owner, before deploying recovery.
-- Existing challenges remain verification-only. No roles or RLS are created.
BEGIN;
ALTER TABLE public.customer_email_challenges
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'verification'
    CHECK (purpose IN ('verification', 'recovery'));
GRANT INSERT (purpose) ON public.customer_email_challenges TO gama_app;
COMMIT;
