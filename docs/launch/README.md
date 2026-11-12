# Built2Bid launch documents

Written 2026-11-12 from a direct inspection of the repository (main @ 7fd9ffa plus branch
`claude/project-thread-6xa3uh`), the Supabase project `asiiqmegvajtuspeumio`, and local production
builds. No secret values appear in any of these files.

Start with **PRODUCTION_READINESS_REPORT.md** (the verdict), then **ACCOUNT_SETUP_CHECKLIST.md**
(what the owner does next, in order).

| Document | What it answers |
|---|---|
| [PRODUCTION_READINESS_REPORT.md](PRODUCTION_READINESS_REPORT.md) | Can we launch? Release gates, verdict, ordered next steps |
| [PRODUCT_READINESS_AUDIT.md](PRODUCT_READINESS_AUDIT.md) | Feature-by-feature inventory with READY / PARTIAL / BLOCKED / NOT IMPLEMENTED and evidence |
| [QA_TEST_RESULTS.md](QA_TEST_RESULTS.md) | What was tested, how, and the results |
| [ACCOUNT_SETUP_CHECKLIST.md](ACCOUNT_SETUP_CHECKLIST.md) | Every external platform: account, steps, permissions, env vars, status, cost |
| [BUSINESS_OWNERSHIP_MATRIX.md](BUSINESS_OWNERSHIP_MATRIX.md) | Who owns and administers each platform |
| [ENVIRONMENT_VARIABLE_INVENTORY.md](ENVIRONMENT_VARIABLE_INVENTORY.md) | Every env var: purpose, scope, Netlify context, required or optional |
| [DOMAIN_MIGRATION_PLAN.md](DOMAIN_MIGRATION_PLAN.md) | Strategy for moving to built2bid.org without rebuilding |
| [DOMAIN_MIGRATION_CHECKLIST.md](DOMAIN_MIGRATION_CHECKLIST.md) | Exact click-by-click changes, DNS records, callback URLs, webhook endpoints |
| [PRODUCTION_LAUNCH_CHECKLIST.md](PRODUCTION_LAUNCH_CHECKLIST.md) | Launch-day checklist |
| [INTEGRATION_ARCHITECTURE.md](INTEGRATION_ARCHITECTURE.md) | Signup, credits, subscriptions, proposals, email, CRM, Instantly: data flow and trust boundaries |
| [INSTANTLY_INTEGRATION_PLAN.md](INSTANTLY_INTEGRATION_PLAN.md) | Instantly API, webhooks, suppression, deliverability, warmup, separate launch gate |
| [CUSTOMER_ACQUISITION_FUNNEL.md](CUSTOMER_ACQUISITION_FUNNEL.md) | Prospect → referral lifecycle, identity, messaging, dashboard |
| [ROLLBACK_AND_RECOVERY_PLAN.md](ROLLBACK_AND_RECOVERY_PLAN.md) | How to undo a deploy, a migration, a domain switch; backups |
| [HANDOFF_TO_NEW_CLAUDE_SESSION.md](HANDOFF_TO_NEW_CLAUDE_SESSION.md) | Everything a new Claude Code session needs to continue |
