# Hushley Billiard Accessories Shop

For step-by-step customer and administrator instructions, see [the user guide](USER_GUIDE.md).

Responsive storefront with Supabase customer authentication, account/order pages, checkout, and a role-gated admin dashboard. The black and white storefront structure follows the DC Pro reference; type scale and spacing use a clearer sans-serif hierarchy inspired by Nike PH.

## Local setup

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Fill in the client's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env`. These are browser-safe values when Row Level Security is enabled. Never place a service-role or secret key in the frontend.

## Supabase OTP signup setup

New customer signup accepts only `@gmail.com` addresses without `+`. Names may contain numbers. Existing account sign-in and recovery are unchanged. The form restriction is not a security boundary: migration `20261111192722_gmail_signup_restriction.sql` has been applied to the linked production project, but the hook still needs to be enabled. In Supabase **Authentication → Hooks → Before User Created**, review the existing hook, then enable the PostgreSQL hook and select `public.hushley_gmail_signup_hook`. Enabling it enforces the rule for new Auth users, including users created outside the storefront, and blocks new phone-only users. Existing users are unaffected. Applying the migration alone does not enable the hook. Verify signup with allowed and rejected addresses after activation.

Blocking `+` does not prevent multiple accounts or bots (Gmail also permits other address variants). Keep Supabase Auth rate limits and email confirmation enabled. CAPTCHA requires a configured provider and a client widget that supplies the challenge token for the affected authentication requests; do not enable it in Supabase until that integration is ready, or authentication can fail. No CAPTCHA is currently configured by this change.

Customer signup sends a Supabase email OTP before asking for the customer's name, phone and password. Sending the code creates an incomplete Auth user with a random temporary password; after verification, the details form replaces the password and updates the profile. A verified incomplete signup resumes the details form on reload. The phone number is checked for duplicates only when details are submitted. The application rejects signups that Supabase auto-confirms without sending a verification challenge. Before enabling this flow in the production Supabase project:

  1. Enable email signup and require email confirmation under **Authentication → Providers → Email**. Set both the **Confirm Signup** and **Reset Password** email templates to include `{{ .Token }}` so Supabase sends codes for the in-page signup and password recovery forms (the default confirmation-link template is not an OTP code).
2. To offer SMS signup, enable phone auth and phone confirmation, configure an SMS provider and its credentials in Supabase, and keep the SMS template configured with `{{ .Code }}`. SMS delivery may incur provider charges.
  3. Configure production email delivery (custom SMTP recommended), redirect allow-list, Auth rate limits, and CAPTCHA in the Supabase dashboard. Keep all SMTP/SMS credentials in Supabase settings; never put them in browser `VITE_*` variables. Password recovery sends a code with `resetPasswordForEmail`, verifies it with `verifyOtp` using type `recovery`, and only then updates the password.

This repository's local Supabase configuration currently has email confirmations disabled and SMS auth disabled. The hosted project's Auth settings are managed separately from SQL migrations; do not push the full local `supabase/config.toml` to production because it contains local URLs and other development defaults. Review Auth settings in the client-owned project before testing production signup. See the [Supabase email template docs](https://supabase.com/docs/guides/auth/auth-email-templates), [OTP verification reference](https://supabase.com/docs/reference/javascript/auth-verifyotp), [phone auth guide](https://supabase.com/docs/guides/auth/phone-login), and [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

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

HTML files stay at the repository root as Vite build entries. The Vercel deployment exposes clean routes (`/account`, `/checkout`, and `/admin`) through `vercel.json`; legacy `.html` URLs redirect to those routes. Keep page-specific UI behavior in `src/pages/`, shared browser-safe integrations in `src/lib/`, and all schema/security changes in versioned Supabase migrations. Server secrets and privileged operations belong in Supabase Edge Functions, never in `VITE_*` variables.

When enabling password recovery on a custom Vercel domain, add `https://YOUR_DOMAIN/account` to Supabase **Authentication → URL Configuration → Redirect URLs**. Vercel rewrites serve the existing HTML entry points behind the clean paths; no HTML or page behavior changes are required.

## Recommended next steps

The owner already has Supabase, GitHub and Vercel resources. Use those existing resources. Review the approved rules in `AGENTS.md`, then the current project state in [the project checklist](PROJECT_CHECKLIST.md) and [the Supabase schema review](supabase/SCHEMA_REVIEW.md). Replace the empty live catalog with approved products and exercise the account → checkout → payment proof → manual admin review flow before launch. Add Edge Functions only for work that needs trusted server credentials or external services.

## Client Supabase project

1. Verify access to the owner's existing Supabase project. Do not create a replacement project or overwrite the repository's current linking/configuration.
2. Configure Auth email confirmation and redirect URLs for the local origin and the eventual storefront domain.
3. The three current migrations have been applied to Supabase production and verified. Do not reset production. For future changes, review schema/RLS impact, use a new versioned migration, inspect `npx supabase migration list --remote` and `npx supabase db push --remote --dry-run`, then apply only to the linked intended project. See [the project checklist](PROJECT_CHECKLIST.md) and [database rollout runbook](supabase/DATABASE_ROLLOUT.md).

4. Create an administrator account through `/account`, confirm its email, then have the project owner assign the trusted app metadata role in the Supabase SQL editor:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'ADMIN_EMAIL';
   ```

   Sign out and back in so the refreshed access token carries the role. Admin access uses `app_metadata`, never editable customer metadata.

## Current scope

While a page is open, the storefront catalog, customer order history and admin dashboard check for updates approximately every 30 seconds. Background refresh pauses during relevant edits or open dialogs; it does not reload the browser page. Updates also resume when the page becomes visible or the connection returns.

Customer order screens use All, To Pay, Shipped, Delivered and Cancelled filters. A locally added delivery-confirmation RPC allows an owner to mark their shipped order received; the migration must be reviewed and applied before that action can work against a hosted database. See [the schema review](supabase/SCHEMA_REVIEW.md).

- Product/category catalog reads, cart, authenticated checkout, and customer order history
- Payment proof upload to a private bucket
- Admin order/payment review, manual shipping fee, product, stock, and inventory history screens
- RLS policies and transactional order/payment/stock RPCs in `supabase/migrations/`

The production database has the three migrations described in [supabase/SCHEMA_REVIEW.md](supabase/SCHEMA_REVIEW.md). The storefront captures configured option choices and checkout persists them; admins can maintain product options, specifications, and shipping class. Remaining launch work includes approved catalog data, Auth/domain setup, end-to-end flow checks, and publishing/deploying through the owner's existing GitHub and Vercel resources. Email/SMS notifications are not automated, and automatic payment-provider integration is not required. Do not use preview data as Hushley inventory.

## GCash receiving details

The `hushley_gcash_payment_details` migration adds an admin-managed GCash receiving name and number. After applying it to the intended Supabase project and deploying the updated frontend, an administrator can enter these in **Payment Verification → GCash payment details**. Signed-in customers with an eligible GCash order see the details beside the payment-proof upload under **Account → My payment**. Until both details are saved, customers are directed to contact the shop. Only enter receiving details, never a PIN, password, or OTP. Other payment methods still require the customer to contact the shop for details. Staff continue to verify payment manually.
## Staff account rollout

The staff-access and email-verification migrations and updated `create-staff` Edge Function were deployed to the linked production Supabase project on 14 November 2026. The matching frontend still needs deployment, and the email delivery and complete flow need authenticated end-to-end testing. The owner supplies a staff name, Gmail address, and initial password and shares the password privately. A confirmation code is sent to the staff email; the staff member shares it with the owner, who enters it in Staff & Activity. An isolated temporary client preserves the owner's session. Staff access is denied until the email is verified. The app does not force a password change. Staff can use email password recovery to change it. The earlier unrelated `protect_deleted_customer_proofs` migration remains pending and requires an explicit out-of-order migration review.

The owner-only Staff & Activity view lists accounts and groups changes by Manila date. A disabled staff account loses database permissions immediately. Staff can see individual order and payment amounts needed for work; those values can be aggregated independently, even though the staff dashboard hides sales summaries and exports. The feature has local regression coverage, but still needs authenticated end-to-end testing with separate owner, staff, disabled staff, and customer accounts. See `supabase/STAFF_ACCESS_DESIGN.md`.

## Customer account deletion

The local account page and `delete-customer-account` Edge Function require a customer to confirm their password on the server before deleting their Auth account. The profile is removed; orders and payment records, their customer contact snapshots, and payment proof files remain available to staff. Existing orders are not automatically cancelled. The local test covers incorrect passwords, administrator rejection, retained records and proof access, and proof access with a deleted user's old token. The function uses Supabase-provided server credentials. The reviewed `protect_deleted_customer_proofs` migration requires an existing profile for customer proof access, while preserving staff access. Neither the migration nor function has been deployed to the hosted project; apply the migration before deploying the function and matching frontend. Deletion revokes refresh sessions, but already issued access tokens may remain valid until expiry for other API operations; see [Supabase user deletion guidance](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users).
