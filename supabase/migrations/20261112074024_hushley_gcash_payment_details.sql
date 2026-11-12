create table public.gcash_payment_details (
  id boolean primary key default true check (id),
  account_name text not null default '' check (char_length(account_name) <= 120),
  account_number text not null default '' check (char_length(account_number) <= 40),
  check ((length(trim(account_name)) = 0 and length(trim(account_number)) = 0) or (length(trim(account_name)) > 0 and length(trim(account_number)) > 0))
);
alter table public.gcash_payment_details enable row level security;
revoke all on public.gcash_payment_details from public, anon, authenticated;
grant select on public.gcash_payment_details to authenticated;
grant update (account_name, account_number) on public.gcash_payment_details to authenticated;
create policy "Signed-in customers can read GCash payment details" on public.gcash_payment_details for select to authenticated using (true);
create policy "Only admins can update GCash payment details" on public.gcash_payment_details for update to authenticated using ((select private.is_hushley_admin())) with check ((select private.is_hushley_admin()));
insert into public.gcash_payment_details (id) values (true);
