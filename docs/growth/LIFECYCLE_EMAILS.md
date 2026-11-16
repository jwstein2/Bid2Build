# Lifecycle emails A–E

Code: `src/lib/email/lifecycle.ts` (rules + copy, pure), `src/lib/email/lifecycle-run.ts` (daily job),
`src/lib/email/unsubscribe.ts`. Migration `20261117003000_lifecycle_emails.sql` (rollback
`rollback_20261117003000.sql`). Tests: `tests/lifecycle-emails.test.ts`, `tests/db/lifecycle-emails.test.ts`.

## Who gets what

| Email | Subject | Sent when | Audience |
|---|---|---|---|
| A | Ready to create your first professional bid? | 24h–7 days after signup, no bid yet | All new accounts |
| B | Your [trade] estimate is ready when you are | Started a bid, untouched 48h+, fewer than 3 priced items, within 14 days of signup | All new accounts |
| C | Your bid is priced. Here's how to send it. | A bid reached 3+ priced items 24h+ ago, never downloaded or sent, within 14 days | All new accounts |
| D | You've sent your first bid. Here's what Unlimited adds. | Downloaded or sent a bid 3–30 days ago, on the Free plan | **Marketing opt-in only** |
| E | Three Built2Bid features worth setting up | Paying subscriber for 7–30 days | Paying accounts |

Owner decision (Nov 16, 2026): product-help emails (A, B, C, E) go to all new accounts with a one-click
unsubscribe; the upgrade email (D) only to accounts that opted in to marketing.

Always suppressed:
- unsubscribed (`profiles.lifecycle_unsubscribed_at`), or an address suppressed/unsubscribed in `leads` (bounce, complaint, manual, deleted account)
- internal, test and demo accounts (same classification as the admin reports) in live mode
- a step already recorded for that account (each step goes out at most once, ever)
- less than 48h since the last lifecycle email
- paying accounts never get A–D; complimentary access is not paying (no E) and never gets D

Emails never include customer names, prices or addresses. B and C link to the bid inside the signed-in app.
The trade comes from the estimate's template or the first landing page (`/bids/<trade>`, `/start/<trade>`).

## Sending modes

| `LIFECYCLE_EMAIL_MODE` | Effect |
|---|---|
| unset / `off` (default) | Nothing is sent or recorded. |
| `test` | Only accounts whose email is in `LIFECYCLE_TEST_RECIPIENTS` can receive them (any account class). |
| `live` | Genuine accounts, by the rules above. |

Sending also needs `RESEND_API_KEY` (already set) and `LIFECYCLE_POSTAL_ADDRESS` (CAN-SPAM footer). At most
`LIFECYCLE_DAILY_CAP` (default 40, Resend free tier is 100/day) go out per UTC day. The Netlify scheduled
function `lifecycle-cron` runs daily at 15:00 UTC (9 AM Central in winter) and calls `/api/cron/lifecycle`
with `EMAIL_OUTBOX_SECRET`.

Optional: `LIFECYCLE_EMAIL_FROM` (default `james@built2bid.org`, shown as "James at Built2Bid"),
`LIFECYCLE_EMAIL_REPLY_TO`, `LIFECYCLE_UNSUBSCRIBE_SECRET` (32+ chars; otherwise derived from the
Supabase service key).

## Unsubscribe

Every email has an unsubscribe link and `List-Unsubscribe` + `List-Unsubscribe-Post` headers (one-click in
Gmail/Outlook). The link is an HMAC of the account id; `/email/unsubscribe` shows a confirm button and
the POST to `/api/email/unsubscribe` sets `profiles.lifecycle_unsubscribed_at`. A GET never unsubscribes
(link scanners). It changes nothing else: sign-in codes, receipts and `marketing_opt_in` are untouched.

## Owner tools

Admin → Operations → Background email:
- **Preview lifecycle emails due now**: counts per email, sends nothing (works while off).
- **Send me the 5 samples**: example data, to `LIFECYCLE_TEST_RECIPIENTS` only (test or live mode).
- Sent counts per email (30 days) and failures. Admin → Integrations shows the mode.

Static previews: `OUT=<dir> npx vitest run -c scripts/growth/vitest.samples.mts scripts/growth/lifecycle-previews.gen.ts`.

## Turning it on (owner checklist)

1. Run `20261117003000_lifecycle_emails.sql` in the Supabase SQL Editor.
2. In Netlify (Production), add `LIFECYCLE_POSTAL_ADDRESS` (a mailing address or PO box for the footer)
   and `LIFECYCLE_TEST_RECIPIENTS` (your own address), then set `LIFECYCLE_EMAIL_MODE=test` and redeploy.
3. Admin → Operations: **Send me the 5 samples**, check them in Gmail and on your phone. Optionally sign up
   a fresh account with a test address on the list and let the daily job send it the real sequence.
4. When you approve real sending, set `LIFECYCLE_EMAIL_MODE=live` and redeploy. To stop at any time, set it
   back to `off` (or delete it) and redeploy.

Retries: a failed send is recorded as `failed` and is not retried automatically (that step is skipped for
that account), so a provider outage can never cause duplicate emails.
