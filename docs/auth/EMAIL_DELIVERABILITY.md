# Email deliverability and sign-in reliability audit

**Date:** 2026-11-17. **Scope:** sign-in codes, account and transactional email, project updates, marketing.
**Nothing in production was changed.** DNS, Supabase Auth, SMTP credentials and Netlify settings are untouched.
Every change below the "Owner actions" heading needs James's go-ahead.

How things were checked: public DNS through Google Public DNS (2026-11-17 05:40 UTC), Netlify environment
variables (names and non-secret values only), Supabase auth logs and read-only SQL, and the code on `main`.
The Supabase dashboard (SMTP, templates, rate limits) and the Resend dashboard could not be read from here, so
those rows say "not verified" and list where to look.

No setup can guarantee inbox placement, and nothing here promises the Gmail Primary tab. Provider "delivered"
means the receiving server accepted the message, not that a person saw it in the inbox.

---

## 1. Current email architecture

| Mail | Sent by | From | Status |
|---|---|---|---|
| Sign-in code, new account (Supabase "Confirm sign up" template) | Supabase Auth → custom SMTP `smtp.resend.com` → Resend (Amazon SES underneath) | `Built2Bid Security <login@built2bid.org>` | Live. Confirmed on a real code delivered to Gmail 2026-11-17 05:45 UTC (section 2a). |
| Sign-in code, returning user ("Magic link or OTP" template) | Same | Same | Same |
| Subscription receipts | Stripe (Stripe's own receipt emails, if turned on in Stripe) | Stripe's sending domain | Not verified: Stripe → Settings → Customer emails. Not part of built2bid.org reputation. |
| Founder welcome after first payment | App → Resend HTTP API | `james@built2bid.org` | Live (`FOUNDER_EMAIL_ENABLED=true`). 1 row so far (skipped). |
| Project updates to a contractor's customers | App → Resend HTTP API | `updates@built2bid.org` | Test mode (`COMM_EMAIL_MODE=test`, only james@built2bid.org). 0 messages. |
| Lifecycle emails A–E (D is promotional) | App → Resend HTTP API | `james@built2bid.org` | Off (`LIFECYCLE_EMAIL_MODE` not set). |
| Facebook trial emails | App → Resend HTTP API | `hello@built2bid.org` | Off. |
| Creator outreach (1:1 emails to creators) | App → Resend HTTP API | `james@built2bid.org` | **Armed:** `CREATOR_OUTREACH_SEND_ENABLED=true`, sending enabled, 10/day, 8 AM–5 PM Central, 19 approved and queued. First sends expected from 8 AM Central today. |
| People's own mail (support@, james@ …) | Google Workspace | built2bid.org mailboxes | MX `smtp.google.com`. |

All app mail and the sign-in codes share **one domain (built2bid.org), one Resend account and one Resend
daily quota.** That is the main reputation risk (section 4).

Code paths: `src/components/auth/auth-dialog.tsx` (code request, entry, resend), `supabase/templates/*`,
`src/lib/email/*` (founder, lifecycle, consent, streams), `src/lib/comms/*` (project updates),
`src/lib/creator/outreach/*`, `src/app/api/webhooks/resend/route.ts` (provider events).

## 2. Confirmed authentication settings (public DNS, 2026-11-17)

| Record | Value found | Verdict |
|---|---|---|
| MX `built2bid.org` | `1 smtp.google.com` | OK (Google Workspace). |
| SPF `built2bid.org` | `v=spf1 include:_spf.google.com ~all` | OK. Exactly one SPF record. Resend doesn't need to be in it: Resend's return path uses its own subdomains, and DMARC accepts an SPF pass on a subdomain (relaxed alignment). |
| DKIM `google._domainkey` | 2048-bit RSA key | OK (Google Workspace). |
| DKIM `resend._domainkey` | 1024-bit RSA key | OK (Resend signs as `d=built2bid.org`, so DKIM aligns). |
| `send.built2bid.org` | CNAME → `send.forge.rmta.net` (MX `feedback.forge.rmta.net`, SPF with 3 IP ranges) | Bounce / return-path subdomain on Resend-managed infrastructure. |
| `rsend.built2bid.org` | CNAME → `rsend.forge.rmta.net` (MX `feedback-smtp.us-east-1.amazonses.com`, SPF `include:amazonses.com`) | Bounce / return-path subdomain seen in the 11-15 Gmail headers. |
| DMARC `_dmarc.built2bid.org` | `v=DMARC1; p=none; rua=mailto:james@built2bid.org` | Valid, meets Google/Yahoo/Microsoft minimum. Weak: monitoring only, reports go to a personal inbox. |
| `auth.built2bid.org` | Doesn't exist | `login@auth.built2bid.org` can't be used until it's set up (section 5). |
| MTA-STS / TLS-RPT / BIMI | None | Optional; not needed now. |

### 2a. A real delivered sign-in code (Gmail, 2026-11-17 05:45 UTC; code redacted)

Read from the raw message ("Show original") of the newest code in James's Gmail:

| Header | Value |
|---|---|
| From | `Built2Bid Security <login@built2bid.org>` |
| SPF | pass, `smtp.mailfrom=…@rsend.built2bid.org`, sending IP 54.240.48.52 (Amazon SES, us-east-1) |
| DKIM | pass `d=built2bid.org` (selector `resend`), plus pass `d=amazonses.com` |
| DMARC | pass (`p=NONE`), `header.from=built2bid.org` |
| TLS | `version=TLS1_3` from Amazon SES to Gmail |
| Structure | `multipart/alternative`: a `text/plain` part and a `text/html` part. Supabase only has an HTML template; Resend builds the plain-text part from it. |
| Template live in Supabase | The PR #33 template (navy "Built2Bid" header, "Hi, Use this code to securely sign in…"). |

The plain-text part already had real blank lines around the code, and Gmail's web inbox snippet reads
"Built2Bid Your Built2Bid verification code Hi, Use this code to securely sign in to Built2Bid: [code] …",
with spaces. So the run-together "Built2Bid308182" was not in the message text itself. The likely cause is how
the Android Gmail notification builds its preview: the old email's very first text was the bare wordmark
"Built2Bid", and Android Gmail now pulls verification codes out of emails and shows them next to that first
text. That explanation is not confirmed (I couldn't see the Android notification). The new template (section 6)
removes the trigger either way: the first text is now a full preview sentence, and the code sits in its own
block under a label. **Whether the Android notification now looks right can only be confirmed on a real
delivered message after the new template is pasted into Supabase** (owner step 3, then step 8).

**Bounce handling:** Resend handles bounces on the `send` / `rsend` subdomains and keeps its own suppression
list for hard bounces and complaints. Built2Bid didn't see those events because no Resend webhook is set up
(`RESEND_WEBHOOK_SECRET` isn't in Netlify). This PR records them once it is.

**Mailbox provider rules** (Gmail/Yahoo since 2024, Outlook.com since 2025; the strict list applies at 5,000+
emails a day to that provider, which Built2Bid is far below):

| Requirement | Built2Bid |
|---|---|
| SPF and DKIM, with DMARC (p=none or stronger) aligned to the From domain | Met for Resend mail and Google Workspace mail. |
| Valid forward/reverse DNS and TLS on sending IPs | Resend's responsibility (shared IPs). |
| One-click unsubscribe (RFC 8058) and honoring it within 2 days, for marketing | Met: lifecycle, trial, project-update nurture and creator outreach all send `List-Unsubscribe` + `List-Unsubscribe-Post`. Unsubscribe is immediate. |
| Spam complaint rate under 0.3% (aim under 0.1%) | Not measured yet. Needs the Resend webhook (and Postmaster Tools once volume allows). |
| No unsubscribe link in sign-in codes | Correct: they're not marketing. |

**Sending limits:** Resend Free is 100 emails a day and 3,000 a month **for the whole account** (sign-in codes,
founder email and outreach together). Supabase also caps auth emails per hour (Auth → Rate Limits; not readable
from here). If Resend's daily cap is hit, sign-in codes fail along with everything else.

## 3. DNS deficiencies and proposed corrections

Nothing is broken. Each item is optional and additive; none of them touches the Google Workspace MX, SPF or DKIM
or the existing Resend records. Make DNS changes in Netlify DNS:
https://app.netlify.com/teams/james-stein/dns/built2bid.org

**D1. DMARC reports to a dedicated alias (now).** Edit the existing TXT record `_dmarc` (don't add a second one):

```
v=DMARC1; p=none; rua=mailto:dmarc@built2bid.org; adkim=r; aspf=r
```

Same policy; only the report address changes. `dmarc@` is already an alias in Google Workspace.

**D2. Tighten DMARC later (after 2–4 weeks of clean reports).** Before this, confirm in the reports that every
real sender passes (Google Workspace, Resend; check for anything else such as a newsletter tool). Then:

```
week 0:  v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@built2bid.org
week 2:  v=DMARC1; p=quarantine; rua=mailto:dmarc@built2bid.org
later:   v=DMARC1; p=reject; rua=mailto:dmarc@built2bid.org
```

Rollback: put back `p=none`. DNS TTL is 1 hour.

**D3. Separate sign-in subdomain `auth.built2bid.org` (recommended, section 5).** Records come from Resend after
adding the domain; copy the exact values from Resend's page. They will be three records like these:

| Type | Netlify host | Value | Purpose |
|---|---|---|---|
| TXT | `resend._domainkey.auth` | `p=MIGfMA0…` (unique, from Resend) | DKIM for auth.built2bid.org |
| MX | `send.auth` | `feedback-smtp.us-east-1.amazonses.com`, priority 10 (or the value Resend shows) | Bounces |
| TXT | `send.auth` | `v=spf1 include:amazonses.com ~all` (or the value Resend shows) | SPF for the bounce address |

If Resend offers CNAME records instead (like the existing `send` / `rsend`), use those. The root `_dmarc`
policy covers the subdomain automatically.

## 4. Production email provider assessment

**Resend via Supabase custom SMTP is an appropriate production setup** and it is already live: authenticated
as built2bid.org, aligned DMARC, reputable shared IPs. Supabase's built-in sender is not in use (it would send
from a Supabase address, only to team members, a few per hour).

Delivery risks, most serious first:

1. **Shared reputation and quota (high).** Sign-in codes share the built2bid.org domain, the Resend account and
   the 100/day quota with creator outreach (armed), founder email, and later lifecycle and project updates.
   Complaints about outreach or marketing would lower the reputation that sign-in codes rely on, and a busy day
   could use up the quota codes need. At today's volume (≈5 codes a day, 10 outreach emails a day) the risk is
   small, but it grows with every marketing stream that turns on.
2. **No delivery visibility (medium).** No Resend webhook, so bounces, complaints, delays and failures are
   invisible to Built2Bid. Fixed in code by this PR; needs owner step 5.
3. **DMARC monitoring unread (medium).** p=none with reports in a personal inbox; no Postmaster Tools.
4. **Unverified dashboard settings (low–medium).** Whether the PR #33 template was pasted into Supabase, the
   sender display name, the auth email rate limit and the code expiry time. Outlook was never tested.
5. **HTML-only template (low).** Supabase has one HTML body field per template; there is no separate plain-text
   template. The HTML is kept tiny and text-like, and `verification-code.txt` holds the matching text copy.

## 5. Recommended sender-domain configuration

| Stream | Identity | Notes |
|---|---|---|
| Sign-in codes | `Built2Bid <login@auth.built2bid.org>` | Own Resend domain and its own sending-only API key, used only by Supabase SMTP. Until D3 is done, keep `login@built2bid.org`. Display name "Built2Bid" (plainer than "Built2Bid Security", which can read like phishing). |
| Transactional / account | `james@built2bid.org`, `updates@built2bid.org` | As today. |
| Marketing (lifecycle D, newsletters) | e.g. `news.built2bid.org` | Before lifecycle goes live. Same Resend steps as D3. |
| Creator / cold outreach | A separate subdomain or separate domain | Before outreach grows past the current small batch. Industry practice is a separate domain for cold email so it can never touch sign-in reputation. |

Subdomains get their own DKIM identity and their own reputation history at Gmail and Microsoft, but mailbox
providers also look at the parent domain, so separation reduces risk rather than removing it. The quota is
separated only by a separate Resend account or by upgrading Resend (Pro, $20/month: 50,000/month, no daily cap).

## 6. Updated OTP templates (this PR)

`supabase/templates/confirm-signup.html` (new email) and `supabase/templates/magic-link.html` (existing account).
Subject for both: **Your Built2Bid verification code**.

- Hidden first line (inbox and notification preview): **"Use your 6-digit code to sign in securely to
  Built2Bid."** The code itself is kept out of the preview line.
- Then the label **"Your Built2Bid verification code:"**, then the code alone in its own block: large monospace,
  spaced, on a light panel, easy to long-press and copy (letter spacing doesn't add real spaces).
- "Enter this code to securely sign in to your account. It works once, and only the newest code works."
- "If you didn't request this code, you can ignore this email."
- "Requested for {email}. Built2Bid will never ask you to share this code." Helps people spot phishing.
- Every piece of text is its own block element, so the plain-text part Resend generates keeps a blank line
  before and after the code (checked by converting the HTML the same way: output matches the real old message
  line for line).
- No images, links, tracking pixel, web fonts or marketing. About 2.4 KB.
- Plain-text reference copy: `supabase/templates/verification-code.txt`. Previews:
  `/mnt/project-files/email-deliverability/otp-email-phone-390.png` and `otp-email-desktop.png` (sample code 123456).

Codes are never logged by the app: the browser sends them straight to Supabase, analytics events carry only
the method and attempt number, and tests use fixed mock codes.

## 7. Marketing-consent verification

| Check | Result |
|---|---|
| Checkbox unchecked by default | Yes (`useState(false)`); browser test confirms. |
| Account creation and codes don't depend on it | Yes; code is sent with or without it (browser test). |
| Production today | 0 of 11 accounts opted in. Nobody is added to a list automatically. |
| What is stored on opt-in | Before: `marketing_opt_in` + time. **Now:** also source (`signup_dialog`, `email_link`, `account_settings`), notice version (`2026-11-17`), and an append-only `marketing_consent_events` row with the exact notice text. The time is set on the server. |
| Withdrawal | Account settings toggle, one-click lifecycle unsubscribe (now also withdraws marketing consent), and Instantly opt-outs. Stamped `marketing_opt_out_at` with an event row. |
| Promotional mail gated on consent | Lifecycle D requires opt-in; all marketing carries one-click unsubscribe. Sign-in codes, receipts and account notices never check consent. |
| Not a deliverability signal | Consent isn't used anywhere in sending decisions for essential mail. |

## 8. End-to-end sign-in test results

Run on this branch against the local mock Supabase (no real email sent):

- `scripts/email-auth/run.mjs`: **13/13**: email-only login, numeric box with `autocomplete="one-time-code"`,
  exactly 6 digits, paste with spaces and leading zero, 8/9-digit paste refused, wrong code message, resend
  back-off (60 s then 2 min), no "we sent" wording, consent box off by default and recorded with source when
  ticked, open-redirect refused, mobile 390 px fits.
- `scripts/checkout-e2e/run.mjs`: **20/20**: checkout resumes the chosen plan after the code, from pricing and
  from the login page, desktop and phones.
- Unit tests 1,112 pass; database tests 338 pass (incl. 4 new for this migration); typecheck clean.

**Real mailboxes.** One real delivered code was inspected (Gmail, current production template, section 2a):
authentication passes and it is in the inbox conversation list. The new template can't be tested on real mail
until it's pasted into Supabase, and Outlook, Yahoo and Android notifications weren't available here, so no
placement or notification result is claimed for them. Owner test matrix (fill in):

| Mailbox | New-user code | Returning code | Resend | Expired code msg | SPF/DKIM/DMARC | Folder seen | Phone notification preview |
|---|---|---|---|---|---|---|---|
| Gmail (personal), old template, 2026-11-17 | | ✓ delivered | | | pass / pass / pass | Inbox | "Built2Bid308182" (reported by James) |
| Gmail (personal), new template | | | | | | | |
| Google Workspace (built2bid.org) | | | | | | | |
| Outlook.com / Hotmail | | | | | | | |
| Yahoo | | | | | | | |
| Other business (e.g. Microsoft 365) | | | | | | | |

How to read headers: Gmail ⋮ → Show original (top shows SPF/DKIM/DMARC). Outlook.com: open message → ⋯ → View
→ View message source, look for `Authentication-Results: spf=pass … dkim=pass … dmarc=pass`. Yahoo: ⋯ → View raw
message.

## 9. Deliverability measurements available now

From Supabase auth logs (last 48 hours, 2026-11-15 05:40 → 11-17 05:40 UTC):

| Measure | Value |
|---|---|
| Code requests accepted (`/otp` 200) | 7 |
| Time for Supabase + Resend to accept a send | 333–500 ms average |
| Successful code verifications | 6 |
| Rejected codes (`otp_expired`, Supabase uses this for wrong and expired codes) | 3 |
| Failed send requests | 0 |

Roughly 6 of 7 code requests ended in a sign-in, probably including James's own tests. These are acceptance
numbers, not inbox numbers.

What this PR adds (after owner steps 2 and 5):
- `email_delivery_events` + `email_delivery_daily`: sent, delivered, delayed, bounced, complained, failed per
  day and stream (`auth`, `transactional`, `project`, `trial`, `other`), recipient **domain** only, median
  delivery seconds. No addresses, subjects or bodies.
- GA4 funnel events: `otp_requested`, `otp_resent`, `otp_verify_failed`, `otp_verified` (no email, no code).

Useful queries (Supabase SQL Editor):

```sql
-- Delivery by day and stream (last 14 days)
select * from public.email_delivery_daily where day > current_date - 14 order by day desc, stream;

-- Bounces and complaints for sign-in codes by mailbox provider (last 30 days)
select recipient_domain, kind, count(*) from public.email_delivery_events
where stream = 'auth' and kind in ('bounced', 'complained', 'delayed', 'failed') and received_at > now() - interval '30 days'
group by 1, 2 order by 3 desc;
```

## 10. Remaining limitations

- Inbox / Promotions / Spam placement isn't measured anywhere; only mailbox tests or Postmaster Tools (at
  higher volume) can show it.
- Google Postmaster Tools shows data only once a domain sends a meaningful daily volume to Gmail; at a few
  emails a day it will likely stay empty for now. Microsoft SNDS is per IP and doesn't apply to shared Resend IPs.
- Supabase applies its own per-address resend minimum and rate limits; the app's back-off is on top of that.
- Supabase templates have no separate plain-text part.
- Sign-in codes and outreach still share domain, account and quota until section 5 is done.
- Abuse protection: Supabase rate limits plus the UI back-off. CAPTCHA (Turnstile) is supported in code but
  not set up.

## Owner actions (in order; each needs your OK)

1. **Merge the PR.** The site works before the SQL runs (consent falls back to the old columns; the webhook
   skips metrics).
2. **Run the SQL** `supabase/migrations/20261123001000_email_consent_and_delivery.sql` in
   https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/sql/new (rollback:
   `supabase/rollback/20261123001000_email_consent_and_delivery_down.sql`).
3. **Paste the templates** at https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/templates:
   "Confirm sign up" ← `confirm-signup.html`, "Magic link" ← `magic-link.html`, both with the subject above.
   Save the current bodies first. Optional: change the SMTP sender name from "Built2Bid Security" to "Built2Bid"
   (step 4). Then request a code on your Android phone and check the notification.
4. **Check Supabase settings** (read and adjust):
   - https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/smtp: custom SMTP on, sender
     `login@built2bid.org`, sender name `Built2Bid`.
   - https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/providers → Email: OTP length 6;
     Email OTP expiration 900 seconds (15 minutes) suggested.
   - https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/rate-limits: emails per hour about 30–60
     (stays under Resend's 100/day).
5. **Resend webhook** at https://resend.com/webhooks → Add endpoint
   `https://built2bid.org/api/webhooks/resend`, events: sent, delivered, delivery delayed, bounced, complained,
   failed. Copy its signing secret into Netlify → Environment variables → `RESEND_WEBHOOK_SECRET` (secret,
   Production): https://app.netlify.com/projects/built2bid/configuration/env. Never paste it in chat. Redeploy.
6. **DMARC report address** (D1) in Netlify DNS.
7. **Google Postmaster Tools**: https://postmaster.google.com → add `built2bid.org` → verify with the TXT it gives.
8. **Mailbox tests** (section 8 table).
9. **Later:** `auth.built2bid.org` (D3) and moving outreach/marketing off the root domain; upgrade Resend to Pro
   when daily email approaches ~70.
