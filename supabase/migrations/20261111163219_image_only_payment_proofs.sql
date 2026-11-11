-- New uploads only. Existing proofs and payment reviews are preserved.
begin;

do $$
begin
  update storage.buckets
    set public = false, file_size_limit = 10485760,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
    where id = 'payment-proofs';
  if not found then raise exception 'payment-proofs bucket is missing'; end if;
end;
$$;

drop policy "Customers upload own payment proofs" on storage.objects;
create policy "Customers upload own payment proofs" on storage.objects
for insert to authenticated with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~* '\.(jpg|jpeg|png|webp)$'
);

commit;
