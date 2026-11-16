# Creator Partner Program (Built2Bid Learning Enterprise)

Invitation-only program for construction creators. It is **not a public plan**: it never appears on
pricing, checkout, plan selection, signup or Enterprise upsells, and public Free / Unlimited / Enterprise
and regular Enterprise behave exactly as before.

## Three experiences

| Who | What they get | Where |
| --- | --- | --- |
| Owner (platform admin) | Creator Partnerships CRM, outreach queue and settings, program provisioning, gift allowances, conversion tracking, CSV export | `/admin/creators`, `/admin/creators/programs`, `/admin/creators/settings` |
| Creator | A 12-month complimentary **Enterprise** grant for their own business (the existing Complimentary Access model), plus a private Learning Enterprise workspace: overview, team roster, private gift links, shared bids with coaching notes, pipeline summaries (counts only), resources, settings | `/learning`, `/learning/shares/[id]` |
| Gifted subscriber | Their **own** account and company profile with complimentary **Unlimited** until the program ends; premium website-based branding setup; opt-in, revocable mentorship sharing | `/gift?token=…`, `/welcome`, `/mentorship`, `/mentorship/shares/[id]` |

A gifted subscriber is never a member of the creator's company and the creator never owns or can read
their data. The creator only sees what the subscriber explicitly shares, per bid, with the details the
subscriber picks. Customer name, email, phone, address and notes are never shared (redaction happens in
SQL, in `mentorship_share_view`).

## Architecture

- **Database**: `supabase/migrations/20261117001000_creator_partner_program.sql` (programs, gifts,
  mentorship consent/shares/comments, resources) and `20261117002000_creator_outreach_crm.sql` (prospects,
  cohort slots, outreach messages/events, suppressions, settings). RLS is on for every table with no
  direct grants; all access goes through `security definer` functions that check the caller.
- **Entitlement reuse**: the creator's Enterprise and each gift's Unlimited are ordinary rows in
  `complimentary_grants` (linked by `creator_program_id` / `creator_gift_id`), so `has_unlimited`,
  `user_entitlement` and the rest of the app work unchanged. Triggers cap a gift grant at the program end
  (even if someone later runs `admin_comp_extend`) and end mentorship sharing when a gift grant is revoked.
- **Seats**: `creator_invite_gift` locks the program row, so two simultaneous invites can't take the last
  seat. Tokens are 32 random bytes; only the SHA-256 hash is stored. Links are single-use, bound to the
  invited email (verified email required at claim), and expire after 30 days or at program end. A replacement
  never extends the term. Someone who already claimed a gift in a program can't be re-gifted in it.
- **No billing**: nothing in this feature calls Stripe or writes subscription/billing tables. A paying
  customer who accepts a gift keeps their subscription and billing exactly as they were (the grant records
  `had_paid_subscription` so conversions aren't miscounted); the owner decides any billing change manually.
- **Onboarding**: `/api/onboarding/discover` fetches the member's website server-side through the existing
  SSRF guard (`src/lib/security/ssrf.ts`: blocks private/loopback/link-local/metadata addresses and
  re-checks every redirect), respects `robots.txt`, extracts name/logo/colors/contact/trade/license with a
  source for each, runs contrast and brand-match checks, and returns suggestions only. The member accepts,
  edits, replaces or removes each field; `/api/onboarding/branding` writes only approved fields and never
  overwrites existing branding unless the member chose "Replace" for that field. Manual entry and skip are
  always available.
- **Outreach automation** (`src/lib/creator/outreach/`): a real DB-backed queue run by a Netlify Scheduled
  Function (`netlify/functions/creator-outreach-cron.mts`, every 15 min) that POSTs to
  `/api/cron/creator-outreach` with `Bearer $CREATOR_OUTREACH_SECRET`. Each tick: (1) past-deadline
  prospects become "No Response — First Cohort" and their cohort slot is reallocated to the next eligible
  creator in the same trade (moved to *Qualified*, never auto-emailed); (2) one follow-up is created 72h
  after an initial send, from the owner-approved template, with the deadline = first Friday 5:00 PM CT at
  least 48h after the follow-up; (3) approved messages are sent inside business hours (CT) and the daily
  limit, re-checking suppression/reply status right before sending. A reply, unsubscribe or bounce stops
  everything for that prospect. Interest is never treated as acceptance; "Accepted" needs evidence
  entered by the owner.
- **Disabled by default.** Nothing sends until **all** of: `CREATOR_OUTREACH_SEND_ENABLED=true`,
  `RESEND_API_KEY`, `CREATOR_OUTREACH_SECRET`, and in Admin → Creator Partnerships → Settings the owner has
  set a verified sender, a postal address (CAN-SPAM), approved the follow-up template and switched sending
  on. Each initial email is also individually approved.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CREATOR_OUTREACH_SECRET` | Long random string. Signs unsubscribe links; authorizes the scheduler route and the reply webhook (`x-built2bid-webhook-secret`). |
| `CREATOR_OUTREACH_SEND_ENABLED` | Must be `true` before any creator outreach email can be sent. Default `false`. |
| `RESEND_API_KEY` | Existing Resend key (sender domain must be verified). |

Gift invitations are never emailed by Built2Bid; the creator copies a private link from `/learning`.

## Setup (staging first)

1. Confirm the Supabase project ref is the Built2Bid project, then apply the two migrations (staging, then
   production) with the usual migration process. The app tolerates the migrations not being applied: the
   new nav links and banners simply don't appear.
2. Deploy. Leave `CREATOR_OUTREACH_SEND_ENABLED` unset/false.
3. Admin → Creator Partnerships → **Import research**: upload `creators_seed.json` (and optionally
   `outreach_drafts.md`). Research contact data is never committed to the repository.
4. Review each creator, edit and approve drafts. Fill in Settings (sender, postal address, business
   hours, daily limit, cohort deadline wording) and approve the follow-up template.
5. When ready, set `CREATOR_OUTREACH_SECRET` and `CREATOR_OUTREACH_SEND_ENABLED=true`, then switch on
   sending in Settings. To pause instantly, switch sending off in Settings.
6. Inbound replies: forward mailbox replies to `POST /api/webhooks/creator-outreach-reply` (body
   `{ from, subject, text, in_reply_to }`) or log them by hand on the creator's page.
7. When a creator explicitly accepts: Programs → create the program, record their acceptance evidence,
   then provision (creates their 12-month Enterprise complimentary grant and shows a private claim link).

## Security notes

- Owner functions are callable only with the service role and re-check `is_admin(p_caller)`.
- Creator and participant functions use `auth.uid()` and check ownership/participation themselves.
- Shared bids: participants can share only their own estimates; totals come from the participant's own
  session; creators never see unshared bids, customer PII, costs without `share_costs` or margin without
  `share_margin`. Suggestions are text only. Nothing can edit a participant's estimate.
- Gift claim and website discovery are rate limited; discovery logs to `import_logs`.
- Outreach CSV export is formula-injection safe. Unsubscribe tokens are HMAC-signed.

## Rollback

1. Turn sending off (Settings) and unset `CREATOR_OUTREACH_SEND_ENABLED`.
2. Revert the app deploy (the rest of the app does not depend on these tables).
3. If the schema must go: export the CRM CSV, then run
   `supabase/rollback/20261117002000_creator_outreach_crm_down.sql` followed by
   `supabase/rollback/20261117001000_creator_partner_program_down.sql`. The second script revokes the
   complimentary grants that belong to creator programs (accounts and bids are untouched) and leaves
   regular Complimentary Access grants alone.

## Tests

- `tests/db/creator-partner-program.test.ts` (real Postgres): tenant separation, terms gate, claim by a
  Free user, replay, concurrent last-seat invites, paid customer untouched, default-private bids,
  share-own-only, redaction, permission combinations, revoke, remove participant, reassignment cap,
  expiry of subscriber and program, outreach suppression/uniqueness/reallocation.
- `tests/db/creator-rollback.test.ts`: rollback scripts.
- `tests/creator-outreach.test.ts`: schedule (incl. DST), reply classification, templates, unsubscribe
  tokens, CSV, import, scheduler flows.
- `tests/creator-onboarding.test.ts`: contrast, brand-match warnings, merge-without-overwrite, trade and
  license detection, SSRF refusals (localhost, private IPs, metadata IP, redirect to private), robots.txt,
  missing/invalid logo.

Run DB tests with `scripts/test-db.sh start` then `npx vitest run`.
