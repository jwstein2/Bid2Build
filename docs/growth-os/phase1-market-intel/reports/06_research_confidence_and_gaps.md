# Research Confidence and Gaps Report (v1.0.0)

Generated from `data/sources.json`, `data/evidence.csv` and `data/gaps.csv`.

## Source verification outcome

| ID | Requested source | Status | Confidence | Key limitation |
|---|---|---|---|---|
| [S01] | U.S. Census 2023 County Business Patterns, NAICS 23 | verified | A | Establishment, not firm; employee count excludes unincorporated owners but includes incorporated owner-officers; data are 2023. |
| [S02] | U.S. Census 2024 Nonemployer Statistics | verified | A | Includes side and part-time businesses (construction threshold is $1); construction detail stops at 4- or 5-digit NAICS, so no individual counts for roofing, painting, siding, concrete, drywall. |
| [S03] | CPWR April 2026 Small Establishments in Construction report | verified_with_internal_inconsistencies | B | Abstract figures (2.7M workers; ~57% of fatalities; 78.1% nonemployer share in 2021) do not match body text (2.5M avg / 2.4M in 2023; ~50.5%); one payroll chart has conflicting labels. Use body figures only. |
| [S04] | NAHB September 2026 residential remodeler findings | verified | D | NAHB members are larger and more formal than the typical remodeler (median $2.1M revenue vs. Census nonemployer reality); n not stated; job-count buckets sum to 94%. |
| [S05] | (supplementary) NAHB Remodeling Market Index Q3 2026 | verified | C | Sentiment only; members only. |
| [S06] | Software Advice 2026 construction software buyer research (part 1) | verified | D | Active-shopper frame overstates software intent; two unreconciled budget figures ($150/user/month vs. $450/month). |
| [S07] | Software Advice 2026 construction software buyer research (part 2) | verified | D | Same as S06; some figures labeled inconsistently (median vs. average). |
| [S08] | Jobber 2026 Home Service Trends Report | verified | C | Vendor survey; owner-reported; customer-expectation figures have no homeowner sample; HVAC lead-response figure differs between body (11%) and spotlight (17%); per-trade n not given. |
| [S09] | (supplementary) Jobber Home Service Economic Report 2026 Q2 | verified | D | Jobber customers only; cohort size not given. |
| [S10] | RoofersCoffeeShop 2024 survey of 210 roofing-industry respondents | partially_verified | E | Gated full report; no software/estimating-tool adoption figures were verifiable. |
| [S11] | Pew Research Center 2026 social media demographic survey | verified | B | General adult population, not contractors; Pinterest not asked in 2026. |
| [S12] | (supplementary) Pew Americans' Social Media Use 2025 | verified | B | Prior-year; used only for daily-use figures. |
| [S13] | (first-party) Built2Bid app repository: plans, prices, trade templates | verified | A | List prices only; actual plan mix, discounts and complimentary grants unknown. README annual price ($149) disagrees with code ($199). |
| [S14] | (first-party) Built2Bid growth-engine docs: baseline and ad-copy rules | verified | B | Point-in-time snapshot; tiny base. |

## Evidence rows by confidence grade

| Grade | Rows |
|---|---|
| A | 31 [PARAM: count of rows in data/evidence.csv] |
| B | 34 [PARAM: count of rows in data/evidence.csv] |
| C | 34 [PARAM: count of rows in data/evidence.csv] |
| D | 28 [PARAM: count of rows in data/evidence.csv] |
| E | 5 [PARAM: count of rows in data/evidence.csv] |

## Confidence by deliverable

| Deliverable | Confidence | Why |
|---|---|---|
| Employer audience counts (CBP <20 paid employees) | High | Official administrative data; proxy rule documented [A02] [G05] |
| Solo operator counts, NAICS 23 total and electrical / plumbing-HVAC | High | Published NES size classes; receipts floor is a scenario [A01] |
| Solo operator counts for other individual trades | Low-medium | Allocated from 4-digit NES groups [A03] [G02] |
| Trade Priority Matrix | Medium (size, authority) / Low (judgment dimensions) | Five of seven dimensions are analyst judgment [G07] [G09] |
| Personas | Medium-low | Evidence-informed composites, not interview-validated [G08] |
| TAM (units) | Medium-high | Census-derived with documented rules |
| SAM / SOM | Low | Driven by scenario assumptions without representative data [A04] [A05] [A06] [G03] |
| Any dollar value | Low (scenario) | Real list prices [S13] but assumed plan mix [A07] and scenario funnel [G01] |

## Gaps and resolution plan

| ID | Area | Gap | Impact | Severity | Proposed resolution | When |
|---|---|---|---|---|---|---|
| [G01] | Product | Resolved for pricing (v1.1.0): real list prices and plans are read from the app repository (S13). Still open: actual plan mix, add-on attach rates and trade/size mix of customers; Built2Bid had 0 paying accounts at the 2026-11-16 baseline (E190), so these cannot yet be observed. | ARPA uses real prices but an assumed plan mix (A07); SOM accounts remain a scenario | medium | Re-run the model once there are paying accounts: replace A07 mix with observed plan mix and A06 with funnel conversion | Ongoing |
| [G02] | Sizing | NES publishes construction only to 4/5-digit NAICS. Nonemployer counts for roofing, siding, concrete, painting, drywall, flooring, tile, finish carpentry, framing, masonry, site prep and other specialty are allocated estimates (A03). | Solo counts for these trades could be off materially | medium | Request Census custom tabulation or use IRS SOI Schedule C principal business codes (e.g., 238160 roofing) as a cross-check | Phase 2 |
| [G03] | Software adoption | No representative source measures the share of 1-20 person contractors that pay for estimating or business software. Software Advice (active shoppers) and Jobber (vendor survey) are biased frames. | SAM depends on scenario A05 (35-65% employers; 15-35% solos) | high | Commission or field a probability-based contractor survey, or license a third-party panel; validate with Built2Bid trial-to-paid data | Phase 2-3 |
| [G04] | Sizing | CBP counts establishments, not firms; multi-location firms are counted more than once. Firm-level counts by size (Census SUSB 2022) were not pulled. | Small overstatement of employer business units | low | Pull SUSB firm-size tables for NAICS 23 to cross-check | Phase 2 |
| [G05] | Owner vs worker | '1-20 total people' is approximated by <20 paid employees (A02). Incorporated owner-officers are already counted as employees; unincorporated partners are not. No Census table counts total people including owners by business. | Edges of the 10-19 and 20-49 classes are imprecise | low | Use Census Annual Business Survey owner data or SUSB for refinement; keep proxy flagged | Phase 2 |
| [G06] | Segments | Plumbing and HVAC share NAICS 238220; pressure washing and soft washing share NAICS 561790 (which also includes duct, chimney and gutter cleaning). Decks have no NAICS code at all. | Separate counts not possible; washing overstated; decks uncounted | medium | Use licensing databases (state contractor boards for plumbing vs HVAC), trade association membership, or keyword-based business listings with an approved data provider | Phase 2 |
| [G07] | Estimate frequency | No verified source reports the number of estimates (not jobs) per year by trade. NAHB gives jobs of $10K+ for members only (E055-E056). D2 scores are judgment. | Trade ranking sensitive to D2 | medium | Customer discovery interviews and Built2Bid product analytics (estimates created per account per month) | Phase 2 |
| [G08] | Personas | Personas are evidence-informed composites, not validated with interviews. | Messaging and objections may be wrong | medium | 10-15 customer/prospect interviews per P1 persona once outreach is authorized | Phase 2+ |
| [G09] | Competition | Competitive landscape (D7) was not researched; scores are judgment. | Whitespace scores unreliable | medium | Competitive teardown phase using public pricing pages | Phase 2 |
| [G10] | Source quality | CPWR bulletin has internal inconsistencies (abstract 2.7M vs body 2.4M/2.5M workers; ~57% vs ~50.5% fatalities; 78.1% nonemployer share in 2021 not in body; conflicting payroll chart labels). | Only body figures used; abstract figures excluded | low | Use CPWR's Excel chart data from cpwr.com data center to resolve | Phase 2 |
| [G11] | Source quality | RoofersCoffeeShop 2024 full report is behind a lead form and was not read (submitting the form would share contact details, which is outreach). Only press-release figures are used; no software/estimating adoption data for roofers was verified. | Roofing technology behavior relies on Jobber spotlight (vendor survey) | medium | The owner can download the report and share it, or authorize form submission | Phase 2 |
| [G12] | Source quality | Software Advice reports two unreconciled budget averages ($150/user/month vs $450/month) and mixes 'median' and 'average' labels. | No longer used for ARPA (real prices now used); budget context only | low | Treat as directional only | n/a |
| [G13] | Source quality | Jobber customer-expectation figures (e.g., same-day response expectations) come from a business-owner survey, not homeowners. HVAC within-hour response differs (11% body vs 17% spotlight). | Excluded customer-expectation figures from evidence table | low | Use a homeowner survey source if needed | n/a |
| [G14] | Geography | State counts are not normalized by population or housing stock; NES geography uses mailing address. County/metro detail exists in Census files but was not extracted. | Geographic prioritization is count-based only | low | Add ACS housing units and county/MSA extracts in Phase 2 | Phase 2 |
| [G15] | Timing | CBP is 2023 and NES is 2024 (different reference years and NAICS vintages, 2017 vs 2022; construction codes did not change). Census advises against NES time series. | Minor year mismatch in combined counts | low | Refresh when CBP 2024 releases | ongoing |
| [G16] | Requested source wording | The requested 'Pew 2026 survey' exists as the Oct 19, 2026 fact sheet; a URL dated 2026/01/15 for the 2025 report does not exist (that report is dated Nov 20, 2025). The 'CPWR April 2026 report' is a 7-page Data Bulletin, not a full report. | None; correct items identified and cited | info | None | n/a |
| [G17] | Digital behavior | Pew measures U.S. adults, not contractors. Contractor-specific platform use was inferred from demographic proxies (men, ages 30-64, HS or less, rural) plus Jobber lead-source data. | Channel recommendations are inference | medium | Measure with Built2Bid's own channel attribution once marketing is authorized | Phase 3 |
| [G18] | Pricing | The repo README states the annual Unlimited price as $149/year, but the checkout code (src/lib/billing/plans.ts, validated against Stripe) charges $199/year. The model uses the code value. | Public copy may be stale; annual ARPA would be lower if $149 were correct | low | Owner to confirm the intended annual price and fix whichever is wrong (app change is outside this phase) | Owner decision |
| [G19] | Messaging | Built2Bid's own ad rules (docs/growth/ADS.md) forbid speed, profit, 'win more jobs' and percentage claims. v1.0.0 persona messages broke these rules and were rewritten in v1.1.0; a test now enforces it. | Messages are functional descriptions; outcome claims need real customer results first | low | Keep the test; revisit once real results exist | n/a |

## What was deliberately not done

- No lead forms were submitted (for example, the RoofersCoffeeShop full report) because that shares contact details with a third party [G11].
- No Census API key was requested (creating an access key needs the owner's approval). Bulk public files gave the same data.
- No paid data sources were licensed or purchased.
