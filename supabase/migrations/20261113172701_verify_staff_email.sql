begin;

-- Check current Auth state on every privileged request, including old sessions.
create or replace function private.is_active_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.staff_accounts s join auth.users u on u.id = s.user_id
    where s.user_id = (select auth.uid()) and s.active and u.email_confirmed_at is not null
      and u.raw_app_meta_data->>'role' = 'staff'
  );
$$;

drop function public.owner_staff_accounts();
create function public.owner_staff_accounts()
returns table(user_id uuid, display_name text, email text, active boolean, email_verified boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hushley_admin() then raise exception 'Owner access required'; end if;
  return query select s.user_id, s.display_name, s.email, s.active, u.email_confirmed_at is not null, s.created_at
    from private.staff_accounts s join auth.users u on u.id = s.user_id order by s.created_at desc;
end; $$;
revoke all on function public.owner_staff_accounts() from public, anon;
grant execute on function public.owner_staff_accounts() to authenticated;

commit;
