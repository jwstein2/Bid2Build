---
name: growth-os-phase-rules
description: Use for any Built2Bid Growth OS work (marketing/sales automation, growth schema, growth-worker, connectors, agents, campaigns). Sets the phase gates, safety limits, staging-first rules and the 7-part phase report.
---

# Growth OS phase rules

Growth OS is the internal marketing and sales operation connected to the Built2Bid app. The owner's standing rules
apply to every phase, every agent and every pull request.

## Before you start
1. Read the earlier phase docs in `docs/growth-os/` (and the owner's project files copy, if you have it) and the
   acceptance results of the previous phase. Do not start a phase until its predecessor's critical acceptance
   tests pass or the owner authorized a documented exception.
2. Inspect what already exists before building a replacement: `src/lib/admin/integrations.ts`, `marketing` schema and
   `mkt-scheduler` (see `growth-os/legacy/`), `growth` / `growth_read` / `growth_api` schemas (Phase 4), Sales Hub
   `sales_*`, `public.leads`, creator outreach, lifecycle email.

## Never without the owner's explicit OK
- Purchase anything, launch or edit ads, change budgets or spending limits (always risk tier 3: never automated).
- Send unsolicited messages. Outbound only to opted-in contacts, through approved templates, with suppression
  checks at approval and at send time.
- Change production: database, Edge Functions, Vault, Netlify env vars, redeploys, the live website.
- Create accounts, OAuth apps or platform applications in Built2Bid's name.

## How to build
- Feature branch and draft PR only. Staging Supabase project `built2bid-growth-staging` for live tests; local
  Postgres tests for full fidelity. Deploy previews share the production database: never test writes there.
- Official APIs and approved connectors, OAuth on the platform's own screen, least-privilege scopes, tokens in Vault.
  Never ask for or handle passwords, recovery codes, MFA codes or secret values; the owner pastes secrets himself.
- Every write through a `growth_api` SECURITY DEFINER function, audited and revertible. The worker uses the
  `growth_worker` role, never the service-role key.
- Prefer deterministic code over model calls. Any model call goes through the prompt registry and the budget
  ceilings ($5/day, $50/month unless the owner changes them).
- Never show simulated, synthetic or stale data as live. Label every number: verified, reported, assumption,
  estimate or simulation.

## Every PR
- Run `/code-review` on the diff, and `/security-review` for anything touching auth, tokens, RLS, SQL functions,
  webhooks or outbound messaging. Fix what is real before asking for review.
- For SQL and Supabase work, follow the Supabase agent skills (`supabase`, `supabase-postgres-best-practices`) if
  installed; see `docs/growth-os/SKILLS.md`.
- Marketing copy follows the `built2bid-marketing-copy` skill.

## End every phase with this report
1. What was implemented. 2. What was tested and the results. 3. Files and systems changed. 4. Permissions or
credentials still required. 5. Known risks and unresolved issues. 6. Operating cost implications. 7. Explicit
acceptance criteria, each marked pass or fail.
