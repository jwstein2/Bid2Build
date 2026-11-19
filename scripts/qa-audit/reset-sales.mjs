// Clears the synthetic QA sales team (emails @audit.test) and everything hanging off it, so sales-team.mjs,
// sales-crm.mjs and sales-pay.mjs start from "no reps yet" on every run. Local stack only (lib.mjs refuses others).
import { q, closeDb } from "./lib.mjs";
const reps = "(select id from public.sales_reps where email like '%@audit.test')";
await q("begin");
try {
  await q(`delete from public.sales_milestone_awards where rep_id in ${reps} or commission_id in (select id from public.sales_commissions where rep_id in ${reps})`);
  for (const t of ["sales_payouts", "sales_commissions", "sales_statements", "sales_attributions", "sales_revenue", "sales_accelerators", "sales_achievements"]) await q(`delete from public.${t} where rep_id in ${reps}`);
  await q(`delete from public.sales_attribution_history where from_rep in ${reps} or to_rep in ${reps}`);
  const r = await q(`delete from public.sales_reps where id in ${reps} returning email`); // invites, tasks, events, progress cascade
  await q("commit"); console.log(`PASS    reset QA sales team (${r.length} rep(s) removed)`);
} catch (e) { await q("rollback"); console.log(`FAIL    reset QA sales team -> ${e.message}`); }
await closeDb();
