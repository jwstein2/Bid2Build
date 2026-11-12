# Route inventory

Baseline: `main` @ a8d5487, audited 2026-11-12. Sources: `next build` route table, `src/app/**`, header/footer/sidebar nav, `src/app/sitemap.ts`.

**Access during audit.** `https://built2bid.netlify.app` sits behind Netlify team SSO and is not reachable from the audit container, so every page was rendered from a local production build (`next build && next start`) with **no Supabase or Stripe credentials**. Public pages and the anonymous bid builder render fully. Signed-in pages render the "Accounts aren't configured yet" guard instead of their content, so they are marked **BLOCKED (code-reviewed only)**. No auth was bypassed.

Status key: **Live** = renders and works locally · **BLOCKED** = needs a signed-in session · **API** = JSON endpoint, no UI.

## Marketing (public)
| Path | Audience | Purpose | Status |
|---|---|---|---|
| `/` | Visitors | Homepage: promise, trade picker, how it works, profit, visibility modes, pricing band, FAQ | Live |
| `/bids` | Visitors | Directory of all 36 trades | Live |
| `/bids/[trade]` (36 SSG pages, e.g. `/bids/roofing`) | Visitors / SEO | Trade landing page with sections, examples, CTA into `/start/[trade]` | Live |
| `/pricing` | Visitors | Free / $19.99 mo / $149 yr plans, comparison table, credit rules | Live |
| `/learn` | Visitors / SEO | Guide index (4 articles) | Live |
| `/learn/[slug]` (4 SSG pages) | Visitors / SEO | Articles: markup vs margin, writing estimates, proposals, sales tax | Live |
| `/login` | Visitors | Passwordless email link + 6-digit code | Live (sending needs Supabase) |
| `/privacy`, `/terms` | Everyone | Legal (marked as placeholder pending attorney review) | Live |
| `/_not-found` | Everyone | 404 | Live |
| `/robots.txt`, `/sitemap.xml` | Crawlers | Indexing disallowed until `NEXT_PUBLIC_ALLOW_INDEXING=true` | Live |

## Bid builder (public, anonymous-first)
| Path | Audience | Purpose | Status |
|---|---|---|---|
| `/start/[trade]` (`?blank=1`) | Visitors / users | Creates a local draft from the trade template, redirects to builder | Live |
| `/builder?draft=<id>` (`&export=1`) | Visitors / users | 4-step builder: Company → Customer & project → Estimate → Proposal; preview modal; export (auth gate for anonymous) | Live (export BLOCKED: needs account) |
| `/estimates/[id]` (`?step=`, `?export=1`) | Signed-in owner | Same builder, cloud-saved draft | BLOCKED |

## Signed-in app (`(app)` layout, requires session)
| Path | Purpose | Status |
|---|---|---|
| `/dashboard` | Bids list: search, status tabs, trade filter, duplicate/rename/archive/delete, quota card, local-draft recovery | BLOCKED |
| `/dashboard/customers` | Saved customers | BLOCKED |
| `/dashboard/items` | Saved cost items | BLOCKED |
| `/dashboard/templates` | Proposal templates (paid) | BLOCKED |
| `/settings/company` | Company profile + logo | BLOCKED |
| `/settings/billing` | Plan, Stripe checkout / portal | BLOCKED |
| `/settings/pricing` | Regional pricing provider status (none connected) | BLOCKED (static) |
| `/settings/account` | Data export, marketing opt-in, account deletion | BLOCKED |

## Admin (`requireAdmin()` + `is_admin` RPC)
| Path | Purpose | Status |
|---|---|---|
| `/admin` | Overview | BLOCKED |
| `/admin/templates`, `/admin/templates/[trade]` | Publish trade template versions | BLOCKED |
| `/admin/flags` | Feature flags | BLOCKED |
| `/admin/logs` | Import & PDF errors | BLOCKED |
| `/admin/audit` | Admin audit log | BLOCKED |

## Auth & API (no UI)
`/auth/callback`, `/auth/confirm`, `/auth/signout`; `/api/estimates/save`, `/api/estimates/[id]`, `/api/estimates/[id]/export`, `/api/estimates/[id]/versions/[versionId]`, `/api/quota`, `/api/business`, `/api/customers`, `/api/library`, `/api/logo`, `/api/import-website`, `/api/pricing/suggest`, `/api/account/{delete,export,marketing}`, `/api/stripe/{checkout,portal,webhook}`. None were changed by this work.
