# SMS sign-in (phone verification codes)

**Status (2026-11-14):** merged (PR #19) and the SQL is applied. Production is back on email sign-in (`NEXT_PUBLIC_SMS_SIGNIN=off`) while Twilio reviews the Trust Hub primary customer profile (error 20003 blocked sends). Deploy previews have it on.

Code shipped behind a flag. Sign-in stays email-only until every step in "Turning it on" is done
and `NEXT_PUBLIC_SMS_SIGNIN=on` is set in Netlify. Nothing here changes existing accounts.

## What contractors see (flag on)

1. **Mobile number** (US by default; country picker for CA, PR, MX, UK, IE, AU, NZ). Formats as you type.
2. **Text me a code** → Supabase asks Twilio Verify to text a 6-digit code. The code is typed into the
   same window, so reading it on a phone and typing it on a desktop works. `autocomplete="one-time-code"`
   gives iOS/Android autofill; Android Chrome WebOTP fills it automatically if the SMS ends with
   `@built2bid.org #123456`.
3. **Resend** is locked for 60 seconds per number (also across closing/reopening the dialog or refreshing).
   Clear messages for wrong code, expired code, too many tries, and numbers that can't get texts.
4. **A number with no account** gets one question: *"I'm new here"* (creates the account) or
   *"I signed up with email before"*. The second path signs in with an email code (existing accounts only,
   so a typo can't create a second account), then texts the phone and attaches it to that same account once
   its code is entered. Bids, customers, subscription and Stripe customer stay on the one account.
5. **Use email instead** is always one tap away (fallback and recovery).
6. **Checkout:** choosing Unlimited Monthly ($19.99) or Annual ($149) while signed out opens the same dialog
   with the plan shown. After the code, it goes straight to Stripe with that plan. A refresh while waiting for
   the text reopens the code step with the same plan and number, and doesn't send another text.
7. **Account settings → Sign-in methods:** add or change a phone (verified by code), and phone-only accounts
   can add an email for receipts and recovery.

## Account safety rules

- Nothing is ever merged because an email or phone "matches". A phone joins an account only when the
  person is signed in to that account **and** enters the code texted to the phone (Supabase `phone_change`).
- Sign-in by phone uses `shouldCreateUser: false` first, so an existing phone never creates a duplicate.
- A number already on another account is refused ("already used by another Built2Bid account").
- Exports, credits and checkout now accept a verified phone **or** a verified email.
- Starter credits: 3 per account, once. Phone numbers are hashed into the same "already claimed" list as
  emails, so deleting an account and signing up again with the same number gets no second bonus.

## Turning it on (owner steps, in order)

Each step is a dashboard change; do them yourself and never paste keys into chat.

1. **Database (safe to do first).** Paste `supabase/migrations/20261114000100_phone_sign_in.sql` into the
   Supabase SQL Editor and run it. It only changes how "verified" is checked (email *or* phone) and adds
   phone hashes to the starter-credit claims; email accounts behave exactly as before. Check:
   ```sql
   select proname, position('phone_confirmed_at' in pg_get_functiondef(oid)) > 0 as phone_ok
   from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('ensure_credit_account', 'credit_status', 'finalize_bid', 'admin_metrics');
   ```
   All four rows should say `true`.
2. **Twilio.** Create a Twilio account, then Verify → Services → create "Built2Bid": code length 6,
   expiry 10 minutes. Turn on **Fraud Guard**. In **Geo permissions**, allow only the countries you serve
   (start with US + Canada). Add a usage trigger/alert (for example $25/month) under Billing.
3. **Supabase phone provider.** Authentication → Sign In / Providers → Phone: enable, provider
   **Twilio Verify**, paste Account SID, Auth Token and Verify Service SID there. Keep "Enable phone signup" on.
   Authentication → Rate Limits: "SMS messages sent per hour" (project-wide cap; 30 is the default).
4. **Bot check (recommended before launch).** Cloudflare Turnstile → add widget for `built2bid.org`.
   Put the **site key** in Netlify as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and redeploy. Then put the
   **secret key** in Supabase → Authentication → Attack Protection → CAPTCHA (provider Turnstile).
   Order matters: site key and deploy first, then Supabase, or sign-ins fail while the site has no widget.
5. **Optional:** add `{{ .Token }}` to the "Change email address" email template so phone-only accounts can
   confirm a new email by code in Settings (the link in the email works either way).
6. **Try it on a deploy preview** with `NEXT_PUBLIC_SMS_SIGNIN=on` set for the Deploy Preview context.
7. **Go live:** set `NEXT_PUBLIC_SMS_SIGNIN=on` for Production and redeploy. To turn it off, remove it and
   redeploy; email sign-in keeps working the whole time.

## Costs (Twilio Verify, US)

Twilio's pricing page (October 2026): **$0.05 per successful verification + $0.0083 per SMS sent**.
Failed verifications pay only the SMS fee. Supabase adds no SMS charge (you bring the provider).

| Monthly sign-ins | ~1 text each | ~15% need a resend |
|---|---|---|
| 500 | ~$29 | ~$30 |
| 2,000 | ~$117 | ~$119 |
| 10,000 | ~$583 | ~$595 |

Sessions last a long time, so most contractors sign in a few times a year, not daily.
**Worst-case abuse** is capped by the Supabase hourly SMS limit: at 30/hour that's at most 720 texts/day,
about $6/day in SMS fees (abusers rarely complete verifications, so the $0.05 fee mostly doesn't apply).
Captcha, Fraud Guard and Geo permissions bring that down further.

## A2P 10DLC and registration

- **Twilio Verify (recommended):** messages go out from Twilio-managed senders. Several onboarding guides
  list Verify as *exempt* from A2P 10DLC registration, but Twilio's own docs couldn't be opened from the
  build environment, so **confirm in the Twilio console before go-live** (Verify service → Messaging
  compliance). If Twilio asks for anything, it will be a short business profile, not a campaign.
- **If you ever send from your own Twilio number instead** (Programmable Messaging): US carriers require
  A2P 10DLC brand + campaign registration (one-time brand and vetting fees plus a monthly campaign fee,
  approval typically 1–3 weeks), or toll-free verification for a toll-free number. Check current fees in
  the Twilio console. Supabase's plain "Twilio" provider uses this path, which is why Verify is preferred.
- **Disclosure:** the sign-in screen says *"to receive a one-time verification text from Built2Bid. Msg &
  data rates may apply."* The privacy policy should also list mobile numbers and Twilio as an SMS processor
  (owner/attorney update).

## Known limits

- The "first time here?" step tells a visitor whether a number has an account (Supabase email sign-up has
  the same property). Captcha and rate limits make bulk probing impractical.
- Burner/VoIP numbers can get the 3 starter credits once each. If that becomes a problem, add a Supabase
  "Before User Created" hook with Twilio Lookup line-type checks.
- Someone who already created a phone-only account and *then* remembers an older email account needs
  support to merge them by hand (the app never merges automatically).
- WebOTP auto-fill needs the `@built2bid.org #code` line in the SMS; Twilio Verify's default template
  doesn't include it, so Android shows the normal autofill suggestion instead.

## Code map

- `src/components/auth/auth-dialog.tsx`: the sign-in dialog (phone, email, linking), used by login,
  builder export and checkout.
- `src/components/auth/captcha.tsx`: Turnstile widget (off until the site key is set).
- `src/lib/auth/phone.ts`: phone parsing/formatting, error messages, resend cooldown, feature flag.
- `src/app/(app)/settings/account/sign-in-methods.tsx`: add/change phone, add email.
- `src/lib/supabase/server.ts`: `SessionUser` now has `phone`, `phoneVerified`, `verified`.
- `supabase/migrations/20261114000100_phone_sign_in.sql` + `tests/db/phone-sign-in.test.ts`.
- `scripts/sms-auth/run.mjs`: 13 browser checks against the mock Supabase (accepts code 123456).
