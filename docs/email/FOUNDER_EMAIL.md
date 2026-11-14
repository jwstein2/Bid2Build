# Founder welcome email

A one-time "thank you" from James to each customer's **first paid subscription**. It is the only
automated email Built2Bid sends to customers. Contractor proposals are never emailed by Built2Bid
(see `SEND_VIA_MY_EMAIL.md`).

**Current state: OFF.** Nothing is sent until every step below is done and the owner approves.

## How it works

1. Stripe sends `invoice.paid`. The webhook updates the subscription first, exactly as before.
2. If the invoice is the subscription's first paid invoice (`billing_reason = subscription_create`,
   `amount_paid > 0`), a job is written to `public.email_outbox` with a unique key per user.
   Duplicate events, renewals (`subscription_cycle`), upgrades and seat changes
   (`subscription_update`), $0 invoices, failed and cancelled checkouts never create a job, and a
   user can only ever have one.
3. After the event is marked processed, the webhook tries to send (only when enabled). The send uses
   Resend's HTTP API with an idempotency key per job, so a retry can't send twice.
4. A failure is recorded on the job (`failed`, error text, attempt count) and never fails the
   webhook, so paid access is never blocked or revoked by email problems.
5. Retries: `POST /api/cron/email-outbox` with `Authorization: Bearer $EMAIL_OUTBOX_SECRET`. Up to 5
   attempts; provider rejections (4xx) aren't retried. Jobs older than 3 days are skipped instead of
   sent late.
6. After a successful send the recipient address is cleared from the job; only the user id, status
   and provider message id remain.

Existing paying customers are marked `skipped` by the migration, so there are no backfill emails.

Copy: `src/lib/email/founder-welcome.ts` (approved text, plain text + simple HTML, no tracking, no
marketing list). Sender: `"James Stein — Founder, Built2Bid" <james@built2bid.org>`, Reply-To
`james@built2bid.org`.

## Delivery cost (first-time paid customers)

| Provider | 100 | 500 | 2,500 | Notes |
|---|---|---|---|---|
| **Resend Free (recommended)** | $0 | $0 | $0 | 3,000 emails/month, max 100/day. Above that, Pro is $20/month for 50,000. |
| Amazon SES | ~$0.01 | ~$0.05 | ~$0.25 | $0.10 per 1,000, but needs an AWS account, sandbox exit and more setup. |
| Postmark | ~$15/mo | ~$15/mo | ~$15/mo | Paid plans start around $15/month for 10,000. |
| Google Workspace mailbox | $0 | $0 | $0 | Not built for automated sending: needs a stored app password or SMTP relay, has per-user daily limits and no idempotency. Not recommended. |

Prices checked November 2026 from public pricing pages and reviews; confirm on resend.com/pricing
before upgrading. These volumes are emails, not subscriber totals. If Supabase sign-in emails also
move to Resend later, they share the same free allowance.

## Setup checklist (owner)

1. Confirm the `james@built2bid.org` alias receives mail in Google Workspace (send it a test from
   another address).
2. Create a Resend account and add the domain `built2bid.org`
   (https://resend.com/domains). Add the DNS records Resend shows (DKIM `resend._domainkey`, and the
   `send` subdomain MX/TXT for bounces) in Netlify DNS. These don't change the root MX, so replies
   still go to Google Workspace.
3. Make sure the root SPF/DMARC records exist (see the sign-in email plan); DKIM from Resend aligns
   with `built2bid.org`, so DMARC passes.
4. Create a **sending-only** API key in Resend.
5. Run `supabase/migrations/20261114009000_founder_welcome_email.sql` in the Supabase SQL editor.
6. In Netlify → Site configuration → Environment variables (Production only):
   - `RESEND_API_KEY` = the key (mark as secret; never paste it in chat)
   - `EMAIL_OUTBOX_SECRET` = a long random string (for retries)
   - `FOUNDER_EMAIL_ENABLED` = `true` ← this is the on switch; leave unset until approved
7. Redeploy. Optional: schedule a call to `/api/cron/email-outbox` every 15 minutes for retries.

To turn it off at any time: remove `FOUNDER_EMAIL_ENABLED` (or set it to anything but `true`) and
redeploy. Jobs keep queueing and expire after 3 days, so turning it back on never sends a flood of
old emails.
