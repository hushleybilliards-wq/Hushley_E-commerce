-- Register this function as the Before User Created Auth hook in the dashboard.
-- Creating the function alone does not enable the hook.
create or replace function public.hushley_gmail_signup_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  signup_email text := lower(trim(coalesce(event->'user'->>'email', '')));
begin
  if signup_email !~ '^[^@+[:space:]]+@gmail[.]com$' then
    return jsonb_build_object('error', jsonb_build_object(
      'message', 'Use a Gmail address ending in @gmail.com without a + sign.',
      'http_code', 403
    ));
  end if;
  return '{}'::jsonb;
end;
$$;

revoke all on function public.hushley_gmail_signup_hook(jsonb) from public, anon, authenticated;
grant execute on function public.hushley_gmail_signup_hook(jsonb) to supabase_auth_admin;
