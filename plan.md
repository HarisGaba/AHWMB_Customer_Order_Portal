# AHWMB Responsive Bilingual Order Portal — Final Implementation Plan

The portal uses a 100% width React/Vite shell with Urdu and English modes. The main page is constrained only on wide displays for comfortable reading; it never constrains the app to a narrow desktop-style column on phones. At 620px and below, the item table becomes a stacked row-card layout inside the full-width card, so every item name, quantity, rate, total, and delete control is visible without horizontal page overflow. On larger displays it remains a conventional table.

Quantity is intentionally plain text rather than a dropdown. Each row uses a large example-based field such as `1 kg` or `1 packet`, with translated guidance explaining that kilograms suit rice/flour and packets suit masala/tea packs. The system stores exactly what the customer writes and does not guess units from item names.

The supplied `public/invoice-template.png` remains the PDF background. The renderer clears only the data areas and writes the live customer name, generation date/time, item names, quantities, rates, and totals. Dynamic text is fitted to its available cell width, uses readable font bounds, and truncates long values with an ellipsis instead of colliding with adjacent columns. Notes and totals have their own spaced positions.

## Revision: auth navigation and invoice fidelity

The header owns the only navigation auth action. It displays `Login` while signed out and `Logout` while a Supabase session exists; logout signs out and navigates to `/`. The login form starts blank and uses `autocomplete="off"` on the form and fields so credentials must be entered manually. `/admin` redirects unauthenticated visitors to `/login` without rendering a second body login action.

The invoice uses the supplied 1024×1536 green/gold artwork as its background. A high-resolution canvas overlay redraws the customer/date/time box and a clearly spaced five-column table: S.No, Item, Quantity, Per KG/Gram/Piece, and Amount (PKR), with fitted text, visible gold dividers, subtotal, total-items, and final-total sections.

## Revision: post-completion editing and operations

Customer orders now capture a Google Maps location link or browser GPS pin. Customer quantities are stored as numeric values with an explicit `KG`, `GRAMS`, or `PCS` unit, so unit-specific pricing stays numerically consistent.

The admin editor remains available for pending and completed orders. Shopkeepers can edit names, quantities, units, unit prices, and line totals; add or remove rows; recalculate the grand total; save changes; and reprint the invoice. The invoice preserves the supplied five-column artwork while showing unit price and line total in dedicated aligned columns.

The Supabase migration adds `orders.location_link`, a normalized `order_items` table, dual-admin RLS through `is_ahwmb_admin()`, update/delete policies, and realtime support. New-order email delivery is represented by `supabase/functions/notify-new-order`, which uses a Supabase Edge Function and a Resend API secret when deployed.

## Revision: unit dropdown and invoice rate column

The admin unit selector now uses a type-safe branch for `unit_type` instead of numeric coercion, so KG, GRAMS, and PCS remain valid controlled-select values and persist in both the JSON order snapshot and normalized `order_items` rows. Unit prices are interpreted in the selected unit: per-KG for KG, per-gram for GRAMS, and per-piece for PCS. Line totals multiply the numeric quantity by the matching unit price.

The invoice renderer follows the supplied five-column reference: S.No, Item, Quantity, Per KG/Gram/Piece, and Amount (PKR). Each item row displays the selected quantity/unit, the matching rate label plus numeric price, and the calculated line total while preserving the dark-green/gold print-ready artwork.

## Revision: normalized PDF quantity and rate presentation

The invoice now derives its printed quantity from the persisted numeric `quantity_value` plus `unit_type`, rather than reusing a stale customer-entered string after an admin edit. It prints normalized examples such as `5 kg`, `250 grams`, and `10 pieces`. The selected unit is also the rate basis: KG uses a per-KG rate, GRAMS uses a per-gram rate, and PCS uses a per-piece rate, so totals are always quantity multiplied by the matching unit rate with no accidental 1000× conversion.

The rate column remains immediately after Quantity and now uses two visually separated lines per row: `Price per KG/Gram/Piece` followed by the numeric `Rs.` rate. The Amount column always prints the numeric line total, including zero, and the row layout remains fitted to the supplied green/gold invoice artwork for clean print output.
