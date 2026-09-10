-- CAN Logger Dashboard - lock down direct RPC access to handle_new_user().
--
-- ALREADY APPLIED to the cloud project (can-logger-dashboard, migration version
-- 20260905052207) from the Supabase SQL editor. It is backfilled here so the
-- repo's migration history matches what is deployed. Safe to re-run.
--
-- handle_new_user() is internal trigger logic: it fires on insert into
-- auth.users (see on_auth_user_created in 0001_init.sql) to create the profiles
-- row. It was never meant to be callable directly through PostgREST's
-- /rest/v1/rpc endpoint. Revoking EXECUTE from the API roles closes that path;
-- the trigger still fires because trigger invocation does not check EXECUTE
-- grants. Flagged by the Supabase database linter.

revoke execute on function public.handle_new_user() from anon, authenticated, public;
