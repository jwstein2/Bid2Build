# Built2Bid Growth OS: Phase 2 Channel Opportunity & Advertising Allocation

Where Built2Bid should put paid and organic marketing effort, built on the Phase 1 market research in `../phase1-market-intel/`.

Nothing in this folder launches a campaign, buys anything, contacts anyone or changes app code. Every paid line is a proposal that still needs the measurement gate (experiment X00) and the owner approval table in `docs/growth/ADS.md`.

## Start here

| Need | File |
|---|---|
| Phase report (what was done, tests, acceptance criteria) | `reports/00_phase2_report.md` |
| Channel Opportunity Matrix | `reports/01_channel_opportunity_matrix.md`, `data/derived/channel_opportunity_matrix.csv` |
| Platform-Specific Audience Profiles | `reports/02_platform_audience_profiles.md`, `data/channels.json` |
| Five Budget Scenarios ($300 to $5,000) | `reports/03_budget_scenarios.md`, `data/derived/budget_scenarios.json` / `.csv` |
| Organic Distribution Strategy | `reports/04_organic_distribution_strategy.md`, `data/derived/organic_allocation.csv` |
| CAC and LTV Model | `reports/05_cac_ltv_model.md`, `data/derived/unit_economics.csv`, `ltv.json`, `breakeven.csv` |
| 30/60/90-Day Experiment Plan | `reports/06_experiment_plan.md`, `data/experiments.json` |
| Sources, evidence, gaps | `data/sources.json`, `data/evidence.csv`, `data/gaps.csv` |

## Rules for agents using this data

1. **Benchmarks are not contractor statistics.** `data/evidence.csv` rows describe other advertisers (WordStream/LocaliQ), other software companies (ChartMogul) or U.S. adults (Pew, via Phase 1). Quote them with their population.
2. **Every funnel number is a scenario.** `data/assumptions.json` (F01-F11) drives CAC, LTV and budget outcomes. Replace values with observed Built2Bid data as experiments finish, bump `model_version`, rebuild.
3. **Analyst parameters are separate.** Weights, gates, caps and channel limits live in `data/model_rules.json`.
4. **Adoption is never a weight.** The opportunity model scores audience quality, intent, CAC, content cost, measurability, competition and evidence.
5. **Copy rules.** Any content follows `docs/growth/ADS.md`: no testimonials or results that have not happened, and no speed, profit, "win more jobs" or percentage claims.
6. **No outreach, sends or spend** without the owner's written approval (standing rules).

## Tag legend used in reports

`[CE###]` Phase 2 evidence · `[P1:E###]` Phase 1 evidence · `[C##]` Phase 2 source · `[P1:S##]` Phase 1 source · `[F##]` scenario assumption · `[G2##]` gap · `[X##]` experiment · `[M]` model output · `[PARAM]` analyst parameter · `[INF]` analyst inference.

## Rebuild and test

```bash
python3 scripts/build.py           # data -> data/derived (no network, no AI)
python3 scripts/render_reports.py  # data/derived -> reports 01-06
python3 -m pytest tests -q         # acceptance tests (needs ../phase1-market-intel)
```
