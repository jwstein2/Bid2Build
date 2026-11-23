# Contractor Market Intelligence Report

Built2Bid Growth OS, Phase 1. Version 1.1.0 (2026-11-23).

**Status: research only.** No marketing was launched, no outreach was sent, no agents were built and nothing was purchased.

**How to read the numbers.** Every number carries a bracketed tag that points to where it came from. `[E###]` is a verified statistic in the evidence table, `[D###]` and `[T:segment.field]` are calculations from Census data, `[M:scenario.field]` is a scenario-model output, `[A##]` is a scenario assumption and `[G##]` is a known gap. `[INF]` marks analyst inference and `[PARAM]` an analyst-set scoring parameter; neither is a measured statistic. An automated test (`tests/test_phase1.py`) fails if any number in this report has no tag or doesn't match its source row.

---

## 1. Summary

1. **The audience is owners, not workers.** U.S. construction has 7,659,459 paid employees [E002], but Built2Bid sells to the person who signs the check. We count business units. In the base case, 2,323,522 construction business units have 1 to 20 total people including the owner [D010]. That total is 740,085 employer establishments with fewer than 20 paid employees [D001] plus 1,583,437 solo operators with at least $25,000 in annual receipts [D005].
2. **Solo operators are most of the market, but many of them aren't real businesses.** There are 3,042,704 construction nonemployers [E010]. About 26.7% of them took in less than $10,000 [D007]. Census includes construction nonemployers with receipts as low as $1 [E018]. Phase 1 therefore counts only "viable" solos above a receipts floor that changes by scenario: $50,000, $25,000 or $10,000 [A01].
3. **Nearly every employer contractor is owner-run at this size.** 90.9% of construction employer establishments have fewer than 20 paid employees [D002], which matches CPWR's 2014-2023 average of 91.0% [E030]. In these firms the owner is effectively the buyer.
4. **Estimating is the main need software shoppers name.** Estimating is the most requested feature, at 72% of Software Advice construction buyer conversations [E072]. Among residential buyers it reaches 89% [E086]. Quoting is a top time drain for 37% of home service owners in Jobber's survey [E103].
5. **Top trades for Built2Bid (v1 matrix):** residential remodelers, residential GCs/custom builders and painters score P1. HVAC, electrical, decks, other specialty trades, small commercial GCs and roofing lead P2. Ignore audience size and roofing, siding and decks rise near the top. They are smaller trades where each account fits well (`02_trade_priority_matrix.md`).
6. **The market model is a scenario, not a forecast.** Base case: 2,275,900 TAM units [M:base.tam_units], 401,305 SAM units [M:base.sam_units] and 3,010 SOM accounts over 36 months [M:base.som_accounts]. SAM and SOM rest on assumptions A04-A07. Base-case ARR is $1,199,521 [M:base.som_arr_usd]: SOM accounts priced at Built2Bid's real list prices, Individual Unlimited $19.99/month [E180] and Enterprise $49.99/month for 3 users [E182], with an assumed plan mix [A07].
7. **Product fit is broad, and the owner's growth plan aligns.** Built2Bid already ships estimate templates for 42 trades [E187], including decks, pressure washing and soft washing. The owner's growth-engine priority trades (decks, general contracting, painting, roofing, concrete, kitchens, bathrooms, flooring, electrical, siding, drywall) [E192] overlap the matrix's P1 and P2 trades. Kitchens and bathrooms are remodeling (NAICS 236118), the top-ranked segment. The matrix ranks HVAC and electrical higher than the plan does, and concrete and drywall lower. Built2Bid had 0 paying accounts at its 2026-11-16 baseline [E190], so every SOM number starts from zero.

## 2. Owner-versus-worker audience definition

| Concept | What it counts | Source field | Used as audience? |
|---|---|---|---|
| Paid employees | Full- and part-time people on payroll in the March 12 pay period, including salaried corporate officers. Sole proprietors and partners of unincorporated businesses are excluded [E006]. | CBP `emp` | No. These are workers. |
| Employer establishment | A physical location with paid employees at any time during the year [E008] | CBP `est` | Yes, when it has fewer than 20 paid employees |
| Nonemployer | A business with no paid employees that is subject to federal income tax [E018]. 89.7% are sole proprietorships [D008]. | NES `ESTAB` | Yes, when receipts are above the scenario floor [A01] |
| Total people including owner | Paid employees plus working unincorporated owners | Not published by Census | Approximated [A02] |

**Proxy rule [A02].** An employer business with 1 to 20 total people including the owner is approximated by an establishment with fewer than 20 paid employees (Census classes <5, 5-9 and 10-19). Because Census excludes unincorporated owners from employee counts [E006], 19 employees plus 1 owner equals 20 people. The proxy has three known errors, all small, listed in gap G05:

- Incorporated owners are already counted as employees, so the true size is slightly overstated.
- Partnerships with several working partners near 19 employees go over 20 people [A02].
- Census counts locations, not firms [G04].

The Census "<5" class also includes establishments with no employees in March that paid wages at some point during the year [E007]. Those are seasonal owner-operators, and they belong in this audience.

**Worker numbers are context only.** CPWR reports that 2.4 million construction workers were at establishments with fewer than 20 employees in 2023 [E032]. These are workers, not buyers, and the model never uses them to size the market.

## 3. Market structure (Census)

### 3.1 Employer establishments (CBP 2023, NAICS 23)

| Size (paid employees) | Establishments |
|---|---|
| <5 | 536,259 [E003] |
| 5-9 | 127,972 [E004] |
| 10-19 | 75,854 [E005] |
| **<20 total (1-20 person proxy)** | **740,085 [D001]** |
| 20+ (outside audience) | 74,472 [D003] |
| All | 814,557 [E001] |

By subsector, establishments with fewer than 20 employees make up 94.3% of building construction (236) [E035], 90.2% of specialty trades (238) [E036] and 76.9% of heavy and civil (237) [E037]. Phase 1 leaves heavy and civil out of the TAM [A08].

### 3.2 Nonemployers (NES 2024, NAICS 23)

| Receipts band | Nonemployers |
|---|---|
| < $5,000 | 488,864 [E013] |
| $5,000-9,999 | 323,394 [E014] |
| $10,000-24,999 | 647,009 [E015] |
| $25,000-49,999 | 544,803 [E016] |
| $50,000 and up | 1,038,633 [E017] |
| **All** | **3,042,704 [E010]** |

Total nonemployer receipts were $258,200,417 thousand [E011], an average of $84,859 per nonemployer [D009]. Viable-solo counts at each floor are 1,038,633 at $50,000 [D004], 1,583,437 at $25,000 [D005] and 2,230,446 at $10,000 [D006].

**Trade detail limit [G02].** Nonemployer Statistics publishes construction only to the 4- or 5-digit NAICS level [E019]. Solo counts for individual trades such as roofing, painting or concrete are therefore allocated estimates [A03]. Electrical (23821) and plumbing/HVAC (23822) are published directly.

## 4. Segment findings

All segment numbers come from `data/derived/segment_sizing.csv`. "Units" means 1 to 20 person business units in the base scenario.

| Segment | Employer <20 | % of trade's employer estabs <20 | Viable solo (base) | Units (base) | Solo count quality |
|---|---|---|---|---|---|
| Remodelers | 132,114 [T:REMODEL.employer_estab_lt20] | 97.6 [T:REMODEL.pct_employer_lt20] | 311,728 [T:REMODEL.solo_viable_base] | 443,842 [T:REMODEL.units_1to20_base] | Allocated [A03] |
| Residential GCs / builders | 73,388 [T:GC_RES.employer_estab_lt20] | 95.5 [T:GC_RES.pct_employer_lt20] | 164,448 [T:GC_RES.solo_viable_base] | 237,836 [T:GC_RES.units_1to20_base] | Allocated |
| Small commercial GCs | 31,868 [T:GC_COMM.employer_estab_lt20] | 81.6 [T:GC_COMM.pct_employer_lt20] | 56,014 [T:GC_COMM.solo_viable_base] | 87,882 [T:GC_COMM.units_1to20_base] | Allocated |
| Roofing | 23,053 [T:ROOF.employer_estab_lt20] | 90.3 [T:ROOF.pct_employer_lt20] | 41,463 [T:ROOF.solo_viable_base] | 64,516 [T:ROOF.units_1to20_base] | Allocated |
| Siding | 8,818 [T:SIDING.employer_estab_lt20] | 96.5 [T:SIDING.pct_employer_lt20] | 17,087 [T:SIDING.solo_viable_base] | 25,905 [T:SIDING.units_1to20_base] | Allocated |
| Decks | not countable [G06] | | | | No NAICS code |
| Concrete | 20,619 [T:CONCRETE.employer_estab_lt20] | 88.3 [T:CONCRETE.pct_employer_lt20] | 34,189 [T:CONCRETE.solo_viable_base] | 54,808 [T:CONCRETE.units_1to20_base] | Allocated |
| Electrical | 73,405 [T:ELEC.employer_estab_lt20] | 88.1 [T:ELEC.pct_employer_lt20] | 76,983 [T:ELEC.solo_viable_base] | 150,388 [T:ELEC.units_1to20_base] | Direct |
| Plumbing + HVAC (one code) | 98,606 [T:PLUMB.employer_estab_lt20] | 88.7 [T:PLUMB.pct_employer_lt20] | 99,120 [T:PLUMB.solo_viable_base] | 197,726 [T:PLUMB.units_1to20_base] | Direct |
| Painting | 36,510 [T:PAINT.employer_estab_lt20] | 95.4 [T:PAINT.pct_employer_lt20] | 113,534 [T:PAINT.solo_viable_base] | 150,044 [T:PAINT.units_1to20_base] | Allocated |
| Drywall & insulation | 18,095 [T:DRYWALL.employer_estab_lt20] | 87.2 [T:DRYWALL.pct_employer_lt20] | 49,734 [T:DRYWALL.solo_viable_base] | 67,829 [T:DRYWALL.units_1to20_base] | Allocated |
| Pressure + soft washing (561790) | 17,292 [T:PRESSURE_WASH.employer_estab_lt20] | 95.7 [T:PRESSURE_WASH.pct_employer_lt20] | 53,404 [T:PRESSURE_WASH.solo_viable_base] | 70,696 [T:PRESSURE_WASH.units_1to20_base] | Direct; overstated [G06] |
| Other small trades | See `02_trade_priority_matrix.md` (flooring, tile, finish carpentry, masonry, framing, site prep, other specialty) | | | | |

### What the evidence says by investigation area

**Company size.** The Census figures above are the base. NAHB member remodelers report a median of 5 employees [E051] and a median of $2.1 million in revenue [E052], but 23% are under $500,000 [E053]. NAHB members are larger than the typical remodeler, since most remodeling units in Census data are solo operators. The NAHB figures describe the top of the market, not its middle [S04].

**Frequency of estimates.** No verified source counts estimates by trade [G07]. NAHB gives completed jobs of $10,000 or more: a median of 8 for members who do any remodeling [E055] and 12 for primary remodelers [E056]. 37% completed only 1 to 5 such jobs [E057]. Win rates show how many bids each job takes. In Jobber's survey, 36% of owners win more than 70% of quotes [E110], so most owners write noticeably more estimates than the jobs they win. Estimate-intensity scores (D2) are judgment.

**Job complexity.** Job complexity is judgment informed by trade practice. Remodeling, residential GC and commercial GC work scores highest (multi-trade scopes and allowances). Exterior cleaning scores lowest (square-foot pricing). Full scores are in the matrix.

**Purchasing authority.** In every countable trade, at least 81.6% of employer establishments have fewer than 20 paid employees [T:GC_COMM.pct_employer_lt20]. In the residential trades it is 95% or more. Solo operators are the sole decision maker by definition.

**Software usage.** No representative measure exists [G03]. Among software shoppers, about 40% already use construction-specific software [E075] and about 30% still use pen-and-paper or spreadsheets [E076]. Among residential shoppers, nearly 35% use manual or paper methods [E087]. Jobber reports 52% of owners use AI [E101]; 54% of those adopters use it for estimates, quotes or contracts [E102]. By trade, AI use is 81.5% in HVAC [E116], 67% in roofing [E114], 65% in plumbing [E118], 64% in electrical [E119] and 57% in general contracting [E120]. Software budgets vary widely: about $63 per user per month for remodelers [E082] and about $150 for general contractors [E084]. 39% of shoppers spend under $165 a month [E079].

**Pain points.** Efficiency is the top reason for switching software (48%) [E077]. Owners' biggest time drains are jobsite management (48%) [E105], quoting (37%) [E103] and admin/paperwork (31%) [E104]. 75% of shoppers who stated a preference want estimating and project management in one platform [E074]. Roofers name recruitment and retention, training, and material cost as their top issues [E134], and only 25% say they are not short of labor [E131].

**Geographic distribution.** State counts in `data/derived/geography_by_state.csv` add employer establishments with fewer than 20 employees to all nonemployers, with no receipts floor because the state file has no receipts bands [G14]. The top states are Texas with 11.95% of U.S. units [T:geo.TX.share_of_us_pct], Florida 10.59% [T:geo.FL.share_of_us_pct], California 8.58% [T:geo.CA.share_of_us_pct], New York 5.27% [T:geo.NY.share_of_us_pct] and Georgia 4.0% [T:geo.GA.share_of_us_pct]. Small establishments make up the largest share of employer establishments in Montana, Vermont and Maine [E040]. Counts are not adjusted for population [G14].

**Digital behavior.** Pew measures all U.S. adults, not contractors [G17]. The demographic groups closest to contractor owners show heavy use of Facebook and YouTube:

- Adults 30-49: Facebook 78% [E146], YouTube 91% [E154], Instagram 64% [E151], TikTok 45% [E155]
- Adults 50-64: Facebook 71% [E147]
- Men: YouTube 85% [E150], Facebook 63% [E148]
- Rural adults: Facebook 76% [E149]
- Adults with a high school education or less: YouTube 77% [E157], Facebook 67% [E156], LinkedIn 13% [E152]

Among home service owners, Facebook is a lead source for 32% [E107], Google Search for 20% [E108] and Instagram for 8% [E109]. Referrals lead at 59% [E106]. Nearly 50% of roofing respondents say digital advertising is their greatest marketing need [E133]. Nextdoor reaches 23% of suburban adults [E153], which matters for residential trades.

**Likely product fit.** Fit is strongest where estimates are frequent, itemized and owner-written (remodeling, residential GC, painting, exterior specialties). It is weaker where field-service software dominates small service tickets (plumbing, HVAC) or where pricing is a flat rate per square foot (washing). See the Trade Priority Matrix.

## 5. Personas

There are seven evidence-informed personas in `04_buyer_persona_database.md` and `data/personas.json`: Solo Remodeler (P01), Small Remodeling Firm Owner (P02), Growth-Stage Roofer (P03), Trade Service Contractor (P04), Exterior Specialty Crew Owner (P05), Painting/Finishing Contractor (P06) and Exterior Cleaning Operator (P07). Each persona keeps cited evidence separate from inference and maps to a real Built2Bid plan: Free credits, Individual Unlimited, or Enterprise [S13]. Messages are hypotheses to test, follow Built2Bid's ad rules (no speed, profit, 'win more jobs' or percentage claims) [E191], and have not been launched.

## 6. Market sizing

See `05_addressable_market_scenario_model.md`. The base-case funnel runs from 2,275,900 TAM units [M:base.tam_units] to 401,305 SAM units [M:base.sam_units], which is 17.6% of TAM [M:base.sam_pct_of_tam], then to 3,010 accounts [M:base.som_accounts]. The low-to-high SOM range is 397 [M:low.som_accounts] to 12,654 [M:high.som_accounts] accounts. That wide range is honest: the main swing factors, software propensity [A05] and obtainable share [A06], have no representative data behind them [G03].

## 7. Recommendations for Phase 2 (not started)

1. Once there are paying accounts, replace the assumed plan mix and obtainable share with observed data and re-run the model [G01]. Resolve the annual-price mismatch between the README and the checkout code [G18].
2. Validate the P1 personas with customer interviews once outreach is authorized [G08].
3. Replace allocated solo counts with IRS Schedule C principal-business-code counts or a Census custom tabulation [G02].
4. Do a competitive teardown for the P1 and P2 trades to replace judgment scores for competitive whitespace (D7) [G09].
