create table if not exists public.apple_notification_logs (
  id uuid primary key default gen_random_uuid(),
  notification_uuid text unique,
  notification_type text,
  subtype text,
  environment text,
  bundle_id text,
  app_apple_id bigint,
  original_transaction_id text,
  transaction_id text,
  product_id text,
  signed_payload text not null,
  decoded_payload jsonb,
  decoded_transaction jsonb,
  decoded_renewal_info jsonb,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed', 'duplicate')),
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists apple_notification_logs_created_at_idx
  on public.apple_notification_logs (created_at desc);

alter table public.apple_notification_logs enable row level security;

revoke all on table public.apple_notification_logs from anon;
revoke all on table public.apple_notification_logs from authenticated;

grant select, insert, update
  on table public.apple_notification_logs
  to service_role;
