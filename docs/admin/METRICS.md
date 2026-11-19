# Owner command center: metric dictionary

Mirrors `src/lib/admin/definitions.ts` (the in-app Definitions page and info tips). Calculations live in `src/lib/admin/model.ts` (accounts, revenue, usage), `src/lib/admin/finance.ts` (Business Scorecard) and `src/lib/admin/costs.ts` (Tech Stack & Costs); tests in `tests/admin-model.test.ts` and `tests/admin-finance.test.ts`.

All business metrics default to **genuine accounts only** (see *Genuine account*). The owner toggle in the header adds internal, test and demo accounts back.

## Registered account

A Built2Bid login (Supabase Auth user).

- **Source:** auth.users (service role)
- **Rules:** Genuine accounts only unless “Include test data” is on.
- **Window:** Signup date
- **Refresh:** Live on each page load
- **Limits:** Includes accounts that never verified their email (shown separately on Customers).

## Genuine account

An account that is not internal, test or demo.

- **Source:** admin_account_labels, admin_roles, auth email
- **Rules:** Owner label wins. Otherwise admin role → internal; reserved test domain (.test, .example, example.com, stripe-test-…) → test; else genuine. Company names are never used.
- **Window:** Current
- **Refresh:** Live
- **Limits:** Until the owner labels them, the owner's own extra logins on real domains count as genuine. Label them on Customers.

## First bid

The first time an account starts an estimate.

- **Source:** estimates.created_at
- **Rules:** Earliest estimate per account.
- **Window:** Date the bid was started
- **Refresh:** Live
- **Limits:** A started bid can be an empty draft.

## Finalized bid

An estimate with at least one locked version (finalized for export or sending).

- **Source:** estimate_versions
- **Rules:** Counted once per estimate, on its first version date.
- **Window:** First version date
- **Refresh:** Live

## Activated business

An account that has finalized at least one bid.

- **Source:** estimate_versions
- **Rules:** Counted on the date of its first finalized bid.
- **Window:** Date of first finalized bid
- **Refresh:** Live
- **Limits:** Enterprise members are counted per login on account views and per company on usage views.

## 7-day activation (added Nov 2026)

An account that, within 7 days of signing up, saved an estimate with at least 3 meaningful line items, finalized (exported) a bid, or sent one for signature.

- **Source:** estimate_items (counts only, via growth_meaningful_estimates), estimate_versions, signing_requests, analytics_events ‘bid_created’
- **Rules:** Meaningful line item = named, quantity > 0 and unit cost > 0; example rows never count. Reported beside “Activated business”, which is unchanged.
- **Window:** Signup cohort; first 7 days after signup
- **Refresh:** Live
- **Limits:** Bids saved before the bid_created event existed use their last update time (can only under-count). Compare the matured-cohort rate.

## Active business

A business that started or finalized a bid, or sent a proposal for signature, in the window.

- **Source:** estimates, estimate_versions, signing_requests
- **Rules:** Page views and sign-ins do not count. A business is the Enterprise company, otherwise the account.
- **Window:** Weekly = last 7 days, monthly = last 30 days
- **Refresh:** Live

## Paying customer

An account with a Stripe subscription in status active, trialing or past due.

- **Source:** subscriptions (webhook snapshot of Stripe)
- **Rules:** Complimentary access never counts. Past due is still counted but flagged red. One per account.
- **Window:** Right now
- **Refresh:** Updated by Stripe webhooks
- **Limits:** Stripe is the source of truth. The Revenue page compares this snapshot with Stripe when Stripe is reachable.

## Complimentary customer

An account with an active complimentary grant and no paid subscription.

- **Source:** complimentary_grants
- **Rules:** Excluded from paying customers, MRR and paid conversion.
- **Window:** Right now
- **Refresh:** Live

## MRR (estimate)

Monthly recurring revenue at list price from paying subscriptions.

- **Source:** subscriptions
- **Rules:** Monthly $19.99; annual $199 ÷ 12 (never counted twice); Enterprise from its licensed seats. Complimentary excluded.
- **Window:** Right now
- **Refresh:** Live
- **Limits:** List price, not cash collected (no discounts, refunds or tax). “Payments received” comes from Stripe invoices.

## Net MRR change

MRR added by new paid subscriptions minus MRR lost to ended ones, in the window.

- **Source:** analytics_events ‘subscribed’, subscriptions end dates
- **Rules:** Start = first ‘subscribed’ event; end = ended_at / canceled_at.
- **Window:** Selected range
- **Refresh:** Live
- **Limits:** Plan changes inside a subscription are not tracked; subscriptions without a recorded start are treated as older than the window.

## Signed proposal

A homeowner accepted a proposal through a Built2Bid signing link.

- **Source:** signatures
- **Rules:** Counted once per estimate.
- **Window:** Signing date
- **Refresh:** Live
- **Limits:** A signature is not a payment. Built2Bid does not see whether the contractor was paid.

## Signed-proposal acceptance rate

Signed ÷ signing requests that are resolved (signed, revoked or expired).

- **Source:** signing_requests
- **Rules:** Requests created in the window; still-pending ones are excluded from the denominator and shown separately.
- **Window:** Selected range
- **Refresh:** Live

## Visitor-to-signup conversion

Signups ÷ GA4 sessions in the window.

- **Source:** GA4 Data API (when connected) + auth.users
- **Rules:** Shown only when GA4 reporting is connected; otherwise “Not connected”.
- **Window:** Selected range
- **Refresh:** GA4 data can lag 24–48 hours
- **Limits:** GA4 counts sessions (and only with analytics consent), not people.

## Signup-to-activation conversion

Of accounts that signed up in the window, the share that has finalized a bid by now.

- **Source:** auth.users, estimate_versions
- **Rules:** Account-based cohort, not events.
- **Window:** Signup cohort
- **Refresh:** Live
- **Limits:** Recent cohorts have had less time to activate.

## Signup-to-paid conversion

Of accounts that signed up in the window, the share that has ever paid by now.

- **Source:** auth.users, subscriptions
- **Rules:** Account-based cohort. Complimentary does not count. The all-time version (every genuine account) is the Overview KPI.
- **Window:** Signup cohort
- **Refresh:** Live

## Acquisition channel

Where an account first came from, by its first visit's campaign tags, ad click id or referring site.

- **Source:** leads (first touch), captured by a first-party cookie
- **Rules:** Deterministic rules listed on the Marketing page. No data → Unknown.
- **Window:** First touch
- **Refresh:** At signup
- **Limits:** Referrer, click id and device are recorded only after migration 20261115002000. Earlier accounts are Unknown unless they carried UTM tags.

## CAC

Acquisition spend ÷ new paying customers in the same window. Blended = all spend (advertising + marketing and prospecting tools); channel and campaign CAC use first-touch attribution.

- **Source:** marketing_costs (Marketing page) + Tech Stack & Costs (marketing/prospecting, allocated)
- **Rules:** Monthly spend is prorated to the days inside the window. No number is shown when there are no new paying customers. Cost per activation uses activated businesses instead.
- **Window:** Selected range
- **Refresh:** When spend is entered
- **Limits:** First-touch model; no ad-platform API is connected. Sales labor is not measured.

## Churn (paid)

Customer churn: paid subscriptions that ended in the window ÷ paying subscriptions at the start of the window. Revenue churn: MRR lost ÷ MRR at the start.

- **Source:** subscriptions
- **Rules:** Scheduled cancellations (cancel at period end) are listed separately and are not churn until they end. Free-account inactivity and expired complimentary access are never churn.
- **Window:** Selected range
- **Refresh:** Live
- **Limits:** Very small paying base: read as counts, not rates.

## Repeat active customer

An account with two or more bids and a bid action in the last 30 days.

- **Source:** estimates, estimate_versions, signing_requests
- **Rules:** Not logging in is never churn.
- **Window:** Last 30 days
- **Refresh:** Live

## Time to first bid

Median hours from account creation to the first bid started (and, separately, to the first finalized bid).

- **Source:** auth.users, estimates, estimate_versions
- **Rules:** Accounts that signed up in the window. “Within 24 h / 30 days” rates only count accounts old enough to have had that long.
- **Window:** Signup cohort
- **Refresh:** Live

## Revenue

Net cash received: paid Stripe invoices minus refunds in the window.

- **Source:** Stripe API (read-only)
- **Rules:** Genuine customers only for invoices; refunds cover the whole Stripe account. Complimentary access is never revenue. Shown as unavailable (not zero) when Stripe cannot be reached.
- **Window:** Selected range
- **Refresh:** Live on page load
- **Limits:** Cash basis, not recognized (accrual) revenue.

## ARR run rate

Current list-price MRR × 12.

- **Source:** subscriptions
- **Rules:** Annual plans contribute $199 ÷ 12 per month, so they are not double counted.
- **Window:** Right now
- **Refresh:** Live
- **Limits:** A run rate, not a forecast or booked revenue.

## Operating profit (provisional)

Revenue minus owner-entered and measured operating costs in the window.

- **Source:** Stripe, Tech Stack & Costs (allocated), Marketing spend, AI usage log
- **Rules:** Recurring costs are spread over the window (annual ÷ 12); usage charges use their dates; shared tools use the Built2Bid allocation %. Missing costs are listed, never treated as zero.
- **Window:** Selected range
- **Refresh:** Live
- **Limits:** Not accounting profit. Excludes taxes, owner pay and anything not entered.

## Enterprise value (illustrative)

ARR run rate × owner-chosen conservative / base / optimistic revenue multiples; a profit multiple only with 12 months of revenue and complete costs.

- **Source:** subscriptions + owner assumptions
- **Rules:** Rounded to avoid false precision.
- **Window:** Right now
- **Refresh:** Live
- **Limits:** Not an appraisal. Enterprise value is not equity value (debt and cash change that).

## Infrastructure cost per active business

Infrastructure and AI costs in the window ÷ monthly active businesses.

- **Source:** Tech Stack & Costs, AI usage log, product activity
- **Rules:** Infrastructure = hosting, database, domain, email, monitoring, AI.
- **Window:** Selected range / last 30 days
- **Refresh:** Live
- **Limits:** Only as complete as the costs entered.

## Infrastructure cost per finalized bid

Infrastructure and AI costs in the window ÷ bids finalized in the window.

- **Source:** Tech Stack & Costs, AI usage log, estimate_versions
- **Rules:** –
- **Window:** Selected range
- **Refresh:** Live
- **Limits:** Only as complete as the costs entered.

## Conventions

- Percentages show their numerator and denominator. Denominators under 20 are flagged *small sample*; period-over-period % change is shown only when the previous value is at least 5.
- Ranges: 7 days and 30 days are bucketed by day, 90 days by week, 12 months by month. Windows end now.
- “Not connected” means the source is not configured on this deploy. Nothing is estimated or simulated in its place.
- Every cost carries a source label: Verified actual, Provider API, Imported invoice, Manual entry, Estimated or Unknown. Unknown is never summed as zero.
- Provider-powered sections show Live / Stale / Unavailable with the time they were read.
