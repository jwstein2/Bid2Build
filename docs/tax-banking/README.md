# V6.9: Tax intelligence and connected banking

Status: tax rates come from **Built2Bid's own tax engine** (official state rate files + the free Census address lookup + construction rules), so there is no paid tax service and no per-call cost. Plaid stays the bank provider and turns on with its keys. Nothing in this release moves money, files anything, or sends email.

## 1. What changed for users

| Where | What it does |
|---|---|
| **Financials → Cash flow** (`/financials/cash`) | A forecast for 7/14/30/60/90 days or a custom end date. It shows **Confirmed** (bank-reported only), **Scheduled** (plus bills, payroll and planned payments with set dates) and **Expected** (plus invoices and milestones on the dates customers usually pay). Line, area, bar and table views. KPIs: bank-reported balance, projected balance, expected in and out, lowest point. Each event links to its record. A cash plan holds payroll, rent, deposits and transfers. Viewers without bank access see the net change from $0. |
| **Financials → Connected banks** (`/financials/banks`) | Read-only bank linking. The button says "Coming soon" until a provider is approved. In practice mode (sandbox books and preview deploys) a mock bank offers test scenarios. Masked accounts (last 4 digits only), a primary account, bank-reported vs available balance, stale-data warnings, "Refresh bank balance" (5 per day per connection), Reconnect, and Disconnect (keeps history). |
| **Financials → Tax & regulatory updates** (`/financials/tax`) | Alerts for the company's states, with View official source / Review affected drafts / Mark reviewed / Dismiss. A banner says how many states have official local rates loaded. Tax setup (home state, service states, registration yes/no, business type, work mix, usual contract, notification choices; email is off by default). **Exemptions: "Ask a customer to sign their certificate online"** makes a secure link; the customer fills in the uniform exemption certificate and signs by typing their name, and it's saved automatically (no uploads). The 50 states + DC agency registry. |
| **Customer exemption page** (`/exempt/<link>`) | No account. Purchaser, address, business type, reason (A–M), ID number, states, the certification statement and a typed signature. One certificate becomes an active exemption for each state picked. |
| **Bid builder → View tax details** | Official rates for the job address (state, county, city, special districts), taxable vs not taxed per line from the construction rules, a "Type of work" switch (new construction vs repair/remodel), the rule note for the state, exemptions, review reasons, and the difference from the bid's own rate. "Use X%" fills the field only when pressed. Signed proposals keep their own snapshot. |
| **Issuing an invoice** | A locked tax snapshot of the invoice's own amounts. If a tax service is on and the rate for the invoice date differs from the contract rate, the snapshot is flagged for review. The invoice amount is never changed. |
| **Financials home + V6.6 dashboard** | New "Cash position" and "Tax & regulatory updates" cards and widgets. Owners get a one-time setup prompt: "Set up sales tax / Connect Business Bank Account / I'll do this later". |
| **Admin → Operations → Tax & banking health** (`/admin/tax-banking`) | Aggregate counts, plus the **official rate files** table: each state's source, status, rates and ZIPs loaded, last good import, and Edit links / Import now. No customer's bank or tax details. |

Screenshots: `/mnt/project-files/tax-banking/screenshots/` (desktop 1440 and phone 390, light and dark, practice data). Walk results are in `walk-results.txt`.

## 2. Audit of existing tax code (before V6.9)

- Bids had one company-typed `tax_rate` and a per-line `taxable` flag (`src/lib/estimate/engine.ts`). There was no address-based rate, no effective dates, and no record of where a rate came from.
- Proposal versions already snapshot `tax/subtotal/total` in `estimate_versions`. V6.9 keeps that as the contract record and never rewrites it.
- Invoices store `tax_rate` and `tax` (`fin_invoices`). V6.9 adds a locked snapshot on issue and changes nothing else.
- Stripe Tax is already active for **Built2Bid's own subscription** (MN). It calculates only for the calling account's registrations, so it can't calculate a contractor's customer tax until Stripe Connect exists. It is listed below but not recommended for this job.
- Reports had a "Sales tax (coming later)" placeholder. It is unchanged; filing and returns are out of scope.

## 3. Architecture

- **Built-in tax engine** (`tax/builtin.ts`, the default provider, `TAX_PROVIDER` unset or `builtin`):
  1. *Where is the job?* The free U.S. Census geocoder gives the county and city codes (`tax/geocode.ts`). Results are cached in `tax_geocode_cache` keyed by a SHA-256 of the address (no address text stored, service role only). Special districts come from the state's boundary file per ZIP (`tax_zip_areas`). If the street can't be matched, the ZIP's most common area is used and flagged.
  2. *What rate on that date?* `tax_jurisdiction_rates`, effective-dated. Official imported rates always beat the bundled statewide **seed** rates (`tax/seed-rates.ts`, checked 2026-11-18; DC and UT have none). States with no local taxes (CT, DC, IN, KY, ME, MD, MA, MI, NJ, RI) need no lookup. No rate on file = the contractor's own rate, labelled, never a guess.
  3. *What is taxable?* `tax/construction-rules.ts`: one rule per state + DC for materials and labor by new construction vs repair, lump sum vs time & materials, residential vs commercial. Uncertain cases are flagged for review and shown as taxable so a bid isn't under-priced. Rules version `2026-11-18.1`. Not legal advice.
- **Official rate import** (`tax/importer.ts`, `tax/official-files.ts`, hourly via `netlify/functions/tax-rates-cron.mts` → `/api/cron/tax-rates`, same bearer secret). States are taken oldest-first within an 18-second budget, so each state refreshes about daily.
  - Streamlined (SST) states: the rate and boundary files in the national layout, found on the listing page (newest `XXR…`/`XXB…` file) or from direct links the owner sets in admin. Zip archives are read in-house.
  - Other states: their own CSV table with an owner-set column mapping (`tax_rate_sources.format`). Until one is set, those states use the statewide seed rate and flag the local part.
  - Each file is validated. A changed format or failed download marks the state (`format_changed`/`failed`) and **keeps the last good rates**. New or changed rates go through `tax_official_import` → `tax_change_record` (versioned, verified, alerts for real changes; first recordings are silent baselines; a different rate for a date already on file is a correction that goes to review).
- **Tax engine** (`src/lib/tax-banking/tax/engine.ts`) is provider-neutral. It tries, in order:
  1. The provider (built-in by default).
  2. The last verified stored rate, flagged `stale_rate`.
  3. The company's typed rate, flagged `unverified_company_rate`.

  It never invents a rate. An exemption applies only with a current certificate for the same state. Tax is rounded once to the cent and allocated by largest remainder. Construction treatments the provider can't settle are flagged `construction_treatment_review`.
- **Adapters** (`tax/providers.ts`): built-in (default), mock (dated test fixtures), and optional paid adapters kept dormant: Avalara AvaTax (SalesOrder, never committed), TaxJar, Stripe Tax.
- **Rate versions** (`tax_jurisdiction_rates`, immutable, effective-dated) and **change events** (`tax_change_events`):
  - Only a *verified numeric rate whose sources agree* can apply automatically. A generated column plus a CHECK constraint enforce this.
  - Rule, taxability, unverified and conflicting changes are always `needs_review`.
  - Duplicates are one event (unique index).
- **Nightly job** (`netlify/functions/tax-banking-cron.mts` → `/api/cron/tax-banking`, bearer `TAX_BANKING_CRON_SECRET`, runs at 09:17 UTC). It:
  1. Checks provider rates for the states companies serve, for today and the next three quarter starts. With no provider it records a skipped run.
  2. Activates changes that are due.
  3. Sends alerts to affected books, once each.
  4. Writes the quarterly summary in the first week of a quarter.
  5. Checks that agency homepages are reachable.
  6. Syncs active bank connections.

  Rate changes take effect with no deploy.
- **Online exemption certificates**: `fin_tax_exemption_requests` (secret link, only its hash stored, 30 days, a new link replaces the old one), `fin_tax_exemption_certificates` (immutable; readable only with manage-financial-config), and `fin_tax_exemptions.certificate_id`. In Streamlined states the certificate applies directly; elsewhere it applies with an "this state may want its own form" review note. Built2Bid can't confirm a permit number with a state.
- **Agency registry**: 51 rows (`authorities.ts`, seeded in SQL), all marked `needs_verification` until the nightly check reaches them. No feeds or agencies are invented.
- **Banking**:
  - The provider's own window does the sign-in. Built2Bid never sees bank credentials.
  - `bank/service.ts` (server-only) exchanges the token, stores it sealed with AES-256-GCM (`BANK_TOKEN_KEY`) in `fin_bank_connection_secrets`. Only the service role can read that table. The token never reaches the browser.
  - Feed lines land in the existing V6.3 `fin_bank_transactions`, so Accountant Mode matching and reconciliation apply unchanged. Balances are immutable snapshots in `fin_bank_balances`.
  - The Plaid adapter uses Transactions and Balance only, never Auth, so no account or routing numbers are fetched.
- **Forecast** (`forecast.ts`) is pure and decimal-safe. Overdue invoices are only ever "expected". Expected dates follow each customer's payment history. Transfers between two selected accounts net to zero. A deposit linked to an invoice replaces it, so nothing is counted twice.
- **Permissions**: capabilities map onto existing keys (`tb_capability_key` / `tb_can`). No new keys are added, and switching modes changes nothing.

  | Capabilities | Existing key |
  |---|---|
  | tax.view_config, tax.review_alerts, cash.view_forecast, reports.view | view_company_financials |
  | tax.manage_settings, bank.connect, bank.disconnect | manage_financial_config |
  | bank.view_balances, bank.view_transactions, bank.reconcile, cash.manage_plan | reconcile |

  Pages are also guarded by V6.7 `requireAnyCapability` (banks → `bank`, cash/tax → `fin_visibility`) and listed in `NAV_FEATURES`.

## 4. Provider comparison (costs as of Nov 2026)

These figures come from public pages and third-party write-ups. Avalara and Plaid quote privately, so confirm with sales before relying on them.

### Tax rates

| Provider | What it covers | Cost | Fit for Built2Bid |
|---|---|---|---|
| **TaxJar (Stripe)** | Rooftop rates, all US states and local jurisdictions, API | Starter $39/mo (no API). **Professional $99/mo+ includes the API**; 10 API calls = 1 order. Price increase announced for Oct 2026. | **Recommended first step.** Published price, simple API, enough for estimate-time rates. Construction taxability is generic, so V6.9 flags those cases for review. |
| **Avalara AvaTax** | Most complete. Construction-specific product codes, exemption certificate management | Quote-based, no public per-transaction price. Third-party estimates range from $119 to $699/mo; filing is extra (about $699–$799 per state per year). | Best accuracy for contractors. Move here when volume or construction rules need it. The adapter is already written. |
| **Stripe Tax** | Calculates only where *the calling Stripe account* is registered | $0.50/transaction (10 calcs included), then $0.05/calc; Tax Complete $90/mo | **Not suitable yet**: it would calculate Built2Bid's tax, not each contractor's. It would work only with Stripe Connect. |

### Bank connections

| Provider | Cost | Notes |
|---|---|---|
| **Plaid** (recommended) | Pay-as-you-go, no public price list. Transactions are billed per connected account per month; Balance is billed per call. Unverified third-party figures: about $0.25–$1.50 per account per month. The sandbox is free. | Most common, widest US bank coverage, standard Link window. Production needs Plaid's application review. |
| Teller | Published per-connection pricing, 100 free developer connections | Cheaper and simpler, but fewer banks. A good fallback. |
| Stripe Financial Connections | Custom pricing | Ties banking to Stripe. Same Connect caveat as Stripe Tax. |

**Decision (James, 2026-11-18):** keep Plaid; replace TaxJar with Built2Bid's own engine (above). The paid tax adapters stay in the code, switched off, in case volume or construction rules ever call for Avalara.

### What the built-in engine can't do (told to James before building)

| Limit | Impact | How it's handled |
|---|---|---|
| Exact local rates outside the 24 Streamlined states | High | Statewide seed rate + "check the local rate" flag until a state table mapping is set in admin |
| Messy local states (CO home-rule, AL, LA, AZ, AK) | Medium | Same flag; AZ/AK construction always goes to review |
| Construction rules need upkeep | High | Versioned rules file; uncertain cases flagged; rule changes never auto-apply |
| Checking a customer's permit number with the state | Low–medium | Customer signs the certificate online; recorded, not verified |
| No accuracy guarantee | Low | Labelled as an estimate everywhere |
| States change file formats | Upkeep | Validation, last good rates kept, admin shows the state as needing a fix |

## 5. Security review

- Credentials: Built2Bid never handles bank logins; the provider window does. Tokens are sealed with AES-GCM and live in a table with no grants for `authenticated` or `anon`. They are read only by server code using the service role, and are deleted on disconnect.
- Only `last4` is stored (a CHECK constraint enforces 4 digits). There are no account or routing numbers, and the Plaid Auth product is never called.
- RLS: balances and connections require `reconcile`. Tax alerts require company financials. Draft tax calculations are visible only to people who can read the bid. Locked snapshots are immutable, and corrections create a new row that points at the original.
- Owner monitoring (`admin_tax_banking_health`) returns totals only and is callable only by the service role.
- Isolation:
  - Real providers need the mode variable, a `*_LIVE=true` switch and credentials. They never run in tests.
  - Mocks never run in a production deploy, except inside a sandbox book.
  - `assertTestIsolation()` fails the test run closed if live Stripe, Plaid or tax credentials are present.
- Nothing sends email: `notify_email` defaults to off, and the alert pipeline is in-app only.
- **Decision for the owner:** statement lines imported before V6.9 (`fin_bank_transactions`) are still readable with `view_company_financials`, as in V6.3. The new balances and connections require `reconcile`. Tightening the old lines to `reconcile` too is a one-line policy change if you want it.

## 6. Database

- Migration: `supabase/migrations/20261226001000_tax_banking.sql`. A copy to paste is at `/mnt/project-files/tax-banking/run-tax-banking.sql`.
- Rollback: `docs/tax-banking/rollback_20261226001000.sql` (copy beside the SQL). It drops all V6.9 objects, keeps bank lines, and resets provider-feed accounts to statement imports. A test proves the migration re-applies cleanly after a rollback.

## 7. Owner checklist

Step-by-step is in `docs/tax-banking/provider-setup.md`. In short:

1. Run the SQL. In Netlify Production, set `TAX_BANKING_CRON_SECRET` (turns on the hourly rate import and the nightly job).
2. Tax: nothing to sign up for. After the first imports, check **Admin → Tax & banking health → Official rate files** and fix any state marked "needs link".
3. Plaid:
   - Test keys (`PLAID_ENV=sandbox`) work only inside a Practice (sandbox) book.
   - After Plaid grants production access, set `PLAID_ENV=production` and the production secret.
   - Also required: `BANK_PROVIDER=plaid`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `BANK_TOKEN_KEY` and `BANK_PROVIDER_LIVE=true`.
4. Until the Plaid variables exist, Connected banks shows "Coming soon".

## 8. Tests (all 40 spec scenarios)

- `tests/tax-builtin.test.ts` (33 unit tests): construction rules for all 51, SST rate/boundary readers, zip archives, file discovery, address → jurisdiction choice, official-over-seed, the built-in provider end to end, Census down, wrong-state address, importer (ok / format changed / no link), seed ↔ SQL sync, the exemption form.
- `tests/tax-banking.test.ts` (41 unit tests): engine, adapters, isolation, token sealing, forecast. This includes the spec example 42,500 − 6,000 − 2,500 + 15,000 − 3,000 = 46,000.
- `tests/db/tax-banking.test.ts` (23 tests against the real SQL, including official imports, boundary switch-over, geocode cache privacy and the online exemption flow): RLS, versioning, dedupe, alerts and digest, snapshots, feed ingest, reconciliation, refresh limit, disconnect, aggregate-only monitoring, rollback.
- Full suites: 1,586 unit tests and 532 database tests pass, plus typecheck, lint and production build.
- Browser walk: `scripts/tax-banking/seed.mjs` + `walk.mjs`.
