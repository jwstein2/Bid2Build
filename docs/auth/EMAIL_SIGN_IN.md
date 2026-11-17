# Email-only sign-in with 6-digit codes (SMS paused)

> **2026-11-17:** live state, DNS check, sender plan, templates and monitoring are in
> [EMAIL_DELIVERABILITY.md](EMAIL_DELIVERABILITY.md). Steps A–F below were completed on 2026-11-15.

**Status (2026-11-15):** code ready in this branch. Production Supabase, SMTP and DNS are **not** changed:
each step below needs the owner's go-ahead and is done in the Supabase / Resend / Netlify dashboards.

Supabase project: `asiiqmegvajtuspeumio`. Dashboard links below go straight to the right page.

## How sign-in works now

1. Customer enters their email.
2. Supabase emails a 6-digit code (`signInWithOtp`, `shouldCreateUser: true`).
3. Customer types, pastes or autofills the code in the same window (`inputMode="numeric"`,
   `autoComplete="one-time-code"`, `maxLength={6}`).
4. `verifyOtp({ type: "email" })` checks it in Supabase. Wrong or expired codes are refused by Supabase.
5. New emails get an account; existing emails sign in to the same account.
6. The customer lands where they were going (`next`, checked by `safeNext`; checkout resumes their plan).

No phone number is asked for and nothing is texted.

Code rules (`src/lib/auth/config.ts` `readCode`):
- Kept as a string, so leading zeros survive (`012345`).
- Spaces, dashes and newlines in a pasted code are dropped (`012 345` → `012345`).
- A code with **more** digits than expected is reported ("That code has more than 6 digits…") and never
  trimmed: trimming would silently send a wrong code.
- Submit is enabled only at exactly 6 digits.
- Resend has a 60-second countdown in the UI; Supabase enforces its own per-email limit.

## 1. Root cause of the 8/9-digit codes

The code length is set by Supabase, not by Built2Bid: **Authentication > Sign In / Providers > Email >
Email OTP Length** (`mailer_otp_length`, allowed 6–10). The emails show `{{ .Token }}` at whatever length
that setting is, so a value above 6 produces 8- (or 9-) digit codes. Recently created Supabase projects
have been reported to default to 8. The site never noticed because the code box accepted up to 8 digits
(`maxLength={8}`) and only required "at least 6".

Not verified from here: threads can't read the Supabase auth settings, so the exact current value needs
a look on the page below. Nothing in the app shortens or pads codes.

**Fix:** set Email OTP Length to **6** (step A below). The site now requires exactly 6.

## 2. Twilio / SMS authentication: disabled

| Layer | State in this branch |
|---|---|
| Login page, sign-in dialog, checkout dialog, builder download dialog | Email only. No "Continue with phone", "Text me a code", "Use my phone instead" or phone field. |
| Account settings | No "Add phone" / "Change number". (An existing number would show as "Sign-in by text is paused".) |
| Dialog code paths | `sendPhone`, `verifyPhone`, `resendLink` and the phone-link step return early unless SMS is on, so no stale state can call Supabase phone auth. |
| `/api/auth/phone-abandon` (the only server route that touches phone auth) | 404 unless **both** `NEXT_PUBLIC_SMS_AUTH_ENABLED=true` and server-only `SMS_AUTH_ENABLED=true`. |
| Supabase phone provider (the real security control) | **Owner step D.** Browsers talk to Supabase directly with the public key, so only turning the phone provider off makes Supabase refuse phone sign-up, sign-in and phone change no matter what a client sends. |
| Phone MFA | Not used in the code. 0 enrolled factors (checked 2026-11-15). Keep it off in Auth > Multi-Factor. |

Flags (`src/lib/auth/config.ts`): `NEXT_PUBLIC_SMS_AUTH_ENABLED` (UI only) and `SMS_AUTH_ENABLED`
(server only), both default off. The old `NEXT_PUBLIC_SMS_SIGNIN` is ignored, so a stale "on" can't bring
SMS back.

Kept for later: all Twilio/SMS code (`src/lib/auth/phone.ts`, the phone stages of `auth-dialog.tsx`,
settings phone row, phone-abandon route, tests, `scripts/sms-auth/run.mjs`, docs/auth/SMS_SIGN_IN.md), the
phone-hash credit logic in the database, and the Twilio account/credentials (not touched).

### Dependency check (read-only SQL on production, 2026-11-15)

| | Count |
|---|---|
| Accounts | 9 |
| Accounts with an auth phone number | 0 |
| Phone-only accounts | 0 |
| Phone identities | 0 |
| MFA factors (any / SMS) | 0 / 0 |
| Pending phone changes | 0 |

Nobody signs in by phone, so turning off the phone provider locks nobody out.

### Remaining SMS dependencies (inventory)

- Supabase phone provider still configured with Twilio Verify (step D turns it off).
- Twilio account, Verify service and Trust Hub profile (untouched; still under review).
- `starter_credit_claims` phone hashes and `credit_status`/`finalize_bid` phone checks (dormant: no phone accounts).
- PR #31 (fixes the link-phone dialog when a text fails) touches the same dialog; it only matters once SMS returns.

### Phone numbers that stay (not authentication)

Untouched by this change: company phone (builder Company step, `b-phone`), customer phone (Project step,
`c-phone`), the Customers list, phone numbers printed on proposals/PDFs, phone formatting helpers, company
settings and all saved data. No database change, no migration, no customer record modified.

## 3. Verification email template

Files: `supabase/templates/magic-link.html` (existing accounts) and `supabase/templates/confirm-signup.html`
(first code for a new email: Supabase sends this one when it creates the account). Plain-text version:
`supabase/templates/verification-code.txt`.

Subject (both): **Your Built2Bid verification code**

```
Hi,

Use this code to securely sign in to Built2Bid:

{{ .Token }}

Enter this code on the Built2Bid website to continue.

If you didn't request this code, you can safely ignore this email.

Built2Bid
built2bid.org
```

Branded card layout (navy Built2Bid header in text, no image) with the code; no sign-in button or link, no images, no tracking pixel, no shortened links. `{{ .Token }}` is filled by
Supabase. Old emails with a link still work because `/auth/callback` and `/auth/confirm` are kept.

Left alone on purpose (they need a link or are separate flows): **Reset password** (the admin "Send secure
sign-in link" button uses it), **Invite user** (Enterprise invites), **Change email address** (Account
settings; already accepts its code), **Reauthentication**.

## 4. Gmail / Outlook spam: findings

What could be checked from here: auth logs show sign-in emails being sent (`/otp` 200) and a 30-second
resend limit. What could not: the Supabase SMTP settings, real message headers, and Gmail/Outlook
placement (threads can't read those dashboards or mailboxes). So these are findings to confirm, not
measured results.

Most likely cause: **Supabase's built-in sender.** If Auth > SMTP has custom SMTP off, every code comes
from Supabase's shared address (not built2bid.org), on shared IPs, with no built2bid.org SPF/DKIM, so
DMARC alignment for Built2Bid is impossible and filters treat "sign in now" mail from an unrelated domain
as likely phishing. The built-in sender also only delivers to project team members and is limited to a
few emails an hour, which would block real customers outright.

The template made it worse: a big "Sign in" button linking to a different domain is a classic phishing
pattern. The new template has no link at all.

Fix: send Supabase auth email through **Resend** (already set up and verified for built2bid.org) with
custom SMTP (step E). Email authentication helps a lot, but no setup can guarantee inbox placement; new
senders build reputation over the first weeks.

## 5. SMTP provider and cost

**Recommended: Resend, existing account.** No new provider.

- Free plan: 3,000 emails/month, **100/day**, shared with the founder email. Resend's pricing page
  currently lists 3 domains on Free (some older guides say 1; check the Domains page).
- Pro: **$20/month** for 50,000 emails, no daily cap. Upgrade once sign-ins plus founder emails approach
  100 a day. Don't upgrade without deciding to.

## 6. Sending identity and exact DNS

Two options. **Option 1 needs no DNS change and is recommended to start.**

### Option 1 (recommended): `Built2Bid Security <login@built2bid.org>`

built2bid.org is already verified in Resend (DKIM `resend._domainkey`, `send` MX + SPF). Any address at a
verified domain can send; no mailbox is needed. DKIM signs as built2bid.org and the return path is
`send.built2bid.org`, so DMARC aligns. **No DNS records to add or change.** Google Workspace MX, SPF and
DKIM at the root stay as they are.

### Option 2: `Built2Bid Security <login@auth.built2bid.org>` (the proposed identity)

Keeps sign-in reputation separate from the root domain. Needs a second Resend domain:

1. Resend > Domains > Add domain `auth.built2bid.org` (same region as built2bid.org).
2. Resend then shows the records to add. They will look like the ones below, but **copy the exact values
   from Resend** (the DKIM key is unique):

| Type | Name (Netlify DNS host) | Value | Notes |
|---|---|---|---|
| TXT | `resend._domainkey.auth` | `p=MIGfMA0…` (from Resend) | DKIM |
| MX | `send.auth` | `feedback-smtp.<region>.amazonses.com`, priority 10 | bounce/return path |
| TXT | `send.auth` | `v=spf1 include:amazonses.com ~all` | SPF for the return path only |

3. Add them in Netlify DNS: https://app.netlify.com/teams/james-stein/dns/built2bid.org
4. Don't touch the root SPF (`v=spf1 include:_spf.google.com ~all`), Google DKIM, MX, or the existing
   Resend records. There must be only one SPF record per name; these new ones live on `send.auth`.
5. DMARC: the root `_dmarc` (p=none) already covers subdomains. Later, once reports look clean for 2–4
   weeks, move to `p=quarantine`.

## Owner rollout checklist (in this order)

Each step needs your OK before it's done in production.

**A. Email OTP Length → 6** (before the deploy, because the new site accepts exactly 6 digits)
https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/providers → Email → Email OTP Length = `6`
→ Save. Leave "Confirm email" on.

**B. Templates**
https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/templates
- Magic Link: subject "Your Built2Bid verification code", body = `supabase/templates/magic-link.html`.
- Confirm sign up: same subject, body = `supabase/templates/confirm-signup.html`.
- Before saving, copy the current bodies into a note (rollback).

**C. Deploy the code** — merge the PR, then Netlify → Deploys → Trigger deploy.
Then in Netlify env vars, delete `NEXT_PUBLIC_SMS_SIGNIN` (all contexts). Don't add
`NEXT_PUBLIC_SMS_AUTH_ENABLED` or `SMS_AUTH_ENABLED`.

**D. Phone provider off** (0 accounts affected)
https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/providers → Phone → turn off "Enable
Phone provider" → Save. Save the Twilio Verify Service SID somewhere safe first in case the form clears.
Check https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/mfa: Phone MFA disabled.

**E. Custom SMTP via Resend**
1. Resend → API Keys → create a new key, permission "Sending access", domain built2bid.org (or
   auth.built2bid.org). Separate from the founder-email key so each can be revoked alone. Never paste it
   in chat.
2. https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/smtp → Enable custom SMTP:
   Sender email `login@built2bid.org` (or `login@auth.built2bid.org`), Sender name `Built2Bid Security`,
   Host `smtp.resend.com`, Port `465`, Username `resend`, Password = the new key. Save.
3. https://supabase.com/dashboard/project/asiiqmegvajtuspeumio/auth/rate-limits → emails per hour
   (Supabase sets 30 after enabling SMTP) → raise to about 100 to match the Resend daily cap.

**F. Live test**
1. Sign in at https://built2bid.org/login with a Gmail and an Outlook.com address. Code is 6 digits.
2. Gmail: ⋮ → Show original → SPF PASS, DKIM PASS (built2bid.org), DMARC PASS. Outlook: View → Message
   source → `Authentication-Results` shows `spf=pass dkim=pass dmarc=pass`.
3. Pricing → Unlimited Monthly, signed out, new email → code → lands on Stripe Checkout with Monthly.
   Repeat with Annual (close Stripe without paying).
4. Existing account sign-in → dashboard shows saved bids.

## Rollback

| What | How |
|---|---|
| Code | Netlify → Deploys → pick the previous production deploy → Publish deploy. Or revert the PR. |
| Code length mismatch (site and Supabase disagree) | Set Netlify `NEXT_PUBLIC_EMAIL_OTP_LENGTH` to the Supabase value (6–10) and redeploy, or change Supabase back. |
| Templates | Paste back the saved bodies (old link+code template is in project files `buildyourbid/supabase/magic-link-email.html`). |
| SMTP | Auth → SMTP → turn off custom SMTP (falls back to Supabase's sender). |
| Phone provider | Auth → Providers → Phone → enable again (Twilio Verify settings). |
| SMS UI later | Netlify: `NEXT_PUBLIC_SMS_AUTH_ENABLED=true` and `SMS_AUTH_ENABLED=true` (Deploy Preview first), redeploy. |

## Tests

- `tests/email-otp.test.ts`: length default/override, leading zeros, paste spacing, too-long refused, SMS
  switches off by default and server switch required, template content (token, no link/pixel/hardcoded code).
- `tests/phone-auth.test.ts`, `tests/phone-abandon.test.ts`: updated for the new flags.
- `scripts/email-auth/run.mjs`: browser checks against the mock Supabase (accepts 123456 and 012345).
- `scripts/checkout-e2e/run.mjs`: checkout continuity, incl. login-page path for monthly and annual.
