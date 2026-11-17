-- Rollback for 20261119004000_proposal_style_policy.sql (Enterprise Bid Style V4.4).
-- Deploy the previous app version first. Company styles and their history are dropped; proposals
-- already generated keep the style frozen in their versions.
begin;
drop function if exists public.proposal_style_reset(uuid);
drop function if exists public.company_proposal_style_save(integer, jsonb, text[], boolean);
drop function if exists public.company_proposal_style();
drop function if exists public.proposal_style_policy(uuid);
drop function if exists public.proposal_style_keys();
drop trigger if exists companies_default_proposal_style on public.companies;
drop function if exists public.companies_default_proposal_style();
drop table if exists public.company_proposal_style_history;
drop table if exists public.company_proposal_styles;
commit;
