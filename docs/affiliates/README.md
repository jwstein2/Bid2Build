# Built2Bid Affiliate Hub

Independent partners (mostly YouTube creators) refer contractors through a permanent link `/a/<CODE>`. For each
paying customer they earn **one month of the customer's eligible subscription value once a year, for at most 10
years**. Paid annually, never monthly, never up front.

The Affiliate Hub is separate from the customer referral program (`referral_*`, a month free for referring a
contractor), from internal sales reps (`sales_*`, staff-only Sales Portal) and from HR (`pm_*`).

Migration: `supabase/migrations/20270211001000_affiliate_hub.sql`. Rollback: `docs/affiliates/rollback_20270211001000.sql`.
Agreement draft for counsel: `docs/affiliates/AFFILIATE_AGREEMENT_DRAFT.md`.

## Routes

| Route | Who | What |
|---|---|---|
| `/affiliates` | public | Landing page: headline, how annual commissions work, disclaimers, FAQ |
| `/affiliates/apply` | public | Application (U.S. only, honeypot, IP rate limit) |
| `/affiliates/terms` | public | Program summary; full agreement shown during onboarding |
| `/a/<CODE>?c=<campaign>&s=<source>&to=<path>` | public | Click logger: hashed IP/UA, bots and prefetch skipped, 90-day `b2b_aff` cookie, safe redirect |
| `/affiliate-hub/login` | affiliates | Sign in (same Built2Bid account system) |
| `/affiliate-hub/invite/<token>` | invitees | Accept an owner invitation (token stored as a hash only) |
| `/affiliate-hub/onboarding` | affiliates | 7 steps: welcome, info, YouTube channel, 10 lessons (FTC included), agreement, W-9 + bank, submit |
| `/affiliate-hub` | active affiliates | Dashboard: KPIs, upcoming commissions, payouts |
| `/affiliate-hub/calendar` | active affiliates | Monthly commission calendar (confirmed vs forecast) |
| `/affiliate-hub/earnings` (+ `/export`) | active affiliates | Annual earnings chart, filters, accessible table, CSV |
| `/affiliate-hub/customers` | active affiliates | Privacy-safe 10-year portfolio per customer (no names or emails) |
| `/affiliate-hub/resources` | active affiliates | Link + campaign/QR generator, talking points, video outline, disclosures |
| `/affiliate-hub/profile` | active affiliates | Profile, bank status, open a dispute |
| `/affiliate-hub/practice-bank` | affiliates | Practice bank page (mock provider; no money moves) |
| `/api/affiliate-payouts/return` | provider | Hosted bank-connect return (signed state cookie) |
| `/api/cron/affiliates` | Netlify cron | Daily: mature holds, evaluate anniversaries, refresh YouTube stats |
| `/admin/affiliates` | owner | CRM tabs: Overview, Affiliates, Prospects, Corrections, Commissions, Payouts, Disputes, Compliance, Settings |

Netlify scheduled function: `netlify/functions/affiliates-cron.mts` (`40 14 * * *`, 8:40 AM CT).

## How money is calculated

- **Year 1** = the customer's first qualifying paid subscription invoice. **Year N** = that date N-1 years later.
- An anniversary qualifies when a qualifying invoice covers that date (paid-through rule, 30 grace days).
  Prorations, fully refunded and disputed invoices don't qualify. A missed anniversary is ineligible; the term never
  restarts. A late-recorded covering invoice turns that line into a commission (`late_invoice`).
- Amount = `round(L × min(1, Pnet / (Ld × M)))`. `Pnet` = pre-tax paid, minus refunds in proportion. `M` = months
  covered. `Ld` = list value per month of every recurring item. `L` = `Ld` (annual ÷ 12, default) or the monthly list
  price (`annual_basis = monthly_list`, the Sales Hub rule). **The owner must approve the annual basis.**
- 30-day hold, then re-checked and moved to payable. Refund or chargeback during the hold reverses it. After payout,
  it is flagged for review only (`after_payout_refunds = review_only`) until counsel approves recovery.
- **Attribution**: one owner per customer, Sales or Affiliate, whichever verified source is recorded first at account
  creation (shared advisory lock). The app layout records the earliest cookie visit first.

## Payouts

Affiliate payouts reuse the V8.1 ledger (`payouts`, `payout_items`, `payout_events`) with `affiliate_id` as a second
payee type. A payout runs only when **all** are true:

1. `affiliate_settings.payouts_enabled` (needs `policy_confirmed_at`), set in Admin → Affiliate Hub → Settings
2. `payout_settings` mode is not `off`, and live activation was done in Admin → Payments
3. The affiliate is active, has an accepted agreement, a W-9 and a verified bank destination, and the balance is ≥ the minimum

Test/practice mode never marks commissions paid. A failed payout releases its items to be planned again. A returned
payout re-opens them as payable. The ledger is never deleted.

## Switches (all OFF by default)

| Switch | Where | Effect |
|---|---|---|
| `YOUTUBE_API_KEY` | Netlify env | Enables channel import + daily stats (YouTube Data API, free quota) |
| `AFFILIATE_EMAILS=on` | Netlify env | Sends transactional emails (application received, approved, payouts). Otherwise they are logged only |
| `recruitment_emails` | Admin → Affiliate Hub → Settings | Allows outreach emails to prospects who gave consent; suppression list always applies |
| `payouts_enabled` | Admin → Affiliate Hub → Settings | See Payouts |
| `applications_open` | Admin → Affiliate Hub → Settings | Public application form on/off (on by default) |

## Tests

- `tests/affiliate-portfolio.test.ts` (unit: portfolio math, links/cookies, invoice facts, YouTube parsing, lessons, analytics)
- `tests/db/affiliate-hub.test.ts` (real Postgres: apply → approve → onboarding, attribution conflicts, commission engine,
  10-year cap, refunds/disputes, holds, payouts, disputes, RLS)
