begin;

-- GCash remains in its existing table so current receiving details stay intact.
create table public.other_payment_details (
  method text primary key check (method in ('maribank', 'paypal', 'pnb')),
  account_name text not null default '' check (char_length(account_name) <= 120),
  account_identifier text not null default '' check (char_length(account_identifier) <= 120),
  check ((length(trim(account_name)) = 0 and length(trim(account_identifier)) = 0)
      or (length(trim(account_name)) > 0 and length(trim(account_identifier)) > 0))
);
alter table public.other_payment_details enable row level security;
revoke all on public.other_payment_details from public, anon, authenticated;
grant select on public.other_payment_details to authenticated;
grant update (account_name, account_identifier) on public.other_payment_details to authenticated;
create policy "Customers and owner read other payment details" on public.other_payment_details
  for select to authenticated using (coalesce(auth.jwt()->'app_metadata'->>'role', '') <> 'staff');
create policy "Only admins update other payment details" on public.other_payment_details
  for update to authenticated using ((select private.is_hushley_admin())) with check ((select private.is_hushley_admin()));
insert into public.other_payment_details (method) values ('maribank'), ('paypal'), ('pnb');

commit;
