-- "Draft with AI" (AI starting-point estimate, Phase 1): log bid drafts with the other AI generations
-- so they count toward the per-user daily limit, the monthly AI budget and the admin cost reports.
--
-- Only widens the allowed values of ai_generations.kind. No new tables, no data changes, nothing that
-- touches estimates. Safe to run more than once. Until it runs, drafting still works; the draft just
-- isn't logged (the insert is refused by the old check and the API ignores that error).
do $$ begin
  if to_regclass('public.ai_generations') is not null then
    alter table public.ai_generations drop constraint if exists ai_generations_kind_check;
    alter table public.ai_generations add constraint ai_generations_kind_check
      check (kind in ('scope', 'exclusions', 'photo_labels', 'bid_draft'));
  end if;
end $$;
