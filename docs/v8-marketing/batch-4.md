# V8 batch 4: contextual upgrade offers, save draft, "Before you go"

Date 2026-11-18. **One SQL file** (additive, idempotent): `supabase/migrations/20270105002000_upgrade_offers.sql`. Rollback: `docs/v8-marketing/rollback_20270105002000.sql`. No new environment variables, no new dependencies, no email sending, no Stripe price or entitlement changes.

Safe before the SQL runs: if `public.upgrade_offers` is missing, no offers show and everything else works as today.

| Item | Change |
|---|---|
| Offer log + caps | New table `upgrade_offers` (offer id, action, short code only; no names, emails or amounts). Browsers can't read or write it; `/api/offers` checks the rules in `src/lib/offers/policy.ts` and writes with the service role. Rules: never a modal, always dismissible; company members and past-due accounts see none; nothing new within 24 h of a dismissal or another offer; upgrade offers wait 72 h after signup; T1 once per 30 days, T5 once per 90 days, T8 once ever; the cancel step is never capped. |
| T1 one free bid left | Small note after a proposal is exported when the free account has exactly one credit left: "You have 1 free bid left. Bidding regularly? Unlimited is $19.99/month, and drafts stay free either way." Links to billing. |
| T8 proposal ready | Celebration note after a proposal is exported, with the person's existing referral link (copy / share). Copy matches the real program: the referrer gets a month free when the friend starts a paid plan; the friend is promised nothing. |
| BLD-2 save draft | Signed-out builder with a priced line shows "Save this bid to your email" (saving doesn't use a bid). Opens the existing sign-in dialog, returning to the same draft. Dismiss hides it for 7 days on that browser. |
| T5 annual | On /settings/billing for monthly subscribers with 3+ paid months and 8+ finalized bids: "Switch to annual and save $90.88" opening Stripe's own plan-change page. Prices unchanged. |
| RET-1 Before you go | Inline step under "Manage subscription" for an active personal plan: optional reason (7 codes), export link, the existing non-refundable wording, then "Continue to cancel" goes straight to Stripe's cancellation page. Never blocks or delays cancelling. |
| Owner report | /admin/marketing: shown / clicked / dismissed per offer and cancellation reasons for the selected range. |

Removed nothing. The Stripe portal button and every billing path work as before; the portal route only adds an optional `intent` that falls back to the plain portal.

## Results (mock backend, production switches)

- New walk `scripts/marketing/v8-offers-walk.mjs`: 28/28 (T1 + 30-day cap, T8 with referral link, company member sees none, BLD-2 save variant, T5, RET-1 desktop + 390 px, canceling account sees neither).
- Vitest 1,689 passed (10 new in `tests/v8-offers.test.ts`); DB test `tests/db/upgrade-offers.test.ts` 3/3 (constraints, closed to browser roles, idempotent + rollback). Type check and lint pass.
- Updated two older walks for the batch 2 phone "More" menu and the batch 1 removal of the automatic homepage popup: email-proposal 89/89, p0-email 37/38 (header title width check at 1024 px). e2e smoke: same 2 pre-existing failures as main.
- Screenshots: `/mnt/project-files/marketing-audit-v8/screenshots/batch4/`.
