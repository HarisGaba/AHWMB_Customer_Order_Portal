# Portal reliability and polish implementation

Scope: customer flow, admin workflows, reports and future POS modules. Preserve all existing records and portal session isolation.

- [x] Database migration: private order lookup, validated submissions, notes, atomic invoice saves/version conflicts, audit history, purchases, sale idempotency/refunds, safe stock reversals.
- [x] Server: verified Turnstile submission endpoint; public RPC bypass closed by migration.
- [x] Customer: review flow, bilingual validation, isolated drafts, confirmation and recoverable submission IDs.
- [x] Admin: search/pagination/counts, dashboard filters, separate save/print/share, dirty guards, activity.
- [x] Reports/POS: durable purchases with explicit safe local import, URL navigation, cart recovery, connection feedback, refunds.
- [x] Styling: consistent controls, responsive layouts, focus indicators and reduced-motion support.
- [x] Automated checks: database integration, mocked endpoint verification, session isolation and pricing; TypeScript and production build.
- [ ] Visual browser verification: blocked by automatic approval-review usage limit. No authenticated browser acceptance tests were performed.
- [ ] Production activation: migration, function secrets/deployment and frontend release are not applied.

No production mutations during implementation. Database rollout requires the new migration and Edge Function configuration together with this frontend.

## Activation prerequisites

1. Export and verify a current production backup. Check the actual schema against the repository migrations through `20261114_ahmed_admin.sql`. The local PostgreSQL tests apply all checked-in migrations, with an auth shim and the existing `daily_expenses` table; they cannot verify untracked production schema changes.
2. Configure a Cloudflare Turnstile widget for the exact production hostname. Set `VITE_TURNSTILE_SITE_KEY` in the frontend build environment. Store `TURNSTILE_SECRET_KEY` only in Supabase Edge Function secrets, never in a `VITE_` variable. Set `TURNSTILE_ALLOWED_HOSTNAMES` to a comma-separated list of exact allowed hostnames (no scheme/path); staging needs its own allowed hostname/configuration.
3. Apply only the new `supabase/migrations/20261115_reliability.sql` to the existing database in a coordinated release window. Do not rerun the base schema, earlier seed/rename migrations, or disabled reset scripts. The migration runs in one transaction, adds columns/tables, creates policies/triggers/RPCs, and changes grants. It does not wipe or backfill business records. Existing customer-history lookup is deliberately revoked until customer identity verification is implemented.
4. Deploy `submit-customer-order` with `supabase functions deploy submit-customer-order --no-verify-jwt`. This public customer endpoint verifies Turnstile server-side (including hostname/action); only then does its service client invoke the restricted submission RPC. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Deploy the updated `daily-backup` function as well after the migration so purchases and activity are included.
5. Build and release this frontend with the configured site key. Keep the database/function/frontend rollout together: old clients cannot submit or write invoice/sale financial fields after the grant changes. Refresh existing tabs after release. Do not restore insecure RPC grants as a rollback shortcut.
6. In staging, verify English/Urdu ordering, notes/review, failure/retry, mobile layout, saved PDF/print/share, purchases/import, permissions, and simultaneous admin/POS tabs. Confirm no order or sale is duplicated after a lost response. Test stock reversal/refund with disposable staging records only. Check an actual downloaded backup includes the new tables. Repeat the visual acceptance check when browser approval is available.

## Data behavior and limits

- Existing products, customers, inventory, orders, sales and local purchase records are retained. No test records were identified or deleted.
- Purchase import is an explicit user action. It keeps the browser original, skips identical UUIDs and stops on conflicting copies instead of overwriting them.
- Invoice saves update the order and its normalized line records in one transaction; stale versions fail with an explanation. Audit snapshots retain before/after order contents. Direct financial-column updates from legacy clients are blocked.
- Sale void/refund records a reason and excludes the receipt from active totals; the original receipt remains in the database/activity history. It does not issue a payment or automatically adjust warehouse/customer-ledger balances.
- Stock reversal succeeds fully or leaves every balance and the transfer untouched. Reversed transfers remain visible and cannot be edited/reversed again. The previous bulk month-delete and force-delete fallback are removed.
- Activity history starts when the migration is applied; earlier events cannot be reconstructed. The connection indicator reports browser online/offline state, not database health.
- Drafts are tab-scoped; POS drafts are additionally account-scoped. Browser storage is a recovery aid, not a durable database backup. Purchase edits warn before screen navigation; unsaved invoices stay in memory while their admin panel remains mounted.
- The four future modules remain functional inside **In Future**, including when the sidebar is collapsed. No production deployment or live transaction verification was performed.

## Validation

Run `pnpm test`, `pnpm exec tsc --noEmit -p tsconfig.app.json`, and `pnpm build`.

Database tests use ephemeral PGlite PostgreSQL, never production. Endpoint tests mock Cloudflare and Supabase and cover missing secrets, invalid tokens/hostname/action, valid submission, and same-reference retry matching. Live Turnstile, deployed RLS and browser/mobile behavior still require staging acceptance.
