-- Will meeting 2026-11-21 (item A): a Saved Item (and a Saved Stack row) can keep its own markup or margin,
-- e.g. 0% markup on a dumpster, so adding it to a bid again doesn't fall back to the bid's markup.
--
-- Additive and backward compatible: one nullable jsonb column per table. NULL (every existing row) means
-- "follow the bid's pricing", exactly as before. No data is changed. Existing RLS policies on both tables
-- are row-level (owner / company template) and cover the new column unchanged.
-- Shape: {"mode": "markup" | "margin", "percent": "<number as text>"}.
-- Rollback: alter table public.saved_items drop column if exists pricing_override;
--           alter table public.assembly_items drop column if exists pricing_override;

alter table public.saved_items add column if not exists pricing_override jsonb;
alter table public.assembly_items add column if not exists pricing_override jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'saved_items_pricing_override_shape') then
    alter table public.saved_items add constraint saved_items_pricing_override_shape check (
      pricing_override is null or (
        jsonb_typeof(pricing_override) = 'object'
        and pricing_override->>'mode' in ('markup', 'margin')
        and (pricing_override->>'percent') ~ '^\d{1,4}(\.\d{1,4})?$'
        and (pricing_override->>'mode' = 'markup' or (pricing_override->>'percent')::numeric < 100)
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assembly_items_pricing_override_shape') then
    alter table public.assembly_items add constraint assembly_items_pricing_override_shape check (
      pricing_override is null or (
        jsonb_typeof(pricing_override) = 'object'
        and pricing_override->>'mode' in ('markup', 'margin')
        and (pricing_override->>'percent') ~ '^\d{1,4}(\.\d{1,4})?$'
        and (pricing_override->>'mode' = 'markup' or (pricing_override->>'percent')::numeric < 100)
      ));
  end if;
end $$;

comment on column public.saved_items.pricing_override is 'Optional item-level markup/margin kept with the saved item. NULL = use the bid''s pricing.';
comment on column public.assembly_items.pricing_override is 'Optional item-level markup/margin kept with the stack row. NULL = use the bid''s pricing.';
