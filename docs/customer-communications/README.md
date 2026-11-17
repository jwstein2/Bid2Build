# Customer Communications (V4.6)

Six-month customer follow-ups ("nurture") and project progress emails, part of the Project Command Center (PM add-on).
**Everything is off by default, and nothing sends until the owner turns it on with the steps below.**

## What ships in this PR

| Area | Where |
| --- | --- |
| Customers → Communications (KPI cards, review queue, scheduled, sent, replies, contacts, automation settings) | `/dashboard/customers/communications` |
| Customer detail with communications summary | `/dashboard/customers/[id]` |
| Per-project "Customer updates" panel (frequency, review first / automatic, preview) | Project page |
| PM reminders (day before, in the contractor's time zone) and customer reply notices | Notification bell |
| Owner emergency stop, reply-monitoring test, sending status | Admin → Operations → Customer communications |
| SQL | `supabase/migrations/20261121001000_customer_communications.sql` (rollback in this folder) |

## How sending works

* **Provider:** the existing Resend account. Nothing new is bought. Customer email can use its own Resend key (`COMM_RESEND_API_KEY`), so contractor campaigns stay separate from sign-in codes and account email. If that key isn't set, it falls back to `RESEND_API_KEY`.
* **From:** `"<Contractor name>" <updates@built2bid.org>`. The footer says "Sent for <Company> using Built2Bid", followed by the contractor's postal address and an unsubscribe link. Contractors can't use their own sending domains yet; that's future work.
* **Unsubscribe:** every nurture email and project update carries the `List-Unsubscribe` and `List-Unsubscribe-Post` headers for one-click unsubscribe, plus a signed link to `/email/preferences`. Suppressions are permanent. Nothing in the app deletes them, and a database trigger blocks deletes.
* **Idempotency:** each message has a unique key and is sent with the Resend `idempotency-key: comm/<id>`. A message is claimed with a conditional update before sending, so a retry or two overlapping cron runs can't send it twice.
* **Statuses:** a message is marked `sent` when Resend accepts it. It is only marked `delivered` when Resend's signed `email.delivered` webhook arrives.
* **Caps:** at most 300 emails per day across Built2Bid (`COMM_DAILY_CAP`) and 60 per account (`COMM_ACCOUNT_DAILY_CAP`).
* **Accuracy:** project updates come from the same customer report as manual publishes. A section is called complete only when a manager confirmed it. Otherwise the email says "X was scheduled through D. Our latest recorded progress is P%." No costs, margins or internal notes ever appear. Each sent update is saved as a frozen publication with a 60-day secure link.
* **Nurture content:** built only from saved facts (name, project type, bid date). Templates that promise an old price is still valid, contain links, or use unknown placeholders are rejected. Offers are optional, dated, and only used when the contractor marks them active. A material comparison needs explicit approval.

## Reply detection (needs one DNS record, with James's approval)

Replies only count as "monitored" after all three of these are true:

1. `COMM_REPLY_DOMAIN` is set (suggested: `reply.built2bid.org`), and that subdomain's MX record points to Resend inbound. **This adds an MX record on the subdomain only. It does not touch the root domain's Google Workspace MX.**
2. The Resend webhook is signed (`RESEND_WEBHOOK_SECRET`).
3. The owner's test message has actually arrived. Use Admin → Operations → Customer communications → "Send test".

Each message's Reply-To is `reply+<token>@reply.built2bid.org`. A matched human reply does four things:

* pauses that contact
* cancels their queued follow-ups
* records the reply
* notifies the PM, or the person who approved the message

"STOP" or "unsubscribe" adds a suppression. An unclear opt-out ("maybe take me off for a while") is suppressed to be safe and flagged for review. Out-of-office replies are logged and change nothing. Bounces suppress the address for every account.

**Until reply monitoring is active:** nurture stays in review-first mode, because "Automatic" is disabled in the UI and refused by the API. Replies go to the contractor's own inbox, and they use "Mark replied". The UI never says "Reply Monitoring Active" unless all three checks pass.

## Environment variables

| Variable | Value | Notes |
| --- | --- | --- |
| `COMM_EMAIL_MODE` | `off` (default), `test`, or `live` | `test` sends only to `COMM_TEST_RECIPIENTS` |
| `COMM_TEST_RECIPIENTS` | e.g. `james@built2bid.org` | comma separated |
| `COMM_RESEND_API_KEY` | optional | separate key for customer email |
| `COMM_EMAIL_FROM` | `updates@built2bid.org` | must be on the verified Resend domain |
| `COMM_REPLY_DOMAIN` | `reply.built2bid.org` | only after the MX record exists |
| `RESEND_WEBHOOK_SECRET` | from Resend → Webhooks | James pastes this in Netlify, never in chat |
| `COMM_UNSUBSCRIBE_SECRET` | optional random string | if unset, it's derived from the service key |
| `COMM_INBOUND_SECRET` | optional | only for a non-Resend forwarder posting to `/api/webhooks/comms-inbound` |
| `EMAIL_OUTBOX_SECRET` | already set | the cron uses it |

Webhook URL for Resend: `https://built2bid.org/api/webhooks/resend`. Events: `email.delivered`, `email.bounced`, `email.complained`, `email.received`.

The cron is the Netlify scheduled function `comms-cron`, which runs every 15 minutes. It returns immediately unless `COMM_EMAIL_MODE` is `test` or `live`.

## Production activation checklist (each step needs James's OK)

1. Run the SQL `20261121001000_customer_communications.sql` in the Supabase SQL Editor. After this, nothing sends, because `COMM_EMAIL_MODE` is unset.
2. Merge and deploy. Customers → Communications appears for PM add-on accounts, with everything off.
3. Test mode:
   * Set `COMM_EMAIL_MODE=test` and `COMM_TEST_RECIPIENTS=<your address>` in Netlify (Production).
   * Create a test project whose customer email is your own address.
   * Approve an update and confirm it arrives with an unsubscribe link and the postal address.
   * Click unsubscribe and confirm the next one is blocked.
4. Reply monitoring (optional, but needed for automatic nurture):
   * Add the MX record for `reply.built2bid.org` as shown in Resend → Domains → Inbound. This needs your approval.
   * Create the webhook and paste `RESEND_WEBHOOK_SECRET` in Netlify.
   * Set `COMM_REPLY_DOMAIN`, then Admin → Operations → "Send test" and wait for "Active".
   * Reply "STOP" to a test email and check that a suppression appears.
5. Go live: set `COMM_EMAIL_MODE=live`. Contractors still have to turn on follow-ups themselves, review the audience, and confirm each person.
6. Emergency stop: Admin → Operations → "Pause all customer email" stops planning and sending right away for everyone.

## Compliance notes (not legal advice)

* **CAN-SPAM (US):** every nurture email includes:
  * the sender's identity
  * a valid postal address (follow-ups won't send without one)
  * a working unsubscribe that is honored right away (the law allows 10 business days)
  * no misleading subject lines (templates are reviewed)
* **CASL (Canada):** applies if contractors email Canadian customers. Implied consent from an inquiry lasts 6 months, and from a purchase 2 years. The audience rules don't enforce those windows yet: for example, lost bids and past customers older than that can still be selected. Old drafts are excluded unless the contractor confirms a relationship. Get attorney review and add a CASL age limit before marketing to Canada.
* Project updates are transactional (about an active job). They still carry an unsubscribe and honor it.
