# Hushley Billiard Accessories Shop

Responsive storefront with Supabase customer authentication, account/order pages, checkout, and a role-gated admin dashboard. The black and white storefront structure follows the DC Pro reference; type scale and spacing use a clearer sans-serif hierarchy inspired by Nike PH.

## Local setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Fill in the client's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`. These are browser-safe values when Row Level Security is enabled. Never place a service-role or secret key in the frontend.

## Project layout

```text
.
├── index.html, account.html, checkout.html, admin.html  # Vite page entry points
├── src/
│   ├── pages/       # Browser code for each page
│   ├── styles/      # Storefront and shared subpage styles
│   └── lib/         # Shared integrations, including the Supabase client
├── supabase/
│   ├── migrations/  # Database schema, RLS, and transactional functions
│   └── functions/   # Future server-only integrations (payments, notifications)
└── public/          # Future static assets copied directly into the build
```

HTML files stay at the repository root so the existing URLs (`/account.html`, `/checkout.html`, and `/admin.html`) remain stable. Keep page-specific UI behavior in `src/pages/`, shared browser-safe integrations in `src/lib/`, and all schema/security changes in versioned Supabase migrations. Server secrets and privileged operations belong in Supabase Edge Functions, never in `VITE_*` variables.

## Recommended next steps

The owner already has Supabase, GitHub and Vercel resources. Use those existing resources. Review the approved rules in `AGENTS.md`, then the current project state in [the project checklist](PROJECT_CHECKLIST.md) and [the Supabase schema review](supabase/SCHEMA_REVIEW.md). Replace the empty live catalog with approved products and exercise the account → checkout → payment proof → manual admin review flow before launch. Add Edge Functions only for work that needs trusted server credentials or external services.

## Client Supabase project

1. Verify access to the owner's existing Supabase project. Do not create a replacement project or overwrite the repository's current linking/configuration.
2. Configure Auth email confirmation and redirect URLs for the local origin and the eventual storefront domain.
3. The three current migrations have been applied to Supabase production and verified. Do not reset production. For future changes, review schema/RLS impact, use a new versioned migration, inspect `npx supabase migration list --remote` and `npx supabase db push --remote --dry-run`, then apply only to the linked intended project. See [the project checklist](PROJECT_CHECKLIST.md) and [database rollout runbook](supabase/DATABASE_ROLLOUT.md).

4. Create an administrator account through `/account.html`, confirm its email, then have the project owner assign the trusted app metadata role in the Supabase SQL editor:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'ADMIN_EMAIL';
   ```

   Sign out and back in so the refreshed access token carries the role. Admin access uses `app_metadata`, never editable customer metadata.

## Current scope

- Product/category catalog reads, cart, authenticated checkout, and customer order history
- Payment proof upload to a private bucket
- Admin order/payment review, manual shipping fee, product, stock, and inventory history screens
- RLS policies and transactional order/payment/stock RPCs in `supabase/migrations/`

The production database has the three migrations described in [supabase/SCHEMA_REVIEW.md](supabase/SCHEMA_REVIEW.md). The storefront captures configured option choices and checkout persists them; admins can maintain product options, specifications, and shipping class. Remaining launch work includes approved catalog data, Auth/domain setup, end-to-end flow checks, and publishing/deploying through the owner's existing GitHub and Vercel resources. Email/SMS notifications are not automated, and automatic payment-provider integration is not required. Do not use preview data as Hushley inventory.
