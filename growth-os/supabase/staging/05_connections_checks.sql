-- Phase 5 staging guard checks (run in the staging SQL editor). Ends by raising, so the test row and its audit
-- entries roll back. Expected result: "ERROR: STAGING GUARD CHECKS PASSED: 4/4 (test row rolled back)".
do $$
declare ok int := 0;
begin
  perform growth_api.register_connection('stripe', 'staging-guard-test', null, true, 'staging-check');
  begin
    update growth.connections set status = 'verified_operational', last_verified_at = now() where account_ref = 'staging-guard-test';
    raise exception 'GUARD FAILED: manual verified allowed';
  exception when others then if sqlerrm like 'GUARD FAILED%' then raise; end if; ok := ok + 1; end;
  begin
    perform growth_api.record_check('stripe', 'staging-guard-test', 'ok', 200, 1, array['read:customers','read:subscriptions','read:invoices','read:charges','read:balance_transactions'], null, null, null, 'x');
    raise exception 'GUARD FAILED: operator record_check allowed';
  exception when others then if sqlerrm like 'GUARD FAILED%' then raise; end if; ok := ok + 1; end;
  begin
    perform growth_api.oauth_begin('stripe', 'staging-guard-test');
    raise exception 'GUARD FAILED: oauth on manual connector';
  exception when others then if sqlerrm like 'GUARD FAILED%' then raise; end if; ok := ok + 1; end;
  if jsonb_array_length(growth_api.connections_overview() -> 'connectors') <> 14 then raise exception 'GUARD FAILED: overview count'; end if;
  ok := ok + 1;
  raise exception 'STAGING GUARD CHECKS PASSED: %/4 (test row rolled back)', ok;
end $$;
