-- Payment proofs contain customer payment information and must never be publicly readable.
-- Preserve any existing upload limits and MIME configuration while enforcing privacy.
begin;

update storage.buckets
set public = false
where id = 'payment-proofs';

commit;
