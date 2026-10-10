# Jodia Bazaar Order Portal

## Weight and piece pricing

For **KG** lines, the shopkeeper enters a rate per kilogram. For **GRAMS** lines, the shopkeeper enters the rate per kilogram and the calculator converts grams to kilograms automatically. **Pieces** are priced per piece. This matches the shop's chai pati pricing and avoids multiplying a gram amount directly by a rupee amount:

- `250 grams at Rs 1,600 per KG = Rs 400`
- `500 grams at Rs 1,600 per KG = Rs 800`
- `1 kg × Rs 1,600/kg = Rs 1,600`
- `3 pieces × Rs 25/piece = Rs 75`

For a 250 g customer order, select **GRAMS**, enter `250`, and set the rate to `1600` per KG. The invoice shows the quantity in grams and the rate basis as per KG. For a 1 kg sale, select **KG**, enter `1`, and set the rate to `1600` per kg. Piece/packet lines continue to use a per-piece rate.

## Invoice saving and printing

Save & Print saves the priced items and financial fields in Supabase, downloads the generated PDF, and triggers print preview through a hidden iframe in the current window. It does not open a new tab. Database and PDF errors are reported separately.

The PDF uses the supplied black-and-white `public/invoice-template.png` reference: decorative frame and crest, customer/date panel, item table, subtotal, balance/deposit/remaining section, total-amount plaque, and thank-you footer. The example image's customer names and extra account amounts are covered and replaced with live order data; blank adjustment rows remain blank so the app never invents charges.

## Run locally

1. Install Node.js and pnpm.
2. Copy `.env.example` to `.env.local` and set the Supabase URL, Supabase publishable key, and shopkeeper WhatsApp number.
3. Apply `supabase/schema.sql` to the intended Supabase project and configure its authentication as required by the project.
4. Run `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm build`.
5. Run `pnpm dev` for local development.

The Supabase publishable/anon key is intended for client use; never put a Supabase service-role key in a browser environment variable.


## Part 1 upgrade notes

The customer portal includes the official rice, pulses, spices, wheat, and extra-items product menu. Use the catalog search field to find a product and place it into the next empty order row, then enter its quantity. The customer quantity placeholder is `Quantity`, and English is the first-open default; Urdu remains available from the header toggle.

Customer submission now uses the `submit_order` Supabase RPC. It inserts the order and normalized `order_items` in one transaction through a security-definer function, avoiding the anonymous `.select('id')` failure while keeping order rows private from anonymous users. Apply `supabase/schema.sql` before testing submission.

The notification Edge Function sends new-order notifications to `NOTIFY_TO_EMAIL`, defaulting to `ahwmb1965@gmail.com`. Configure `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL` as Supabase Edge Function secrets. The admin allowlist already includes `ahwmb1965@gmail.com`; set its password through Supabase Authentication rather than storing credentials in frontend code or source control.

## Part 2 invoice upgrade

The supplied black-and-white invoice reference is now stored as `public/invoice-template.png` and used as the PDF background. Dynamic customer data, item rows, per-unit labels and amounts, subtotal, balance, deposit, remaining balance, and total amount are overlaid in the reference positions.

The Admin Panel's Total Balance, Deposit, and Remaining Balance fields use `Remaining Balance = Total Balance - Deposit`. Applying `supabase/schema.sql` adds the three persistence columns to `orders` and the save operation stores them.

Save & Print downloads the PDF and launches print preview through a hidden iframe in the current window; it does not open a new tab or popup. After saving, Share PDF File uses `navigator.share` with only a PDF `File`. No admin URL, route, or internal link is placed in the shared payload.
