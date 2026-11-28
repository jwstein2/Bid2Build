-- SNAPSHOT, NOT A MIGRATION. Read-only export of the production `marketing` schema (social publishing scheduler)
-- taken 2026-11-24 from the live database, because it was created outside supabase/migrations.
-- Purpose: version the existing system (Phase 4 decision "bring mkt-scheduler into the repo, keep it paused").
-- Do not run this anywhere as is: identity columns (events.id, publish_jobs.id, runs.id), RLS policies, grants,
-- indexes and triggers are not reproduced. Publishing is paused in production (settings.publishing_paused = true).
-- Source of the Edge Function: growth-os/legacy/mkt-scheduler/.

create table marketing.campaigns (
  id text not null,
  trade text,
  pain_point text,
  subject text,
  landing_url text not null,
  utm_source text not null default 'facebook'::text,
  utm_medium text not null default 'organic_social'::text,
  created_at timestamp with time zone not null default now(),
  constraint campaigns_id_check CHECK ((id ~ '^[a-z0-9][a-z0-9-]{1,63}$'::text)),
  constraint campaigns_landing_url_check CHECK ((landing_url ~ '^https://'::text)),
  constraint campaigns_pkey PRIMARY KEY (id)
);

create table marketing.channels (
  id uuid not null default gen_random_uuid(),
  platform text not null,
  provider text not null,
  provider_channel_id text not null,
  display_name text not null,
  status text not null default 'connected'::text,
  last_health_at timestamp with time zone,
  last_health_detail text,
  token_expires_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint channels_pkey PRIMARY KEY (id),
  constraint channels_platform_check CHECK ((platform = ANY (ARRAY['facebook_page'::text, 'instagram'::text, 'tiktok'::text, 'youtube'::text]))),
  constraint channels_provider_check CHECK ((provider = ANY (ARRAY['buffer'::text, 'meta'::text, 'mock'::text]))),
  constraint channels_provider_provider_channel_id_key UNIQUE (provider, provider_channel_id),
  constraint channels_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'needs_reauth'::text, 'disconnected'::text, 'paused'::text])))
);

create table marketing.creatives (
  id uuid not null default gen_random_uuid(),
  kind text not null,
  title text not null,
  storage_path text,
  drive_file_id text,
  drive_url text,
  sha256 text,
  bytes bigint,
  width integer,
  height integer,
  duration_s numeric,
  ai_generated boolean not null default false,
  rights_note text,
  qc_status text not null default 'pending'::text,
  qc_report jsonb,
  created_at timestamp with time zone not null default now(),
  constraint creatives_kind_check CHECK ((kind = ANY (ARRAY['image'::text, 'video'::text]))),
  constraint creatives_pkey PRIMARY KEY (id),
  constraint creatives_qc_status_check CHECK ((qc_status = ANY (ARRAY['pending'::text, 'pass'::text, 'fail'::text]))),
  constraint creatives_sha256_key UNIQUE (sha256)
);

create table marketing.content_items (
  id uuid not null default gen_random_uuid(),
  content_key text not null,
  campaign_id text,
  creative_id uuid,
  channel_id uuid not null,
  kind text not null,
  topic text,
  caption text not null,
  link_url text,
  local_time timestamp without time zone not null,
  tz text not null default 'America/Chicago'::text,
  publish_at timestamp with time zone not null,
  status text not null default 'draft'::text,
  needs_review_reason text,
  approved_at timestamp with time zone,
  approved_by uuid,
  attempts integer not null default 0,
  next_attempt_at timestamp with time zone,
  locked_by text,
  locked_at timestamp with time zone,
  provider_post_id text,
  published_url text,
  published_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint content_items_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES marketing.campaigns(id),
  constraint content_items_caption_check CHECK (((length(caption) >= 1) AND (length(caption) <= 5000))),
  constraint content_items_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES marketing.channels(id),
  constraint content_items_check CHECK (((status <> ALL (ARRAY['approved'::text, 'submitting'::text, 'submitted'::text, 'published'::text])) OR (approved_at IS NOT NULL))),
  constraint content_items_content_key_check CHECK ((content_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{2,95}$'::text)),
  constraint content_items_content_key_key UNIQUE (content_key),
  constraint content_items_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES marketing.creatives(id),
  constraint content_items_kind_check CHECK ((kind = ANY (ARRAY['post'::text, 'reel'::text, 'story'::text]))),
  constraint content_items_link_url_check CHECK (((link_url IS NULL) OR (link_url ~ '^https://'::text))),
  constraint content_items_pkey PRIMARY KEY (id),
  constraint content_items_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'quality_check'::text, 'ready'::text, 'approved'::text, 'submitting'::text, 'verify_pending'::text, 'submitted'::text, 'published'::text, 'needs_review'::text, 'failed'::text, 'retry_pending'::text, 'canceled'::text])))
);

create table marketing.events (
  id bigint not null,   -- identity in production
  at timestamp with time zone not null default now(),
  actor text not null,
  kind text not null,
  content_id uuid,
  detail jsonb,
  constraint events_pkey PRIMARY KEY (id)
);

create table marketing.owners (
  user_id uuid not null,
  note text,
  created_at timestamp with time zone not null default now(),
  constraint owners_pkey PRIMARY KEY (user_id)
);

create table marketing.publish_jobs (
  id bigint not null,   -- identity in production
  content_id uuid not null,
  attempt integer not null,
  idempotency_key text not null,
  provider text not null,
  state text not null default 'sending'::text,
  provider_post_id text,
  error_code text,
  error_detail text,
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  worker text,
  constraint publish_jobs_content_id_fkey FOREIGN KEY (content_id) REFERENCES marketing.content_items(id) ON DELETE CASCADE,
  constraint publish_jobs_idempotency_key_key UNIQUE (idempotency_key),
  constraint publish_jobs_pkey PRIMARY KEY (id),
  constraint publish_jobs_state_check CHECK ((state = ANY (ARRAY['sending'::text, 'accepted'::text, 'rejected'::text, 'error'::text, 'timeout'::text, 'found_existing'::text])))
);

create table marketing.runs (
  id bigint not null,   -- identity in production
  job text not null,
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  ok boolean,
  summary jsonb,
  constraint runs_pkey PRIMARY KEY (id)
);

create table marketing.settings (
  id smallint not null default 1,
  publishing_paused boolean not null default true,
  mode text not null default 'review'::text,
  timezone text not null default 'America/Chicago'::text,
  push_window_days integer not null default 7,
  daily_cap_per_channel integer not null default 10,
  late_grace_minutes integer not null default 120,
  max_attempts integer not null default 3,
  targets jsonb not null default '{"reserve_days": 14, "facebook_page": {"posts_per_week": 5, "videos_per_week": 3}}'::jsonb,
  auto_allowed jsonb not null default '{"kinds": [], "topics": []}'::jsonb,
  qc_policy text,
  pronunciation jsonb,
  updated_at timestamp with time zone not null default now(),
  constraint settings_daily_cap_per_channel_check CHECK (((daily_cap_per_channel >= 1) AND (daily_cap_per_channel <= 25))),
  constraint settings_id_check CHECK ((id = 1)),
  constraint settings_mode_check CHECK ((mode = ANY (ARRAY['review'::text, 'auto'::text]))),
  constraint settings_pkey PRIMARY KEY (id),
  constraint settings_push_window_days_check CHECK (((push_window_days >= 1) AND (push_window_days <= 28)))
);

CREATE OR REPLACE FUNCTION marketing.tg_content_times() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
begin
  new.publish_at := new.local_time at time zone new.tz;  -- DST-correct via tz database
  new.updated_at := now();
  return new;
end $function$;

CREATE OR REPLACE FUNCTION marketing.tg_content_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into marketing.events(actor, kind, content_id, detail)
    values (coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), current_user),
            'status:' || new.status, new.id,
            jsonb_build_object('from', case when tg_op = 'UPDATE' then old.status end, 'error', new.last_error));
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION marketing.is_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  select exists (select 1 from marketing.owners o where o.user_id = (select auth.uid()));
$function$;

CREATE OR REPLACE FUNCTION marketing.owner_set_paused(p_paused boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
begin
  if not marketing.is_owner() then raise exception 'not allowed'; end if;
  update marketing.settings set publishing_paused = p_paused, updated_at = now() where id = 1;
  insert into marketing.events(actor, kind, detail) values ((select auth.uid())::text,
         case when p_paused then 'paused' else 'resumed' end, null);
end $function$;

CREATE OR REPLACE FUNCTION marketing.owner_review(p_content_id uuid, p_approve boolean, p_note text DEFAULT NULL::text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare v text;
begin
  if not marketing.is_owner() then raise exception 'not allowed'; end if;
  update marketing.content_items
     set status = case when p_approve then 'approved' else 'canceled' end,
         approved_at = case when p_approve then now() end,
         approved_by = case when p_approve then (select auth.uid()) end,
         needs_review_reason = case when p_approve then null else coalesce(p_note, 'rejected by owner') end
   where id = p_content_id and status in ('ready','needs_review')
  returning status into v;
  if v is null then raise exception 'item is not awaiting review'; end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION marketing.queue_health() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  with s as (select * from marketing.settings where id = 1),
  days as (
    select count(distinct (ci.publish_at at time zone s.timezone)::date) as covered
      from marketing.content_items ci, s
     where ci.status in ('approved','submitting','verify_pending','submitted')
       and ci.publish_at between now() and now() + interval '14 days')
  select jsonb_build_object(
    'paused', (select publishing_paused from s),
    'mode', (select mode from s),
    'days_covered_next_14', (select covered from days),
    'awaiting_approval', (select count(*) from marketing.content_items where status = 'ready'),
    'needs_review', (select count(*) from marketing.content_items where status = 'needs_review'),
    'failed_7d', (select count(*) from marketing.content_items where status = 'failed' and updated_at > now() - interval '7 days'),
    'stuck_submitting', (select count(*) from marketing.content_items where status = 'submitting' and locked_at < now() - interval '10 minutes'),
    'channels_not_connected', (select count(*) from marketing.channels where status <> 'connected'),
    'last_runs', (select coalesce(jsonb_object_agg(job, last), '{}') from
                   (select job, max(started_at) as last from marketing.runs group by job) r)
  );
$function$;

CREATE OR REPLACE FUNCTION marketing.claim_due(p_worker text, p_limit integer DEFAULT 10)
 RETURNS TABLE(content_id uuid, content_key text, job_id bigint, idempotency_key text, attempt integer, provider text, provider_channel_id text,
               kind text, caption text, link_url text, publish_at timestamp with time zone, creative_id uuid, publish_now boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare s marketing.settings; r record; v_job bigint; v_key text;
begin
  select * into s from marketing.settings where id = 1;
  if s.publishing_paused then return; end if;
  -- One claimer at a time (held to end of transaction): the daily cap counts rows other workers
  -- claimed but had not committed yet. Claiming takes milliseconds, so this costs nothing.
  perform pg_advisory_xact_lock(hashtext('marketing.claim_due'));

  -- missed slots: too late to post, hand to a person
  update marketing.content_items ci set status = 'needs_review',
         needs_review_reason = 'missed its time slot by more than ' || s.late_grace_minutes || ' min'
   where ci.status in ('approved','retry_pending')
     and ci.publish_at < now() - make_interval(mins => s.late_grace_minutes);

  for r in
    select ci.*, ch.provider as ch_provider, ch.provider_channel_id as ch_pid
      from marketing.content_items ci
      join marketing.channels ch on ch.id = ci.channel_id
     where ch.status = 'connected'
       and (ci.status = 'approved' or (ci.status = 'retry_pending' and ci.next_attempt_at <= now()))
       and ci.publish_at <= now() + make_interval(days => s.push_window_days)
       and (ci.creative_id is null or exists (select 1 from marketing.creatives c
                                              where c.id = ci.creative_id and c.qc_status = 'pass'))
       and (select count(*) from marketing.content_items x
             where x.channel_id = ci.channel_id
               and x.status in ('submitting','verify_pending','submitted','published')
               and (x.publish_at at time zone s.timezone)::date = (ci.publish_at at time zone s.timezone)::date
           ) < s.daily_cap_per_channel
     order by ci.publish_at
     limit p_limit
     for update of ci skip locked
  loop
    -- re-check the daily cap per row: the candidate list was read before this loop claimed anything
    if (select count(*) from marketing.content_items x
         where x.channel_id = r.channel_id
           and x.status in ('submitting','verify_pending','submitted','published')
           and (x.publish_at at time zone s.timezone)::date = (r.publish_at at time zone s.timezone)::date
       ) >= s.daily_cap_per_channel then
      continue;
    end if;
    v_key := r.content_key || ':' || (r.attempts + 1);
    update marketing.content_items set status = 'submitting', attempts = attempts + 1,
           locked_by = p_worker, locked_at = now(), last_error = null
     where id = r.id;
    insert into marketing.publish_jobs(content_id, attempt, idempotency_key, provider, worker)
    values (r.id, r.attempts + 1, v_key, r.ch_provider, p_worker) returning id into v_job;
    content_id := r.id; content_key := r.content_key; job_id := v_job; idempotency_key := v_key;
    attempt := r.attempts + 1; provider := r.ch_provider; provider_channel_id := r.ch_pid;
    kind := r.kind; caption := r.caption; link_url := r.link_url; publish_at := r.publish_at;
    creative_id := r.creative_id; publish_now := r.publish_at < now() + interval '15 minutes';
    return next;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION marketing.record_submit(p_job_id bigint, p_outcome text, p_provider_post_id text DEFAULT NULL::text,
  p_error_code text DEFAULT NULL::text, p_error_detail text DEFAULT NULL::text) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare j marketing.publish_jobs; ci marketing.content_items; s marketing.settings; v_status text;
begin
  select * into s from marketing.settings where id = 1;
  select * into j from marketing.publish_jobs where id = p_job_id for update;
  if not found then raise exception 'unknown job %', p_job_id; end if;
  select * into ci from marketing.content_items where id = j.content_id for update;
  if ci.status <> 'submitting' then return ci.status; end if;  -- already resolved; never double-apply

  update marketing.publish_jobs set state = p_outcome, provider_post_id = p_provider_post_id,
         error_code = p_error_code, error_detail = left(p_error_detail, 2000), finished_at = now()
   where id = p_job_id;

  v_status := case
    when p_outcome in ('accepted','found_existing') then 'submitted'
    when p_outcome = 'timeout' then 'verify_pending'          -- look it up before any resend
    when p_outcome = 'rejected' then 'failed'
    when ci.attempts >= s.max_attempts then 'failed'
    else 'retry_pending' end;

  update marketing.content_items set status = v_status,
         provider_post_id = coalesce(p_provider_post_id, provider_post_id),
         last_error = case when p_outcome in ('accepted','found_existing') then null
                           else coalesce(p_error_code, '') || ': ' || coalesce(left(p_error_detail, 500), '') end,
         next_attempt_at = case when v_status = 'retry_pending' then now() +
                               (array[interval '5 minutes', interval '30 minutes', interval '120 minutes'])[least(ci.attempts, 3)] end,
         locked_by = null, locked_at = null
   where id = ci.id;
  return v_status;
end $function$;

CREATE OR REPLACE FUNCTION marketing.recover_stale(p_minutes integer DEFAULT 10) RETURNS integer
 LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
  with u as (
    update marketing.content_items set status = 'verify_pending', locked_by = null, locked_at = null,
           last_error = 'worker stopped mid-send; verifying with provider'
     where status = 'submitting' and locked_at < now() - make_interval(mins => p_minutes)
    returning 1)
  select count(*)::int from u;
$function$;

CREATE OR REPLACE FUNCTION marketing.due_for_reconcile(p_limit integer DEFAULT 50)
 RETURNS TABLE(content_id uuid, content_key text, status text, provider text, provider_channel_id text, provider_post_id text,
               publish_at timestamp with time zone, attempts integer, caption text)
 LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
  select ci.id, ci.content_key, ci.status, ch.provider, ch.provider_channel_id, ci.provider_post_id, ci.publish_at, ci.attempts, ci.caption
    from marketing.content_items ci join marketing.channels ch on ch.id = ci.channel_id
   where ci.status = 'verify_pending'
      or (ci.status = 'submitted' and ci.publish_at < now() - interval '5 minutes')
   order by ci.publish_at limit p_limit;
$function$;

CREATE OR REPLACE FUNCTION marketing.record_status(p_content_id uuid, p_state text, p_provider_post_id text DEFAULT NULL::text,
  p_url text DEFAULT NULL::text, p_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_error text DEFAULT NULL::text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare ci marketing.content_items; s marketing.settings; v text;
begin
  select * into s from marketing.settings where id = 1;
  select * into ci from marketing.content_items where id = p_content_id for update;
  if not found then raise exception 'unknown content %', p_content_id; end if;
  v := case
    when p_state = 'published' then 'published'
    when p_state = 'scheduled' then 'submitted'
    when p_state = 'error' then 'failed'
    when p_state = 'not_found' and ci.status = 'verify_pending' and ci.attempts < s.max_attempts then 'retry_pending'
    when p_state = 'not_found' then 'needs_review'
    else ci.status end;
  update marketing.content_items set status = v,
         provider_post_id = coalesce(p_provider_post_id, provider_post_id),
         published_url = coalesce(p_url, published_url),
         published_at = case when v = 'published' then coalesce(p_published_at, now()) else published_at end,
         last_error = case when v in ('failed','needs_review') then coalesce(p_error, 'provider reports ' || p_state) else null end,
         needs_review_reason = case when v = 'needs_review' then 'provider has no record of this post' else needs_review_reason end,
         next_attempt_at = case when v = 'retry_pending' then now() else null end
   where id = ci.id;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION marketing.record_health(p_channel uuid, p_ok boolean, p_detail text) RETURNS text
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare v text;
begin
  update marketing.channels set last_health_at = now(), last_health_detail = left(p_detail, 500),
         status = case when p_ok then status when status = 'connected' then 'needs_reauth' else status end
   where id = p_channel returning status into v;
  if not p_ok then
    insert into marketing.events(actor, kind, detail) values ('scheduler', 'alert:channel_health',
      jsonb_build_object('channel', p_channel, 'detail', p_detail));
  end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION marketing.cron_call(p_route text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $function$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mkt_project_url')
           || '/functions/v1/mkt-scheduler/' || p_route,
    headers := jsonb_build_object('Content-Type', 'application/json',
               'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mkt_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$function$;

-- pg_cron jobs in production (all active; push does nothing while settings.publishing_paused is true):
--   mkt-push       '*/15 * * * *'       select marketing.cron_call('push')
--   mkt-reconcile  '7,22,37,52 * * * *' select marketing.cron_call('reconcile')
--   mkt-health     '41 * * * *'         select marketing.cron_call('health')
--   mkt-digest     '7 14 * * 1'         select marketing.cron_call('health?digest=1')
--   mkt-cleanup    '23 4 * * *'         delete old cron.job_run_details (14 d) and marketing.runs (60 d)
