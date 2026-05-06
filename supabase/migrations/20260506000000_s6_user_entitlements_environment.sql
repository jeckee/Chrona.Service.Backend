-- S6 patch: ensure `environment` column exists on public.user_entitlements.
--
-- The original S6 migration (20260505193000_s6_user_entitlements.sql) wrapped
-- the table in `create table if not exists`. On databases where an earlier
-- revision of the table already existed (without the `environment` column),
-- the entire create statement was skipped and the new column was silently
-- omitted, even though `supabase migration list` reports the migration as
-- applied. This caused PostgREST PGRST204 errors:
--
--   Could not find the 'environment' column of 'user_entitlements'
--   in the schema cache
--
-- Use `add column if not exists` so this patch is idempotent across both
-- already-fixed and never-fixed databases.

alter table public.user_entitlements
  add column if not exists environment text;

-- Ask PostgREST to reload its schema cache immediately. DDL normally triggers
-- this automatically, but emitting the notify explicitly avoids a window
-- where writes still see the stale cache.
notify pgrst, 'reload schema';
