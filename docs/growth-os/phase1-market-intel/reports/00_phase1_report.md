# Phase 1 Report: Market Intelligence & Buyer Segmentation

Built2Bid Growth OS · Version 1.1.0 (2026-11-23) · Status: **complete, awaiting the owner's review**

## 1. What was implemented

- **Source verification.** All eight requested starting points were checked directly. The URLs, statistics, dates, sample definitions, methods and confidence ratings are in `data/sources.json` [S01] through [S12].
  - Seven were fully verified.
  - The CPWR bulletin was verified, but its abstract contains inconsistencies; only figures from the body text are used [G10].
  - RoofersCoffeeShop was partly verified because the full report is behind a lead form, and Phase 1 doesn't share contact details [G11].
- **Census data.** Unmodified extracts of CBP 2023 and NES 2024 (U.S. and state) are in `data/raw/`, with provenance notes.
- **Owner-versus-worker audience frame.** `data/derived/audience_frame_naics23.csv`:
  - Employer businesses: establishments with fewer than 20 paid employees, 740,085 [D001].
  - Viable solo operators at the base receipts floor: 1,583,437 [D005].
  - Workers (7,659,459 paid employees [E002]) are kept separate and never counted as buyers.
- **Segment sizing** for 22 trade segments, including every trade requested (`data/derived/segment_sizing.csv`).
- **Trade Priority Matrix** with seven weighted dimensions, the basis for every score, and a sensitivity view that leaves out audience size (`data/derived/trade_priority_matrix.csv`).
- **Seven buyer personas** (`data/personas.json`). Each covers all eight requested fields and keeps cited evidence separate from inference.
- **Versioned TAM/SAM/SOM scenario model v1.0.0**: low, base and high scenarios driven by `data/assumptions.json` (`data/derived/market_model_v1.json`).
- **State geography table** (`data/derived/geography_by_state.csv`).
- **Gaps register** with 17 entries (`data/gaps.csv`) [PARAM: count of rows].
- **Six readable reports** (01-06) plus this phase report. Reports 02-06 are generated from the data, so their numbers are never hand-typed.
- **v1.1.0 update: real pricing.** Built2Bid's plans and list prices were read (read-only) from the app code into `data/pricing.json` [S13]: Free credits [E189], Individual Unlimited $19.99/month [E180] or $199/year [E181], Enterprise $49.99/month with 3 users included [E182], and add-ons: Project Command Center $4.99/month [E184] and Solo Financials $21.99/month [E185]. These replace the v1.0.0 placeholders in the model and personas. ARPA is now computed from these prices, and only the plan mix is assumed [A07].
- **Existing implementations reviewed before adding anything** (standing rule): `docs/growth/` (growth engine, activation, ad rules), `docs/MARKET-INTELLIGENCE.md` (admin pricing benchmarks from opted-in bids) and `src/lib/trades/data.ts` (42 trade templates [E187]). This research does not duplicate them. Persona messages were rewritten to follow the existing ad rules [E191] [G19].
- **A deterministic rebuild pipeline** (`scripts/build.py`, `scripts/render_reports.py`). It makes no network or AI calls.

## 2. Tests run and results

Command: `python3 -m pytest tests -q`, run in the phase folder with Python 3.13 and pytest 9.1. **Result inside the repo branch: 19 passed, 0 failed.** In the shared project-folder copy the result is 18 passed and 1 skipped, because the app source isn't there to compare prices against.

| Test | What it proves | Result |
|---|---|---|
| test_all_requested_sources_present_and_verified | Every requested source has URL, date, sample, method, confidence, verification note | Pass |
| test_partial_verification_is_documented_as_gap | Partially verified sources (CPWR, RCS) appear in the gaps report | Pass |
| test_evidence_rows_resolve_to_sources | Every evidence row cites a registered source | Pass |
| test_census_reconciliation_checks_pass | CBP 6-digit rows sum to the NAICS 23 total; NES subsectors, receipt classes and states sum to U.S. totals | Pass |
| test_build_is_deterministic | Re-running the pipeline reproduces byte-identical outputs | Pass |
| test_audience_units_never_use_employee_counts | Audience = employer establishments <20 + viable solos; never employees | Pass |
| test_model_unit_is_business_not_worker | Model TAM employer units equal the Census establishment counts | Pass |
| test_employer_proxy_definition_cites_census_owner_exclusion | The 1-20 proxy rests on Census's owner exclusion [E006] | Pass |
| test_shared_codes_not_double_counted | Plumbing/HVAC and pressure/soft washing counted once | Pass |
| test_funnel_narrows_and_propensity_below_one | SOM < SAM < TAM; software propensity below 100% in every scenario | Pass |
| test_every_assumption_labeled | Every assumption has a description and basis; model labeled SCENARIO | Pass |
| test_at_least_five_complete_personas | At least five personas, all eight fields, every cited id exists | Pass |
| test_requested_segments_scored | All 13 named trades are scored | Pass |
| test_every_tag_resolves | Every bracketed tag in every report points to a real row | Pass |
| test_tagged_numbers_match_source_values | The number next to each tag equals the value in its source row | Pass |
| test_every_number_in_reports_is_traceable | No report line has a statistic without a tag | Pass |
| test_arpa_uses_real_list_prices | Model ARPA equals the prices in data/pricing.json; no placeholders left | Pass |
| test_pricing_matches_app_source_when_in_repo | data/pricing.json matches src/lib/billing/plans.ts and src/lib/enterprise/pricing.ts | Pass in repo (skipped outside it) |
| test_persona_messages_follow_house_ad_rules | No speed, profit, 'win more' or percentage claims in persona messages | Pass |

**Mutation check.** I added an untagged number and a mis-tagged number to report 01 in a scratch copy. Both traceability tests failed as expected, which shows the checks catch real errors.

## 3. Files and systems changed

- **Created:** `/mnt/project-files/growth-os/phase1-market-intel/` (data, derived tables, reports, scripts, tests), and the same files at `docs/growth-os/phase1-market-intel/` on branch `growth-os/phase1-market-intel` in the app repository (new files only, inside `docs/`).
- **Project memory:** a note pointing future threads to this folder and its rules.
- **Not touched:** app code, the main branch, the Built2Bid production app, customer data, ad accounts, email or CRM tools, and any connectors (MailerLite, Stripe, Supabase and others were not called).
- **Census access:** public bulk files were read through a browser session, because the cloud environment blocks census.gov and the Census API now requires a key.
- **Repository:** committed to a feature branch with a draft pull request; nothing is merged.

## 4. Permissions and credentials still needed

| Need | Why | Priority |
|---|---|---|
| Confirm the annual Unlimited price ($199 in code vs $149 in README) | Annual ARPA and public copy [G18] | Medium |
| Customer and trial data once there are paying accounts (0 at the 2026-11-16 baseline [E190]) | Calibrates plan mix [A07], fit [A04], propensity [A05] and obtainable share [A06] | High |
| Authorization (later phase) for customer interviews | Validates personas [G08] | Medium |
| Optional: the owner downloads the RoofersCoffeeShop 2024 report | Closes [G11] without Claude submitting a form | Low |
| Optional: free Census API key | Simplifies refreshes; not required | Low |

## 5. Risks and unresolved issues

- **SAM and SOM are low-confidence scenarios.** No representative source measures paid-software adoption among contractors with 1 to 20 people [G03].
- **Solo counts by trade are allocated estimates.** This applies to most individual trades [G02].
- **Five of seven matrix dimensions are judgment.** Rankings are sensitive to the estimate-intensity weight [G07] and to competitive scores that weren't researched [G09].
- **Personas aren't validated with real customers** [G08].
- **Plan mix is unobserved.** Prices are real, but with no paying accounts yet the split between Individual and Enterprise, and add-on attach rates, are assumptions [A07] [G01].
- **Census vintages differ.** CBP is 2023 and NES is 2024, a small mismatch [G15].

## 6. Operating cost implications

- **Data:** $0. All sources are public, and no paid data was purchased.
- **Rebuild:** local Python only. No API or AI calls, and it runs in seconds.
- **Refresh cadence:** annual. CBP 2024 and NES 2025 releases will need a re-extract, about one agent session.
- **Phase 2 options that could cost money** (none committed):
  - A Census custom tabulation or a licensed contractor panel to close [G03].
  - A business-listings data provider to separate plumbing from HVAC and to count deck builders [G06].
  - These need the owner's approval before any spend.

## 7. Acceptance criteria

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| AC1 | All numerical claims trace to sources or are explicitly labeled scenarios | **Pass** | Traceability tests 14-16 |
| AC2 | Owner-versus-worker audience distinction preserved | **Pass** | Tests 6-8; report 01 section 2 |
| AC3 | Every named source verified directly, with URLs, original statistics, dates, sample, method and confidence retained | **Pass, with documented limits** | Report 03; CPWR inconsistencies [G10] and gated RCS report [G11] are disclosed, not papered over |
| AC4 | Requested segments plus other small trades researched and scored on the nine requested attributes | **Pass** | Report 01 section 4; report 02. Estimate frequency and competition are judgment-based [G07] [G09] |
| AC5 | At least five evidence-backed personas with all eight requested fields | **Pass** (seven) | Report 04; test 12 |
| AC6 | Versioned TAM/SAM/SOM; no fabricated counts; not all businesses assumed to buy software | **Pass** | Report 05; tests 9-11 |
| AC7 | Structured, machine-readable tables for future agents | **Pass** | `data/` CSV/JSON plus README rules |
| AC8 | All six deliverables produced | **Pass** | Reports 01-06 |
| AC9 | No marketing launched, no agents built, no purchases or outreach | **Pass** | Section 3 |
| AC10 | Work committed to a separate feature branch | **Pass** | Branch `growth-os/phase1-market-intel`, draft PR; app code and main untouched |

**Phase gate.** All acceptance criteria pass, including the critical ones (AC1, AC2, AC6). Phase 2 has not started and waits for the owner's go-ahead.
