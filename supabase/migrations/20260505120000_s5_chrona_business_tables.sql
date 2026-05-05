-- S5: Chrona minimal business tables, updated_at triggers, RLS
-- users.id maps to auth.users.id (extension profile, not login credentials)

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- public.users
-- -----------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_email_idx on public.users (email);

comment on table public.users is 'Chrona app profile; id matches auth.users.id. No passwords or provider tokens.';

-- -----------------------------------------------------------------------------
-- public.subscriptions
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.users (id) on delete cascade,
  product_id text,
  original_transaction_id text,
  status text not null default 'inactive'
    check (
      status in (
        'inactive',
        'active',
        'expired',
        'canceled',
        'refunded'
      )
    ),
  expires_at timestamptz,
  environment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now ()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- public.agent_usage_logs
-- -----------------------------------------------------------------------------
create table public.agent_usage_logs (
  id uuid primary key default gen_random_uuid (),
  user_id uuid not null references public.users (id) on delete cascade,
  feature text not null check (feature in ('schedule', 'summary')),
  model text,
  input_chars integer,
  output_chars integer,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric,
  success boolean not null,
  error_code text,
  error_message text,
  created_at timestamptz not null default now ()
);

create index agent_usage_logs_user_id_idx on public.agent_usage_logs (user_id);
create index agent_usage_logs_created_at_idx on public.agent_usage_logs (created_at);

comment on table public.agent_usage_logs is 'AI usage metrics only; no full prompts or outputs.';

-- -----------------------------------------------------------------------------
-- updated_at trigger (shared)
-- -----------------------------------------------------------------------------
create or replace function public.handle_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row
  execute function public.handle_updated_at ();

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row
  execute function public.handle_updated_at ();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.users enable row level security;

alter table public.subscriptions enable row level security;

alter table public.agent_usage_logs enable row level security;

-- users: own row only
create policy users_select_own on public.users
  for select
  using (auth.uid () = id);

create policy users_insert_own on public.users
  for insert
  with check (auth.uid () = id);

create policy users_update_own on public.users
  for update
  using (auth.uid () = id)
  with check (auth.uid () = id);

-- subscriptions: read-only for own rows (no client writes)
create policy subscriptions_select_own on public.subscriptions
  for select
  using (auth.uid () = user_id);

-- usage logs: insert own rows only; no reads from clients
create policy agent_usage_logs_insert_own on public.agent_usage_logs
  for insert
  to authenticated
  with check (auth.uid () = user_id);

-- -----------------------------------------------------------------------------
-- Grants (authenticated JWT + anon key)
-- -----------------------------------------------------------------------------
revoke all on table public.users from anon;
revoke all on table public.subscriptions from anon;
revoke all on table public.agent_usage_logs from anon;

grant select, insert, update on table public.users to authenticated;

grant select on table public.subscriptions to authenticated;

grant insert on table public.agent_usage_logs to authenticated;
