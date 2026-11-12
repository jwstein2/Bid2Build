# Handoff to a new Claude Code session

For any authorized Claude Code session with access to `jwstein2/bid2build`. Read this, then
PRODUCTION_READINESS_REPORT.md. No secrets are in this repo; ask the owner to place credentials in
Netlify / Supabase dashboards, never in chat.

## Product

Built2Bid: contractors turn rough estimates into customer-ready proposals (branded PDF). Free plan +
Unlimited at $19.99/month or $149/year. Brand: "Blueprint Precision" (navy #0B2D4D, cyan #00C2E0,
teal #14B8A6, Montserrat + Inter); see `docs/brand/BRAND-GUIDELINES.md`. Homepage H1: "Win More Bids.
Look More Professional. Get Back to Building." Never invent testimonials, numbers or win rates.

## Where things are

| Thing | Location |
|---|---|
| Repo | `github.com/jwstein2/bid2build`, default should be `main` (production deploys from `main`) |
| Hosting | Netlify site `built2bid` (id `5669aacb-977e-47d7-96a3-b665e3b0d99b`), `https://built2bid.netlify.app` |
| Domain | `built2bid.org`, bought through Netlify, **not attached yet**; Google Workspace email on it |
| Database/auth | Supabase project `asiiqmegvajtuspeumio` (org "Build2Bid", us-east-1, Postgres 17) |
| Payments | Stripe: **no account yet** |
| AI | Anthropic key in Netlify (Production); default model `claude-opus-5-5` |
| Outreach | Instantly: **no workspace yet**; code on branch below |

## Code map

* `src/lib/site.ts` + `src/lib/config/deploy.ts`: brand and **all URLs**; per-Netlify-context resolution (previews use `DEPLOY_PRIME_URL`). Don't hardcode domains anywhere.
* `src/lib/estimate/engine.ts`: money math (Decimal). **Do not change formulas without the owner's explicit OK.**
* `src/lib/proposal/build.ts`: the only bridge from estimate to customer-facing proposal (never leaks costs).
* `src/app/api/estimates/[id]/export/route.ts` + `record_export()` SQL: finalize + credit/quota (atomic, idempotent).
* `src/app/api/stripe/*`, `src/lib/billing/*`: checkout, portal, webhook (entitlements only change here).
* `src/lib/growth/*`, `src/app/api/webhooks/instantly`, `src/app/admin/sales`: funnel, Instantly, sales dashboard.
* `supabase/migrations/`: schema; `supabase/rollback/`: down scripts; `tests/db/`: RLS and SQL tests.
* `AGENTS.md`: this Next.js (16.4) differs from training data; read `node_modules/next/dist/docs/` before using unfamiliar APIs. Middleware is `src/proxy.ts`.

## Commands

```
npm ci
npm run lint && npm run typecheck
npm test                    # unit + integration
npm run test:db             # throwaway local Postgres (scripts/test-db.sh), RLS/quota/billing/growth
npm run build && npx next start -p 3100 & node scripts/e2e-smoke.mjs http://localhost:3100
```

## State at handoff (2026-11-12)

* Merged: PR #1 MVP, #2 rebrand, #4 scope/exclusions + AI, #5 market intelligence, #6 sign-in links.
* **Open PR #3** (draft): starter + monthly credits matching the business rules. Needs rebase on `main` (conflict in `src/components/builder/builder.tsx` step list), review, merge, then migration `20261112000500_two_balance_credits.sql` pasted in the Supabase SQL Editor.
* **Branch `claude/project-thread-6xa3uh`** (this work, draft PR): domain portability, preview noindex, HSTS, growth funnel + Instantly hooks, admin Sales page, launch docs. Migration `20261112001000_growth_funnel.sql` **not applied**.
* Applied migrations on production: core_schema, functions, storage, hardening, proposal_text_ai (history) + market_intelligence (SQL Editor, not in history).
* Production data: 1 user (owner, admin), 1 estimate, no subscriptions.

## Working rules with this owner

* The Supabase connector's confirmation prompts do not render for the owner: for DDL or destructive SQL, give the owner SQL to paste in the SQL Editor instead of calling `apply_migration`.
* The cloud container cannot reach `*.netlify.app`, Supabase REST, or the Netlify API; the Netlify connector needs the owner's authorization. Use Supabase SQL (read-only) and local builds for evidence.
* Never: change DNS, attach the domain, switch Stripe to live, send Instantly campaigns, or create duplicate accounts without the owner's explicit approval.
* Secrets pasted in chat must be rotated; never echo them.
* Branch from `main`, open draft PRs, keep migrations additive with a rollback script.

## Next tasks, in order

1. Merge this branch's PR; owner sets `NEXT_PUBLIC_SUPPORT_EMAIL`, scopes `NEXT_PUBLIC_SITE_URL` to Production.
2. Rebase + merge PR #3; owner applies migration 0500.
3. Owner applies growth migration 1000.
4. Email: Workspace sender for Supabase SMTP + SPF/DKIM/DMARC (owner, DNS approval).
5. Stripe test mode: owner creates account and puts keys in Netlify; run `npm run stripe:setup`; run billing test plan.
6. Attach built2bid.org (owner approval), switch URLs (DOMAIN_MIGRATION_CHECKLIST.md).
7. Monitoring (Sentry, uptime), analytics choice, lifecycle email provider and templates.
8. Instantly workspace, outreach domains, warmup; webhook test plan; separate launch gate.
