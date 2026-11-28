-- Discount line items (2026-11-25).
--
-- Estimate line items can now be a customer Discount (cost_type = 'discount'): a flat amount
-- (unit_cost, entered as a positive number) or, with unit = 'percent', a percent of the other lines in
-- its section. Discounts are never marked up, carry no cost, and always show their amount on the proposal.
-- The whole-project discount (dollars or percent) lives in estimates.proposal_config.projectDiscount,
-- so it needs no column. Nothing else changes. Safe to run more than once.

alter table public.estimate_items drop constraint if exists estimate_items_cost_type_check;
alter table public.estimate_items add constraint estimate_items_cost_type_check check (cost_type in (
  'material', 'labor', 'labor_material', 'equipment', 'subcontractor', 'overhead', 'contingency', 'permit', 'delivery', 'labor_burden', 'other', 'discount'
));
