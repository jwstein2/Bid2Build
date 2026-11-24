# Growth OS Phase 4: build report (system architecture foundation)

Date: 2026-11-24. Branch `claude/project-thread-uld2ny`, draft PR #266. Staging only: nothing was changed in the
production database, the Netlify site, its environment variables or any website.

Labels used below: **[verified]** = checked by a test or a direct read; **[assumption]** / **[estimate]** as marked.

## 1. What was implemented

- **Separate Growth OS service inside the existing Supabase stack** (decision approved 2026-11-23): three schemas
  and one role, with clear boundaries.
  - `growth`: private state. Control row with emergency stop (starts stopped), audit log, budgets, model prices,
    versioned prompts (immutable once approved, hashed), agent task registry (versioned, risk tiers 0 to 3),
    event inbox, ingest cursors, schedules, durable jobs, runs, run steps, usage, approvals, change log, connections.
  - `growth_read`: the only window onto customer data (acquisition events, funnel leads with hashed email, lead
    events). Internal, test and demo accounts are excluded.
  - `growth_api`: every write path, SECURITY DEFINER with an empty search_path and execute revoked from PUBLIC.
    Worker calls (tick, ingest, enqueue, dispatch, schedules, claim, complete, recovery, step log, secret, contact
    eligibility, approved CRM apply) and operator calls (stop, resume, pause, decide approval, set budget, revert, cleanup).
  - Role `growth_worker`: no access to `public` tables or Vault directly; never uses the service-role key.
- **Event intake**: cursor-based ingestion with a look-back window and a unique key, so it is idempotent.
- **Durable queue and scheduler**: leases with SKIP LOCKED, fenced completion, exponential backoff with jitter,
  dead-letter state, stale-lease recovery, one job per schedule slot. pg_cron → pg_net → Edge Function `growth-worker`.
- **Human approvals**: tier 2 tasks wait for an approval bound to a SHA-256 of the payload; single use; tier 3
  (money) is refused outright.
- **Approved CRM writes**: `lead.set_stage` (forward only) and `lead.add_event`, each change-logged and revertible.
- **Cost controls**: $5/day and $50/month global ceilings (approved), reserved at claim and settled from token counts.
- **Emergency stop and rollback**: global stop, per-task and per-connector pause, `GROWTH_WORKER_ENABLED=false`,
  unscheduling the tick, `revert_change`, and a full rollback script.
- **Retention** (approved): runs 180 days, steps 60 days, dispatched inbox 180 days.
- **Worker**: `growth-os/worker/core.ts` (runtime-agnostic, tested) and `index.ts` (Deno Edge Function).
- **Staging project** `built2bid-growth-staging` (us-east-1, Micro) created in the Built2Bid org, with app-table
  stand-ins, the foundation, synthetic `.test` data, Vault secrets generated in the database, the worker deployed,
  and `GROWTH_ENV=staging` set.
- **Existing social scheduler versioned** (approved): verbatim copy of `mkt-scheduler` and a snapshot of the
  `marketing` schema in `growth-os/legacy/`. Production untouched; publishing stays paused **[verified]**.

## 2. Tests and results

| Suite | Where | Result |
| --- | --- | --- |
| `tests/db/growth-os.test.ts` (26 tests: least privilege, ingest, 100 jobs × 4 workers, retry, dead, crash fencing, approvals, tamper, tier 3, revert, stop, budget, immutability, schedules, cron, env mismatch, eligibility, rollback) | Local Postgres with the real app migrations | **26/26 pass** [verified] |
| `growth-os/supabase/staging/04_staging_checks.sql` (23 checks) | Supabase staging project | **23/23 pass** [verified] |
| pg_cron/pg_net → `growth-worker` | Staging | Request reached the function; it stopped at boot with "set GROWTH_DB_PASSWORD" as designed [verified via function logs] |
| Unattended ticks by the Edge Function | Staging | **Not run yet**: needs the `GROWTH_DB_PASSWORD` secret (see §4) |
| Phase 3 migration on the same staging project | Staging | 13/13 pass (reported by the Phase 3 thread) |
| `next build`, `tsc --noEmit`, eslint | Local and Netlify preview | Pass. The first preview of this branch failed once in Netlify's build step; the next build passed with no code change, so it is treated as transient [assumption: log not readable from here] |

## 3. Files and systems changed

Repository (feature branch only):
- `growth-os/supabase/migrations/20270301001000_growth_os_foundation.sql`, `growth-os/supabase/rollback/…_down.sql`
- `growth-os/supabase/staging/00_app_tables_standin.sql`, `01_synthetic_seed.sql`, `02_staging_wiring.sql`, `03_schedule_tick.sql`, `04_staging_checks.sql`
- `growth-os/worker/core.ts`, `growth-os/worker/index.ts`, `growth-os/README.md`
- `growth-os/legacy/` (scheduler source and schema snapshot, documentation only)
- `tests/db/growth-os.test.ts`; `tsconfig.json` and `eslint.config.mjs` (exclude the Deno files)
- `docs/growth-os/phase4-architecture/` (audit, design, this report)

Systems:
- **New** Supabase project `built2bid-growth-staging` (ref `nkpnfpxrvukfqwgbbwrs`): schemas, role, Vault secrets
  (`growth_worker_db_password`, `growth_cron_secret`, `growth_worker_url`), extensions pg_cron and pg_net, Edge
  Function `growth-worker`, secret `GROWTH_ENV`. Growth OS is left **stopped**; no cron job scheduled yet.
- Production Supabase, Netlify and websites: **read-only** access only.

## 4. Permissions and credentials still needed

| # | Item | Who | Why |
| --- | --- | --- | --- |
| 1 | Copy Vault `growth_worker_db_password` into Edge Function secret `GROWTH_DB_PASSWORD` (staging) | James, 2 min | The worker logs in as `growth_worker`. Claude may not type passwords into sites |
| 2 | Then Claude schedules the tick (`03_schedule_tick.sql`), resumes, and verifies unattended runs | Claude | Closes acceptance criterion 5 |
| 3 | Anthropic API key in staging Vault as `growth_anthropic_api_key`, with a spend limit set in the Anthropic console | James | Only when the first AI task is enabled. Not needed for Phase 4 |
| 4 | Production go-live of Growth OS: run the migration in prod, set a prod `growth_worker` password, deploy the function, schedule the tick | James's explicit approval | Production change |

## 5. Risks and open issues

- Supabase MCP write calls on this account wait for a confirmation that never reaches James and time out; writes were done through the SQL editor in the Claude browser instead. Reads work.
- Staging holds stand-ins for the app tables, not the full app schema (5.8 MB of migrations that have drifted from prod). The full-fidelity check runs locally against the real migrations. Stand-ins must follow app column changes.
- Production migration history drifts from the repo (audit R4), so the prod rollout must be applied by hand and checked.
- The shared prod database also hosts the unrelated `hbb` app (audit R3); its removal is outside Phase 4.
- The legacy scheduler uses the service-role key; folding it into Growth OS is Phase 7.

## 6. Operating cost

- Staging project: about **$10/month** (Micro compute, as quoted by Supabase) [verified quote].
- Edge Function: one call per minute ≈ 43,200 per month, inside the Pro plan's included invocations [estimate].
- LLM spend: **$0** until an AI task is enabled; hard ceilings $5/day and $50/month.
- Production go-live adds no new vendor; compute stays on the existing project [assumption].

## 7. Acceptance criteria

| Criterion | Result |
| --- | --- |
| Securely read authorized customer acquisition events | **PASS**: local test plus staging checks 2–3; the internal account is excluded; `growth_worker` is denied on `public` tables |
| Write approved CRM updates | **PASS**: staging checks 11–14 (waits for approval, applies once, logged, reverts, refuses a tampered payload) |
| Execute durable test jobs | **PASS** at the database and worker-code level (local 100 jobs × 4 workers; staging checks 4–10). Edge Function run on staging pending item 4.1 |
| Recover from failures | **PASS**: retry with backoff, dead letter, lease expiry recovery, fenced completion (local and staging) |
| Operate without an open Claude conversation | **PARTIAL**: pg_cron → pg_net → Edge Function path verified on staging; unattended ticks start after item 4.1 |

Critical items still open: criterion 5 (and the Edge Function half of criterion 3), both closed by item 4.1.

## Appendix A: sign-ins, secrets and variables (Phase 4 scope)

| Platform | Item | Environment | Status |
| --- | --- | --- | --- |
| Supabase staging | Edge Function secret `GROWTH_DB_PASSWORD` | staging | **Needed** (item 4.1) |
| Supabase staging | Edge Function secret `GROWTH_ENV=staging` | staging | Done |
| Supabase staging | Vault `growth_worker_db_password`, `growth_cron_secret`, `growth_worker_url` | staging | Done (generated in the database) |
| Supabase staging | Vault `growth_anthropic_api_key` | staging | Later, with the first AI task |
| Supabase prod | Same four items for production | production | Later, at go-live, with approval |
| Supabase prod | Vault `mkt_buffer_api_key`, `mkt_buffer_org_id`, `mkt_meta_page_token`; Buffer channel reconnect | production | Existing; Buffer channel needs re-auth before any publishing (Phase 7) |
| Netlify | None for Growth OS. Previews must never get Growth OS secrets | — | — |

## Appendix B: automated executables (what can run, and what is planned)

Built and enabled on staging (nothing contacts anyone or spends money):

| Task | Tier | Trigger | Effect |
| --- | --- | --- | --- |
| `system.noop` / `system.echo` | 0 | Test jobs | None (test only) |
| `system.maintenance` | 0 | Daily 09:17 UTC | Retention cleanup inside `growth` |
| `crm.apply_update` | 2, needs approval | Enqueued, then a person approves | One lead stage change or lead event, change-logged, revertible |

Existing in production, paused: the legacy social scheduler (`mkt-push` every 15 min, `mkt-reconcile`, `mkt-health`,
`mkt-digest` weekly, `mkt-cleanup` daily). Publishing is off and there is no content queued.

Planned for later phases (not built, each needs its own approval): connector health checks and OAuth refresh (5);
agent tasks for research and drafting under the prompt registry and budgets (6); content drafting and social
publishing through the approval queue (7); lead follow-up drafts and CRM updates under suppression checks (8);
ad campaign drafts with spend changes always tier 3, so never automated (9); scaling rules and autonomy levels (10).
