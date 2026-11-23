# Evidence and Source Registry (v1.0.0)

Generated from `data/sources.json` and `data/evidence.csv`. Every statistic used anywhere in Phase 1 has a row here with its source, base population, period and confidence. Machine-readable versions are the JSON and CSV files themselves.

## Confidence scale

- **A**: High: official administrative or census data with published methodology; near-complete coverage
- **B**: Medium-high: research organization or probability survey with stated n, dates and method
- **C**: Medium: vendor or member survey with stated n and method but self-selected or non-representative frame
- **D**: Low-medium: vendor operational data or member census with no stated n, or unreconciled internal inconsistencies
- **E**: Low: self-selected small survey, key content gated or unverified

## Sources (requested starting points first)

### S01 2023 County Business Patterns (CBP)

- Requested as: U.S. Census 2023 County Business Patterns, NAICS 23
- Verification status: **verified**
- Publisher: U.S. Census Bureau
- Release date: 2025-06-26
- Data period: Employment in pay period including March 12, 2023; establishments with paid employees any time in 2023
- Sample / universe: Universe of U.S. establishments with paid employees (Business Register); excludes self-employed individuals and businesses with an EIN but no employees. 2017 NAICS.
- Method: Administrative records (payroll tax filings) plus Census surveys; noise infusion for disclosure avoidance. Size classes by mid-March paid employment. 'Paid employment' includes salaried officers of corporations; excludes sole proprietors and partners of unincorporated businesses (glossary). The '<5' class includes establishments with no paid employees in mid-March that paid wages at some time in the year.
- How verified: Bulk file cbp23us.zip and cbp23st.zip downloaded in-browser from www2.census.gov and parsed; glossary read directly. Census API was not usable (now requires a key).
- Confidence: **A**
- Limitations: Establishment, not firm; employee count excludes unincorporated owners but includes incorporated owner-officers; data are 2023.
- URLs: https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23us.zip ; https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23st.zip ; https://www.census.gov/newsroom/press-releases/2025/2023-county-business-patterns.html ; https://www.census.gov/programs-surveys/cbp/about/glossary.html ; https://www.census.gov/programs-surveys/cbp/technical-documentation/methodology.html

### S02 2024 Nonemployer Statistics (NES)

- Requested as: U.S. Census 2024 Nonemployer Statistics
- Verification status: **verified**
- Publisher: U.S. Census Bureau
- Release date: 2026-09-29
- Data period: Tax year 2024
- Sample / universe: Businesses with no paid employees, subject to federal income tax, receipts of $1,000 or more ($1 or more for Construction). 2022 NAICS.
- Method: IRS administrative records (business income tax returns). Excludes government and nonprofits. Primary nonsampling error is improper inclusion of employer establishments. Census advises against time-series use. Geography by mailing address.
- How verified: Bulk files downloaded in-browser from www2.census.gov and parsed; tip sheet, methodology and NAICS code list read.
- Confidence: **A**
- Limitations: Includes side and part-time businesses (construction threshold is $1); construction detail stops at 4- or 5-digit NAICS, so no individual counts for roofing, painting, siding, concrete, drywall.
- URLs: https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2024/historical-datasets/nonemp24us.zip ; https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2024/historical-datasets/nonemp24st.zip ; https://www.census.gov/newsroom/press-releases/2026/2024-nonemployer-statistics.html ; https://www.census.gov/programs-surveys/nonemployer-statistics/technical-documentation/methodology.html ; https://www2.census.gov/programs-surveys/nonemployer-statistics/technical-documentation/code-lists/nes_naics22.txt

### S03 Data Bulletin: Small Establishments in Construction: Employment, Injuries, and Training

- Requested as: CPWR April 2026 Small Establishments in Construction report
- Verification status: **verified_with_internal_inconsistencies**
- Publisher: CPWR - The Center for Construction Research and Training (NIOSH cooperative agreement OH 012761); authors: Amber B. Trueblood, Derek Dufoe, Raina D. Brooks, William Harris
- Release date: 2026-04
- Data period: CBP 2014-2023, NES 2014-2023, CFOI 2011-2022, SOII 2024, QCEW 2024, Dodge/CPWR survey 2025
- Sample / universe: Small establishment = fewer than 20 employees (CPWR's construction convention; NIOSH uses 50).
- Method: Secondary analysis of federal datasets plus a 2025 Dodge/CPWR contractor survey.
- How verified: CDC Stacks record and 7-page PDF read via web fetch.
- Confidence: **B**
- Limitations: Abstract figures (2.7M workers; ~57% of fatalities; 78.1% nonemployer share in 2021) do not match body text (2.5M avg / 2.4M in 2023; ~50.5%); one payroll chart has conflicting labels. Use body figures only.
- URLs: https://stacks.cdc.gov/view/cdc/260010 ; https://stacks.cdc.gov/view/cdc/260010/cdc_260010_DS1.pdf

### S04 Median Revenue of NAHB Remodelers Grows 24% (NAHB blog) and NAHB Remodelers: What the Data Says (Eye On Housing, Eric Lynch)

- Requested as: NAHB September 2026 residential remodeler findings
- Verification status: **verified**
- Publisher: National Association of Home Builders
- Release date: 2026-09-28
- Data period: 2025 (NAHB 2025 Member Census)
- Sample / universe: NAHB Builder members; 21% list residential remodeling as primary business. Sample size and fielding dates not published.
- Method: Member census (self-reported).
- How verified: Both pages fetched; figures agree.
- Confidence: **D**
- Limitations: NAHB members are larger and more formal than the typical remodeler (median $2.1M revenue vs. Census nonemployer reality); n not stated; job-count buckets sum to 94%.
- URLs: https://www.nahb.org/blog/2026/09/residential-remodelers-nahb-census-data ; https://eyeonhousing.org/2026/09/nahb-remodelers-what-the-data-says/

### S05 Remodeling Market Sentiment Remains Stable in Third Quarter Despite Headwinds

- Requested as: (supplementary) NAHB Remodeling Market Index Q3 2026
- Verification status: **verified**
- Publisher: NAHB / Eye On Housing (Eric Lynch)
- Release date: 2026-10-08
- Data period: Q3 2026
- Sample / universe: NAHB remodeler members rating conditions good/fair/poor
- Method: Diffusion index 0-100; >50 means more 'good' than 'poor'.
- How verified: Page fetched; components reconcile.
- Confidence: **C**
- Limitations: Sentiment only; members only.
- URLs: https://eyeonhousing.org/2026/10/remodeling-market-sentiment-remains-stable-in-third-quarter-despite-headwinds/

### S06 How Small Construction Businesses Choose Software: Insights From 8,000+ Buyers

- Requested as: Software Advice 2026 construction software buyer research (part 1)
- Verification status: **verified**
- Publisher: Software Advice (Gartner Digital Markets); authors: Amita Jain
- Release date: 2026-03-16
- Data period: Jan 1, 2025 - Jan 1, 2026 (per companion article S07)
- Sample / universe: 8,205 advisor phone conversations with small and midsize construction businesses actively shopping for software; 55% had 10 or fewer employees.
- Method: Analysis of Software Advice advisor call records. Not a survey. Denominators for most percentages not stated. Publisher says findings may not be representative.
- How verified: Page fetched in full.
- Confidence: **D**
- Limitations: Active-shopper frame overstates software intent; two unreconciled budget figures ($150/user/month vs. $450/month).
- URLs: https://www.softwareadvice.com/resources/construction-software-buyer-insights/

### S07 Residential vs. Commercial Construction Software (2026 Guide)

- Requested as: Software Advice 2026 construction software buyer research (part 2)
- Verification status: **verified**
- Publisher: Software Advice; authors: Amita Jain
- Release date: 2026-04-02
- Data period: Jan 1, 2025 - Jan 1, 2026
- Sample / universe: n = 8,205 advisor conversations (same dataset as S06)
- Method: Advisor call records; rounded; may not be representative.
- How verified: Page fetched in full.
- Confidence: **D**
- Limitations: Same as S06; some figures labeled inconsistently (median vs. average).
- URLs: https://www.softwareadvice.com/resources/residential-vs-commercial-construction-software/

### S08 Blue Collar Strong: The 2026 Home Service Trends Report

- Requested as: Jobber 2026 Home Service Trends Report
- Verification status: **verified**
- Publisher: Jobber
- Release date: 2026 (no date on page; page modified 2026-03-25)
- Data period: Survey fielded December 2025
- Sample / universe: 1,050 U.S. home service business owners (cleaning, HVAC, roofing, plumbing, electrical, lawn care, tree care, general contracting); solo operators through established businesses. Whether respondents are Jobber customers is not stated.
- Method: Online survey via Conjointly; margin of error +/-3 points at 90% confidence; some benchmarks from anonymized Jobber platform data. Homeowners were not surveyed.
- How verified: Page fetched; methodology section and industry spotlights read directly in browser.
- Confidence: **C**
- Limitations: Vendor survey; owner-reported; customer-expectation figures have no homeowner sample; HVAC lead-response figure differs between body (11%) and spotlight (17%); per-trade n not given.
- URLs: https://www.getjobber.com/home-service-trends-report/

### S09 Jobber Home Service Economic Report: 2026 Q2

- Requested as: (supplementary) Jobber Home Service Economic Report 2026 Q2
- Verification status: **verified**
- Publisher: Jobber
- Release date: 2026-08
- Data period: Q2 2026
- Sample / universe: Jobber platform data (400,000+ professionals); YoY cohort of businesses on Jobber since Jan 2023
- Method: Platform transaction data plus cited macro sources
- How verified: Page fetched (page is marked noindex).
- Confidence: **D**
- Limitations: Jobber customers only; cohort size not given.
- URLs: https://www.getjobber.com/home-service-reports/august-2026/

### S10 RoofersCoffeeShop Releases 2024 Roofing Industry Trends Report (press release and podcast transcript)

- Requested as: RoofersCoffeeShop 2024 survey of 210 roofing-industry respondents
- Verification status: **partially_verified**
- Publisher: RoofersCoffeeShop (sponsor: Beacon Building Products)
- Release date: 2024-11-18 (EIN Presswire; RCS post dated 2024-12-09)
- Data period: Fielded May - September 2024
- Sample / universe: 210 respondents, roofing contractors and other industry members; mix not published; more owners than prior year's 50/50; about 24% under 10 employees (spoken in podcast).
- Method: Self-selected online survey; no weighting or questionnaire published.
- How verified: Press release and transcript fetched; full report is behind a lead form and was NOT read (no form submitted, per no-outreach rule).
- Confidence: **E**
- Limitations: Gated full report; no software/estimating-tool adoption figures were verifiable.
- URLs: https://www.rooferscoffeeshop.com/post/rooferscoffeeshop-releases-2024-roofing-industry-trends-report ; https://www.einpresswire.com/article/761619171/rooferscoffeeshop-releases-2024-roofing-industry-trends-report ; https://www.rooferscoffeeshop.com/post/whats-next-in-roofing-2024-trends-uncovered-podcast-transcript

### S11 Americans' Use of Social Media in 2026 (fact sheet) and 2026 NPORS topline

- Requested as: Pew Research Center 2026 social media demographic survey
- Verification status: **verified**
- Publisher: Pew Research Center
- Release date: 2026-10-19
- Data period: Jan 30 - June 18, 2026
- Sample / universe: National Public Opinion Reference Survey (NPORS), N = 5,511 U.S. adults; margin of error +/-1.8 points
- Method: Address-based probability sample; web, mail and phone. 'Ever use' each platform.
- How verified: Fact sheet demographic tables read directly in browser; topline read via fetch.
- Confidence: **B**
- Limitations: General adult population, not contractors; Pinterest not asked in 2026.
- URLs: https://www.pewresearch.org/internet/fact-sheet/social-media/ ; https://www.pewresearch.org/wp-content/uploads/sites/20/2026/10/PI_2026.10.19_NPORS-Internet-Fact-Sheets_TOPLINE.pdf

### S12 Americans' Social Media Use 2025

- Requested as: (supplementary) Pew Americans' Social Media Use 2025
- Verification status: **verified**
- Publisher: Pew Research Center (Jeffrey Gottfried, Eugenie Park)
- Release date: 2025-11-20
- Data period: Feb 5 - June 18, 2025
- Sample / universe: NPORS 2025, n = 5,022 U.S. adults
- Method: Address-based; web, mail, phone
- How verified: Fetched.
- Confidence: **B**
- Limitations: Prior-year; used only for daily-use figures.
- URLs: https://www.pewresearch.org/internet/2025/11/20/americans-social-media-use-2025/

### S13 Built2Bid application source code (jwstein2/Bid2Build)

- Requested as: (first-party) Built2Bid app repository: plans, prices, trade templates
- Verification status: **verified**
- Publisher: Built2Bid (first-party)
- Release date: commit 39104b5, 2026-11-23
- Data period: As of 2026-11-23
- Sample / universe: Price constants that the checkout server validates against Stripe; trade template catalog
- Method: Read-only inspection of source files; values copied into data/pricing.json
- How verified: Repository cloned read-only; constants read directly from the files listed
- Confidence: **A**
- Limitations: List prices only; actual plan mix, discounts and complimentary grants unknown. README annual price ($149) disagrees with code ($199).
- URLs: https://github.com/jwstein2/Bid2Build/blob/39104b51a3aacf9e928d89b29556d6bfc81fc87d/src/lib/billing/plans.ts ; https://github.com/jwstein2/Bid2Build/blob/39104b51a3aacf9e928d89b29556d6bfc81fc87d/src/lib/enterprise/pricing.ts ; https://github.com/jwstein2/Bid2Build/blob/39104b51a3aacf9e928d89b29556d6bfc81fc87d/src/lib/pm/billing.ts ; https://github.com/jwstein2/Bid2Build/blob/39104b51a3aacf9e928d89b29556d6bfc81fc87d/src/lib/financials/billing.ts ; https://github.com/jwstein2/Bid2Build/blob/39104b51a3aacf9e928d89b29556d6bfc81fc87d/src/lib/trades/data.ts ; https://github.com/jwstein2/Bid2Build/blob/39104b51a3aacf9e928d89b29556d6bfc81fc87d/README.md

### S14 docs/growth/README.md and docs/growth/ADS.md

- Requested as: (first-party) Built2Bid growth-engine docs: baseline and ad-copy rules
- Verification status: **verified**
- Publisher: Built2Bid (first-party)
- Release date: 2026-11-16 audit (commit 39104b5)
- Data period: Production baseline read 2026-11-16
- Sample / universe: Built2Bid production accounts not labeled test/internal
- Method: Owner-run read-only production audit recorded in repo docs
- How verified: Files read directly
- Confidence: **B**
- Limitations: Point-in-time snapshot; tiny base.
- URLs: https://github.com/jwstein2/Bid2Build/blob/39104b51a3aacf9e928d89b29556d6bfc81fc87d/docs/growth/README.md ; https://github.com/jwstein2/Bid2Build/blob/39104b51a3aacf9e928d89b29556d6bfc81fc87d/docs/growth/ADS.md

## Evidence table

| ID | Source | Metric | Value | Unit | Base | Period | Confidence | Note |
|---|---|---|---|---|---|---|---|---|
| E001 | S01 | NAICS 23 employer establishments | 814,557 [E001] | establishments | All U.S. construction establishments with paid employees | 2023 | A |  |
| E002 | S01 | NAICS 23 paid employees | 7,659,459 [E002] | employees | Paid employees week incl. March 12 | 2023 | A | Workers not buyers |
| E003 | S01 | NAICS 23 establishments <5 paid employees | 536,259 [E003] | establishments | NAICS 23 | 2023 | A | Includes estabs with 0 employees in March but payroll in year |
| E004 | S01 | NAICS 23 establishments 5-9 paid employees | 127,972 [E004] | establishments | NAICS 23 | 2023 | A |  |
| E005 | S01 | NAICS 23 establishments 10-19 paid employees | 75,854 [E005] | establishments | NAICS 23 | 2023 | A |  |
| E006 | S01 | Definition of paid employment | includes salaried officers of corporations; excludes sole proprietors and partners of unincorporated businesses [E006] | text | CBP | 2023 | A | Basis for owner-vs-worker distinction |
| E007 | S01 | Definition of <5 size class | includes establishments with no paid employees in mid-March pay period that paid wages at some time during year [E007] | text | CBP | 2023 | A |  |
| E008 | S01 | Establishment definition | single physical location; not necessarily identical with a company [E008] | text | CBP | 2023 | A |  |
| E010 | S02 | NAICS 23 nonemployer establishments | 3,042,704 [E010] | establishments | No paid employees; receipts >= $1 for construction | 2024 | A |  |
| E011 | S02 | NAICS 23 nonemployer receipts | 258,200,417 [E011] | USD thousands | NAICS 23 nonemployers | 2024 | A | = $258.2B |
| E012 | S02 | NAICS 23 nonemployers that are sole proprietorships | 2,727,891 [E012] | establishments | NAICS 23 nonemployers | 2024 | A |  |
| E013 | S02 | NAICS 23 nonemployers with receipts <$5K | 488,864 [E013] | establishments | NAICS 23 nonemployers | 2024 | A |  |
| E014 | S02 | NAICS 23 nonemployers with receipts $5K-9.9K | 323,394 [E014] | establishments | NAICS 23 nonemployers | 2024 | A |  |
| E015 | S02 | NAICS 23 nonemployers with receipts $10K-24.9K | 647,009 [E015] | establishments | NAICS 23 nonemployers | 2024 | A |  |
| E016 | S02 | NAICS 23 nonemployers with receipts $25K-49.9K | 544,803 [E016] | establishments | NAICS 23 nonemployers | 2024 | A |  |
| E017 | S02 | NAICS 23 nonemployers with receipts $50K+ | 1,038,633 [E017] | establishments | NAICS 23 nonemployers | 2024 | A | Sum of published size classes |
| E018 | S02 | NES coverage threshold | no paid employees; subject to federal income tax; receipts >= $1,000 ($1 or more for Construction) [E018] | text | NES | 2024 | A |  |
| E019 | S02 | NES construction NAICS granularity | 23; 236; 2361; 2362; 237...; 238; 2381; 2382; 23821; 23822; 23829; 2383; 2389 [E019] | text | NES | 2024 | A | No 6-digit trade detail |
| E020 | S02 | NES caution on time series | not recommended to analyze multiple years as a time series [E020] | text | NES | 2024 | A |  |
| E030 | S03 | Share of construction payroll establishments with <20 employees | 91 [E030] | percent | Payroll establishments NAICS 23 | 2014-2023 average | B |  |
| E031 | S03 | Share of payroll employees at establishments with <20 employees | 36.5 [E031] | percent | Payroll employees NAICS 23 | 2014-2023 average | B |  |
| E032 | S03 | Workers at establishments with <20 employees | 2.4 [E032] | million workers | NAICS 23 | 2023 | B | Abstract states 2.7M (inconsistent) |
| E033 | S03 | Workers at nonemployer establishments | 2.9 [E033] | million | NAICS 23 | 2023 | B | CPWR equates nonemployer establishments with workers |
| E034 | S03 | Nonemployer establishments growth | 20.8 [E034] | percent | NAICS 23 nonemployers 2.4M to 2.9M | 2014-2023 | B |  |
| E035 | S03 | Share of establishments <20 employees: Construction of Buildings (236) | 94.3 [E035] | percent | NAICS 236 payroll establishments | 2023 | B |  |
| E036 | S03 | Share of establishments <20 employees: Specialty Trade (238) | 90.2 [E036] | percent | NAICS 238 payroll establishments | 2023 | B |  |
| E037 | S03 | Share of establishments <20 employees: Heavy & Civil (237) | 76.9 [E037] | percent | NAICS 237 payroll establishments | 2023 | B |  |
| E038 | S03 | Small establishment definition | fewer than 20 employees [E038] | text | CPWR | 2026 | B |  |
| E039 | S03 | Firms 1-19 employees offering train-the-trainer | 58.9 [E039] | percent | Dodge/CPWR survey firms 1-19 | 2025 | B | vs 86.6% for 100+ |
| E040 | S03 | States with highest share of small establishments | MT 95.8%; VT 95.4%; ME 94.8% [E040] | text | Payroll establishments | 2023 | B |  |
| E050 | S04 | Share of NAHB Builder members whose primary business is residential remodeling | 21 [E050] | percent | NAHB Builder members | 2025 | D |  |
| E051 | S04 | Median employees of NAHB remodelers | 5 [E051] | employees | NAHB remodeler members | 2025 | D |  |
| E052 | S04 | Median annual revenue (dollar volume) of NAHB remodelers | 2.1 [E052] | USD millions | NAHB remodeler members | 2025 | D | Up from $1.7M in 2024 |
| E053 | S04 | NAHB remodelers with revenue under $500K | 23 [E053] | percent | NAHB remodeler members | 2025 | D |  |
| E054 | S04 | NAHB remodelers with revenue $1.0-4.9M | 52 [E054] | percent | NAHB remodeler members | 2025 | D |  |
| E055 | S04 | Median jobs of $10K+ completed (remodeling primary or secondary) | 8 [E055] | jobs per year | NAHB members doing remodeling | 2025 | D | Mean 19 |
| E056 | S04 | Median jobs of $10K+ completed (primary remodelers) | 12 [E056] | jobs per year | NAHB primary remodelers | 2025 | D | Mean 31 |
| E057 | S04 | Members completing 1-5 jobs of $10K+ | 37 [E057] | percent | NAHB members doing remodeling | 2025 | D | Buckets sum to 94% |
| E060 | S05 | Remodeling Market Index | 62 [E060] | index | NAHB remodelers | Q3 2026 | C |  |
| E061 | S05 | RMI small projects (<$20K) current conditions | 73 [E061] | index | NAHB remodelers | Q3 2026 | C |  |
| E062 | S05 | RMI leads and inquiries | 53 [E062] | index | NAHB remodelers | Q3 2026 | C |  |
| E070 | S06 | Advisor conversations analyzed | 8,205 [E070] | conversations | SMB construction software shoppers | Jan 2025-Jan 2026 | D |  |
| E071 | S06 | Share of conversations with businesses of 10 or fewer employees | 55 [E071] | percent | SA conversations | Jan 2025-Jan 2026 | D |  |
| E072 | S06 | Estimating requested | 72 [E072] | percent | SA conversations (base not stated) | Jan 2025-Jan 2026 | D | Most requested feature |
| E073 | S06 | Project management requested | 68 [E073] | percent | SA conversations | Jan 2025-Jan 2026 | D |  |
| E074 | S06 | Want estimating and PM in one platform (of those expressing preference) | 75 [E074] | percent | SA conversations expressing preference | Jan 2025-Jan 2026 | D |  |
| E075 | S06 | Currently use construction-specific software | 40 [E075] | percent (approx.) | SA conversations | Jan 2025-Jan 2026 | D | Categories not stated as exclusive |
| E076 | S06 | Currently use manual methods (pen-and-paper or spreadsheets) | 30 [E076] | percent (approx.) | SA conversations | Jan 2025-Jan 2026 | D |  |
| E077 | S06 | Top switching driver: efficiency | 48 [E077] | percent | SA conversations | Jan 2025-Jan 2026 | D |  |
| E078 | S06 | Switching driver: affordability | 7 [E078] | percent | SA conversations | Jan 2025-Jan 2026 | D |  |
| E079 | S06 | Buyers spending under $165/month | 39 [E079] | percent | SA conversations | Jan 2025-Jan 2026 | D |  |
| E080 | S06 | Buyers spending over $495/month | 30 [E080] | percent | SA conversations | Jan 2025-Jan 2026 | D |  |
| E081 | S06 | Average budget per user per month | 150 [E081] | USD | SA conversations | Jan 2025-Jan 2026 | D | Body also says $450/month average; unreconciled |
| E082 | S07 | Residential remodeler budget per user per month | 63 [E082] | USD (approx.) | SA residential remodeler conversations | Jan 2025-Jan 2026 | D | Lowest of any segment |
| E083 | S07 | Custom home builder budget per user per month | 88 [E083] | USD (approx.) | SA conversations | Jan 2025-Jan 2026 | D |  |
| E084 | S07 | General contractor budget per user per month | 150 [E084] | USD (approx.) | SA conversations | Jan 2025-Jan 2026 | D | Labeled median in one place |
| E085 | S07 | Specialty contractor budget per user per month | 150-157 [E085] | USD | SA conversations | Jan 2025-Jan 2026 | D |  |
| E086 | S07 | Residential buyers prioritizing estimating | 89 [E086] | percent | SA residential conversations | Jan 2025-Jan 2026 | D |  |
| E087 | S07 | Residential buyers relying on manual or paper methods | 35 [E087] | percent (nearly) | SA residential conversations | Jan 2025-Jan 2026 | D |  |
| E088 | S07 | Residential builders requesting customer management | 26 [E088] | percent | SA residential conversations | Jan 2025-Jan 2026 | D | vs 19% all segments |
| E089 | S07 | Conversation mix: residential segments | 31 [E089] | percent | SA conversations n=8205 | Jan 2025-Jan 2026 | D |  |
| E100 | S08 | Survey respondents | 1,050 [E100] | business owners | U.S. home service business owners | Dec 2025 | C |  |
| E101 | S08 | Owners using AI | 52 [E101] | percent | Respondents | Dec 2025 | C |  |
| E102 | S08 | AI adopters using AI to create estimates/quotes/contracts | 54 [E102] | percent | AI adopters | Dec 2025 | C |  |
| E103 | S08 | Quoting named as a biggest time drain | 37 [E103] | percent | Respondents | Dec 2025 | C |  |
| E104 | S08 | Admin/paperwork named as a biggest time drain | 31 [E104] | percent | Respondents | Dec 2025 | C |  |
| E105 | S08 | Jobsite management named as a biggest time drain | 48 [E105] | percent | Respondents | Dec 2025 | C |  |
| E106 | S08 | Lead source: referrals | 59 [E106] | percent | Respondents | Dec 2025 | C |  |
| E107 | S08 | Lead source: Facebook | 32 [E107] | percent | Respondents | Dec 2025 | C |  |
| E108 | S08 | Lead source: Google Search | 20 [E108] | percent | Respondents | Dec 2025 | C |  |
| E109 | S08 | Lead source: Instagram | 8 [E109] | percent | Respondents | Dec 2025 | C |  |
| E110 | S08 | Win more than 70% of quotes | 36 [E110] | percent | Respondents | Dec 2025 | C |  |
| E111 | S08 | Respond to leads within an hour | 20 [E111] | percent | Respondents | Dec 2025 | C |  |
| E112 | S08 | Offer tiered good/better/best pricing | 16 [E112] | percent | Pros (Jobber data/survey) | Dec 2025 | C |  |
| E113 | S08 | Raised prices last year | 65 [E113] | percent | Respondents | Dec 2025 | C |  |
| E114 | S08 | Roofing: use AI | 67 [E114] | percent | Roofing respondents | Dec 2025 | C | Per-trade n not stated |
| E115 | S08 | Roofing: share earning $500K+ | over half [E115] | text | Roofing respondents | Dec 2025 | C |  |
| E116 | S08 | HVAC: use AI | 81.5 [E116] | percent | HVAC respondents | Dec 2025 | C | Highest of any trade |
| E117 | S08 | HVAC: share earning $500K+ | over 60 [E117] | percent | HVAC respondents | Dec 2025 | C |  |
| E118 | S08 | Plumbing: use AI | 65 [E118] | percent | Plumbing respondents | Dec 2025 | C |  |
| E119 | S08 | Electrical: use AI | 64 [E119] | percent | Electrical respondents | Dec 2025 | C |  |
| E120 | S08 | General contracting: use AI | 57 [E120] | percent | GC respondents | Dec 2025 | C |  |
| E121 | S08 | General contracting: pricing confidence | 58 [E121] | percent | GC respondents | Dec 2025 | C |  |
| E122 | S08 | Cleaning: share earning under $50K | over 40 [E122] | percent | Cleaning respondents | Dec 2025 | C | Closest proxy for exterior cleaning |
| E123 | S08 | Cleaning: use AI | 50 [E123] | percent | Cleaning respondents | Dec 2025 | C |  |
| E124 | S08 | AI adopters among owners under 30 | 64 [E124] | percent | Owners under 30 | Dec 2025 | C |  |
| E125 | S08 | Digital gap: no FAQ section on site | 74 [E125] | percent | Respondents | Dec 2025 | C |  |
| E126 | S08 | Customer satisfaction factor: clear communication | 32 [E126] | percent | Respondents (source of customer view not stated) | Dec 2025 | C | Not a homeowner sample |
| E130 | S10 | Respondents | 210 [E130] | respondents | Roofing industry (contractors and others) | May-Sep 2024 | E |  |
| E131 | S10 | Not experiencing a labor shortage | 25 [E131] | percent | Respondents | May-Sep 2024 | E |  |
| E132 | S10 | Contractors using subcontracting crews | 57 [E132] | percent | Contractor respondents | May-Sep 2024 | E |  |
| E133 | S10 | Digital advertising as greatest marketing need | nearly 50 [E133] | percent | Respondents | May-Sep 2024 | E |  |
| E134 | S10 | Top business issues | recruitment and retention; training; material cost [E134] | text | Respondents | May-Sep 2024 | E |  |
| E140 | S11 | U.S. adults ever using YouTube | 84 [E140] | percent | U.S. adults | 2026 | B |  |
| E141 | S11 | U.S. adults ever using Facebook | 70 [E141] | percent | U.S. adults | 2026 | B |  |
| E142 | S11 | U.S. adults ever using Instagram | 51 [E142] | percent | U.S. adults | 2026 | B |  |
| E143 | S11 | U.S. adults ever using TikTok | 37 [E143] | percent | U.S. adults | 2026 | B |  |
| E144 | S11 | U.S. adults ever using LinkedIn | 31 [E144] | percent | U.S. adults | 2026 | B |  |
| E145 | S11 | U.S. adults ever using Nextdoor | 18 [E145] | percent | U.S. adults | 2026 | B |  |
| E146 | S11 | Facebook use ages 30-49 | 78 [E146] | percent | U.S. adults 30-49 | 2026 | B |  |
| E147 | S11 | Facebook use ages 50-64 | 71 [E147] | percent | U.S. adults 50-64 | 2026 | B |  |
| E148 | S11 | Facebook use among men | 63 [E148] | percent | U.S. men | 2026 | B |  |
| E149 | S11 | Facebook use among rural adults | 76 [E149] | percent | Rural adults | 2026 | B |  |
| E150 | S11 | YouTube use among men | 85 [E150] | percent | U.S. men | 2026 | B |  |
| E151 | S11 | Instagram use ages 30-49 | 64 [E151] | percent | U.S. adults 30-49 | 2026 | B |  |
| E152 | S11 | LinkedIn use among high school or less | 13 [E152] | percent | Adults HS or less | 2026 | B |  |
| E153 | S11 | Nextdoor use among suburban adults | 23 [E153] | percent | Suburban adults | 2026 | B |  |
| E154 | S11 | YouTube use ages 30-49 | 91 [E154] | percent | U.S. adults 30-49 | 2026 | B |  |
| E155 | S11 | TikTok use ages 30-49 | 45 [E155] | percent | U.S. adults 30-49 | 2026 | B |  |
| E156 | S11 | Facebook use among HS or less | 67 [E156] | percent | Adults HS or less | 2026 | B |  |
| E157 | S11 | YouTube use among HS or less | 77 [E157] | percent | Adults HS or less | 2026 | B |  |
| E158 | S11 | Survey sample | 5,511 [E158] | adults | NPORS 2026 | Jan 30-Jun 18 2026 | B | MOE +/-1.8 |
| E160 | S12 | Daily Facebook use ages 30-49 | 58 [E160] | percent | U.S. adults 30-49 | 2025 | B |  |
| E021 | S02 | Nonemployer establishments NAICS 2383 (building finishing) | 678,091 [E021] | establishments | NES | 2024 | A |  |
| E022 | S02 | Share of NAICS 56179 nonemployers with receipts under $25K | 63.6 [E022] | percent | NES 56179 nonemployers | 2024 | A | Arithmetic on published size classes |
| E127 | S08 | Roofing: saw significant demand increases | 28 [E127] | percent | Roofing respondents | Dec 2025 | C |  |
| E128 | S08 | Roofing: expect significant revenue growth next year | 32 [E128] | percent | Roofing respondents | Dec 2025 | C |  |
| E129 | S08 | Roofing: high-performing channels | YouTube; Local Services Ads; Google [E129] | text | Roofing respondents | Dec 2025 | C |  |
| E170 | S08 | Cleaning: respond to leads within an hour | 26 [E170] | percent | Cleaning respondents | Dec 2025 | C |  |
| E180 | S13 | Individual Unlimited monthly list price | 19.99 [E180] | USD per month | Built2Bid list price | 2026-11-23 | A | First-party |
| E181 | S13 | Individual Unlimited annual list price | 199 [E181] | USD per year | Built2Bid list price | 2026-11-23 | A | README says $149/yr (stale; G18) |
| E182 | S13 | Enterprise base price (includes 3 users) | 49.99 [E182] | USD per month | Built2Bid list price | 2026-11-23 | A |  |
| E183 | S13 | Enterprise seat price users 4-5 | 19.99 [E183] | USD per user per month | Built2Bid list price | 2026-11-23 | A | Users 6-10 $17.99; 11+ $15.99 |
| E184 | S13 | Project Command Center add-on (Standard) | 4.99 [E184] | USD per month | Built2Bid list price | 2026-11-23 | A |  |
| E185 | S13 | Solo Financials add-on | 21.99 [E185] | USD per month | Built2Bid list price | 2026-11-23 | A | $219.99/yr on annual plans |
| E186 | S13 | Enterprise seat price users 6-10 | 17.99 [E186] | USD per user per month | Built2Bid list price | 2026-11-23 | A |  |
| E187 | S13 | Trade estimate templates shipped | 42 [E187] | trade slugs | Built2Bid trade catalog | 2026-11-23 | A | Includes decks; pressure-washing; soft-washing; kitchens; bathrooms |
| E188 | S13 | Product positioning | Estimates and proposals for every trade [E188] | text | README | 2026-11-23 | A |  |
| E189 | S13 | Free plan | 3 starter credits + 1 monthly credit from month two; one credit per new finalized bid [E189] | text | README | 2026-11-23 | A |  |
| E190 | S14 | Paying accounts at production baseline | 0 [E190] | accounts | Production accounts not labeled test/internal | 2026-11-16 | B | 8 non-test accounts; 3 finalized a bid |
| E191 | S14 | Ad copy rule | No testimonials, ratings or results that haven't happened. No speed, profit, 'win more jobs' or percentage claims. [E191] | text | Built2Bid ad rules | 2026-11-16 | B | Persona messages rewritten to comply |
| E192 | S14 | Growth-engine priority trades | decks, general contracting, painting, roofing, concrete, kitchens, bathrooms, flooring, electrical, siding, drywall [E192] | text | Built2Bid owner spec | 2026-11-16 | B | Compare with Trade Priority Matrix |
