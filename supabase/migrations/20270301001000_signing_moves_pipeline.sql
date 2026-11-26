-- Signing moves the bid through the pipeline (2026-11-25).
--
-- Until now the e-signature system left estimates.pipeline_stage alone (see 20261115001000_e_signatures.sql),
-- so a bid whose customer signed stayed at "draft" in the database. The Bids board derives Won from the
-- signature, but every reader that counts pipeline_stage (Getting started checklist, sidebar counts, company
-- page, financial records, scheduling) treated the signed bid as an unsent draft.
--
-- * Creating a customer signing link moves a draft / ready / approved bid to "pending" (out for signature).
-- * A customer signature moves any bid that isn't already won-or-later (or lost) to "won", with won_at set to
--   the signature time. A Lost bid is left alone, matching the board ("Lost stays Lost").
-- * Both write estimate_stage_history like set_estimate_stage does (changed_by = the bid owner for the link,
--   null for the customer's signature) and go through app.stage_change so guard_pipeline_stage allows it.
-- * Backfill: existing signed bids move to Won; bids with a pending, unexpired link move to Pending.
-- Idempotent: safe to run more than once.

create or replace function public.pipeline_stage_on_signing_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates%rowtype;
begin
  select * into e from public.estimates where id = new.estimate_id for update;
  if not found or e.pipeline_stage not in ('draft', 'ready_for_review', 'approved') then return new; end if;
  perform set_config('app.stage_change', 'on', true);
  update public.estimates set pipeline_stage = 'pending', stage_changed_at = now(), lost_reason = null, won_at = null
    where id = e.id;
  perform set_config('app.stage_change', '', true);
  insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
    values (e.id, e.company_id, e.pipeline_stage, 'pending', new.user_id, 'Signing link created', now());
  return new;
end $$;

drop trigger if exists signing_requests_pipeline_stage on public.signing_requests;
create trigger signing_requests_pipeline_stage after insert on public.signing_requests
  for each row execute function public.pipeline_stage_on_signing_request();

create or replace function public.pipeline_stage_on_signature() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  e public.estimates%rowtype;
begin
  select * into e from public.estimates where id = new.estimate_id for update;
  if not found or e.pipeline_stage in ('won', 'scheduled', 'in_progress', 'completed', 'lost') then return new; end if;
  perform set_config('app.stage_change', 'on', true);
  update public.estimates set pipeline_stage = 'won', stage_changed_at = now(), lost_reason = null,
    won_at = coalesce(new.signed_at, now())
    where id = e.id;
  perform set_config('app.stage_change', '', true);
  insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
    values (e.id, e.company_id, e.pipeline_stage, 'won', null, 'Customer signed', coalesce(new.signed_at, now()));
  return new;
end $$;

-- Fires after signatures_project_review (alphabetical), so the review is queued as a signature approval
-- before the stage change; project_review_enqueue keeps 'signature' as the source either way.
drop trigger if exists signatures_pipeline_stage on public.signatures;
create trigger signatures_pipeline_stage after insert on public.signatures
  for each row execute function public.pipeline_stage_on_signature();

revoke all on function public.pipeline_stage_on_signing_request() from public, anon, authenticated;
revoke all on function public.pipeline_stage_on_signature() from public, anon, authenticated;

-- Backfill ------------------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  perform set_config('app.stage_change', 'on', true);

  -- Signed bids still before Won.
  for r in
    select e.id, e.company_id, e.pipeline_stage, s.signed_at
    from public.estimates e
    join lateral (select min(signed_at) as signed_at from public.signatures where estimate_id = e.id) s on s.signed_at is not null
    where e.pipeline_stage in ('draft', 'ready_for_review', 'approved', 'sent', 'pending')
  loop
    update public.estimates set pipeline_stage = 'won', stage_changed_at = now(), lost_reason = null, won_at = r.signed_at where id = r.id;
    insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
      values (r.id, r.company_id, r.pipeline_stage, 'won', null, 'Customer signed (backfill)', r.signed_at);
  end loop;

  -- Unsigned bids with a live signing link still marked draft / ready.
  for r in
    select e.id, e.company_id, e.pipeline_stage, e.user_id
    from public.estimates e
    where e.pipeline_stage in ('draft', 'ready_for_review', 'approved')
      and not exists (select 1 from public.signatures s where s.estimate_id = e.id)
      and exists (select 1 from public.signing_requests q where q.estimate_id = e.id and q.status = 'pending' and q.expires_at > now())
  loop
    update public.estimates set pipeline_stage = 'pending', stage_changed_at = now(), lost_reason = null, won_at = null where id = r.id;
    insert into public.estimate_stage_history (estimate_id, company_id, from_stage, to_stage, changed_by, note, effective_at)
      values (r.id, r.company_id, r.pipeline_stage, 'pending', r.user_id, 'Signing link created (backfill)', now());
  end loop;

  perform set_config('app.stage_change', '', true);
end $$;
