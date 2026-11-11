-- Prevent two profiles from claiming the same Philippine contact number,
-- including the +63 and 09 forms. Blank/invalid legacy values are not indexed.
create unique index profiles_unique_ph_contact_phone_idx on public.profiles (
  regexp_replace(regexp_replace(phone, '[^0-9]', '', 'g'), '^(0063|63|0)', '')
)
where regexp_replace(regexp_replace(phone, '[^0-9]', '', 'g'), '^(0063|63|0)', '') ~ '^9[0-9]{9}$';
