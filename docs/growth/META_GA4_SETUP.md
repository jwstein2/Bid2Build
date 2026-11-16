# Meta Pixel / Conversions API and GA4 conversions

**Status when PR 3 merges: nothing is sent to Meta, and GA4 only receives a few extra browser events.**
Not "live" until a test event is seen in Meta Events Manager → Test events / GA4 DebugView.

## What is built

- **Consent.** If `NEXT_PUBLIC_META_PIXEL_ID` is set, visitors see a small "Allow / No thanks" banner on
  public and app pages (never on signing, sign-in, claim or admin pages). The Pixel script loads only
  after Allow. The choice is a first-party cookie (`b2b_ad_consent`) and, for signed-in accounts, Auth
  user metadata (with Meta's `_fbp`/`_fbc` browser ids). No choice = nothing ad-related loads.
- **Server events (CAPI).** `src/lib/growth/conversions.ts`. Only CompleteRegistration, ActivatedContractor
  and Subscribe, each once (`ad_conversions` unique event_id), only for accounts that clicked Allow.
  Sent: event name/time/id, `action_source: website`, page URL, SHA-256 of normalized email and of the
  account id, `_fbp`/`_fbc`, and for Subscribe the plan list price. Never names, addresses, bid amounts,
  margins or proposal content. The token never reaches the browser. Retries: 5 attempts, every 10 minutes
  (`netlify/functions/conversions-cron.mts`); events older than ~6.5 days are skipped.
- **Dedupe.** The browser Pixel fires the same `eventID` (e.g. `account_created:<user id>`), so Meta keeps one.
- **GA4.** `src/lib/analytics/track.ts` sends `landing_view`, `signup_started`, `sign_up`,
  `proposal_previewed`, `pdf_exported` through the existing GA4 tag. No new dependency.
- **Admin.** Operations → Integrations shows Pixel / CAPI state. They show amber (not green) until you
  confirm a test event.

## Owner steps (in order; nothing here spends money)

1. **Privacy policy.** Before turning the Pixel on, add Meta to the privacy page. Suggested text:
   "Advertising measurement: if you allow it, we use the Meta Pixel and Meta Conversions API to measure
   which of our ads lead to sign-ups and subscriptions. We share a hashed (one-way encrypted) email
   address and account identifier and the type of event, never your bids, customers or prices. You can
   change your choice by clearing the b2b_ad_consent cookie." (Attorney review recommended.)
2. **SQL.** Run `supabase/migrations/20261117002000_ad_conversions.sql` in the Supabase SQL Editor.
3. **Meta dataset.** Meta Business Suite → Events Manager → Connect data sources → Web → reuse or
   create a dataset for built2bid.org. Copy the dataset (Pixel) ID.
   (The "Built2Bid Messenger" app from the Facebook-trial thread is separate and isn't needed for this.)
4. **Token.** Events Manager → your dataset → Settings → Conversions API → Generate access token.
5. **Netlify → Site configuration → Environment variables (Production only):**
   - `NEXT_PUBLIC_META_PIXEL_ID` = dataset ID (public)
   - `META_PIXEL_ID` = same ID
   - `META_CAPI_TOKEN` = token, marked **secret**
   - `META_TEST_EVENT_CODE` = the code from Events Manager → Test events (start in test mode)
   - `META_CAPI_ENABLED` = `true`
   Then Deploys → Trigger deploy.
6. **Verify.** Open built2bid.org in a private window, click Allow, sign up with a test address → the
   Test events tab should show PageView, Lead, CompleteRegistration (browser + server, deduplicated).
7. Remove `META_TEST_EVENT_CODE` and redeploy to go live. Campaigns stay paused until you approve them.

## GA4 → Google Ads

1. GA4 → Admin → Events → mark `sign_up` and `pdf_exported` as **key events**.
2. Google Ads → Tools → Data manager → Google Analytics (GA4) → Link → import those key events as
   conversions (secondary at first). Requires admin on both accounts.
3. Paid subscriptions are confirmed by Stripe on the server, which GA4 can't see. Importing them needs
   GA4 Measurement Protocol (an API secret) or offline conversion upload: a later step if YouTube ads
   prove worth it.

## Turning it off
Set `META_CAPI_ENABLED=false` and remove `NEXT_PUBLIC_META_PIXEL_ID`, redeploy. Queued rows stay in
`ad_conversions` (rollback SQL drops the table).
