@AGENTS.md

## Growth OS (marketing and sales automation)

Any work on Growth OS (`growth-os/`, `docs/growth-os/`, the `growth*` schemas, `growth-worker`, connectors,
campaigns, outreach or marketing copy) follows these project skills in `.claude/skills/`:

- `growth-os-phase-rules`: phase gates, the never-without-approval list (spend, ads, unsolicited messages,
  production changes, new accounts), staging-first testing, and the 7-part phase report.
- `built2bid-marketing-copy`: brand voice, plan names and prices (Free, Individual Unlimited $19.99/mo or
  $199/yr, Team $49.99/mo), and the claims register.

On every Growth OS PR, run `/code-review`, and `/security-review` when it touches auth, tokens, RLS, SQL
functions, webhooks or outbound messaging. For database work, use the official Supabase agent skills
(`npx skills add supabase/agent-skills`, installed per developer, not committed). Community marketing skills are
optional helpers; the vetted list and how to use them safely is in `docs/growth-os/SKILLS.md`.
