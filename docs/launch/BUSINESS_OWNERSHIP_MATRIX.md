# Business ownership matrix

Goal: the business (not a personal inbox) owns every account, the owner holds the keys, and Claude has
only the access it needs. "Business login" = a Google Workspace address on built2bid.org.

| Area | Platform | Owner of record (target) | Admins | Claude's access | Billing | Holds secrets for | Current state |
|---|---|---|---|---|---|---|---|
| Hosting + domain | Netlify (site `built2bid`; domain `built2bid.org` registered here) | `admin@built2bid.org` as team Owner | James | Netlify connector (OAuth, when authorized): read deploys, set env vars; **no DNS changes without approval** | Netlify team card | All app env vars | Personal login; domain bought; not attached |
| DNS | Netlify DNS | same as Netlify | James | none by default | included with domain | — | Zone exists (domain bought via Netlify) |
| Source code | GitHub `jwstein2/bid2build` (optionally move to an org later) | James (`jwstein2`), add business org later | James | Claude GitHub App: contents + PRs on this repo only | free | none (no secrets in Git) | Personal account; default branch should be `main` |
| Database + auth + storage | Supabase org "Build2Bid", project `asiiqmegvajtuspeumio` | `admin@built2bid.org` as org Owner | James | Supabase connector (SQL, migrations; destructive actions need owner confirmation) | Supabase org card (Pro recommended) | SMTP password (in Auth settings) | Personal email owner |
| Payments | Stripe | Business entity, `admin@built2bid.org` | James | none (keys only in Netlify) | payouts to business bank | `STRIPE_*` | Not created |
| Email (people) | Google Workspace on built2bid.org | `admin@built2bid.org` super admin | James | none | Workspace subscription | app password for `no-reply@` (stored in Supabase) | Configured (owner) |
| Transactional email | Supabase Auth via Workspace SMTP now; Resend later | business | James | — | — | SMTP / `RESEND_API_KEY` | Personal Gmail SMTP today: move |
| Outreach | Instantly + outreach domains/mailboxes | `admin@built2bid.org` | James | none until key is placed in Netlify; never sends | Instantly plan | `INSTANTLY_*` | Not created |
| AI | Anthropic Console | business (move key ownership to a business-email org if possible) | James | — | Anthropic card | `ANTHROPIC_API_KEY` | Live; key must be rotated |
| Search | Google Search Console | `admin@built2bid.org` | James | — | free | — | Not created |
| Analytics | Plausible or GA4 | `admin@built2bid.org` | James | — | — | — | Not chosen |
| Monitoring | Sentry, uptime monitor | `admin@built2bid.org` | James | — | free tiers | `SENTRY_*` | Not created |
| Automation | n8n (connector present in this workspace) | optional | James | n8n connector | — | — | Not used by Built2Bid |
| AI dev | Claude account "JW Stein 2" (this project) | James | James | — | Claude plan | none | Existing; keep, do not duplicate |

## Principles

1. **Two humans with recovery access** for Netlify, Supabase, Stripe, Workspace (owner + a trusted backup), each with 2FA.
2. **Secrets flow one way:** vendor dashboard → Netlify environment variable (marked secret). Never through chat, docs or Git. If a secret is ever pasted, rotate it.
3. **Least privilege for automation:** Claude connectors are scoped to read/configure; Claude does not change DNS, take payments live, or send outreach without written approval.
4. **Document every new account** in ACCOUNT_SETUP_CHECKLIST.md with its status.
