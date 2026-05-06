-- S6 follow-up: ensure backend service_role can mutate entitlement rows.
-- RLS may be bypassed by service_role, but table privileges are still required.

grant select, insert, update, delete
  on table public.user_entitlements
  to service_role;
