# Growth OS (internal)

Internal marketing and sales operations service for Built2Bid. Design and audit: `docs/growth-os/phase4-architecture/`.

It lives in its own schemas (`growth`, `growth_read`, `growth_api`) and runs as its own database role (`growth_worker`).
It never uses the service-role key, it reads app data only through `growth_read` views, and it writes app data only
through `growth_api.crm_apply` after a human approval.

| Path | What it is |
| --- | --- |
| `supabase/migrations/20270301001000_growth_os_foundation.sql` | All Growth OS objects. Staging and test only until production is approved. |
| `supabase/rollback/..._down.sql` | Removes every Growth OS object. Leaves app tables untouched. |
| `supabase/staging/00_app_tables_standin.sql` | Staging project only: minimal copies of the app tables Growth OS reads. |
| `supabase/staging/01_synthetic_seed.sql` | Staging project only: synthetic accounts and events on `.test` domains. |
| `supabase/staging/02_staging_wiring.sql` | Staging project only: env, worker login and Vault secrets (generated in the database). |
| `supabase/staging/03_schedule_tick.sql` | Staging project only: the every-minute pg_cron tick. |
| `worker/core.ts` | The tick: ingest, dispatch, schedules, claim and run jobs. Runtime-agnostic and unit tested. |
| `worker/index.ts` | Supabase Edge Function entry (Deno), deployed as `growth-worker` with `verify_jwt = false`. |

## Environments

- **test**: local Postgres, `npm run test:db` style (`npx vitest run tests/db/growth-os.test.ts` with `scripts/test-db.sh start`). Applies the real app migrations, then Growth OS.
- **staging**: separate Supabase project `built2bid-growth-staging`. No customer data. Apply in order: `00`, the foundation migration, `01`, `02`; deploy `worker/` as `growth-worker` (verify_jwt off) with Edge Function secrets `GROWTH_ENV=staging` and `GROWTH_DB_PASSWORD` (copied from Vault by a person); then `03`.
- **production**: not deployed. Needs explicit approval, and the migration then moves into `supabase/migrations/`.

`GROWTH_ENV` must equal `growth.control.env` or every tick does nothing, so a staging deploy can never act on production.

## Operating

All operator calls need an admin session (or the SQL editor):

```sql
select growth_api.stop('reason');                     -- emergency stop; running jobs stop at their next step
select growth_api.resume('reason');
select growth_api.set_paused('task', 'crm.apply_update', true);
select growth_api.decide_approval(<approval_id>, true, 'note');
select growth_api.set_budget('global', 'day', 5);
select growth_api.revert_change(<change_id>);
```

Kill switches, outermost first: unschedule `growth-tick`; Edge Function secret `GROWTH_WORKER_ENABLED=false`;
`growth_api.stop`; pause a task or connector. Full removal: the rollback script.
