-- A signed JWT can outlive a deleted Auth user. Require an extant customer
-- profile for customer-owned proof access, while keeping the admin path intact.
begin;
drop policy if exists "Customers upload own payment proofs" on storage.objects;
create policy "Customers upload own payment proofs" on storage.objects
for insert to authenticated with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~* '\.(jpg|jpeg|png|webp)$'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
);
drop policy if exists "Customers and admins read payment proofs" on storage.objects;
create policy "Customers and admins read payment proofs" on storage.objects
for select to authenticated using (
  bucket_id = 'payment-proofs' and (
    (select private.is_hushley_admin()) or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (select 1 from public.profiles p where p.id = (select auth.uid()))
    )
  )
);
commit;
