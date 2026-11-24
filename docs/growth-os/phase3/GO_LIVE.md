# Phase 3 go-live: what James needs to do

Status (2026-11-24): built, tested locally, passed on the staging database (13/13). **Nothing is live in production.**
Everything below waits for James's explicit "go live". No secret values belong in this file or in chat.

## Sign-ins and settings James does (in this order)

| # | Where | What | Secret? | Undo |
|---|---|---|---|---|
| 1 | GitHub, PR #265 | Review, then merge. Merging publishes the Privacy and Cookie Policy text (dated November 24, 2026), so do it the same day as steps 2 and 3. | No | Revert the PR |
| 2 | Supabase, production project, SQL editor | Run `supabase/migrations/20270228001000_marketing_measurement.sql`. It's safe to run twice. | No | `docs/growth-os/phase3/rollback_20270228001000.sql` |
| 3 | Netlify, site built2bid, environment variables (Production) | Add `MARKETING_TOUCHES` = `on`, then redeploy | No (it's a switch, not a key) | Delete the variable and redeploy |
| 4 | Stripe, live webhook endpoint (optional) | Add the events `invoice.voided` and `invoice.marked_uncollectible`. The code already handles them. | No | Remove the events |
| 5 | Attorney (recommended) | Review the new "Visit measurement" text on /privacy and the two new rows on /cookies | No | — |

Claude can do steps 2–4 in the Claude browser while James is signed in, once he says go live.

## Variables

| Variable | Where | Value | Needed for |
|---|---|---|---|
| `MARKETING_TOUCHES` | Netlify (production) | `on` | Visit tracking. Off by default. |

No new API keys, secrets or paid services. Everything else reuses existing settings (Supabase service key, Stripe webhook secret).

## Automated jobs

None are scheduled. Once live, these run on their own as part of normal traffic:
- Each visit from a tagged link updates two first-party cookies (unless the visitor sends GPC or turned analytics off).
- At sign-in, those visits are linked to the account (after the page loads).
- The Stripe webhook records scheduled cancellations, as well as the renewals and cancellations it already records.
- The dashboard (Admin → Marketing → Customer journey) calculates attribution, revenue, retention, CAC and 11 data quality checks when it's opened.

No emails, ads, posts or messages are sent, and no AI calls are made.

## Checked 2026-11-24

- **Google Analytics 4 is firing on built2bid.org.** The gtag script for property G-2KJ9K3FX07 loads, `_ga` cookies are set, and a `g/collect` hit is sent. The Meta pixel didn't load, which is correct because nobody chose Allow in the ad banner.
- Production's `analytics_events` event list matches what the migration expects, so the migration will apply cleanly.

## After go-live (Claude does this, read only)

Visit the site with a tagged test link, sign in with a test account, and confirm one touch row and one identity link were created, then delete those test rows. Check the dashboard's data quality panel.
