-- OPTIONAL ROLLBACK STEP ONLY. Run manually as gamabn AFTER all gama_app backend pools are stopped.
-- Does not terminate existing sessions, revoke grants, drop the role or delete data.
BEGIN;
DO $guard$
BEGIN
    IF current_database()<>'neondb' OR current_user='gama_app' THEN RAISE EXCEPTION 'Use administrative connection to neondb'; END IF;
END
$guard$;
ALTER ROLE gama_app NOLOGIN;
COMMIT;
