# Instantly integration plan

Status: **PARTIAL / BLOCKED.** Server-side code exists on this branch and is off by default. It was
written from Instantly's official API v2 documentation (checked 2026-11-12) but has **never run against
a real workspace**, because none exists yet. **No outreach has been sent and none will be sent without
the owner's explicit approval.**

Sources: [API introduction](https://developer.instantly.ai/), [Create lead](https://developer.instantly.ai/api-reference/lead/create-lead),
[Create block list entry](https://developer.instantly.ai/api-reference/blocklistentry/create-block-list-entry),
[Webhook object](https://developer.instantly.ai/api-reference/webhook/get-webhook),
[Webhook events](https://developer.instantly.ai/guides/webhook-events).

## What Instantly's API provides (verified from docs)

* Base `https://api.instantly.ai/api/v2`, auth `Authorization: Bearer <API key>`; keys are scoped (e.g. `leads:create`, `block_list_entries:create`, `webhooks:all`).
* `POST /leads`: create a lead in a campaign or list; `skip_if_in_workspace`, `skip_if_in_campaign`, `skip_if_in_list` prevent duplicates; the workspace block list is always checked; `custom_variables` for personalization (flat values only).
* `POST /block-lists-entries` with `bl_value` = email or domain: Instantly never emails it again.
* Webhooks: `target_hook_url`, optional `campaign` filter, **custom `headers`** (Instantly does not sign deliveries, so a shared-secret header is the authentication), `event_type` one of `email_sent`, `email_opened`, `email_link_clicked`, `reply_received`, `email_bounced`, `lead_unsubscribed`, `campaign_completed`, `account_error`, `lead_interested`, `lead_not_interested`, `lead_meeting_booked`, `lead_meeting_completed`, `lead_closed`, `lead_out_of_office`, `lead_wrong_person`, `lead_no_show`, `all_events`, …
* Payload base fields `timestamp`, `event_type`, `workspace`, `campaign_id`, `campaign_name`, plus `lead_email`, `email_account`, step/variant, and email/reply bodies for some events. No documented event id, so we deduplicate on a hash.
* Webhooks are auto-disabled after repeated delivery failures (`status = -1`), so the endpoint must answer fast and 200 on duplicates.

## What is built (this branch)

| Piece | File | Behavior |
|---|---|---|
| Webhook receiver | `src/app/api/webhooks/instantly/route.ts` | Requires header `x-built2bid-webhook-secret` = `INSTANTLY_WEBHOOK_SECRET` (constant-time compare); 503 if unset, 401 if wrong. Upserts the lead by normalized email, stores the event once (`lead_events.dedupe_key`), advances stage, applies suppression. Stores **no email bodies or reply text**. |
| Event mapping | `src/lib/growth/instantly-events.ts` | sent → contacted; opened/clicked → engaged; reply → replied; interested/meeting → interested; **unsubscribed → suppress + block list + our marketing opt-out cleared**; bounced → suppress. |
| API client | `src/lib/growth/instantly.ts` | `blockEmail()`, `addLeadToCampaign()`; no-op unless `INSTANTLY_API_KEY` and `INSTANTLY_SYNC_ENABLED=true`. |
| Customer suppression | `src/lib/growth/leads.ts` `markCustomer()` from the Stripe webhook | New paying customer → lead `paid`, `suppressed_at`, pushed to the Instantly block list. |
| Attribution | `src/proxy.ts`, `src/lib/growth/attribution.ts` | First-touch UTM / `ic` / `ref` cookie, linked to the lead at sign-in. |
| Data model | `supabase/migrations/20261112001000_growth_funnel.sql` | `leads`, `lead_events`, `marketing_costs`, `growth_funnel()`; service role only. **Not applied yet.** |
| Dashboard | `/admin/sales` | Campaign table: leads, replied, signed up, first bid, paid, unsubscribed. |

Deliberately **not** automated: importing prospects into campaigns and starting/stopping campaigns.
Those stay operator actions in Instantly's UI so nothing can email people by accident.

## Setup steps (after the owner creates the Instantly workspace)

1. 🔐 Apply `supabase/migrations/20261112001000_growth_funnel.sql` in the Supabase SQL Editor.
2. 🔐 Instantly → Settings → Integrations → API: create an **API v2 key** with only `leads:create` and `block_list_entries:create` (add `webhooks:all` only if Claude should manage webhooks). Store it in Netlify as secret `INSTANTLY_API_KEY` (Production only). Never paste it in chat.
3. Generate a random 32+ character string; store as Netlify secret `INSTANTLY_WEBHOOK_SECRET`.
4. 🔐 Instantly → Webhooks → add: URL `https://built2bid.org/api/webhooks/instantly`, event "All events", header `x-built2bid-webhook-secret: <same string>`.
5. Set `INSTANTLY_SYNC_ENABLED=true` (Production), redeploy.
6. Run the test plan below with a seed campaign sent only to the owner's own addresses.

## Outbound domains, authentication, warmup (recommendation)

* **Never send cold email from `built2bid.org`.** It carries sign-in and billing email; a spam reputation hit there locks customers out.
* Buy 2–3 look-alike domains for outreach (e.g. `getbuilt2bid.com`, `built2bidpro.com`, `trybuilt2bid.com`; check availability first; owner purchase decision). Redirect their websites to `https://built2bid.org` (301).
* For each outreach domain: 2–3 Google Workspace (or Microsoft 365) mailboxes, SPF, DKIM, DMARC (`p=none` at first), custom tracking domain CNAME if Instantly link tracking is used.
* Warm up every mailbox with Instantly's warmup for at least 2–3 weeks before any campaign; start at ~10–20 sends/mailbox/day and ramp slowly; keep under ~30–50/day/mailbox.
* Cost to expect: ~$10–15 per domain/year; ~$7–8 per Workspace mailbox/month; Instantly plan (check current pricing).

## Consent, opt-out and compliance (CAN-SPAM baseline; check other jurisdictions with counsel)

* Every outreach email: truthful sender and subject, a physical postal address, a working one-click unsubscribe (Instantly's unsubscribe link). Honor opt-outs within 10 business days (we do it immediately via webhook).
* Unsubscribe in Instantly → our webhook marks the lead suppressed, clears the app's `marketing_opt_in`, and adds the email to the Instantly block list so every campaign respects it.
* Suppression survives account deletion (`leads.user_id` → null; email kept only as a do-not-contact record). Mention this in the Privacy Policy.
* B2B prospecting only; do not email consumers. If targeting Canada (CASL) or EU/UK (GDPR/PECR) contractors, get counsel first: those regimes require consent or a documented legitimate-interest basis.
* No purchased lists without provenance; verify emails before import (Instantly `verify_leads_on_import`).

## Test plan (all with the owner's own addresses only)

1. `curl` the webhook with a wrong secret → 401; correct secret, fake `reply_received` payload → 200 and a lead row in stage `replied`; same payload again → `duplicate`.
2. In Instantly, create a test campaign with only owner-controlled addresses; send one step; confirm `email_sent` arrives and the lead moves to `contacted`.
3. Click the tracked link → land on built2bid.org with UTM → sign up with that address → lead links to the account, stage `signed_up`, campaign shows 1 signup on `/admin/sales`.
4. Unsubscribe from the test email → lead suppressed, block-list entry visible in Instantly.
5. With Stripe test mode, subscribe → lead `paid`, block-listed.

## Separate launch gate for outreach (all must be true)

- [ ] Outreach domains bought and redirected; **not** built2bid.org
- [ ] SPF, DKIM, DMARC pass on every sending mailbox (check with a mail-tester service)
- [ ] Warmup ≥ 14 days, healthy warmup score on every mailbox
- [ ] Growth migration applied; webhook test plan steps 1–5 passed
- [ ] Customers and opted-out people are on the block list (export from `leads where suppressed_at is not null`)
- [ ] Postal address and unsubscribe present in every template; copy reviewed: **no invented testimonials, numbers or win-rate claims**
- [ ] First campaign ≤ 50 prospects, reviewed by the owner
- [ ] **Owner's explicit written approval to send**
