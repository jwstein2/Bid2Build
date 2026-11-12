# Architecture

**Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript, Tailwind v4, Supabase (Postgres + RLS, Auth, Storage), Stripe Billing, @react-pdf/renderer, decimal.js. Hosted on Netlify.

## Data flow
```
Trade page -> /start/[trade] -> local draft (localStorage) -> /builder
  Company -> Customer & project -> Estimate -> Proposal -> Preview
  Export: sign in (passwordless) -> draft saved to account -> POST /api/estimates/[id]/export
```
- **Engine** (`src/lib/estimate/engine.ts`): all money is decimal, rounded half-up to cents per line.
  `unitPrice = round2(unitCost × factor)`, `extended = round2(qty × unitPrice)`. Markup factor `1 + m`, margin factor `1 / (1 − m)`; one method per estimate. Override precedence item > section > estimate. Pass-through items bill at cost. Adjustments apply before tax and are allocated proportionally to the taxable base. Example rows never count.
- **Confidentiality boundary** (`src/lib/proposal/build.ts`): `buildProposal()` produces the only customer-facing representation (`ProposalDocument`). It contains no costs, markups, or margins. Both the HTML preview and the PDF render from it, so they cannot diverge.
- **Exports** (`/api/estimates/[id]/export`): render PDF first, then `record_export()` (service role) atomically checks the verified email, locks the user's monthly counter, and creates an immutable version keyed by a SHA-256 of the canonical snapshot. Same content = same version = no credit. PDF goes to the private `documents` bucket; the user gets a short-lived signed URL.
- **Credits**: two balances (3 starter, never expire; 1 monthly from the second signup-anniversary cycle, no rollover), enforced only in the database by `finalize_bid()` / `credit_status()`. Monthly is spent first; one credit per bid, charged on its first finalized version.
- **Billing**: entitlement is set only by verified Stripe webhooks through `apply_subscription_update()`, which ignores out-of-order events. `has_unlimited()` = active/trialing/past_due within the paid period.
- **Templates**: built-in seed in `src/lib/trades/data.ts` (no prices). Admins publish new versions to `trade_templates`; new bids use the latest published version and record it in `templateRef`.
- **Market intelligence** (`src/lib/market`, `/admin/market`): opt-in, de-identified observations captured once per finalized version into the non-exposed `market` schema; admin-only reports with a 20-business suppression floor. See `docs/MARKET-INTELLIGENCE.md`.
- **Regional pricing**: provider interface only (`src/lib/pricing/provider.ts`). No provider is connected; the UI says "Local pricing unavailable. Enter your cost manually."

## Key directories
| Path | Purpose |
|---|---|
| `src/lib/estimate` | Types, engine, factory, zod schemas |
| `src/lib/proposal`, `src/lib/pdf` | Canonical proposal, 5 templates, PDF |
| `src/lib/security` | SSRF-safe fetch, image/SVG validation |
| `src/lib/billing` | Stripe client, webhook mapping |
| `src/lib/admin` | Admin authorization + audit log |
| `src/lib/market` | Pricing observations: classification, units, trade models, capture, synthetic demo data |
| `src/components/builder` | Builder UI and reducer (undo for deletes) |
| `supabase/migrations` | Schema, RLS, functions, storage policies |
| `tests`, `tests/db` | Unit tests; Postgres tests for RLS, quota, billing |
