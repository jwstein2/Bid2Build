# Legacy social publishing scheduler (versioned copy)

Read-only copies of the social publishing scheduler that already runs in the production Supabase project.
It was deployed outside this repository; Phase 4 decided to version it here **without changing behaviour** and
keep publishing paused.

| Path | What it is |
| --- | --- |
| `mkt-scheduler/` | Source of the `mkt-scheduler` Edge Function (version 2 in production), copied verbatim on 2026-11-24. |
| `marketing-schema/marketing_schema_snapshot.sql` | Snapshot of the `marketing` schema's tables, functions and pg_cron jobs. Not a migration. |

Facts at copy time (verified read-only):

- `marketing.settings.publishing_paused` is `true`, so `mkt-push` claims nothing.
- Five pg_cron jobs are active (`mkt-push`, `mkt-reconcile`, `mkt-health`, `mkt-digest`, `mkt-cleanup`).
- Credentials live in Vault (`mkt_*` names). None are in this repository.
- The function uses `SUPABASE_DB_URL` and the service-role key. Growth OS does not; folding the scheduler into
  Growth OS (a `publish.social` task on the Growth OS queue with the `growth_worker` role) is Phase 7 work.

Nothing here is deployed from the repository. Redeploying from these files is a production change and needs
James's explicit approval.
