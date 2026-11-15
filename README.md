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

Save invoice, Print / download PDF, and Share PDF File are separate actions. Save commits the invoice atomically; printing and sharing require saved changes. Share uses `navigator.share` with only a PDF `File`, or downloads the file when native sharing is unavailable. No admin URL, route, or internal link is placed in the shared payload.

## POS system (`/pos`)

The Point of Sale lives in `src/pos/` and loads its own React/Tailwind bundle at `/pos`. The first permitted main report opens by default. Point of Sale, Rate Changing, Item Addition and Total Summary are grouped under the collapsed **In Future** sidebar dropdown, according to page permissions. They remain usable, and switching modules preserves the in-progress cart. Set a module’s `future` flag to `false` in `src/pos/App.tsx` to promote it into the main menu. Users with only future-module permissions can still open their first permitted page.

- `/` is the customer order form; `/admin` is the customer-order administration panel; `/pos` includes billing and operational reports.
- Both portals use the same Supabase project, with database RLS and `has_perm()` enforcing page access. Apply migrations in order when provisioning a new database; do not re-run the base schema over an existing deployment.
- `/admin` and `/` retain the original Supabase localStorage session key. `/pos` uses `ahwmb-pos-auth`. Existing saved sessions are preserved. Navigation never copies refresh tokens or borrows the other portal's identity.
- Use `/login?next=/admin` or `/login?next=/pos` to sign into a specific portal. A portal without its own session requires one sign-in, even if the other portal is signed in. Both can then stay open concurrently, including under different accounts. Switching buttons open the destination's own session.
- Explicit logout affects tabs sharing that portal session; it leaves the other portal's session intact. Refresh and permissions remain synchronized within each portal. Old `ahwmb-tab-login` sessionStorage markers are ignored.
- Generic `/login` preserves the existing account defaults: Ahmed opens `/admin`, and ahwmb1965 opens `/pos`. An explicit permitted `next` destination takes precedence.

### Data preservation

No database cleanup is performed on startup, navigation, or deployment. `sales` supplies billing history and Total Summary. Rate Changing and Item Addition show the live `items` catalog, not separate activity logs. The repository has no separate rate-change/item-addition log tables or test-record flag.

The old `supabase/manual/reset_pos_all.sql` and `reset_pos_sales.sql` scripts are disabled and raise an error without changing data. Never clear the catalog to reset these views. Any future test cleanup requires confirmed sale UUIDs and a verified backup. This repair intentionally preserves all existing sales, stock, customers, orders, rates, and local business storage.

Validation: `pnpm test`, `pnpm exec tsc --noEmit -p tsconfig.app.json`, and `pnpm build`. Session tests use the installed Supabase SDK with shared in-memory storage and a mocked network; they do not connect to production.

### Reliability release setup

See [IMPLEMENTATION.md](IMPLEMENTATION.md) for the coordinated database migration, Turnstile secrets, Edge Function deployment, staging acceptance checks and current verification limits. This frontend requires that rollout before production activation. Purchases now use a database table with an explicit, non-destructive import of old browser records. New audit history records future changes; sale and transfer reversals retain their original records.
