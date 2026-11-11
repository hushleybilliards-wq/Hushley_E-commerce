# Hushley Billiard Accessories — Commerce Logic

This document turns the shop's requirements into a practical guide for how the catalog, cart, checkout, payment review, shipping, inventory, orders, and admin work together. It separates confirmed business rules from draft requirements and decisions that still need the owner's input.

## 1. Customer journey

1. The customer browses active products and selects the options configured for each product.
2. The cart stores each product, quantity, and selected options. Changing quantity or removing a line updates the cart subtotal.
3. The customer enters contact and delivery details, courier, destination, and payment method at checkout.
4. The system creates an order and reserves available stock. The order is not yet paid.
5. The customer pays for the products and uploads proof of payment in their account.
6. Staff check their bank or e-wallet and approve or reject the proof. Approval consumes the reserved stock.
7. Staff contact the customer about the shipping fee, which the customer pays separately. Staff arrange delivery and enter the tracking number.

## 2. Catalog and variations

### Product categories

The requested catalog includes:

- Billiard cues and carbon shafts
- Billiard chalk, cue tips, and ferrules
- Cue cases, grips and leather, gloves, and cue accessories
- Billiard ball sets and other billiard products

Categories should support browsing and filtering. The database catalog is the source of truth; only active products meeting the storefront's publication requirements should be shown.

### Product information

Each product may include its name, description, images, price, stock, category, specifications, and product-specific options. Option examples include size, color, and cue-tip hardness (Soft, Medium, Hard). Do not force the same options onto every product.

The customer must choose each required option before adding the product to the cart. Optional choices may be omitted. Persist the selected choices with the cart line and copy them to the order line so staff can fulfill the correct item.

**Current inventory model:** options are selection snapshots at one product price with shared product stock. Separate price, SKU, and stock per variant are not part of the current model.

## 3. Cart and checkout

The cart supports multiple products, quantity changes, removal, line totals, subtotal, and the final order total. Checkout collects:

- Customer name, mobile number, and email
- Delivery address, city/municipality, province, postal code, and country
- Courier and shipping destination/region
- One supported payment method
- Product IDs, quantities, and selected options for every cart line

Checkout offers local and international delivery. Local province, city, and barangay lists load from the third-party PSGC API; customers can retry loading the list if the service is unavailable. The barangay is saved with the street address. International customers choose a country and explicitly select Asia or Outside Asia for staff review.

Customers can add, edit, or delete one default delivery address under **Account → My Addresses**, or save one after placing an order. Checkout displays a compact summary of a complete saved address and lets the customer change it. The default is separate from the address snapshot on past orders. The default-address migration is applied to the existing Supabase project.

### Account requirement versus draft guest checkout

The supplied generic website brief requests guest checkout. The current approved project flow uses verified customer accounts and account-based order history/payment-proof submission. Keep authenticated checkout unless the owner explicitly changes that rule; guest checkout would require a reviewed change to order ownership, proof submission, RLS, and order lookup.

## 4. Payment and proof review

Supported methods are **GCash, MariBank, PayPal, and PNB bank transfer**. Cash on delivery is not offered. This is manual payment verification, not automated payment processing.

### What the customer and staff do

1. **Customer:** Place an order, pay the product amount using the selected method, and open **Account → My Payment** to upload an image of the receipt. The payment details currently shown are placeholders; contact the shop for the real details.
2. **Staff:** Open **Payment Verification**, inspect the proof, and check the actual bank or e-wallet. Approve only after receiving the product payment, or reject the proof if necessary.
3. **Staff:** Contact the customer about the shipping fee and arrange its payment separately. For Lalamove, the customer pays the rider directly. Record shipping details and tracking in **Shipping & Dispatch** or **Orders Management**.
4. **Staff:** For PhilPost, record the estimate separately from the actual cost, send the official receipt and privately arrange any refund or balance as needed.

The two-hour reservation hold still applies. If it expires before proof submission, the customer must contact the shop before paying; staff cancel expired unpaid orders to release stock. Unquoted pending orders with zero shipping and no proof now follow this flow; other existing orders retain their original payment terms. The product-first migration is applied to the existing Supabase project.

Uploading proof alone must never mark an order paid or deduct stock as a completed sale. A rejected proof releases the stock hold; resubmission must reacquire available stock before the order returns to payment review.

New proof uploads are limited to JPEG, PNG, or WebP images, at most 10 MiB. The browser checks the file type, signature, and whether it decodes as an image; the private Storage bucket also restricts MIME types, size, and filename extensions. Existing proofs remain available for staff review. Storage MIME types and browser checks are not a trusted inspection of file contents: a modified client can bypass browser checks and supply a misleading MIME type. A trusted server-side image decoder and re-encoding step is required before claiming malicious or disguised files are impossible. Staff must verify the transfer manually.

## 5. Shipping rules

There is no live courier-rate integration. The courier, destination, quote, and any later international adjustment must remain clear in the order record.

### Domestic — J&T Express

| Item class | Luzon | Visayas | Mindanao |
| --- | ---: | ---: | ---: |
| Small items | ₱75 | ₱100 | ₱100 |
| Billiard cues (tako) | ₱300 | ₱300 | ₱300 |
| Billiard ball sets | ₱500 | ₱500 | ₱500 |

### Luzon — Lalamove

The website shipping amount is ₱0. The customer pays the rider directly on delivery. Lalamove is a Luzon option; do not collect its delivery charge through checkout.

### International — Philippine Post Office

| Destination zone | Shipping amount | Treatment |
| --- | ---: | --- |
| Asia | ₱3,100 | Estimate |
| Outside Asia, including USA and Canada | ₱4,100 | Estimate |

Staff should keep the original estimate, actual cost, and adjustment distinct. If actual cost is lower, staff email the official receipt/proof and privately arrange the excess refund. If actual cost is higher, staff email the proof and balance due; the customer pays the difference directly outside the website. The website does not send that email, issue the refund, or collect the additional balance automatically.

### Shipping calculations that remain manual

Product shipping classes are assigned by staff. Do not infer a class from category. Do not automatically add, multiply, or take the maximum of rates for mixed carts or multiple quantities. Staff must review and record the quote basis. The international rate basis (per order or per parcel) and the country-to-Asia mapping have not been defined; do not invent either rule.

## 6. Inventory and orders

- New orders reserve stock transactionally so concurrent checkouts cannot reserve more than available inventory.
- Payment approval consumes the reservation and records an inventory transaction.
- Rejected proof or cancellation of an unpaid order releases its reservation.
- Cancelling a paid order does not automatically restock inventory or issue a refund; staff must handle those actions under the shop's process.
- The two-hour payment hold currently has no automatic expiry job. Staff must cancel expired unpaid orders to release stock.
- Admin stock adjustments should use the inventory adjustment flow and retain a reason/history record.
- New orders receive a unique internal reference with the Manila date, for example `HUS-YYYYMMDD-...`. Existing order numbers stay unchanged. Courier tracking numbers are issued by the courier and entered by staff; the internal reference is not a courier tracking number.
- Administrator accounts cannot place customer orders. The customer directory excludes accounts with the trusted administrator role.

### Order status outline

`Pending Payment → Payment Verification → Payment Confirmed → Processing → Ready to Ship → Shipped → In Transit → Delivered`

Payment rejection returns the order to a rejected state; a customer resubmission can reopen payment review if stock is available. Unpaid orders may be cancelled. Paid orders must not enter fulfillment until staff approve a matching payment.

### Customer cancellation

In **My Orders**, a customer can cancel their own pending-payment order before any payment proof has been submitted. They choose a reason and confirm the cancellation. A successful cancellation is final for that order and releases its stock reservation; repeating the request does not cancel it a second time. If the customer has already sent money or submitted proof, they must contact the shop so staff can handle the situation manually. The site does not automatically issue refunds.

## 7. Admin responsibilities

Authorized staff manage product content and publication, categories, product-specific options/specifications, shipping classifications, inventory, incoming orders, payment proof review, shipping quotes, actual international shipping records, order status, and tracking numbers.

Payment approval/rejection, courier charge collection, international refund/balance settlement, and customer email/SMS communications are manual operations unless a separately approved feature is implemented. Dashboard sales and inventory metrics should reflect the underlying approved records and must not imply a payment has been verified merely because proof exists.

## 8. Draft requirements that are not confirmed behavior

The pasted generic brief also mentions guest checkout, automatic shipping calculation from weight, LBC services, automated email/SMS confirmations and status notifications, per-variation inventory, sales reports, and broader courier availability. These are not established by the confirmed Hushley rules/current implementation described above. Do not present them as available or add them without owner approval and a review of the required database/security changes.

The draft says “secure payment processing”; for this shop that means securely storing proof and enforcing manual review. It does not mean integrating a payment gateway or automatically verifying payments.

## 9. Implementation references

- Project architecture, auth, and confirmed business requirements: [AGENTS.md](AGENTS.md)
- Current implementation and rollout checklist: [PROJECT_CHECKLIST.md](PROJECT_CHECKLIST.md)
- SQL contracts and shipping/payment safeguards: [supabase/SCHEMA_REVIEW.md](supabase/SCHEMA_REVIEW.md)
- Versioned schema changes: `supabase/migrations/`
- Customer and staff page behavior: `src/pages/`
