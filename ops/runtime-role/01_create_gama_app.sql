-- PREPARED ONLY. Run manually as gamabn/authorized role administrator, NOT from backend startup.
-- Intentionally fails if gama_app already exists: inspect it instead of changing an unknown role.
BEGIN;
CREATE ROLE gama_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
    NOREPLICATION NOINHERIT PASSWORD NULL;
-- No password is stored in this repository. Provision a strong password separately before login.
-- Never grant gamabn, neon_superuser, pg_database_owner or any administrative membership to gama_app.
COMMIT;
