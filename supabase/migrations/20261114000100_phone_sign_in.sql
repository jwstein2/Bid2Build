-- Phone (SMS code) sign-in.
--
-- Until now "verified account" meant auth.users.email_confirmed_at is set. A contractor who signs up
-- with a texted code has phone_confirmed_at instead and may have no email at all, so:
--
--  1. ensure_credit_account: grants the 3 starter credits once a phone OR email is verified, and
--     records a one-way hash of the phone in starter_credit_claims (same table as email hashes,
--     prefixed "phone:" before hashing), so deleting an account and signing up again with the same
--     number doesn't grant a second starter bonus. An account that has both is claimed under both.
--  2. credit_status, finalize_bid and admin_metrics: "verified" checks also accept a confirmed phone.
--     These are patched in place from the live definitions (only the verification test changes), so
--     anything else that changed in production since the original migration is kept as is.
--
-- Non-destructive: no table, column or row is removed; existing email accounts behave exactly as before.
-- Safe to run more than once.

create or replace function public.ensure_credit_account(p_user_id uuid) returns public.credit_accounts
language plpgsql security definer set search_path = public as $$
declare
  v_acct public.credit_accounts;
  v_email text;
  v_email_ok boolean;
  v_phone text;
  v_phone_ok boolean;
  v_created timestamptz;
  v_hashes text[] := '{}';
  v_new integer := 0;
  v_rows integer;
  v_hash text;
begin
  select u.email, u.email_confirmed_at is not null, regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), u.phone_confirmed_at is not null, u.created_at
    into v_email, v_email_ok, v_phone, v_phone_ok, v_created
    from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  insert into public.credit_accounts (user_id, cycle_anchor) values (p_user_id, coalesce(v_created, now()))
    on conflict (user_id) do nothing;
  select * into v_acct from public.credit_accounts where user_id = p_user_id;

  if v_acct.starter_granted_at is null and (v_email_ok or v_phone_ok) then
    select * into v_acct from public.credit_accounts where user_id = p_user_id for update;
    if v_acct.starter_granted_at is null then
      if v_email_ok and v_email is not null and v_email <> '' then
        v_hashes := v_hashes || encode(sha256(convert_to(lower(trim(v_email)), 'UTF8')), 'hex');
      end if;
      if v_phone_ok and v_phone <> '' then
        v_hashes := v_hashes || encode(sha256(convert_to('phone:' || v_phone, 'UTF8')), 'hex');
      end if;
      -- Grant only if every verified identifier is new: a repeat email OR a repeat phone is a repeat signup.
      foreach v_hash in array v_hashes loop
        if exists (select 1 from public.starter_credit_claims where email_hash = v_hash) then
          v_new := -1;
          exit;
        end if;
      end loop;
      if v_new = 0 and cardinality(v_hashes) > 0 then
        foreach v_hash in array v_hashes loop
          insert into public.starter_credit_claims (email_hash) values (v_hash) on conflict do nothing;
          get diagnostics v_rows = row_count;
          if v_rows = 0 then v_new := -1; end if; -- lost a race with a concurrent signup
        end loop;
      end if;
      if v_new = 0 and cardinality(v_hashes) > 0 then
        insert into public.credit_ledger (user_id, kind, amount, note) values (p_user_id, 'starter_grant', public.starter_credit_amount(), 'signup');
        update public.credit_accounts set starter_balance = public.starter_credit_amount(), starter_granted_at = now()
          where user_id = p_user_id returning * into v_acct;
      else
        insert into public.credit_ledger (user_id, kind, amount, note) values (p_user_id, 'starter_grant', 0, 'identity_already_claimed');
        update public.credit_accounts set starter_granted_at = now() where user_id = p_user_id returning * into v_acct;
      end if;
    end if;
  end if;
  return v_acct;
end $$;
revoke execute on function public.ensure_credit_account(uuid) from public, anon, authenticated;

-- Patch the remaining "email verified" tests in place.
do $patch$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('public.credit_status()',
       'u.email_confirmed_at is not null', '(u.email_confirmed_at is not null or u.phone_confirmed_at is not null)'),
      ('public.finalize_bid(uuid,uuid,text,jsonb,jsonb,numeric,numeric,numeric,numeric)',
       'u.email_confirmed_at is not null', '(u.email_confirmed_at is not null or u.phone_confirmed_at is not null)'),
      ('public.admin_metrics(uuid)',
       'where email_confirmed_at is not null)', 'where email_confirmed_at is not null or phone_confirmed_at is not null)')
    ) as t(fn, old_text, new_text)
  loop
    if to_regprocedure(r.fn) is null then
      raise notice 'phone sign-in: % not found, skipped', r.fn;
      continue;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(r.fn));
    if position(r.new_text in v_def) > 0 then
      raise notice 'phone sign-in: % already patched', r.fn;
      continue;
    end if;
    if position(r.old_text in v_def) = 0 then
      raise exception 'phone sign-in: % no longer contains "%"; patch it by hand', r.fn, r.old_text;
    end if;
    v_new := replace(v_def, r.old_text, r.new_text);
    execute v_new;
  end loop;
end
$patch$;
