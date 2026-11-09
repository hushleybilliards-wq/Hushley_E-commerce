# Supabase database rollout runbook

Project ref: `zdxkkggacvjifgcduqrz`

This guide is for a Windows PowerShell session opened at the repository root. It does not need the Supabase service-role/secret key or the browser publishable key. Do not paste database passwords, access tokens, or secret keys into chat, Git, `.env`, or command output.

## Important state

- The hosted project was not available through the connected Supabase tools when this runbook was prepared.
- Earlier read-only API checks returned `PGRST205` for `public.products` and `public.categories`. This can mean the tables are absent or not exposed; it does not prove the database is empty.
- Local migrations are `20261108031340_hushley_commerce_auth.sql`, `20261109105526_hushley_shipping_options_payment_guards.sql`, and `20261109125917_hushley_private_payment_proof_bucket.sql`.
- The last migration enforces `storage.buckets.public = false` for `payment-proofs` and preserves the bucket's existing upload limits and MIME list.
- **Do not run a live push until the migration history and existing schema have been compared.** If the remote migration history is empty or differs, stop and reconcile before pushing. Never use `--include-all` to force mismatched history.

## 1. Install and authenticate the CLI

From the repository root:

```powershell
npm install --save-dev supabase
npx supabase --version
npx supabase login
```

`supabase login` opens an interactive browser authentication flow. Complete it using an account that has owner/admin access to this Supabase project. Do not put an access token into a command or this repository.

## 2. Link this checkout to the existing project

```powershell
npx supabase link --project-ref zdxkkggacvjifgcduqrz
```

If prompted for the database password, enter it only in the CLI prompt. Do not save it in a tracked file. Confirm the linked project in the CLI output before continuing.

## 3. Inspect migration history and dry-run

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Review both outputs. The expected local versions are listed above. A migration marked pending on the remote is not automatically safe to run: first compare the remote schema and data with the SQL in `supabase/migrations/` and the contract in `SCHEMA_REVIEW.md`.

**Stop here and share the non-secret output for review if:**

- remote history is empty, missing an earlier migration, or has a different version/order;
- the dry-run proposes migrations you do not expect;
- the remote already has tables/functions/policies that the pending migration creates or changes;
- this project has customer/order/payment data that has not been backed up and checked.

Do not run `supabase db reset` against the linked project. Do not add `--include-all` to work around history mismatches. The earlier `PGRST205` result means the live schema must be inspected before deciding whether migrations can be applied as-is.

## 4. Back up, then apply only after the review

Before a production migration, create or confirm a current database backup from the Supabase Dashboard. Keep the backup outside this repository. Once the migration history, schema, and dry-run have been reviewed and approved, apply the pending migrations:

```powershell
npx supabase db push --linked
```

The CLI should show which migrations it will apply and request confirmation. Read that list before accepting. If the CLI reports a history mismatch, stop; do not repair or mark migrations applied until the actual schema has been compared with each migration.

## 5. Verify in the Supabase SQL Editor

Run these read-only checks in the Dashboard SQL Editor after applying:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;

select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('products', 'categories', 'orders', 'payments')
order by table_name;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'payment-proofs';

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'place_order';
```

Confirm that expected migrations are recorded, the commerce tables exist, the proof bucket reports `public = false`, and the active `place_order` signature includes `p_shipping_region`. The migration deliberately leaves existing bucket MIME/size settings as-is; compare them with the app's supported proof types and 10 MB limit before accepting uploads.

## 6. Browser/API smoke check

After schema verification, reload the storefront and confirm that the catalog loads without `PGRST205`. Then use a test customer and test product to verify checkout creates an order with the chosen region. Upload a test proof and confirm it remains pending until an admin manually approves it. Use a non-production test payment/account and remove test data through the app's normal supported workflow.

## References

- [Supabase CLI setup and project linking](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Supabase CLI `db push` reference](https://supabase.com/docs/reference/cli/supabase-db-push)
