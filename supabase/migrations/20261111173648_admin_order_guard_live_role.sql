begin;
-- Check current Auth data as well as JWT claims, which can lag until token refresh.
create or replace function private.prevent_admin_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (private.is_hushley_admin() or exists (
    select 1 from auth.users u where u.id = auth.uid() and u.raw_app_meta_data->>'role' = 'admin'
  )) then
    raise exception 'Administrator accounts cannot place customer orders';
  end if;
  return new;
end; $$;
revoke all on function private.prevent_admin_order() from public, anon, authenticated;
commit;
