-- Rollback for 20261117001000_creator_partner_program.sql (run the outreach CRM rollback first).
--
-- What this does:
--  * Ends every complimentary grant that belongs to a creator program (creator Enterprise grants and
--    gifted Unlimited grants) by revoking it, so nobody keeps program access after the program tables
--    are gone. Accounts, companies, estimates and every other user record are untouched. Regular
--    Complimentary Access grants (no creator link) are untouched.
--  * Drops the program, gift, mentorship and resource tables and functions, and the columns this
--    migration added to business_profiles and complimentary_grants.
--
-- If you only want to pause the program, do NOT run this: end programs from Admin > Creator Partnerships.
update public.complimentary_grants
   set status = 'revoked', revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, 'Creator program rolled back'), invite_token_hash = null
 where (creator_program_id is not null or creator_gift_id is not null) and status <> 'revoked';

drop trigger if exists complimentary_grants_creator_sync on public.complimentary_grants;
drop trigger if exists complimentary_grants_creator_cap on public.complimentary_grants;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'creator_program_state', 'creator_program_active', 'creator_gift_state', 'creator_seats_used', 'creator_require_program',
      'mentorship_is_participant', 'creator_audit', 'creator_program_sync', 'creator_grant_changed', 'creator_gift_grant_cap',
      'mentorship_share_guard', 'creator_program_row', 'admin_creator_program_create', 'admin_creator_program_record_terms',
      'admin_creator_program_provision', 'admin_creator_program_set_allowance', 'admin_creator_program_end', 'admin_creator_programs',
      'admin_creator_program_detail', 'my_creator_programs', 'creator_confirm_terms', 'creator_dashboard', 'creator_invite_gift',
      'creator_rotate_gift', 'creator_record_gift_sent', 'creator_revoke_gift', 'creator_shares', 'mentorship_share_view',
      'mentorship_add_comment', 'mentorship_resolve_comment', 'creator_pipeline_summary', 'creator_save_resource',
      'creator_delete_resource', 'program_resources', 'creator_gift_preview', 'claim_creator_gift', 'my_mentorship',
      'set_mentorship_consent', 'share_estimate_for_mentorship', 'revoke_mentorship_share', 'my_estimate_shares')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

alter table public.complimentary_grants drop column if exists creator_gift_id;
alter table public.complimentary_grants drop column if exists creator_program_id;
drop table if exists public.mentorship_comments;
drop table if exists public.mentorship_shares;
drop table if exists public.mentorship_consents;
drop table if exists public.creator_resources;
drop table if exists public.creator_gifts;
drop table if exists public.creator_programs;
-- Company profile columns hold the member's own data (trade, where branding came from). Kept by
-- default; uncomment to remove them as well.
-- alter table public.business_profiles drop column if exists branding_source;
-- alter table public.business_profiles drop column if exists primary_trade;
