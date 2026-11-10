# Hushley Billiard Ecommerce — Project Context

Read this file before making changes. It describes the existing project and the business requirements confirmed by the shop owner. Keep it updated when the architecture or approved business rules change.

## Project purpose

Build and maintain the Hushley Billiard Accessories online store. This is an existing project: the owner already has a Supabase database, a GitHub repository, and Vercel for deployment. Work in these existing resources; do not create replacement projects or repositories. Do not commit secrets or put privileged keys in browser code.

## Stack and code map

- Frontend: vanilla JavaScript ES modules, HTML, and CSS.
- Build and local development: Vite (`npm run dev`, `npm run build`).
- Backend: Supabase PostgreSQL, Auth, Storage, Row Level Security (RLS), and SQL functions/RPCs.
- Source control: existing GitHub repository.
- Hosting: existing Vercel deployment.
- Root HTML entry points and URLs: `index.html`, `account.html`, `checkout.html`, and `admin.html`.
- `src/pages/`: storefront, account, checkout, and admin page behavior.
- `src/styles/`: storefront and shared subpage styles.
- `src/lib/supabase.js`: browser Supabase client. It must use publishable credentials only.
- `supabase/migrations/`: database schema, RLS policies, triggers, and transactional functions. Add schema changes as reviewed migrations; never make ad hoc production changes.
- `supabase/functions/`: reserved for future server-only integrations (for example, email notifications). There is no requirement for automated payment processing.
- `vite.config.js`: multi-page build configuration.
- `README.md`: local setup and project operations.

## Storefront visual and UX reference

The owner supplied a Google Stitch storefront export in `stitch design/`:

- `stitch design/screen.png`: full-page visual reference.
- `stitch design/code.html`: exported design implementation, including layout, components, icons, and design tokens.
- `stitch design/DESIGN.md`: design brief and token notes.

Use these as the general visual and UX direction across the storefront, product browsing, cart, checkout, account, and admin screens. Carry through the dark obsidian/carbon surfaces, emerald interaction accents, restrained gold highlights, compact technical typography, product photography, visible product specifications, category/filter navigation, clear cart actions, and trust/service information. Use a consistent adaptation of the design rather than copying the standalone Stitch page wholesale; keep the app's existing navigation, accessibility, responsive behavior, and Supabase flows.

The reference contains placeholder or unconfirmed commercial claims. Treat it as visual guidance, not the source of business truth. In particular, do not copy claims about zero-COD/prepaid protocols, same-day dispatch, LBC/DHL availability, live tracking, warranties, certifications, or product performance unless the owner confirms them. The confirmed payment, courier, and shipping rules elsewhere in this file take precedence. Replace the screenshot's placeholder logo/image blocks and sample products with approved brand assets and catalog data when available.

Preserve the current root page URLs unless a routing change is intentional and all links/deployment behavior are updated with it.

## Confirmed product requirements

The catalog includes billiard cues, carbon shafts, cue tips, chalk, ferrules, cue cases, billiard ball sets, and other billiard accessories. Products can have variations such as size, color, cue-tip hardness (Soft, Medium, Hard), and item-specific specifications. Keep variant choices and the selected variant on the order line so the shop can fulfill the correct item. Do not assume every product shares the same options.

## Confirmed customer account verification

- Signup offers verification through either email OTP or SMS OTP. Customers choose one as their verified Supabase Auth identity and then set a password; do not show the account as signed in until `verifyOtp` succeeds.
- Collect the mobile number as a contact for email-primary signups. For phone-primary signups, collect an email for order contact but treat it as unverified metadata; checkout still collects the customer email for each order.
- Normalize Philippine mobile numbers to E.164 before calling Supabase Auth. Accept an international number only when it is valid for the Auth provider.
- Sign-in accepts the verified email or phone identity with its password. Password recovery supports email identities; phone-only customers need a linked email or support process until phone recovery is separately configured.
- The production Supabase project must have email confirmation enabled and the Confirm Signup template must include `{{ .Token }}` for a code-entry flow. Phone signup requires phone auth and confirmation enabled, an SMS provider configured with the `{{ .Code }}` template, and provider credentials kept in Supabase settings (never browser env vars).
- Keep Auth server rate limits in force and show throttling responses. Do not use client-only counters as the security control. The Hushley administrator promotion remains limited to the confirmed owner email; phone signup does not grant admin access.

## Confirmed checkout and payment requirements

- Checkout requires a customer to choose GCash, MariBank, PayPal, or PNB bank transfer.
- The customer uploads proof of payment after checkout.
- Payment verification is manual: staff check their bank/e-wallet account and then approve or reject the proof in the admin flow. Do not describe or implement payment as automatically verified.
- An order must not be treated as paid until staff approve the payment.

## Confirmed shipping requirements

No live courier-rate integration is wanted. Use the shop's fixed/estimated rates below and keep courier choice and destination clear in the order.

### Domestic: J&T Express

| Item class | Luzon | Visayas | Mindanao |
| --- | ---: | ---: | ---: |
| Small items | ₱75 | ₱100 | ₱100 |
| Billiard cues (tako) | ₱300 | ₱300 | ₱300 |
| Billiard ball sets | ₱500 | ₱500 | ₱500 |

For Luzon, Lalamove may be offered, especially for cues and other items. When Lalamove is selected, collect no delivery fee through the website; the customer pays the rider directly on delivery.

### International: Philippine Post Office

- Asia: estimated ₱3,100.
- Outside Asia (including USA and Canada): estimated ₱4,100.
- These are estimates; the actual shipping cost can differ. If actual cost is lower, staff email the customer the official receipt/proof and privately arrange a refund of the excess shipping amount. If actual cost is higher, staff email the proof and the balance due; the customer can pay the difference directly outside the website.
- Keep estimated shipping, actual shipping, and any adjustment/balance distinguishable in order records and customer communication. Do not imply that the website automatically issues refunds or collects additional payment.

The owner has not specified how to combine shipping for mixed carts (for example, a cue plus small accessories), whether international rates apply per order or per parcel, or which destinations count as Asia. Do not invent those rules; isolate the calculation so these decisions can be set explicitly.

## Existing implementation status

The production Supabase project has four migrations in `supabase/migrations/`. Product categories, `options` and `specifications` JSON, order-item `selected_options`, manual payment review, private payment proof storage, shipping quotes, and transactional inventory functions are live. The storefront now collects configured product options and persists them with cart lines and checkout. The admin can create/edit options, specifications, and staff-assigned shipping classes. A verified account matching `hushleybilliards@gmail.com` is granted the trusted `app_metadata.role = 'admin'` claim by migration `20261110160235_hushley_owner_admin_role.sql`; Supabase Auth still requires the owner to sign up and verify that email. These screens build but still need authenticated end-to-end verification.

Checkout currently asks for a courier and payment method. Shipping fee is currently editable/confirmed by staff in the admin page. The fixed domestic/international rate rules above are requirements to implement; do not assume the current checkout calculates them. Inspect the current UI, JavaScript, migration, and RLS before changing behavior. Keep the Lalamove website shipping amount at zero and represent international shipping as an estimate with a manual adjustment process.

The owner has an existing Supabase project, GitHub repository, and Vercel account. Do not create replacements. Current check: Supabase is linked and migrated; project code is published on `main` in the existing public GitHub repo; the public deployment reflects current assets, but no Hushley Vercel project is visible to the connected Vercel account. Verify access and target before any direct deployment. Never print `.env` contents or expose secret/service-role credentials.

## Working guidance

Schema and rollout review: `supabase/migrations/20261109105526_hushley_shipping_options_payment_guards.sql` adds shipping reference rates and structured quote/actual-cost fields, validates option selections and hardens payment/stock transitions. The production project was migrated on 9 November 2026 and verified; see `PROJECT_CHECKLIST.md` and `supabase/SCHEMA_REVIEW.md`. Product shipping classes remain staff-assigned; mixed-cart and parcel calculations remain manual. Admin-managed Supabase catalog data is the storefront source of truth. Admin supports images, descriptions, options, specifications, and publishing; the storefront only displays active products with an image and description. Readable system-font overrides are in `src/styles/readability.css`. Full authenticated flow verification is still pending. The connected Vercel account does not currently show the Hushley project; deployed signup has reported Supabase is unconfigured, so verify the active project's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values and redeploy before account signup.

1. Preserve existing user-facing behavior unless the requested change requires otherwise.
2. Treat pricing, shipping, and payment decisions above as requirements; ask only when an unresolved business rule affects the implementation.
3. Keep browser-safe UI in `src/`; put privileged credentials and trusted server-side operations in backend functions or the database with reviewed access controls.
4. For database changes, review RLS and existing RPC behavior as well as the schema. Do not weaken access rules to make a feature work.
5. Update `README.md` or this context file when setup, deployment, or confirmed business rules change.
