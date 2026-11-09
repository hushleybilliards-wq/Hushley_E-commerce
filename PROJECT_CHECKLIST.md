# Hushley Ecommerce Project Checklist

Last reviewed: 9 November 2026 (Asia/Manila)

## Status at a glance

| Area | Status | Evidence / next action |
|---|---|---|
| Storefront and admin UI | In progress | Admin product create/edit supports images, descriptions, SKU, options, specifications, pricing, stock, and publish state. Storefront displays only active, complete products from Supabase. Readability stylesheet uses a conventional system font. Production build passes; authenticated UI flow remains to verify. |
| Supabase production schema | Complete | Three local migrations applied; remote history matches local. Core tables, RPC signature, and private proof bucket verified. |
| Supabase security review | Review before launch | Advisor warnings include authenticated `SECURITY DEFINER` RPCs (intentional trusted RPC pattern with internal auth checks) and overlapping read policies (performance/maintainability). Review/test role checks before launch. |
| GitHub source | Complete | Reviewed project is published to the existing public repository on `main`. Remote head verified at `77640ca`; `.env`, `dist/`, and `node_modules/` are excluded. |
| Vercel deployment | Blocked | No Hushley project/deployment found in the connected Vercel account; no `.vercel` project link exists locally. |
| End-to-end commerce | Not verified | Needs test customer, test products, payment-proof upload, manual admin review, and shipping checks. |

## 1. Source control and deployment

- [x] Confirm the intended GitHub repository and default branch. Current configured remote: `https://github.com/hushleybilliards-wq/Hushley_E-commerce.git` (`main`).
- [x] Review the local project files and ensure `.env`, credentials, and build output stay excluded.
- [x] Publish the reviewed project to the existing public GitHub repository; remote branch `main` was verified at `77640ca`.
- [ ] Connect that repository to the client's existing Vercel project, or identify the correct Vercel account/team if the project is not visible.
- [ ] Configure Vercel production environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never use a Supabase secret/service-role key in a `VITE_*` variable.
- [ ] Deploy a preview and verify storefront, account, checkout, and admin routes.
- [ ] Deploy production and record the live URL and deployment commit.

## 2. Supabase production database

- [x] Link the local Supabase CLI to project `zdxkkggacvjifgcduqrz`.
- [x] Apply `20261108031340_hushley_commerce_auth.sql`.
- [x] Apply `20261109105526_hushley_shipping_options_payment_guards.sql`.
- [x] Apply `20261109125917_hushley_private_payment_proof_bucket.sql`.
- [x] Verify remote migration history matches the three local versions.
- [x] Verify commerce tables and admin helper exist.
- [x] Verify `place_order` includes `p_shipping_region`.
- [x] Verify `payment-proofs` is private, limited to 10 MiB, and allows JPEG, PNG, WebP, and PDF.
- [ ] Review Supabase advisor findings and test customer/non-admin/admin authorization behavior before launch.
- [ ] Configure and verify Auth site URL, email confirmation, and redirect allow-list for localhost and the eventual production domain.

The detailed database rollout and verification commands are in [supabase/DATABASE_ROLLOUT.md](supabase/DATABASE_ROLLOUT.md). The database has been migrated; do not rerun a reset against production.

## 3. Catalog and product configuration

- [x] Remove hard-coded preview products from storefront; catalog content comes from Supabase.
- [x] Require a product description and image before an admin-created product can be published; storefront excludes incomplete products.
- [x] Support admin editing of product name, description, SKU, category, image, options, specifications, price, stock, shipping class, and published state.
- [ ] Enter client-approved product names, prices, descriptions, images, stock counts, and active status in the admin panel.
- [ ] Assign shipping classes (`small_items`, `cue`, `ball_set`) to products that staff have reviewed.
- [ ] Confirm each product's options (for example cue length, color, or tip hardness) and whether each option is required.
- [x] Build product variation selection into the storefront; required/optional choices persist with cart lines and checkout.
- [x] Extend admin product create/edit screens to manage options, specifications, and shipping class.
- [ ] Confirm product photos are stored in the intended bucket and public product image access is configured safely.

## 4. Storefront, account, and checkout

- [ ] Configure `.env` locally using only Supabase URL and publishable key.
- [ ] Test product listing, search/filter behavior, cart persistence, and empty/error/offline states.
- [ ] Test sign-up, email confirmation, sign-in, sign-out, and password recovery.
- [ ] Test checkout with a test product and confirm destination region is saved as structured order data.
- [ ] Test customer order history and payment proof upload using a non-production test payment.
- [ ] Confirm a submitted proof remains pending until a staff member manually reviews it.
- [ ] Confirm upload rejects unsupported files and files larger than 10 MiB.

## 5. Admin operations

- [ ] Create/sign up the business owner account `hushleybilliards@gmail.com` through the account page and confirm the email. Production Supabase currently has no matching Auth account, so the admin role cannot yet be assigned.
- [ ] Assign the trusted `app_metadata.role = 'admin'` claim in Supabase, then sign out and back in to refresh the JWT.
- [ ] Confirm non-admin accounts cannot access admin pages or admin RPC actions.
- [ ] Test manual payment approval/rejection, stock adjustments, order status changes, shipping quote confirmation, and tracking entry.
- [ ] Confirm staff have a process for expired unpaid orders; automatic reservation cleanup is not configured.
- [ ] Confirm international shipping adjustment and refund/balance communications happen outside the website as documented.

## 6. Pre-launch sign-off

- [ ] Review the final Supabase security advisor output and retain a record of the intentional RPC/policy findings.
- [ ] Run the production build after final frontend changes.
- [ ] Test the complete customer-to-admin flow on a Vercel preview with test accounts and test data.
- [ ] Check mobile layout, browser console, and production environment variables.
- [ ] Verify the production URL, Auth redirects, catalog, checkout, private payment proof access, and admin authorization.
- [ ] Obtain client sign-off on catalog, prices, shipping behavior, policies, and go-live timing.

## Current external blockers

1. The connected Vercel account has no Hushley project or deployment for this GitHub repo. The correct client team/project must be made accessible before deploying.
2. The production catalog is empty: no products are seeded yet. The client must supply approved catalog content, prices, images, variants, stock, and shipping classifications.
3. The production domain and administrator account are not yet configured; Auth redirects and end-to-end flow verification depend on them.
