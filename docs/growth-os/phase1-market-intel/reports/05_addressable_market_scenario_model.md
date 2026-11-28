# Addressable Market Scenario Model (v1.1.0)

Generated from `data/derived/market_model_v1.json` (model date 2026-11-23). Unit: business units (owner-level decision makers), not workers.

> SCENARIO MODEL. TAM unit counts are Census-derived (with A02/A03 estimation rules). SAM, SOM and all dollar values depend on scenario assumptions A04-A07 and are not facts. ARPA uses real Built2Bid list prices (data/pricing.json); only the plan mix is assumed.

## Definitions

- **TAM (units)**: U.S. business units with 1-20 total people including the owner, in residential and light-commercial building trades plus exterior cleaning [A08]. Employer part = CBP 2023 establishments with <20 paid employees [A02]. Solo part = NES 2024 nonemployers above a receipts floor that varies by scenario [A01]; 6-digit trade solo counts are allocated estimates [A03].
- **SAM (units)**: TAM x segment fit weight from the Trade Priority Matrix tier [A04] x share likely to pay for estimating software [A05]. This is the step that stops the model from treating every construction business as a software buyer.
- **SOM (accounts)**: SAM x obtainable share within 36 months [A06].
- **Dollar values**: units x ARPA x 12. ARPA uses Built2Bid's real list prices with an assumed plan mix [A07]; free-plan users are excluded [A09]. Dollar values remain scenarios because the funnel steps they multiply are scenarios.

## Totals

| Metric | Low | Base | High |
|---|---|---|---|
| TAM units | 1,727,630 [M:low.tam_units] | 2,275,900 [M:base.tam_units] | 2,937,313 [M:high.tam_units] |
|   of which employer (<20 paid employees) | 703,643 [M:low.tam_employer_units] | 703,643 [M:base.tam_employer_units] | 703,643 [M:high.tam_employer_units] |
|   of which viable solo operators | 1,023,987 [M:low.tam_solo_units] | 1,572,257 [M:base.tam_solo_units] | 2,233,670 [M:high.tam_solo_units] |
| SAM units | 158,662 [M:low.sam_units] | 401,305 [M:base.sam_units] | 843,604 [M:high.sam_units] |
|   of which employer | 97,303 [M:low.sam_employer_units] | 188,900 [M:base.sam_employer_units] | 310,436 [M:high.sam_employer_units] |
|   of which solo | 61,359 [M:low.sam_solo_units] | 212,404 [M:base.sam_solo_units] | 533,168 [M:high.sam_solo_units] |
| SAM as % of TAM | 9.2 [M:low.sam_pct_of_tam] | 17.6 [M:base.sam_pct_of_tam] | 28.7 [M:high.sam_pct_of_tam] |
| SOM accounts (36 months) | 397 [M:low.som_accounts] | 3,010 [M:base.som_accounts] | 12,654 [M:high.som_accounts] |
| SOM ARR, USD (scenario) | 88,873 [M:low.som_arr_usd] | 1,199,521 [M:base.som_arr_usd] | 7,204,947 [M:high.som_arr_usd] |
| SAM annual value, USD (scenario) | 35,549,036 [M:low.sam_annual_value_usd] | 159,936,101 [M:base.sam_annual_value_usd] | 480,329,804 [M:high.sam_annual_value_usd] |
| TAM annual value at list-price ARPA, USD (scenario) | 372,522,336 [M:low.tam_annual_value_usd_at_arpa] | 767,180,329 [M:base.tam_annual_value_usd_at_arpa] | 1,367,864,796 [M:high.tam_annual_value_usd_at_arpa] |

Note: TAM employer units are identical across scenarios because they are a Census count; only the solo receipts floor changes TAM. 'Low' uses the strictest floor ($50,000), 'high' the loosest ($10,000) [A01].

## Scenario assumptions

| ID | Name | Low | Base | High | Basis |
|---|---|---|---|---|---|
| [A01] | solo_receipts_floor_usd | 50000 | 25000 | 10000 | Analyst judgment applied to published NES receipts size classes (E013-E017). 'low' scenario uses the strictest floor. |
| [A02] | employer_proxy_rule | rule | n_lt5 + n5_9 + n10_19 | rule | CBP paid employment excludes unincorporated owners (E006), so 19 employees + 1 owner = 20 people. Known errors: incorporated owners are already counted as employees; partnerships with several working partners near 19 employees exceed 20; establishments are locations not firms (E008). |
| [A03] | nes_6digit_allocation | rule | nes_parent * (cbp_n_lt5_trade / cbp_n_lt5_parent) | rule | NES does not publish 6-digit construction detail (E019). Assumes the smallest employers mirror the nonemployer trade mix. Confidence: low-medium. |
| [A04] | segment_fit_weight | P1:0.6, P2:0.35, P3:0.1 | P1:0.75, P2:0.5, P3:0.2 | P1:0.9, P2:0.65, P3:0.3 | Analyst judgment; no source measures this. |
| [A05] | software_propensity | employer 0.35, solo 0.15 | employer 0.5, solo 0.25 | employer 0.65, solo 0.35 | Scenario only. Directional context (not a measurement of the population): Software Advice shoppers report ~30% manual methods (E076) and ~40% construction-specific software (E075) but are active shoppers; Jobber respondents report 52% AI use (E101) in a vendor sample. No representative source measures paid-software adoption among 1-20 person contractors (gap G03). |
| [A06] | obtainable_share_36mo | 0.0025 | 0.0075 | 0.015 | Scenario only; early-stage vertical SaaS planning range. Starting point is 0 paying accounts (E190). Replace with funnel data from Built2Bid. |
| [A07] | arpa_usd_month | solo: Individual Unlimited, all annual ($199/yr); employer: Owner buys Individual Unlimited monthly only (1 user) | solo: Individual Unlimited, half monthly / half annual; employer: Team with 3 users (base price) | solo: Individual Unlimited monthly + 10% attach of Solo Financials + 10% attach of Project Command Center; employer: Team with 5 users | Prices are first-party facts (S13, E180-E186). Plan mix and attach rates are scenario assumptions; Built2Bid had 0 paying accounts at the 2026-11-16 baseline (E190), so no observed mix exists yet. |
| [A08] | tam_scope | rule | segments with in_tam=true in segments.json | rule | Built2Bid ships estimate templates for 42 trade slugs including decks, pressure washing and soft washing (E187), and markets 'Estimates and proposals for every trade' (E188). Heavy civil and industrial building are outside that catalog. |
| [A09] | free_plan_excluded | rule | paying accounts only | rule | Built2Bid offers a free credit plan (E189). |

## ARPA used (USD per paying account per month)

Computed from Built2Bid's real list prices in `data/pricing.json` [S13]: Individual Unlimited $19.99/month [E180] or $199/year [E181]; Team $49.99/month with 3 users included [E182], users 4-5 at $19.99 [E183]. Only the plan mix is a scenario [A07].

| Account type | Low | Base | High |
|---|---|---|---|
| Solo operator | 16.58 [T:arpa.solo.low] | 18.29 [T:arpa.solo.base] | 22.69 [T:arpa.solo.high] |
| Employer business (<20 paid employees) | 19.99 [T:arpa.employer.low] | 49.99 [T:arpa.employer.base] | 89.97 [T:arpa.employer.high] |

## Base-scenario detail by segment

| Segment | Tier used | TAM units | Fit weight | SAM units | SOM accounts | SOM ARR USD (scenario) |
|---|---|---|---|---|---|---|
| REMODEL | P1 | 443,842 | 0.75 | 107,992 | 810 | 319,111 [T:mseg.base.REMODEL] |
| GC_RES | P1 | 237,836 | 0.75 | 58,354 | 438 | 174,573 [T:mseg.base.GC_RES] |
| GC_COMM | P2 | 87,882 | 0.5 | 14,969 | 112 | 47,370 [T:mseg.base.GC_COMM] |
| ROOF | P2 | 64,516 | 0.5 | 10,946 | 82 | 34,461 [T:mseg.base.ROOF] |
| SIDING | P2 | 25,905 | 0.5 | 4,340 | 33 | 13,434 [T:mseg.base.SIDING] |
| CONCRETE | P3 | 54,808 | 0.2 | 3,771 | 28 | 12,091 [T:mseg.base.CONCRETE] |
| MASONRY | P3 | 48,051 | 0.2 | 3,244 | 24 | 10,138 [T:mseg.base.MASONRY] |
| FRAMING | P3 | 33,661 | 0.2 | 2,268 | 17 | 7,072 [T:mseg.base.FRAMING] |
| ELEC | P2 | 150,388 | 0.5 | 27,974 | 210 | 98,404 [T:mseg.base.ELEC] |
| PLUMB | P2 | 197,726 | 0.5 | 37,042 | 278 | 131,305 [T:mseg.base.PLUMB] |
| PAINT | P1 | 150,044 | 0.75 | 34,979 | 262 | 96,640 [T:mseg.base.PAINT] |
| DRYWALL | P3 | 67,829 | 0.2 | 4,296 | 32 | 12,234 [T:mseg.base.DRYWALL] |
| FLOORING | P2 | 71,770 | 0.5 | 11,125 | 83 | 30,601 [T:mseg.base.FLOORING] |
| TILE | P3 | 40,324 | 0.2 | 2,521 | 19 | 7,029 [T:mseg.base.TILE] |
| FINISH_CARP | P3 | 124,225 | 0.2 | 7,744 | 58 | 21,493 [T:mseg.base.FINISH_CARP] |
| OTHER_FINISH | P3 | 25,975 | 0.2 | 1,654 | 12 | 4,748 [T:mseg.base.OTHER_FINISH] |
| OTHER_SPEC | P2 | 201,010 | 0.5 | 30,087 | 226 | 77,829 [T:mseg.base.OTHER_SPEC] |
| SITE_PREP | P2 | 179,412 | 0.5 | 27,001 | 203 | 70,550 [T:mseg.base.SITE_PREP] |
| PRESSURE_WASH | P2 | 70,696 | 0.5 | 10,998 | 82 | 30,438 [T:mseg.base.PRESSURE_WASH] |

## Versioning

- v1.0.0 (2026-11-23): first model. Inputs: CBP 2023, NES 2024, assumptions A01-A08, placeholder ARPA.
- v1.1.0 (2026-11-23): ARPA now computed from Built2Bid's real list prices (S13); A07 rewritten as a plan-mix assumption; A09 added (free plan excluded). Unit counts unchanged.
- To create a new version: copy `data/assumptions.json`, change values, bump `model_version`, run `python3 scripts/build.py && python3 scripts/render_reports.py && python3 -m pytest tests -q`. Keep prior outputs by tagging the folder or committing to the feature branch.
