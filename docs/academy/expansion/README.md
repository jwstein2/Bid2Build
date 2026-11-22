# Academy expansion: code library and contractor education

This folder tracks the Academy expansion (codebook search, contractor education, study tools). It is an incremental
change to the live Academy, delivered in separate PRs, each behind a switch that is off until an Academy admin turns it on.

## Phase 0 audit (what already existed and is reused)

| Need | Reused |
|---|---|
| Academy shell, tabs, roles, audit log, Manage area | `src/app/(marketing)/academy/**`, `academy_role()`, `academy_has_role()`, `academy_audit_log`, `requireAcademyStaff()` |
| Security model | No client write grants on Academy tables; staff writes with the service role after a role check; learner writes through `SECURITY DEFINER` RPCs |
| ZIP → state | `src/lib/market/geo` (`cleanZip`, `resolveGeo`, `US_STATES`) |
| Account location and trade | `business_profiles.address` / `primary_trade`, `fin_business_config.primary_trade_slug`, `academy_members.primary_trade`, `parseUsAddress`, `tradeSlugFrom` |
| Canonical trades | `src/lib/trades/data.ts` (42 trades). Not in the catalog yet: welding, junk removal, separate residential vs commercial building. Reported, not added. |
| AI cost controls | `src/lib/ai/guard.ts` (daily budget, free quota), `provider.ts` (Haiku), `logAiGeneration`. The code library makes **no AI calls** in this phase; `ai_generations` kind `academy_code_explain` is registered for a later, opt-in grounded explanation (`academy_settings.kb_ai_explain`, off). |
| Scheduled jobs | Netlify scheduled function → `/api/cron/...` with the `EMAIL_OUTBOX_SECRET` bearer |
| Wage data for the trade comparison (later phase) | BLS OEWS May 2025 in `src/lib/ai-draft/labor-rates.ts` |
| Quiz UI (later phase) | `src/components/academy/quiz.tsx` |

## PR 1: knowledge engine + code search (this PR)

| Area | Path |
|---|---|
| Schema, RLS, RPCs, private bucket | `supabase/migrations/20270220001000_academy_knowledge.sql` |
| Seed (generated, do not hand-edit) | `supabase/migrations/20270220002000_academy_knowledge_seed.sql` ← `npx tsx scripts/academy/kb/gen-seed.ts` |
| Official-source snapshot | `src/lib/academy/kb/seed/official-snapshot.json` ← `python3 scripts/academy/kb/fetch_official.py` |
| Curated catalog (families, sources, adoptions, summaries, terms) | `src/lib/academy/kb/seed/catalog.ts` |
| Rollback | `docs/academy/rollback_20270220001000.sql` (tested) |
| Read layer | `src/lib/academy/kb/server.ts` |
| Pure logic | `src/lib/academy/kb/{types,location,answer,monitor}.ts` |
| Pages | `/academy/codes`, `/academy/codes/section/[id]`, `/academy/codes/coverage`, `/academy/manage/codes` |
| Monitoring | `netlify/functions/academy-kb-cron.mts` → `src/app/api/cron/academy-kb/route.ts` |
| Tests | `tests/academy-knowledge.test.ts` (17), `tests/db/academy-knowledge.test.ts` (23) |

### Switches

- `academy_settings.kb_enabled` (default **off**): the Codes tab and pages are visible to Academy staff only until an admin clicks **Turn on for everyone** in Manage → Codes.
- `academy_settings.kb_ai_explain` (default **off**, not used yet).
- `ACADEMY_KB_MONITOR=false` (Netlify env) pauses source monitoring.

### Rules the code enforces

- **Verified only through `academy_kb_verify()`**, by an Academy admin or the service role, with the official https link and quoted evidence (a trigger refuses any other path).
- **Usage rights**: full text only for public-domain or government-edict sources; excerpts only where allowed; copyrighted model codes (IRC, IBC, NEC...) are stored as section number + title + link to the publisher's free read-only copy, and only after their titles are verified.
- **Never invented**: page numbers are null unless verified for that exact edition; no effective date, amendment or section is generated.
- **Applicability comes from documented adoptions**, not a model: Verified Applicable / Jurisdiction Confirmation Needed / Source Review Needed / Different Edition Adopted / Superseded / Unavailable.
- **Quick Answer** only from a verified section that matched on section number or approved terminology and applies where the visitor is. Otherwise the page shows: "Unable to verify the applicable requirement from the available official sources. Confirm with your local building department or authority having jurisdiction."
- **A ZIP suggests a state, never the permitting authority.** The state can be changed. A local authority is only set when the user picks a verified one.
- **Changes invalidate dependents**: editing or superseding a section/source/adoption flags study items that cite it, clears cached answers and opens a review item.
- **Anonymous search trends** only (no user id, emails/phones/addresses scrubbed).
- **Monitoring never edits content**: eCFR sections are checked on the eCFR versioner's amendment dates, Minnesota rules on the rule text; a change or dead link opens a review item. The first fingerprint is a baseline, not a verification.

### Source coverage (seeded 2026-11-22)

| Jurisdiction | On file | Status |
|---|---|---|
| Federal | OSHA 29 CFR 1926 (fall protection, ladders, stairways, scaffolds, excavation, electrical, PPE, training...), 29 CFR 1904 reporting, 29 CFR 1952 State Plans (21 states with private-sector plans flagged), EPA 40 CFR 745 lead RRP | Verified from eCFR (current as of 2026-11-19) |
| Minnesota | 2020 MN State Building Code administration (1300), IBC 2018 adoption (1305), IRC 2018 adoption + stair/deck amendments (1309), 2026 NEC adoption effective Aug 17, 2026 (1315), residential energy code (1322), mechanical/fuel gas (1346) | Verified from the Revisor and DLI |
| IRC 2018 | 17 section titles (stairs, guards, decks...) | Pending review: title only, no text |
| Other 49 states + DC | Nothing | Awaiting verification (shown honestly on the coverage page) |

Known gaps: Minnesota plumbing code (chapter 4714) not yet seeded; FMCSA definitions (49 CFR 390.3/390.5) skipped because eCFR shows transitional versions; WI, IA, TX, FL, CA queued next.

## PR 2: "Where is the project?" + all 50 states

- **Local permitting authorities.** Migration `20270222001000_academy_kb_local.sql` adds `kind`, `county_name`, `local_status` (enforces / not_enforced / unknown), `phone`, `detail`, `source_url`, `verified_at` to `academy_kb_jurisdictions`, and teaches `academy_kb_applicability` two new reasons: `local_verified` (the picked city/township enforces the state code → Verified Applicable) and `local_not_enforced` (it does not → still Jurisdiction Confirmation Needed, with the state's statewide-standard note). Seed `20270222002000` loads Minnesota DLI's directory (87 counties, ~3,200 cities/townships: `python3 scripts/academy/kb/fetch_mn_jurisdictions.py` then `gen_local_seed.py`).
- **ZIP → area picker.** `public/academy-geo/<zip3>.json` (from Census 2020 ZCTA relationship files, `gen_geo.py`) lists every city, township and unincorporated county area a ZIP touches; the visitor picks one. An optional street-address lookup (`/api/academy/locate`) uses the free Census geocoder (no key, address never stored or logged, 20/hour per visitor). Ids match between the two (`src/lib/academy/kb/geo.ts`).
- **State adoptions.** Researched per state from official sources, then re-checked by `scripts/academy/kb/check_state_evidence.py`: each quote must appear word for word on the official page (only .gov / state legal-publication hosts). Matches are `verified` with the page hash; anything else is `pending_review` with the reason, for an admin to confirm in Manage → Codes. Output `src/lib/academy/kb/seed/state-adoptions.json` → `gen_states_seed.py` → `20270222003000_academy_kb_states_seed.sql` (rollback `docs/academy/rollback_20270222003000.sql`).
- 2026-11-22 result: 370 adoptions in 49 states + DC (Minnesota seeded earlier), 308 verified. Mostly pending: NH, WV, SD (pages could not be re-read word for word), FL (quotes came from mixed pages), WY (evidence on a Google Drive link), AR (fire marshal rules unreachable). MO has no statewide code.

## Next PRs

1. Study tools: flashcards, quizzes (5/10/20/25/50/custom, timed), practice exams (original questions, "not an official exam"), "How to read a codebook" lesson, five-minute lessons, learning paths. Tables and RPCs are already in this migration.
2. Start Your Contracting Business guide, licences/insurance, tool kits, suppliers, BLS earnings comparison (wages vs business profit), Grow Your Business, DOT/safety.
3. More verified states (WI, IA, TX, FL, CA), grounded Haiku explanations behind `kb_ai_explain` and the existing AI guard, and the advisory "Check applicable codes" panel for estimates.
