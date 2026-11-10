-- Grant the store owner admin privileges only after the exact mailbox is verified.
-- Supabase Auth creates the account; this migration does not create a password or user.
create or replace function private.grant_hushley_owner_admin_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(coalesce(new.email, '')) = 'hushleybilliards@gmail.com'
     and new.email_confirmed_at is not null
     and coalesce(new.raw_app_meta_data ->> 'role', '') <> 'admin' then
    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('role', 'admin')
    where id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function private.grant_hushley_owner_admin_role()
  from public, anon, authenticated;

drop trigger if exists grant_hushley_owner_admin_role on auth.users;
create trigger grant_hushley_owner_admin_role
  after insert or update on auth.users
  for each row
  execute function private.grant_hushley_owner_admin_role();

-- Also promote the owner if the verified account was created before this migration.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || pg_catalog.jsonb_build_object('role', 'admin')
where lower(email) = 'hushleybilliards@gmail.com'
  and email_confirmed_at is not null
  and coalesce(raw_app_meta_data ->> 'role', '') <> 'admin';
