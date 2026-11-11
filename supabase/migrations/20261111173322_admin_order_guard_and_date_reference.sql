begin;

-- An internal reference, not a courier-issued tracking number. Existing numbers stay unchanged.
alter table public.orders alter column order_number set default
  ('HUS-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)));

create function private.prevent_admin_order() returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and private.is_hushley_admin() then
    raise exception 'Administrator accounts cannot place customer orders';
  end if;
  return new;
end; $$;
revoke all on function private.prevent_admin_order() from public, anon, authenticated;
create trigger prevent_admin_order before insert on public.orders
  for each row execute function private.prevent_admin_order();

-- Staff listing excludes all Auth accounts with the trusted admin claim.
create function public.admin_customer_profiles()
returns table (id uuid, full_name text, phone text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Administrator access required'; end if;
  return query select p.id, p.full_name, p.phone, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    where coalesce(u.raw_app_meta_data->>'role', '') <> 'admin' and p.id <> auth.uid();
end; $$;
revoke all on function public.admin_customer_profiles() from public, anon;
grant execute on function public.admin_customer_profiles() to authenticated;

commit;
