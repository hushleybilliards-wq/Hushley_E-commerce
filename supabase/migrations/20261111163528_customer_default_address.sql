begin;
alter table public.profiles add column default_address jsonb
  check (default_address is null or (jsonb_typeof(default_address) = 'object' and octet_length(default_address::text) <= 8192));
-- Existing profile RLS permits customers to update only their own profile.
grant update (default_address) on public.profiles to authenticated;
comment on column public.profiles.default_address is 'Customer-selected checkout address; prior orders keep their own snapshots.';
commit;
