-- Rollback for 20261119002000_project_documents.sql. Run 003000's rollback first. Deploy the previous
-- app version first. Change orders, scopes, shares, subcontractor quotes and cost adjustments are dropped
-- (export anything you need first). Proposal versions and e-signatures are untouched.
begin;
drop function if exists public.sub_quote_report();
drop function if exists public.sub_quotes_for_estimate(uuid);
drop function if exists public.sub_quote_apply_cost(uuid, uuid, text);
drop function if exists public.sub_quote_record(uuid, jsonb);
drop table if exists public.project_cost_adjustments;
drop table if exists public.subcontractor_quote_revisions;
drop table if exists public.subcontractor_quotes;
drop function if exists public.can_record_sub_quotes(uuid);
drop function if exists public.can_view_sub_costs(uuid);
drop function if exists public.scope_share_read(text);
drop function if exists public.project_scope_shares(uuid);
drop function if exists public.scope_share_revoke(uuid);
drop function if exists public.scope_share_publish(uuid, uuid, uuid, text, jsonb, uuid[], integer);
drop function if exists public.can_share_project_scope(uuid);
drop table if exists public.scope_share_versions;
drop table if exists public.scope_shares;
drop function if exists public.project_scope_save(uuid, integer, jsonb);
drop function if exists public.project_scope_init(uuid, uuid, jsonb);
drop function if exists public.scope_section_content(public.project_scope_sections);
drop table if exists public.project_scope_revisions;
drop table if exists public.project_scope_sections;
drop function if exists public.project_scope_readable(uuid);
drop function if exists public.can_manage_project_scope(uuid);
drop function if exists public.project_proposal_history(uuid);
drop function if exists public.change_order_accept_signing(text, text, text, text, text, text, text, text, text);
drop function if exists public.change_order_create_signing(uuid, uuid, text, timestamptz);
drop function if exists public.change_order_decide(uuid, text, text);
drop function if exists public.change_order_send(uuid, text);
drop function if exists public.change_order_save(uuid, jsonb);
drop function if exists public.change_order_content(uuid);
drop table if exists public.change_order_signatures;
drop table if exists public.change_order_signing;
drop table if exists public.change_order_versions;
drop table if exists public.change_orders;
drop trigger if exists estimate_versions_immutable on public.estimate_versions;
drop function if exists public.guard_estimate_version_update();
-- guard_write_once() is shared with 004000; drop it only after that rollback ran.
drop function if exists public.guard_write_once();
commit;
