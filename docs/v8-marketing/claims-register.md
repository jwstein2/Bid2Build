# Claims register

Categories: **1** product fact · **2** customer outcome (Built2Bid's own customers, with evidence) · **3** third-party research · **4** illustrative calculation · **5** hypothesis. Only 1–3 may be stated as fact, and 3 only with its source and limits beside it. Re-verify every 6 months.

## Claims on the site after Batch 1

| Claim | Cat. | Evidence | Placement |
|---|---|---|---|
| "Free for every trade · No credit card · Build before you sign up" | 1 | Starter credits in Postgres; no-account builder `/start/[trade]` | Hero eyebrow |
| "Price materials and labor with built-in calculators" | 1 | `src/lib/calculators/` | Hero sub |
| "Send a proposal your customer can sign online" | 1 | E-signatures live (gate `esign`) | Hero sub |
| "Your costs stay private" | 1 | Customer views built only from customer prices | Hero, About, trust block |
| "Export anytime", "No long-term contracts", paid periods non-refundable | 1 | Terms, account export (PR #89) | About, trust block |
| "Built2Bid L.L.C., a Minnesota company" | 1 (owner to confirm) | `/security` page; Stripe Tax head office | About, trust block |

## Third-party statistics reviewed

| Statistic | Source, date, sample, method | Sponsor / type | Decision | Approved wording and placement | Re-verify |
|---|---|---|---|---|---|
| 54% of home service owners who use AI use it for quoting | Jobber 2026 Home Service Trends Report; survey of 1,050 US home service business owners by Conjointly, Dec 2025; ±3 pts at 90% confidence. getjobber.com/home-service-trends-report/ | Vendor-sponsored, observational | ACCEPT, restricted | "In Jobber's 2026 survey of 1,050 US home service owners, 54% of those using AI said they use it for quoting." Learn/Academy only, not homepage | 2027-05 |
| 52% of home service owners use AI | Same report | Vendor-sponsored | ACCEPT, restricted | Same rules as above | 2027-05 |
| Only 16% offer good/better/best options | Same report | Vendor-sponsored | ACCEPT, restricted | Academy lesson on options pricing, with source | 2027-05 |
| 13 hours a week looking for data | Autodesk State of Design & Make, EMEA construction spotlight | Vendor-sponsored; EMEA business leaders; no sample on the page; correlation | DEFER | Not used. EMEA leaders ≠ US small contractors | – |
| 35% of time (14+ hrs/week) on non-productive work; $177B; 48% of rework from poor data, $31.3B | FMI/PlanGrid "Construction Disconnected", 2018, ~600 construction professionals | Commissioned by PlanGrid; 8 years old; larger firms | REJECT for marketing | Possibly Academy background with date and sponsor | – |
| 14–15% (McKinsey "Reinventing construction", 2017) | Could not verify the specific figure; report is global and megaproject-focused | – | REJECT | – | – |

## Prohibited until Built2Bid has its own evidence

Win 30% more bids · Increase revenue by 20% · Reduce estimating time by 70% · Save 10 hours every week · Guaranteed growth · Increase margins by 15% · Pays for itself with one bid · Trusted by thousands. `tests/v8-marketing.test.ts` scans the homepage, About page and trust content for these patterns.

## Hypotheses (category 5, not to be published as fact)

- "In minutes": plausible from the builder flow, unmeasured. Becomes publishable as a fact once the median time-to-first-bid is measured (Batch 2), e.g. "Most first bids are ready in about N minutes" with the measurement date.
