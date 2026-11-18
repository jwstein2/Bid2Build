# Supplier pricing (migration 20261211001000)

Projects → Team & Subcontractors → **Supplier pricing** (`/projects/team/pricing`):

- **Price cross-check**: the latest price each supplier gave for the same product (same name, unit, pack),
  from the price lists the contractor imported (`/dashboard/items/import`). In a company, imports linked
  to company suppliers are shared. Undone imports and archived suppliers are left out; expired prices are
  shown but never ranked. Only real imported prices.
- **Find a branch**: Google Maps search links for each supplier near a ZIP/town (nothing fetched from
  supplier sites).
- **Supplier connections**: opt-in per company. Stores the contractor's account/branch number and consent
  only, never passwords or keys. Users can request, pause, resume or remove. Only the server (service role)
  can mark one `connected`, once a real partner integration exists. No live connector ships
  (`SUPPLIER_CONNECTORS` in `src/lib/pricing/connectors.ts` is empty).

SQL: `supabase/migrations/20261211001000_supplier_pricing.sql` (copy for the SQL Editor:
`/mnt/project-files/supplier-pricing/run-supplier-pricing.sql`). Rollback: `rollback_20261211001000.sql`.

## Research (November 2026)

| Source | API | What it gives | Access | Cost |
|---|---|---|---|---|
| ABC Supply | Public developer portal (apidocs.abcsupply.com) | Contract pricing by ship-to + branch, products, locations, orders (webhooks) | Sign up; third-party software track needs a demo + sandbox orders. Terms reportedly bar direct price-comparison tools: confirm before feeding the cross-check | Reported free |
| QXO (Beacon) | Partner only | Contract pricing (nightly by branch), ordering | Partner agreement (Roofr, AccuLynx, ServiceTitan, JobNimbus, Contractor+) | Not published |
| SRS (Roof Hub) | Partner only | Branch pricing, stock, ordering | Contractor pastes Roof Hub integration key; partner agreement with SRS | Not published |
| Ferguson | Partner API + PunchOut (cXML) | Contract pricing, availability, ordering | Partner agreement (ServiceTitan, Ply) | PunchOut free |
| Home Depot | No public API | Online retail prices via affiliate product feed (Impact) | Affiliate approval; feed terms decide whether a logged-in SaaS may show prices | Free; ~1–8% commission earned |
| Lowe's | No public API | Online retail prices via affiliate feed (CJ, some say Impact) | Affiliate approval | Free; ~1–2% commission |
| Menards | None found | — | No official affiliate feed found | — |
| 84 Lumber | None | Store/contract pricing | Ask the store for a price list and import it | — |
| 1build | GraphQL API | County-level material/labor/equipment prices (~68M points) | Developer sign-up + sales quote | Quote |
| RSMeans (Gordian) | API option | Cost database | Subscription (~$265–360/user/yr online); API quote | Quote |

Not used: scraping any supplier or retail site, and resold scraped data (Bright Data, BigBox API, etc.),
because the retailers' terms still apply once prices are shown to paying customers.
