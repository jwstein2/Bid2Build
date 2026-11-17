# Financials: owner decisions (2026-11-17)

James asked for the recommended option on each open Phase 1 question, based on common practice. This records what was chosen, why, and what shipped.

## 1. A Financials seat alone opens a job's finances (yes)
- **Practice:** QuickBooks and Sage both give bookkeepers and accountants job-cost and invoice access without access to sales or estimating. Billing staff seldom need the estimate itself.
- **Shipped:** `fin_job_header()` returns a bid's basic details (title, customer, stage) to anyone `fin_job_visible()` allows: a covered Financials seat, the free accountant seat, or the assigned PM. It never returns line items, costs or margins, which stay behind the bid's own permissions. The job page and `/api/financials/jobs/*` use it when the person can't read the bid.

## 2. Solo pricing: 1 user plus a free accountant seat (no price created)
- **Practice:** QuickBooks Solopreneur is about $20/mo with no accountant access; Simple Start is about $38/mo for 1 user and adds free accountant access. Inviting your accountant at no charge is the norm on every paid tier. These are third-party figures; check Intuit's live page before launch.
- **Shipped:** this was already in the Phase 1 database (solo books get 1 seat and one free read-only accountant seat). No Stripe objects were created or changed.
- **Recommended price (needs James's go-ahead before any Stripe change):** solo Financials at **$14.99/mo or $149/yr**, against $24.99/mo with 3 users for companies. That undercuts QuickBooks Simple Start while including job costing.

## 3. Record retention: 7 years after the last financial activity
- **Practice:** the IRS default is 3 years, 4 for employment tax, 6 for substantial underreporting and 7 for bad-debt or worthless-securities claims. Many states run longer. Seven years is the common blanket rule for small businesses.
- **Shipped (migration 20261125001000):**
  - Account deletion checks Financials first. A solo book with no records (setup only) is purged, so the account deletes as before.
  - A book with records (jobs, invoices, payments, credits, refunds, bills, expenses, commitments, documents or vendors) gets a hold until 7 years after its last activity. The account is **closed instead**: subscriptions are canceled, sign-in is blocked, and the records stay read-only.
  - Settings and the Privacy page explain this (only when Financials is on).
  - "Download my data" now includes the financial tables.
  - Company books belong to the company; a company owner already can't delete their login while the company exists.
- **Later:** a scheduled purge of released holds. Nothing becomes eligible before 2033.
- **Legal check:** have the attorney reviewing the Terms confirm the 7-year rule and the Privacy wording.

## 4. CPA before Phase 2: yes, a fixed-scope review
- **Recommendation:** hire a CPA firm with a construction practice (one that audits or reviews contractors and knows ASC 606 over-time revenue, retainage and WIP) on a **fixed-fee scope of about $3k–$7.5k**, before any ledger code.
- **Scope to ask for:**
  1. The default chart of accounts per trade profile.
  2. Posting rules for invoices, payments, deposits, retainage, change orders and vendor bills.
  3. Cash vs accrual and WIP / over-under billing reports.
  4. Sales-tax timing on change orders.
  5. Period close and lock rules.
  6. Sign-off on export formats accountants will import.
- **Where to look:** your state CPA society's directory (for Minnesota, MNCPA's "Find a CPA"), or the CFMA member directory. Ask for two quotes.
- **Deliverable:** a written memo we turn into Phase 2 tests. Keep "financial operations and job costing" wording until it's done.

## 5. One Home for every pillar (behind its own switch)
- **Practice:** Procore, Buildertrend and JobTread each have one role-aware home with modules as views, not several competing dashboards.
- **Shipped:** `/home` behind `NEXT_PUBLIC_UNIFIED_HOME` (off). It holds no numbers of its own:
  - **Win the Job:** Bids board counts (same filters as the board).
  - **Company:** win rate and open value from `company_pipeline_summary`.
  - **Run the Job:** schedules.
  - **Grow the Business:** customers.
  - **Know Your Numbers:** the person's first three Financials KPIs from the dashboard engine, plus urgent alerts.

  Pillars without access are left out (no upsells). The nav gets "Home" at the top and the logo points there. The existing pages stay as the views, unchanged.
- **Turning it on:** set `NEXT_PUBLIC_UNIFIED_HOME=on` in Netlify and redeploy. Making `/home` the default landing page after sign-in is a follow-up once James likes it.
