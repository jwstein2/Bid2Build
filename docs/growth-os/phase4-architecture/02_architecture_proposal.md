# Growth OS Phase 4, Part B: Proposed architecture (design only)

Status: **proposal, nothing built.** This turns the audit in `01_codebase_audit.md` into a minimal
design for the Phase 4 build, once Phase 4 is approved. Labels: **[Decision needed]** marks a choice for
James. **[Estimate]** marks a number that has not been verified.

## 1. Principles

1. **Use what already exists.** The `marketing` scheduler already shows the queue and lease pattern in
   production, and the Sales Hub `SECURITY DEFINER` functions already form the approved CRM write
   surface. Growth OS should build on both and not run a parallel copy of either.
2. **A separate deploy unit, the same platform.** Growth OS runs outside the customer Next.js app, so a
   Growth OS bug, deploy or outage cannot take down built2bid.org, and the reverse also holds. It still
   uses the existing Supabase account, Vault, `pg_cron` and `pg_net`, so it needs no new vendors.
3. **The database is the source of truth and the enforcement point.** Jobs, approvals, budgets and stop
   switches live in Postgres and are checked in SQL at claim time. A UI flag alone never controls a job.
4. **Deterministic first.** A job is code. An LLM call is one bounded step inside a job, with a
   versioned prompt and a budget. It is never the scheduler or the router.
5. **Least privilege.** Growth OS uses its own Postgres role that can read a few views and call a few
   functions. It never holds the customer app's service-role key.
6. **Nothing reaches the outside world without the right tier.** Sends, publishing, CRM stage changes,
   spend and purchases go through approval tiers (§4.8). Purchases, ad launches, unsolicited messages
   and spending-limit changes are never automated (standing rule).

## 2. The shape

```
                         ┌───────────── Customer SaaS (unchanged) ──────────────┐
 built2bid.org ─ Netlify │ Next.js app · /api/* · /admin (requireAdmin + audit)  │
                         │ writes: public.analytics_events, leads, lead_events,  │
                         │         sales_* (via SECURITY DEFINER functions)      │
                         └───────────────┬───────────────────────────────────────┘
                                         │ read-only views          ▲ approved writes only
                                         ▼ (growth_read.*)          │ (growth_api.* functions)
 ┌──────────────────────────── Supabase project (same) ─────────────┴──────────────────────┐
 │  schema growth  (not exposed to PostgREST; RLS on, no anon/authenticated grants)        │
 │   events_inbox · ingest_cursors · jobs · job_attempts · schedules · agent_tasks         │
 │   prompts · runs · run_steps · approvals · change_log · budgets · usage · control       │
 │   connections (metadata only)                                                           │
 │  Vault: growth_* secrets (provider tokens, cron secret, DB password for growth_worker)  │
 │  pg_cron ──(every minute)──▶ growth.cron_tick() ──pg_net──▶ Edge Function growth-worker │
 └─────────────────────────────────────────────────────────────────────────────────────────┘
          growth-worker (Deno, verify_jwt=false + x-growth-cron-secret, connects as growth_worker)
            tick → ingest events → enqueue due schedules → claim jobs → run handlers
                 → providers (Anthropic, Resend, Buffer/Meta, ... added in Phase 5)
 Owner UI: /admin/growth (Phase 5/6) inside the existing admin area: approvals, stop button, budgets,
           runs. Its writes call growth_api.* through requireAdmin() + audit().
```

Why this and not the alternatives:

| Option | Verdict |
|---|---|
| **Edge Function worker + `pg_cron` + Postgres queue (recommended)** | Already proven here by `mkt-scheduler`. Edge Functions allow 150 s per request. Growth OS deploys separately from the customer app and runs without a Claude session. No new vendor |
| Add Growth OS routes and crons to the Next.js app | Smallest diff, but no boundary: same deploy, same service-role key, and a Growth OS bug can break checkout. Netlify scheduled functions are also capped near 30 s |
| `pgmq` instead of a jobs table | Fine, but not installed. Volume is tiny (hundreds of jobs a day). A plain table is easier to query, audit and test with the existing local-Postgres harness |
| Separate Supabase project for Growth OS in production | Strongest isolation, but it needs cross-project replication of acquisition events and CRM writes over HTTP, which means more moving parts. Revisit if R3 (the shared `hbb` app) gets worse or the data volume grows. **[Decision needed]** |
| n8n, Inngest, Temporal or another external orchestrator | A new vendor, new secrets and a new failure domain, for a load Postgres handles easily. Not minimal |

## 3. Environments

| Env | Database | Worker | Providers | Data |
|---|---|---|---|---|
| **test** | Local Postgres from `scripts/test-db.sh` + Supabase stubs, migrations applied fresh each run | `core.ts` run in Node/Vitest with mock providers and a fake clock | Mocks only | Synthetic |
| **staging** | **A separate Supabase project** (recommended) holding only `growth` + a schema-only copy of the `public` tables it reads, seeded with synthetic rows | `growth-worker` deployed to the staging project | Sandbox or test credentials (Resend test domain or capture-only adapter, Buffer test channel, Anthropic with a low budget) | Synthetic, never production |
| **production** | `asiiqmegvajtuspeumio`, schema `growth` | `growth-worker` deployed to production **from `main` only, by a manual CLI step or a protected Action** | Real connectors approved in Phase 5 | Live |

- **[Decision needed]** Staging as a separate Supabase project versus Supabase branching. Branching
  needs the CLI migration history that this project lacks (Audit R4), so a separate project is simpler
  now. Cost: [Estimate] about $10/month for one extra project on a paid org (Micro compute), or $0 on a
  free org with pausing. Check against the current plan.
- Netlify previews must **not** get Growth OS credentials. The worker is never deployed from a preview.
- Every row and job carries `env` and the worker refuses work whose `env` doesn't match its own setting,
  as a guard against restoring a staging dump into production or the reverse.

## 4. Components

### 4.1 Shared marketing data schema (`growth`)

Only Growth OS state lives here. Customer data stays where it is and is **read through views**.

| Table | Purpose (key columns) |
|---|---|
| `growth.events_inbox` | Normalized acquisition events copied in by ingestion: `source` (analytics_events, leads, lead_events, sales_activities…), `source_id`, `event`, `occurred_at`, `subject_ref` (opaque lead or account id), `props jsonb`. **Unique (source, source_id)** |
| `growth.ingest_cursors` | One row per source: `last_seen_at`, `last_seen_id`. Ingestion is a cursor poll, **not triggers on customer tables**, so the customer write path is untouched |
| `growth.jobs` / `job_attempts` | Durable queue (§4.3) |
| `growth.schedules` | Cron-like schedule rows (§4.4) |
| `growth.agent_tasks` | Task registry (§4.5) |
| `growth.prompts` | Versioned prompts (§4.6) |
| `growth.runs` / `run_steps` | Execution logs (§4.7) |
| `growth.approvals` | Human approvals (§4.8) |
| `growth.change_log` | Before and after image of every external or CRM write, for rollback (§4.11) |
| `growth.budgets` / `usage` | Cost controls (§4.10) |
| `growth.control` | Emergency stop and per-scope pauses (§4.11) |
| `growth.connections` | Provider connection **metadata** (provider, account id, scopes, status, expiry, last health). Secrets stay in Vault |

The `marketing.*` content tables can stay as they are and be read by Growth OS. Phase 7 decides whether
to fold them into `growth` (after R2 is fixed).

### 4.2 Secure internal API layer

There is no new HTTP API for the core flows, which keeps the attack surface small. The interface is
**Postgres itself**, with two narrow schemas:

- **`growth_read`**: views over customer data with only the columns Growth OS needs. Examples:
  `growth_read.acquisition_events` (from `analytics_events`, no prices or customer names, which the
  table already avoids), `growth_read.funnel_leads` (stage, first-touch UTM, created/updated, no raw
  email; `email_hash` instead), `growth_read.sales_leads_min`, and `growth_read.contact_eligibility(email,
  purpose)` (§4.9). Internal, test and demo accounts are excluded with the existing `admin_account_labels`
  classification.
- **`growth_api`**: `SECURITY DEFINER` functions, `search_path=''`. These are the **only** writes Growth
  OS can make outside its own schema:
  - `crm_apply(p_approval_id)`: applies one approved CRM update by calling the existing functions
    (`sales_lead_ingest`, the activity/task inserts the Sales Hub uses, `leads` stage advance). It
    verifies that the approval is `approved`, unexpired, unused and matches the payload hash, writes
    `change_log` in the same transaction and marks the approval used.
  - `revert_change(p_change_id)`: compensating write from `change_log` (§4.11).
  - `decide_approval(p_id, p_decision, p_note)`, `set_control(...)`, `set_budget(...)`: called only from
    `/admin/growth` server code after `requireAdmin()` + `audit()`. They check `is_admin(auth.uid())`
    themselves as well.
- **Database role `growth_worker`** (LOGIN, password in Vault): USAGE on `growth`, `growth_read` and
  `growth_api`; DML on `growth.*`; SELECT on `growth_read.*`; EXECUTE on the worker-side `growth_api`
  functions only. **No grants on `public` tables. Never the service-role key.** A database test asserts
  that `growth_worker` cannot select from `public.profiles` or insert into `public.leads`.
- When an outside caller is needed (for example the weekly lead-import agent or a Phase 6 agent host),
  it gets a dedicated Edge Function route with its own secret and a per-caller scope list. It does not
  reuse `EMAIL_OUTBOX_SECRET` (R5).

### 4.3 Event bus and durable job queue

Event bus: `events_inbox` plus handlers subscribed by event name in `agent_tasks.triggers`. Each tick,
after ingestion, the worker enqueues one job per (handler, event) with idempotency key
`task:event_source:event_id`, so re-ingesting an event never duplicates work.

`growth.jobs`: `id`, `env`, `task_key`, `task_version`, `payload jsonb`, `idempotency_key` **unique**,
`state` (`queued | leased | succeeded | failed_retryable | dead | canceled | awaiting_approval`),
`priority`, `run_after`, `attempts`, `max_attempts`, `lease_owner`, `lease_expires_at`, `last_error`,
`approval_id`, `parent_job_id`, `created_by` (`schedule:<id> | event:<id> | admin:<uid> | job:<id>`),
timestamps.

Rules (taken from `marketing.claim_due` / `recover_stale` / `record_submit`):
- **Claim** = `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING`, refused
  entirely when `control.global_stop` or the task's or connector's pause is set, or when its budget is
  spent.
- **Lease** of 5 minutes. `recover_stale()` returns expired leases to the queue. Jobs that touch the
  outside world move to `verify_pending` first, and the handler's `find_existing()` runs before any
  resend ("look before resend").
- **Retry** with exponential backoff and jitter (`run_after = now() + 2^attempts min`, capped). After
  `max_attempts` the job goes to `dead`, an alert fires and the job stays visible in the UI.
- **Completion** is written in one transaction with its `runs` row and any `change_log` rows.
- Handlers must be idempotent. External calls carry `idempotency_key:attempt` where the provider
  supports it.

### 4.4 Scheduling service

- One `pg_cron` job, `growth-tick`, runs every minute and calls `growth.cron_tick()` → `pg_net` →
  `growth-worker/tick` with `x-growth-cron-secret` read from Vault. This is the same shape as
  `marketing.cron_call`.
- `growth.schedules` rows (`task_key`, `cron_expr`, `timezone`, `enabled`, `next_run_at`,
  `last_enqueued_at`) are evaluated by the tick, which enqueues jobs with idempotency key
  `schedule:<id>:<slot>`. That gives **exactly one job per slot**, even if two ticks overlap or one
  tick is missed and a later tick catches up within a grace window.
- Schedules are data, so enabling, disabling or retiming one is an audited admin action with no
  `pg_cron` edit and no deploy.
- A heartbeat row per tick (`growth.control.last_tick_at`) plus a Better Stack heartbeat URL alerts if
  ticks stop.

### 4.5 Agent task registry

`growth.agent_tasks` (`key`, `version`, **immutable once active**): `description`, `handler` (code entry
point in the worker), `input_schema` / `output_schema` (JSON Schema, validated before and after the
run), `triggers` (event names and/or schedule), `prompt_key` + pinned `prompt_version` (nullable for
non-AI tasks), `model`, `max_tokens`, `allowed_connectors[]`, `allowed_actions[]`, `risk_tier` (0–3),
`requires_approval` (derived from the tier and overridable upward only), `max_runs_per_day`,
`max_cost_usd_per_run`, `enabled`, `owner`.

A job records `task_version` at enqueue, so changing a task never changes jobs already in flight.

### 4.6 Versioned prompts

- The source is in the repo (`growth-os/prompts/<key>/v<N>.md`, reviewed by PR). A sync step writes
  `growth.prompts(key, version, body, sha256, status draft|approved|retired, approved_by, approved_at)`.
- A row is **immutable once `approved`**. The worker refuses a prompt whose stored hash doesn't match
  the body. Each run stores the prompt key, version and hash.
- Rolling back a prompt means re-pinning the task to the earlier version, which is one audited update.

### 4.7 Agent execution logs

- `growth.runs`: `job_id`, `task_key@version`, `prompt_key@version#hash`, `model`, `input_hash`,
  `output` (redacted), `tokens_in` / `tokens_out`, `cost_usd`, `provider_calls`, `status`, `error`,
  `started_at` / `finished_at`, `worker_id`, `env`.
- `growth.run_steps`: ordered tool and provider calls (`connector`, `action`, `request_hash`,
  `response_code`, `latency_ms`, `idempotency_key`, `change_id`).
- PII: emails and phone numbers are stored hashed or redacted in logs. Raw contact data stays in the
  source tables.
- Retention: runs 180 days and steps 60 days, via a cleanup cron (same as `mkt-cleanup`).
  [Decision needed] on the retention windows.

### 4.8 Human approvals

| Tier | Examples | Gate |
|---|---|---|
| 0 Read and analyze | Ingest events, compute segments, draft a report | Automatic, logged |
| 1 Internal reversible | Draft content into a queue, add a CRM note or task, tag a lead | Automatic, logged, revertible through `change_log` |
| 2 External or customer-visible | Send an email, publish a post, change a CRM stage or owner, sync to an ad audience | **Approval required**, per item or for a pre-approved template plus a cap (like `marketing.settings.auto_allowed` and `creator_outreach_settings.approved_at`) |
| 3 Money and commitments | Any spend, a budget or limit change, a purchase, launching or unpausing ads | **Never automated.** The worker cannot perform it. An approval only produces instructions for James to act on |

`growth.approvals`: `subject_type` / `subject_id`, `action`, `payload jsonb`, `payload_sha256`,
`requested_by` (task@version, run id), `risk_tier`, `status` (`pending | approved | rejected | expired |
used`), `decided_by`, `decided_at`, `note`, `expires_at`, `used_at`. An approval covers **exactly one
payload hash**. Changing the payload after approval makes it useless, and it can be used once.

### 4.9 Contact eligibility (needed before any outreach)

`growth_read.contact_eligibility(email, purpose)` returns `allowed`, `reason`. It combines
`leads.suppressed_at` / `unsubscribed_at`, `comm_suppressions`, `sales_suppressions`, `sales_bad_emails`,
`creator_outreach_suppressions`, marketing consent (`profiles.marketing_opt_in` and the latest
`marketing_consent_events`), paying-customer status, account deletion, and "already in an active
sequence" (creator outreach, sales nurture, lifecycle). Every tier-2 send handler must call it at
approval time **and again at send time**.

### 4.10 Cost and usage controls

- `growth.budgets` (`scope`: global, task, connector or model; `period`: day or month; `limit_usd`;
  `hard`) and `growth.usage` (reserved and actual per run).
- Preflight follows `src/lib/ai/guard.ts`: **reserve** the estimated cost before the call, settle with the
  actual cost after, and release on failure. Claim refuses jobs whose task or global budget has no room
  left.
- Starting defaults [Decision needed]: global $5/day and $50/month for LLM calls, per-task caps, and a
  provider-call cap per connector per day. The Anthropic Admin cost API (already wired in
  `src/lib/admin/monitors.ts` when `ANTHROPIC_ADMIN_KEY` is set) gives an outside check.
- Circuit breaker: 3 consecutive failures for one connector pause that connector and alert.

### 4.11 Emergency stop and rollback

- **Stop**: `growth.control` singleton with `global_stop`, `stopped_by`, `stopped_at`, `reason`, plus a
  `paused_tasks[]` and `paused_connectors[]` list. It is checked (a) in `claim`, (b) by the worker
  before every external call and (c) by `cron_tick`. Three ways to trigger it: the `/admin/growth`
  button, one SQL statement (`select growth_api.stop('reason')`), or unscheduling `growth-tick`. In-flight
  jobs finish their current step and stop; no new external call starts.
- **Data rollback**: every CRM or external write has a `change_log` row (`target`, `before`, `after`,
  `compensating_action`). `revert_change(id)` or `revert_run(run_id)` applies the compensation (for a
  published post, the provider's `remove()`). Writes that can't be compensated, such as an email that
  has already been sent, are marked as such so the tier-2 approval says so up front.
- **Code rollback**: Edge Function deploys are versioned, so redeploy the previous tag. Every migration
  has a down script in `supabase/rollback/` (existing convention), and migrations go through the CLI
  so history is recorded (fixes R4 for Growth OS).
- **Kill switch independent of the database**: the worker env var `GROWTH_WORKER_ENABLED=false` makes
  every tick a no-op, which covers the case where the database itself is the problem.

### 4.12 Secrets and OAuth token management

- **Supabase Vault** for all Growth OS secrets (`growth_*` names), read per request by the worker over
  the `growth_worker` connection, through a `growth_api.secret(name)` function that allows only
  `growth_%` names. This means `growth_worker` gets no direct `vault.decrypted_secrets` access, which is
  tighter than the current `mkt-scheduler`. Rotation needs no redeploy.
- OAuth (Phase 5): authorization-code flow with PKCE, handled by an admin-only route. The refresh token
  goes to Vault and `growth.connections` keeps scopes, account and expiry. Each connector requests the
  minimum scopes (the existing `INTEGRATION_ARCHITECTURE.md` scope table is the template). A health job
  refreshes tokens and flags `needs_reauth`, as `marketing.record_health` does.
- Secrets never go in the repo, logs, `runs.output` or chat. The worker logs only HTTP status codes for
  provider errors.

## 5. How the acceptance criteria would be met and tested

| Phase 4 acceptance criterion | Mechanism | Integration test (to build) |
|---|---|---|
| Securely read authorized customer acquisition events | `growth_read` views + cursor ingestion as `growth_worker` | Seed `analytics_events`/`leads` → run `ingest` twice → exactly N inbox rows; `growth_worker` is denied on `public.profiles`, `public.leads` and `vault.decrypted_secrets` |
| Write approved CRM updates | `growth_api.crm_apply(approval_id)` | Unapproved, expired, reused or tampered-payload approvals are refused; an approved one writes once and logs `change_log`; `revert_change` restores the before state |
| Execute durable test jobs | `jobs` + claim/lease + `noop` and `echo` test tasks | Enqueue 100 jobs → all succeed exactly once with 4 concurrent workers; duplicate idempotency keys are ignored |
| Recover from failures | lease expiry, retry, backoff, dead letter, verify-before-resend | Kill the worker mid-job → lease expires → the job finishes once; a provider timeout → `verify_pending` → no duplicate send; a permanent error → `dead` + alert |
| Operate without an open Claude conversation | `pg_cron` → Edge Function, schedules as data | Staging: a schedule fires on time over 24 h with no session open; ticks are recorded; the heartbeat alert fires when ticks stop |
| Emergency stop | `control.global_stop` | With the stop set, claim returns nothing, the worker makes no outbound call, and the stop/resume actions are audited |
| Cost controls | budgets and reservations | A job is refused when the budget can't cover its estimate; usage is settled to actual cost |

## 6. Operating cost [Estimates, to verify against the current plans]

| Item | Cost |
|---|---|
| `pg_cron` + `pg_net` + Vault | Included |
| Edge Function invocations: about 44k ticks/month + job calls | Within included quotas on free and paid plans (hundreds of thousands to millions per month) |
| Postgres storage for `growth` (runs, events) | Under 100 MB/year at the expected volume |
| Staging Supabase project | about $0–10/month |
| LLM calls | Capped by `growth.budgets` (proposed default ≤ $50/month) |
| Deterministic jobs | No per-call cost |

## 7. Build order for Phase 4 (once approved)

1. Bring `mkt-scheduler` source and the `marketing` schema DDL into the repo as is (no behavior change).
   This fixes R2 and gives the project a tested pattern.
2. Create the staging project and the `growth` migrations through the CLI (with history), plus the
   rollback scripts.
3. `growth_worker` role, `growth_read` views, `growth_api` functions, and database tests for every grant.
4. Worker `core.ts` (ingest, schedules, claim, run, recover) with Vitest tests on local Postgres and mock
   providers.
5. Deploy to staging, then run the 24-hour unattended soak and the failure-injection tests.
6. Production deploy of the worker only with `global_stop=true`, then flip it on after James's sign-off.
   `/admin/growth` comes in Phase 5/6.

## 8. Decisions for James

1. Growth OS in the **same Supabase project, separate schema** (recommended) versus a separate project.
2. Staging as a **separate Supabase project** (recommended) versus branching.
3. Starting budgets (proposed $5/day and $50/month for LLM calls) and log retention (180 / 60 days).
4. What to do with the existing `marketing` scheduler: bring it into the repo and keep it paused
   (recommended), reconnect Buffer, or retire it.
5. Whether to move the unrelated `hbb` app out of the Built2Bid production database (R3). That's outside
   Growth OS, but it affects its blast radius.
