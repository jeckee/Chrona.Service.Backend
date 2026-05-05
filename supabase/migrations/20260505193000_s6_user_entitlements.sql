-- S6: user entitlement state for subscription gating.
-- Writes are server-authoritative via service_role; clients can only read their own row.

create table if not exists public.user_entitlements (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.users (id) on delete cascade,
  status text not null
    check (status in ('none', 'trial', 'active', 'expired')),
  product_id text,
  original_transaction_id text,
  latest_transaction_id text,
  environment text,
  expires_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- `unique (user_id)` already provides a unique btree index on user_id,
-- so a separate user_id index would be redundant.
create index if not exists user_entitlements_status_idx
  on public.user_entitlements (status);

create trigger user_entitlements_set_updated_at
  before update on public.user_entitlements
  for each row
  execute function public.handle_updated_at ();

alter table public.user_entitlements enable row level security;

-- Clients may only read their own entitlement. All mutations must go through
-- the server using the service_role key (which bypasses RLS).
create policy user_entitlements_select_own on public.user_entitlements
  for select
  to authenticated
  using (auth.uid () = user_id);

revoke all on table public.user_entitlements from anon;
revoke all on table public.user_entitlements from authenticated;
grant select on table public.user_entitlements to authenticated;
