-- Rollback for 20270115001000_library_generator.sql ("Generate My Price Library").
-- Removes the draft staging tables and the approval function. Saved Items and Saved Stacks that were
-- already approved stay exactly as they are (only their link back to a draft is dropped).
-- Run only if the generator must be removed; drafts that were not approved are lost.
drop function if exists public.library_draft_approve(jsonb);
alter table public.saved_items drop column if exists source_draft_id;
do $$ begin
  if to_regclass('public.price_records') is not null then
    alter table public.price_records drop column if exists draft_id;
    update public.price_records set action = 'updated' where action = 'merged';
    alter table public.price_records drop constraint if exists price_records_action_check;
    alter table public.price_records add constraint price_records_action_check check (action in ('created', 'updated', 'unchanged'));
  end if;
end $$;
drop table if exists public.library_draft_approvals;
drop table if exists public.library_draft_stacks;
drop table if exists public.library_draft_items;
drop table if exists public.library_drafts;
drop function if exists public.library_draft_items_guard();
drop function if exists public.library_draft_stacks_guard();
-- ai_generations.kind keeps 'library_generate' allowed (harmless; existing log rows stay valid).
