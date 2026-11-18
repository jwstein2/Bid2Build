# V8 batch 5: Saved Items for free accounts, Enterprise shown as Team

Date 2026-11-18. James decided (2026-11-18): "rename to team, if its minimal/no cost let them save items, let them know that saved items get to be kept when upgrading".

**One SQL file**: `supabase/migrations/20270106001000_free_saved_items.sql` (additive, idempotent). Rollback: `docs/v8-marketing/rollback_20270106001000.sql`. No new environment variables, no new dependencies, no Stripe change.

Safe before the SQL runs: until it does, free accounts see today's locked Saved Items (the app checks `saved_items_free_ok()`).

## Saved Items for free (LIB-2)

| | Free | Unlimited / Team |
|---|---|---|
| Save, edit, delete own Saved Items | Yes, up to 250 | Yes, no limit |
| Add saved items to bids | Yes | Yes |
| Saved Stacks, starter assemblies, favorites | No (Unlimited) | Yes |
| Supplier price-list import, refresh costs, company templates | No (Unlimited) | Yes |

Cost: a saved item is one small database row (well under 1 KB), so 250 items is a fraction of a megabyte per account on the existing Supabase Pro plan. No extra API calls, AI or storage. The 250 cap is a database guard against abuse, not a paywall. Nothing is ever deleted on a plan change: items stay through upgrades and downgrades.

"Your saved items stay with you when you upgrade to Unlimited." appears on every free save (builder toast), in the builder picker, on the Saved Items page, on the dashboard tile, and the pricing page Free card ("Save up to 250 of your own items, kept when you upgrade") and comparison cell.

## Enterprise → Team (MKT-5, display only)

Every customer-facing label, message and email draft now says **Team** (pricing card and section, billing, company pages, sign-in and checkout dialogs, API messages, guides, search, homepage FAQ and schema). Unchanged on purpose: plan ids (`enterprise`), routes and anchors (`/pricing#enterprise`), database, Stripe price ids/env vars, owner admin pages, and the "Learning Enterprise" creator program name.

Owner follow-up (optional, Stripe dashboard): the Stripe product name still reads Enterprise on Stripe Checkout, receipts and invoices. Renaming the product in Stripe changes only the display name, not prices.

Also renamed the batch 4 SQL file from 20270105001000 to 20270105002000 (it shared a version number with the HR files migration). Both are already applied; nothing to run.

## Results (mock backend)
- New walk `scripts/marketing/v8-batch5-walk.mjs`: 22/22 (free library, API caps, before-SQL lock, Unlimited unchanged, no "Enterprise" on / and /pricing, Team plan on company billing, axe 0, 390 px).
- DB test `tests/db/free-saved-items.test.ts` 5/5 (free writes own rows only, stacks still locked, 250 cap vs Unlimited no cap, idempotent, rollback keeps items).
- Vitest 1,773 passed. Type check and lint pass. Marketing walk 319/321 (known mock-only Academy 404s); Team billing walk 22/22; V6 journeys walk 20/20.
- Pre-existing, unrelated: `scripts/saved-items/walk.mjs` (old "Default rate" label) and `scripts/enterprise/pricing-walk.mjs` (expects the pre-V6 /login redirect) were already stale.

## Follow-up: Team continuity (2026-11-18, no SQL)
James asked for the rename to hold across the platform and admin side. Admin labels (revenue, usage, states, complimentary grants, customer list, activity feed, metric definitions, creator programs) now say Team. The creator program is now "Learning Team" (was "Learning Enterprise"). Kept: "Enterprise value" on the revenue scorecard (the finance term for a company's valuation, not the plan) and all internal ids.
Stripe: the connector is read-only, so the live product "Built2Bid Enterprise" (prod_Vdx86xJaXgDkiR) is renamed by the owner in the Stripe dashboard. The editor-seat product description also mentions Enterprise.
