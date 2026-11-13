# Staff access implementation review

This document records the owner's approved direction. The staff and email-verification migrations and revised `create-staff` Edge Function were deployed to the linked production Supabase project on 14 November 2026. The matching frontend remains local and needs deployment, and authenticated end-to-end verification remains outstanding.

## Roles and provisioning

- The owner creates, disables, and manages individual staff accounts. Staff have no staff-management permission.
- Staff identity must be assigned by a trusted server operation, never from user-editable metadata or browser-supplied role claims. Account creation must not expose a service key in the browser.
- Every privileged request must check that the staff account is still active in server-controlled data. Do not rely solely on a long-lived JWT claim: disabling a staff account must also prevent existing sessions from making staff changes.
- The owner supplies an initial password during account creation and shares it privately with the staff member. The updated flow sends a signup code to the staff email; the staff member gives it to the owner to enter in Staff & Activity. An isolated temporary Auth client keeps verification from replacing the owner's session. The email must be confirmed before staff permissions are granted. The staff member may change the password using the existing email password-recovery flow; a mandatory first-login password change is not implemented.

## Permissions

- Staff may view the customer, order, and proof details needed for fulfillment; manually approve or reject proof; update order status; and create or edit products and categories.
- Product deletion, staff management, shop payment settings, sales reports and exports, and the complete staff activity log are owner-only. Individual order and payment amounts are visible to staff handling orders, so access to those records cannot prevent staff from deriving their own totals.
- Do not expand `private.is_hushley_admin()` to include staff: existing policies and security-definer functions use it for owner-only actions. Add separate, narrowly scoped policies and RPCs, including storage policies for reading payment proof and uploading product images.
- Order status changes must not allow staff to mark an unpaid order paid or bypass inventory and payment checks. Payment approval must reuse the existing transaction's validation and inventory guarantees. Product deletion must be denied in the database, not merely hidden in the interface.
- Staff accounts must not place customer orders and must be excluded from the customer directory. Verify all existing customer and owner flows remain unchanged.

## Activity history

- Record staff actions on the server, in the same transaction as each successful change. Include the staff identity and a stable display name snapshot, action, subject, relevant old/new status where applicable, and timestamp. Do not store passwords, payment credentials, or unnecessary proof contents.
- Only the owner can read the full activity log. Staff cannot insert, edit, or delete records directly. A disabled staff account's previous activity remains visible.
- The dashboard groups records by Manila calendar date, newest first, with expandable dates and a connected timeline. Each entry shows the staff name, time, action, and affected order, product, or category. Provide date, staff, and activity filters.

## Required verification before release

Test owner, active staff, disabled staff with an existing session, customer, and anonymous access against the real RLS policies, RPCs, and Storage. Cover unauthorized deletion, payment settings, reports, audit tampering, direct status updates, payment approval and stock concurrency, account provisioning failure, role revocation, and signup/recovery. Verify the complete workflow with separate authenticated accounts in a non-production environment before reviewing migrations and deploying to the existing project.
