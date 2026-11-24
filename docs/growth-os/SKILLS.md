# Growth OS: skills for agents and contributors

Vetted 2026-11-24. Full review with the per-agent mapping: owner's project files
`growth-os/review/skills_recommendations.md`.

## Committed in this repo (`.claude/skills/`)

| Skill | Use for |
|---|---|
| `growth-os-phase-rules` | Every Growth OS task: phase gates, safety limits, staging-first, phase report |
| `built2bid-marketing-copy` | Any customer-facing copy: voice, plans and prices, claims register |

## Install per developer (not committed)

| Skill | Source | Install | Use for |
|---|---|---|---|
| Supabase agent skills (`supabase`, `supabase-postgres-best-practices`) | Official, Supabase (MIT), reviewed @ `c9be0e931b79` | `npx skills add supabase/agent-skills` | Schema, RLS, SQL functions, Edge Functions, query performance |
| `/code-review`, `/security-review` | Built into Claude Code | none | Every Growth OS PR |

## Community marketing skills (vetted, pinned)

The 18 skills the owner approved are vendored, instruction files only, in `growth-os/skills/vendor/` with a
hash manifest and a test (`tests/growth-os-vendored-skills.test.ts`). They don't auto-load; Phase 6 copies what
it needs into the prompt registry. The table below is the vetting summary.

| Repo | Licence | What's useful | Cautions |
|---|---|---|---|
| `coreyhaines31/marketingskills` @ `8fd2fcade2fd` | MIT | `copywriting`, `copy-editing`, `seo-audit`, `ai-seo`, `schema`, `programmatic-seo`, `emails`, `onboarding`, `analytics`, `ads`, `ad-creative`, `cro`, `pricing` | Instruction-only, but some skills name paid "partner" tools: ignore tool picks the owner hasn't approved. Don't use `cold-email`, `prospecting`, `sms` for anything that would send unsolicited messages. `reverse-engineer-marketing/scripts/teardown.mjs` fetches public pages; run only on purpose |
| `thatrebeccarae/claude-marketing` @ `a8a63ec1341f` | MIT | `google-ads`, `facebook-ads`, `linkedin-ads`, `tiktok-ads`, `google-analytics`, `google-tag-manager`, `utm-attribution-strategy`, `technical-seo-audit`, `wasted-spend-finder` | Some skills ship Python API clients (GA4, Klaviyo, Shopify) that call official endpoints with your keys: don't run them with Built2Bid credentials; Growth OS connectors own API access |

Rules for any third-party skill: install only from a pinned commit after reading it, never give it secrets,
and `built2bid-marketing-copy` and `growth-os-phase-rules` win on any conflict.
