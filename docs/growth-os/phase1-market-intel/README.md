# Built2Bid Growth OS: Phase 1 Market Intelligence

Research-backed contractor market intelligence for Built2Bid. The audience is U.S. construction businesses with 1 to 20 total people including the owner. The material is built so future agents can read the tables directly.

Nothing in this folder launches marketing, contacts anyone or spends money. It does not change app code.

## Start here

| Need | File |
|---|---|
| Phase report (what was done, test results, acceptance criteria) | `reports/00_phase1_report.md` |
| Narrative findings | `reports/01_contractor_market_intelligence_report.md` |
| Trade ranking | `reports/02_trade_priority_matrix.md` and `data/derived/trade_priority_matrix.csv` |
| Every source and statistic | `reports/03_evidence_and_source_registry.md`, `data/sources.json`, `data/evidence.csv` |
| Personas | `reports/04_buyer_persona_database.md` and `data/personas.json` |
| TAM / SAM / SOM | `reports/05_addressable_market_scenario_model.md`, `data/derived/market_model_v1.json`, `data/derived/market_model_v1_segments.csv`, `data/assumptions.json` |
| Confidence and gaps | `reports/06_research_confidence_and_gaps.md` and `data/gaps.csv` |

## Rules for agents using this data

1. **Owners, not workers.** Audience counts are business units. Never use `emp`, `paid_employees_all_sizes` or CPWR worker counts as a count of buyers.
2. **Check the claim type before you quote.** In `data/evidence.csv`, `verified_fact` and `derived_fact` rows can be quoted with their source. Anything from `data/assumptions.json` or the SAM, SOM and dollar fields of the market model is a **scenario** and must be labeled that way.
3. **Solo counts for individual trades are estimates.** In `segment_sizing.csv`, rows whose `method_note` says ESTIMATE come from rule A03.
4. **Pricing.** ARPA comes from Built2Bid's real list prices in `data/pricing.json` (copied read-only from the app code); only the plan mix is a scenario (A07). If app prices change, update `data/pricing.json` and rebuild; a test compares it with the app source when this folder sits inside the repo.
5. **Shared codes.** Plumbing and HVAC share NAICS 238220. Pressure washing and soft washing share NAICS 561790. Decks have no code.
6. **Messaging rules.** Follow `docs/growth/ADS.md`: no speed, profit, 'win more jobs' or percentage claims.

## Tag legend used in reports

`[E###]` evidence row · `[D###]` audience-frame calculation (`data/derived/audience_frame_naics23.csv`) · `[T:SEG.field]` segment sizing or matrix field · `[T:geo.ST.field]` state table · `[M:scenario.field]` market-model total · `[A##]` scenario assumption · `[S##]` source · `[G##]` gap · `[INF]` analyst inference · `[PARAM]` analyst-set parameter.

## Rebuild and test

```bash
python3 scripts/build.py           # Census extracts -> derived tables (no network, no AI)
python3 scripts/render_reports.py  # derived tables -> reports 02-06
python3 -m pytest tests -q         # acceptance tests
```

To create a new model version, copy and edit `data/assumptions.json`, bump `model_version`, and rerun the three commands above.

## Folder layout

```
data/raw/        Unmodified Census extracts + provenance README
data/            sources.json, evidence.csv, assumptions.json, segments.json, personas.json, gaps.csv
data/derived/    audience_frame_naics23.csv, segment_sizing.csv, trade_priority_matrix.csv,
                 market_model_v1.json, market_model_v1_segments.csv, geography_by_state.csv,
                 reconciliation_checks.json
reports/         00-06 readable reports (02-06 are generated)
scripts/         build.py, render_reports.py
tests/           test_phase1.py
```
