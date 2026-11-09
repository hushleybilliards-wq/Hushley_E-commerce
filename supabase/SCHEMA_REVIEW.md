# Local schema review — 9 November 2026

Migration: `migrations/20261109105526_hushley_shipping_options_payment_guards.sql`, created with Supabase CLI 3.0.0 `migration new`. The production project `zdxkkggacvjifgcduqrz` was linked and the migration was applied on 9 November 2026, together with the base schema and private proof bucket follow-up migration. Remote migration history now matches all three local migrations.

Follow-up migration: `migrations/20261109125917_hushley_private_payment_proof_bucket.sql` enforces `storage.buckets.public = false` for `payment-proofs` while preserving existing upload limits and MIME settings. Checkout passes `p_shipping_region` as a structured RPC argument; the admin order query selects and displays that field.

## Findings and changes

- The original categories covered cues, shafts, tips, chalk, ferrules, cases and accessories; the migration adds `balls` for billiard ball sets.
- `products.options` and `order_items.selected_options` existed, but checkout accepted arbitrary selections. The replacement RPC validates required choices, allowed values and unknown keys, then stores the selections and shipping class as order-line snapshots.
- Products have a nullable staff-assigned `shipping_class`: `small_items`, `cue`, or `ball_set`. No classifications are guessed for shafts, cases or other products.
- Twelve public reference-rate rows represent the nine J&T region/class rates, Luzon Lalamove zero website fee, and two PhilPost estimates. RLS allows staff configuration and public reads. Every rate is in PHP.
- Shipping requires a staff quote. For exactly one domestic unit with a known class, confirmation enforces the configured J&T amount. Lalamove always enforces zero website shipping and permits only Luzon when a region is specified. Other combinations require an explicit staff quote note; no mixed-cart formula is implemented.
- Orders store region, quote kind, reference-rate snapshot, quote basis, confirming staff/time, original international estimate, actual shipping, receipt reference, customer-email timestamp, settlement note and external-settlement timestamp. The generated adjustment is actual minus estimate: negative means refund due; positive means additional balance due. Actual cost changes never change the original order total. Recording an email or settlement timestamp does not send email, refund money or collect payment.
- Broad `GRANT ALL` included `TRUNCATE`, which bypasses RLS. Grants are narrowed to necessary operations, and payments/order lines/inventory history become writable only through the trusted RPCs. Existing owner-read/admin-read RLS remains in force. Customer profile updates are limited to name and phone.
- Unpaid orders cannot enter paid/fulfillment states through direct status updates. Manual review must approve an existing proof and matching amount/method. Review and resubmission lock the order first, with consistent product lock order. Only one pending/approved payment can exist per order.
- Proof submission now requires a non-null existing object in the customer's private folder. Upload alone leaves payment pending. Payment approval consumes stock once; rejected proof releases the hold and resubmission reacquires it. Cancelling an already paid order no longer releases other orders' reserved stock.

## Integration contract

Product option shape (names and string values are case-sensitive):

```json
[{"name":"Hardness","values":["Soft","Medium","Hard"],"required":true},
 {"name":"Color","values":["Black","Blue"],"required":false}]
```

Omitted `required` means true. `[]` means no selections. Specifications remain a product-specific JSON object. This is option selection at one product price and shared stock; separate variant prices, SKUs and inventory are not implemented.

`place_order` retains its prior named arguments and adds optional `p_shipping_region`. Values are `Luzon`, `Visayas`, `Mindanao`, `Asia`, `Outside Asia`. Couriers are `j&t`, `lalamove`, `philpost`. Each `p_items` member uses `{product_id, quantity, options: {"Hardness":"Soft"}}`. Checkout now sends structured region data and selected options. Calls without the new argument still create an unconfirmed order; staff must supply the region before confirming shipping.

Staff confirmation:

```sql
select public.admin_confirm_order_shipping(
  p_order_id := 'ORDER_UUID', p_region := 'Luzon', p_fee := 300,
  p_quote_note := 'One cue; staff reviewed destination and parcel requirement'
);
```

Shipping confirmation in the admin UI calls `admin_confirm_order_shipping` with region, fee, and quote basis. A fee-only save without those fields fails for unconfirmed orders.

International actual-cost recording:

```sql
select public.admin_record_shipping_actual(
  p_order_id := 'ORDER_UUID', p_actual_fee := 4000,
  p_receipt_reference := 'private-receipt-identifier',
  p_customer_emailed_at := null, p_note := null, p_settled_at := null
);
```

Later call with the actual email and settlement timestamps/details after staff perform those actions. A negative adjustment should be described as an excess-shipping refund, a positive adjustment as an external balance due, and zero as no adjustment. Settlement requires receipt/email/note information. These records are visible only to the order owner and staff through existing orders RLS; avoid unrelated private staff notes or public receipt URLs.

## Unresolved business decisions

- Mixed-cart combination (e.g. cue plus chalk), multiple quantities and parcel allocation: manual review only; do not take the maximum, sum rates, or multiply rates automatically.
- Whether international estimates apply per order or per parcel: no basis is assumed. Staff must record the basis of the individual quote.
- Which countries count as Asia: no country map is seeded. The structured zone is a customer/staff selection pending staff destination review.
- Product shipping classification is intentionally unpopulated. Staff must classify approved inventory.

## Rollout review and remaining risks

The three local migrations are applied to the hosted project. Before future schema changes, compare actual migration history/schema with these local files and inspect existing data in a safe staging copy. The unique active-payment index intentionally fails if duplicate pending/approved payments exist; investigate rather than delete payment history automatically. New option/specification/stock/finite-value constraints are `NOT VALID`: they preserve legacy rows while enforcing new writes, and require later explicit validation after data cleanup. Existing invalid product option shapes or reserved stock above total stock can block updates until reconciled.

Audit legacy orders with nonzero Lalamove website fees, unknown couriers, paid/fulfillment states without approved payments, mismatched totals, or invalid destination regions. Historical orders and their amounts are not rewritten or marked paid automatically. Legacy confirmed orders retain their previous values; structured shipping snapshots are only created on a new confirmation/change before any proof exists.

The two-hour reservation expiry is still only a timestamp; no automatic expiration cleanup job exists. Staff must cancel expired unpaid orders to release stock. Cancelling paid orders does not automatically restock or refund them. Admin catalog stock edits remain possible through product management; the stock RPC is the audited adjustment path. Staff JWT roles can remain cached until token refresh. Receipt records are current values, not an append-only financial audit trail. Customer address/courier changes after checkout are not exposed by these grants. Review these operational limits before launch.

## Local verification

Docker's Linux engine was unavailable, so full local Supabase services did not run. Both base and shipping SQL were executed against PGlite PostgreSQL with pgcrypto, minimal Auth/Storage helpers and real SQL roles/RLS. Regression coverage includes shipping rates, option validation/snapshots, permission boundaries, proof review/rejection/resubmission, inventory holds and manual international adjustments. After production rollout, read-only SQL verified the expected tables, the admin helper, the `place_order` signature, and the private payment-proof bucket. Supabase advisors reported heuristic warnings for authenticated execution of internally guarded `SECURITY DEFINER` RPCs and overlapping category/product/shipping-rate read policies. This does not replace customer/non-admin/admin behavior tests, real Storage uploads, PostgREST browser flow checks, or concurrency testing.

Run the offline tests without adding runtime dependencies to the website:

```powershell
$schemaTestDir = Join-Path $env:TEMP 'hushley-schema-verification'
npm install --prefix $schemaTestDir --no-audit --no-fund @electric-sql/pglite@0.5.15
$env:HUSHLEY_TEST_DEPENDENCIES = $schemaTestDir
node supabase/tests/schema.test.mjs
```

This test runner reads only local migration files, creates an in-memory database, and never reads `.env` or contacts a hosted database.
