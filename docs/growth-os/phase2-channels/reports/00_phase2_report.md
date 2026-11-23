# Phase 2 Report: Channel Opportunity & Advertising Allocation

Built2Bid Growth OS · Version 2.0.0 (2026-11-23) · Status: **complete, awaiting the owner's review**

## Recommendation in brief

- **Month 1: $0 paid.** Run the free experiments first: the measurement gate [X00], a Keyword Planner forecast [X01], reach estimates [X02], an organic landing-page baseline [X03] and lifecycle emails on [X04].
- **Months 2-3: a $300 to $500/month Google Search test,** only if X00 passes and the owner signs the ADS.md approval table. Search has the strongest purchase intent and measurement path of the paid channels [M].
- **Hold $1,000+ until search results are in.** At base assumptions no paid channel pays back: base CAC is $3,261 for search and $1,467 for Meta against a base LTV of $298 [M]. Budgets above $500 buy more learning, not profitable growth, until real conversion data replaces the assumptions [X10].
- **Put most effort into organic and activation.** Search content, how-to video, communities and lifecycle email cost owner time, not media money. Improving activation [F04] and paid conversion [F06] lowers CAC on every channel at once [INF].
- **LinkedIn and TikTok get $0 paid** in every scenario. Both fail the measurability and score gates (report 01) [PARAM].

## 1. What was implemented

- **Prior work reviewed before building** (standing rule): Phase 1 reports, data and tests; `docs/growth/README.md`, `ADS.md` (existing $600 draft plan, stop/scale rules, copy rules, UTM standard), `EVENTS.md`, `META_GA4_SETUP.md` and `ACTIVATION.md` [P1:S14]. Phase 2 reuses those definitions (7-day activation, UTM tags, approval gate) and does not replace them.
- **New source research.** 14 sources read directly on 2026-11-23 (`data/sources.json` [C01] to [C14]) and 48 evidence rows (`data/evidence.csv`) [PARAM: count of rows]: search and Meta ad benchmarks, LinkedIn and TikTok budget rules, Meta targeting changes, YouTube billing rules, SaaS conversion benchmarks, CAN-SPAM and email benchmarks. Phase 1 Pew and Jobber evidence is reused by reference.
- **Nine channels profiled** (`data/channels.json`): Google Search, Facebook, Instagram, YouTube, TikTok, LinkedIn, email, contractor communities and partnerships. Each keeps the six audience layers separate and covers intent, formats, targeting, audience verification, organic opportunities, costs and restrictions.
- **Weighted opportunity model** on the seven requested dimensions, with paid-spend gates (`data/model_rules.json`) [PARAM]. Expected CAC is computed from the funnel model for paid channels.
- **Unit economics:** CAC by channel and scenario, LTV with a 36-month cap, contribution margin, and a break-even table [M].
- **Deterministic budget allocator** for $300, $500, $1,000, $2,500 and $5,000 per month, with minimum viable tests, channel limits, caps and a reserve [PARAM].
- **Organic time allocation** for 5, 10 and 20 hours a week, separate from paid spend [PARAM].
- **12 experiments** over 30/60/90 days (`data/experiments.json`), each tied to the assumptions it replaces [PARAM: count of rows].
- **Pipeline:** `scripts/build.py` and `scripts/render_reports.py` (no network or AI calls); reports 01-06 are generated, so no number is hand-typed.

## 2. Tests run and results

Command: `python3 -m pytest tests -q` in the phase folder (Python 3, pytest). **Result: 20 passed, 0 failed.** Phase 1 tests still pass (19 passed) [PARAM: test counts].

| Test | What it proves | Result |
|---|---|---|
| test_sources_complete | Every source has URL, date, sample, method, confidence, limits | Pass |
| test_evidence_rows_resolve_and_are_facts | Evidence rows cite registered sources | Pass |
| test_every_tag_resolves_in_reports_and_channel_data | Every tag in reports and channel data points to a real row | Pass |
| test_every_number_line_is_tagged | No report line has a percent or dollar figure without a tag | Pass |
| test_tagged_evidence_numbers_match | A number stated before an evidence tag equals that evidence value | Pass |
| test_no_percentage_presented_as_contractor_statistic | Cited percentages name their population (adults, surveyed owners, advertisers, software products) | Pass |
| test_all_requested_channels_present_with_layers_and_profiles | All nine channels, six layers and seven profile attributes | Pass |
| test_weights_cover_required_dimensions_and_exclude_adoption | Weights are the seven requested dimensions, sum to 1, and contain no adoption term | Pass |
| test_every_score_has_basis | Every score has a written basis | Pass |
| test_assumptions_needing_experiments_map_to_plan | CPC, CTR, landing conversion, activation, paid conversion and retention are flagged and mapped to experiments | Pass |
| test_experiment_plan_covers_30_60_90 | Plan covers days 1-30, 31-60 and 61-90 | Pass |
| test_five_budget_scenarios | Exactly the five requested budgets | Pass |
| test_allocations_sum_within_budget_and_respect_caps_and_minimums | Lines plus reserve equal the budget; caps, minimums and channel limits hold | Pass |
| test_gated_channels_get_zero_paid_and_small_budgets_concentrate | LinkedIn and TikTok get $0 paid; the two smallest budgets fund one channel [PARAM] | Pass |
| test_spend_not_proportional_to_adoption | YouTube, the platform with the most adult users [P1:E140], never gets the largest share | Pass |
| test_every_budget_line_has_assumptions_evidence_outcome_uncertainty_validation | Each budget line has the five required elements | Pass |
| test_ltv_uses_phase1_arpa | LTV uses Phase 1 ARPA from real list prices | Pass |
| test_organic_plan_covers_every_channel_and_sums_to_100 | Organic plan covers all channels; shares total 100 [PARAM] | Pass |
| test_copy_follows_house_ad_rules | No banned claims in organic plan and channel content | Pass |
| test_build_is_deterministic | Rebuild reproduces byte-identical outputs | Pass |

**Mutation check.** In a scratch copy, adding an untagged dollar figure to report 03 and changing a cited benchmark value in report 02 each made a traceability test fail, so the checks catch real errors.

## 3. Files and systems changed

- **Created:** `docs/growth-os/phase2-channels/` on a new feature branch based on the Phase 1 branch (data, derived tables, reports, scripts, tests). New files only, inside `docs/`. The same folder is copied to the project's shared files.
- **Not changed:** app code, `docs/growth/ADS.md` and other existing growth docs, Phase 1 files, the main branch, production, customer data, ad accounts, email tools and connectors (none were called).
- **Project memory:** a note pointing future phases to this folder.

## 4. Permissions and credentials still needed

| Need | Why | Priority |
|---|---|---|
| Owner completes the GA4 key-event and Google Ads link steps, and Meta privacy text, SQL, dataset, token and test event (META_GA4_SETUP.md) | Measurement gate [X00]; no paid test without it | High |
| A Google Ads account for Keyword Planner (free; no campaign) | Replace search CPC and volume assumptions [X01] [G202] | High |
| Owner reads reach estimates in Meta Ads Manager and Google Ads drafts | Reachable-audience layer [X02] | Medium |
| Approval to turn on lifecycle emails | Activation experiment [X04] | Medium |
| Written approval of any monthly ad budget, creatives and the ADS.md gate table | Standing rule on spend | Required before any spend |
| Approval of any creator or partner outreach and fees | Standing rule on outreach and purchases [X08] | Required before outreach |
| List of contractor groups the owner already belongs to | Community plan [G205] | Low |

## 5. Risks and unresolved issues

- **Base case does not pay back.** Base LTV is $298 against base CACs above $1,000 on every paid channel [M]. Only the optimistic case brings Meta ($222), YouTube ($198) and partner ($111) CAC under the 10-month payback limit of $372; optimistic search CAC ($444) stays above it [M]. Nothing supports the optimistic case yet [G207].
- **Small samples.** At $300 to $500 a month, 90 days gives roughly 150 to 260 search clicks: enough to read landing conversion within about ±3 points, not paid conversion [M].
- **Benchmarks are borrowed.** CPC and conversion anchors come from other advertisers and software companies with higher prices [C01] [C03] [C09].
- **Measurement is not live.** Google Ads conversion import and Meta CAPI are built or documented but not switched on [G208].
- **Meta targeting keeps narrowing** [CE030] [CE031]; contractor-only audiences cannot be bought, so the landing page and activation metric must do the filtering.
- **Judgment scores.** Audience quality, intent and competitive pressure are judgment; competitor ad activity was not researched [G203].
- **Open from Phase 1:** annual price in the README ($149) differs from the code ($199) [P1:E181].

## 6. Operating cost implications

- **This phase:** $0 media and data spend [PARAM]. Rebuild is local Python only, in seconds.
- **Paid scenarios** (none committed): $300, $500, $1,000, $2,500 or $5,000 per month, as chosen by the owner [PARAM].
- **Owner time:** 5, 10 or 20 hours a week for organic work (report 04) [PARAM].
- **Creative:** reuse existing footage first; any new AI video credits need approval (ADS.md).
- **Creator deals:** about $500 per pilot in the $2,500+ scenarios (assumption) [F01].

## 7. Acceptance criteria

| ID | Criterion | Result | Evidence |
|---|---|---|---|
| AC1 | Channel Opportunity Matrix covering every requested channel | **Pass** | Report 01; matrix CSV |
| AC2 | Platform profiles: audience, intent, formats, targeting, verification, organic, costs, restrictions | **Pass** | Report 02; profile test |
| AC3 | Adoption layers kept separate (total, construction, owner, reachable, qualified leads, conversion) | **Pass, with documented gaps** | Report 02. Construction adoption has no source [G201]; reachable audience needs ad-tool access [G202] |
| AC4 | Dollars never distributed in proportion to adoption | **Pass** | Weights exclude adoption; YouTube test |
| AC5 | Transparent weighted model on the seven requested dimensions | **Pass** | Report 01; `model_rules.json` |
| AC6 | Five budget scenarios ($300 to $5,000) [PARAM] | **Pass** | Report 03 |
| AC7 | Limited budgets concentrated where evidence and measurement are strongest; zero paid allowed | **Pass** | One channel at the two smallest budgets; LinkedIn and TikTok at $0 paid [M] |
| AC8 | Separate organic allocation plan | **Pass** | Report 04 |
| AC9 | Baseline CTR, CPC, landing conversion, activation, paid conversion, retention and contribution margin, with experiment flags | **Pass** | Report 05; assumptions test |
| AC10 | CAC and LTV model | **Pass** | Report 05 |
| AC11 | 30/60/90-day experiment plan | **Pass** | Report 06 |
| AC12 | Every budget recommendation has assumptions, evidence, expected outcomes, uncertainty and a validation method | **Pass, with one disclosed limit** | Report 03 tables; the creator-partner line has no external evidence, stated as inference [G206] |
| AC13 | No unsupported percentage presented as a contractor fact | **Pass** | Population-label and traceability tests |
| AC14 | No ads launched, nothing purchased, no outreach; separate feature branch; no app code changes | **Pass** | Section 3 |

**Phase gate.** All criteria pass, including the critical ones (AC4, AC12, AC13). Phase 3 (measurement infrastructure) has not started and waits for the owner's go-ahead. Phase 3 is also where the X00 measurement gate would be finished.
