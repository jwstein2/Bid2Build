-- Rollback for 20270202001000_sales_comp_v3.sql: go back to the V2 milestone rules for milestones reached
-- from now on. Settings only: awards, snapshots, disputes, program history and every new column stay, so no
-- earned compensation or audit record is lost. Writes a new policy version.
select set_config('sales.policy_note', 'Rollback of Compensation V3 to the V2 milestone rules', true);
update public.sales_settings set milestone_model = 'v2_window', milestone_qualification = 'first_payment', milestone_every = 50,
  milestone_rates = '[{"from":50,"pct":3},{"from":100,"pct":4},{"from":250,"pct":5}]'::jsonb, milestone_min_cents = 15000,
  milestone_flat = '[{"at":10,"cents":2500,"badge":"First 10"},{"at":25,"cents":7500,"badge":"25 Club"}]'::jsonb, updated_at = now()
where id;
