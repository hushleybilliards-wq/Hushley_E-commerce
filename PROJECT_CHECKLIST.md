# Hushley Ecommerce Project Checklist

Last reviewed: 11 November 2026 (Asia/Manila)

## Status at a glance

| Area | Status | Evidence / next action |
|---|---|---|
| Storefront, account, and admin UI | In progress | Compact product cards, regular-weight system typography, hover-pausing category loop, and staged email/SMS OTP signup are implemented locally. Admin modal and approved-payment chart remain. Build and deployed UI verification are pending for this latest update. |
| Supabase production schema | Complete | Four local migrations applied; remote history matches local. Core tables, RPC signature, private proof bucket, and verified-owner admin trigger verified. |
| Supabase security review | Review before launch | Advisor warnings include authenticated `SECURITY DEFINER` RPCs (intentional trusted RPC pattern with internal auth checks) and overlapping read policies (performance/maintainability). Review/test role checks before launch. |
| GitHub source | Published through `de4c8b0` | Latest account/storefront updates are currently local and not yet pushed. `.env`, `dist/`, and `node_modules/` remain excluded. |
| Vercel deployment | Existing live URL | Current public deployment is [hushley-billiards.vercel.app](https://hushley-billiards.vercel.app); the connected Vercel account still cannot list/manage the Hushley project. Verify this update after publication. |
| End-to-end commerce | Not verified | Needs test customer, test products, payment-proof upload, manual admin review, and shipping checks. |

## 1. Source control and deployment

- [x] Confirm the intended GitHub repository and default branch. Current configured remote: `https://github.com/hushleybilliards-wq/Hushley_E-commerce.git` (`main`).
- [x] Review the local project files and ensure `.env`, credentials, and build output stay excluded.
- [x] Publish the reviewed project to the existing public GitHub repository; latest published commit is `b2ff301` on `main`.
- [ ] Connect that repository to the client's existing Vercel project, or identify the correct Vercel account/team if the project is not visible; the current public deployment is updating from GitHub, but is not manageable in the connected Vercel account.
- [ ] Configure Vercel production environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never use a Supabase secret/service-role key in a `VITE_*` variable.
- [x] Verify storefront and admin routes on the public deployment; asset filenames match the local production build for `d65168d`.
- [x] Verify production URL: `https://hushley-billiards.vercel.app` (deployment record itself is inaccessible through the connected Vercel account).

## 2. Supabase production database

- [x] Link the local Supabase CLI to project `zdxkkggacvjifgcduqrz`.
- [x] Apply `20261108031340_hushley_commerce_auth.sql`.
- [x] Apply `20261109105526_hushley_shipping_options_payment_guards.sql`.
- [x] Apply `20261109125917_hushley_private_payment_proof_bucket.sql`.
- [x] Apply `20261110160235_hushley_owner_admin_role.sql`; verified email `hushleybilliards@gmail.com` receives trusted admin metadata after confirmation.
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

- [x] Replace the oversized storefront hero copy with an infinite category carousel using active categories and available product imagery; category selection filters the matching catalog.
- [x] Use compact product cards, hide SKU from customer-facing views, remove the carousel pause/play button, and pause autoplay on hover/focus.
- [x] Remove bold typography weights and normalize the storefront/admin font system.
- [x] Restyle sign-in and sign-up around the supplied Stitch account references and Hushley logo.
- [x] Offer email OTP or SMS OTP at signup, collect required order contacts, and require Supabase `verifyOtp` success before showing the signed-in account.
- [ ] Configure production Auth confirmation switches, OTP email/SMS templates, production SMTP, SMS provider credentials, rate limits, and CAPTCHA in the client-owned Supabase project.
- [ ] Verify email OTP and SMS OTP with owner-controlled test addresses/numbers after Auth settings are configured.
- [ ] Review whether the customer terms/privacy notice needs approved content and destination links before launch.
- [ ] Visually inspect the storefront carousel and account layouts at desktop and mobile sizes.
- [ ] Configure `.env` locally using only Supabase URL and publishable key.
- [ ] Test product listing, search/filter behavior, cart persistence, and empty/error/offline states.
- [ ] Test sign-up, email confirmation, sign-in, sign-out, and password recovery.
- [ ] Test checkout with a test product and confirm destination region is saved as structured order data.
- [ ] Test customer order history and payment proof upload using a non-production test payment.
- [ ] Confirm a submitted proof remains pending until a staff member manually reviews it.
- [ ] Confirm upload rejects unsupported files and files larger than 10 MiB.

## 5. Admin operations

- [ ] Configure Supabase URL and publishable key in the active Vercel project's Production environment and redeploy; current deployed account page says Supabase is not connected.
- [ ] Sign up the business owner account `hushleybilliards@gmail.com` through the deployed account page and confirm the email. Production Supabase currently has no matching Auth account.
- [x] Install verified-email admin promotion trigger; after signup and email confirmation, sign out and back in to refresh the JWT.
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

1. Commit `b76b071` (`Add OTP signup and compact storefront cards`) is on `main`; the public account page currently serves the matching built asset `account-7mci0CVg.js`. This confirms that this UI/signup update reached the existing Vercel URL. Vercel project ownership/access remains unavailable in the connected account, so deployment settings cannot be inspected here.
2. Configure Supabase Auth settings and verify OTP delivery before treating signup as launch-ready; see the Auth configuration items above. The site returning HTTP 200 confirms page availability, not that email/SMS providers are configured.
3. The production catalog is empty: no products are seeded yet. The client must supply approved catalog content, prices, images, variants, stock, and shipping classifications.
4. The production domain and administrator account are not yet configured; Auth redirects and end-to-end flow verification depend on them.
