-- =============================================================================
--  PLUMBLINE — PATCH 003 (Supabase / PostgreSQL)
-- =============================================================================
--  Runs AFTER plumbline_supabase_setup_claude.sql. Idempotent; safe to re-run.
--
--  Fixes three gaps in the 001+002 setup:
--    1. Identity tables exposed via Supabase PostgREST (anon/authenticated
--       auto-grants on public tables, incl. users.password_hash).
--    2. audit_log append-only enforced only against Supabase client roles,
--       not the API/owner role.
--    4. No DB support for the password-change flow (§3.1) or expired
--       session/token purging.
--
--  NOTE on RLS semantics: RLS is ENABLEd, not FORCEd, so the Express API
--  (connecting as table owner) is unaffected. Supabase's anon/authenticated
--  roles hit deny-by-default (RLS on, no policies). service_role has
--  BYPASSRLS by design — protect that key operationally.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Lock down the seven unprotected tables
--    RLS with no policies = deny-by-default for non-owner roles.
--    Belt and suspenders: also revoke the Supabase auto-grants outright.
-- ---------------------------------------------------------------------------
alter table users            enable row level security;
alter table sessions         enable row level security;
alter table remember_tokens  enable row level security;
alter table activity_log     enable row level security;
alter table capabilities     enable row level security;
alter table saved_workflows  enable row level security;
alter table audit_log        enable row level security;

do $$
declare
  t text;
  r text;
begin
  foreach t in array array['users','sessions','remember_tokens','activity_log',
                           'capabilities','saved_workflows','audit_log'] loop
    foreach r in array array['anon','authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table %I from %I', t, r);
      end if;
    end loop;
  end loop;
end $$;

-- Sequences behind bigserial/identity columns (activity_log, audit_log)
do $$
declare
  s text;
  r text;
begin
  for s in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
      and c.relname like any (array['activity_log%','audit_log%'])
  loop
    foreach r in array array['anon','authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on sequence %I from %I', s, r);
      end if;
    end loop;
  end loop;
end $$;

-- Stop future public tables from being auto-granted to client roles.
-- (Comment out if other apps in this project rely on PostgREST table access.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    alter default privileges in schema public revoke all on tables from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter default privileges in schema public revoke all on tables from authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. audit_log: append-only against EVERYONE, including the owner role.
--    A BEFORE trigger raises on any UPDATE or DELETE. Pruning old audit
--    rows (if ever needed) requires deliberately dropping this trigger —
--    which is the correct amount of friction for a security log.
-- ---------------------------------------------------------------------------
create or replace function trg_audit_append_only_fn() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only (% attempted on audit_id %)',
    tg_op, old.audit_id;
end $$;

drop trigger if exists trg_audit_append_only on audit_log;
create trigger trg_audit_append_only
  before update or delete on audit_log
  for each row execute function trg_audit_append_only_fn();

-- ---------------------------------------------------------------------------
-- 4a. Atomic password change per §3.1:
--     new bcrypt($2a$10) hash + audit_log(PASSWORD_CHANGED)
--     + revoke all sessions + delete all remember_tokens.
--     Callable by the user themself or by a superuser (maintenance screen).
--     Returns the target user id; raises on any authorization failure.
-- ---------------------------------------------------------------------------
create or replace function admin_reset_password(
  p_actor_user_id  uuid,
  p_target_user_id uuid,
  p_new_password   text
) returns uuid
language plpgsql as $$
declare
  v_actor_type text;
begin
  if p_new_password is null or length(p_new_password) < 8 then
    raise exception 'password must be at least 8 characters';
  end if;

  select user_type into v_actor_type
  from users where id = p_actor_user_id and is_active;
  if v_actor_type is null then
    raise exception 'actor % not found or inactive', p_actor_user_id;
  end if;
  if p_actor_user_id <> p_target_user_id and v_actor_type <> 'superuser' then
    raise exception 'only a superuser may change another user''s password';
  end if;

  update users
  set password_hash = crypt(p_new_password, gen_salt('bf', 10))
  where id = p_target_user_id;
  if not found then
    raise exception 'target user % not found', p_target_user_id;
  end if;

  update sessions set revoked_at = now()
  where user_id = p_target_user_id and revoked_at is null;

  delete from remember_tokens where user_id = p_target_user_id;

  insert into audit_log (actor_user_id, action, entity_type, entity_id, details)
  values (p_actor_user_id, 'PASSWORD_CHANGED', 'users', p_target_user_id,
          jsonb_build_object('self_service', p_actor_user_id = p_target_user_id));

  return p_target_user_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4b. Superuser session revocation (maintenance screen), audited.
-- ---------------------------------------------------------------------------
create or replace function admin_revoke_sessions(
  p_actor_user_id  uuid,
  p_target_user_id uuid
) returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  if not exists (select 1 from users
                 where id = p_actor_user_id and is_active and user_type = 'superuser') then
    raise exception 'only an active superuser may revoke sessions';
  end if;

  update sessions set revoked_at = now()
  where user_id = p_target_user_id and revoked_at is null;
  get diagnostics v_count = row_count;

  insert into audit_log (actor_user_id, action, entity_type, entity_id, details)
  values (p_actor_user_id, 'SU_REVOKED_SESSIONS', 'users', p_target_user_id,
          jsonb_build_object('sessions_revoked', v_count));

  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 4c. Purge expired auth artifacts.
--     Deletes expired remember_tokens, and sessions that are expired or
--     revoked for more than the retention window (kept briefly for the
--     history/audit view's ip/user_agent fingerprints).
-- ---------------------------------------------------------------------------
create or replace function purge_expired_auth(p_retain_days integer default 30)
returns table (sessions_purged bigint, tokens_purged bigint)
language plpgsql as $$
declare
  v_sessions bigint;
  v_tokens   bigint;
begin
  delete from sessions
  where expires_at < now() - make_interval(days => p_retain_days)
     or (revoked_at is not null
         and revoked_at < now() - make_interval(days => p_retain_days));
  get diagnostics v_sessions = row_count;

  delete from remember_tokens where expires_at < now();
  get diagnostics v_tokens = row_count;

  return query select v_sessions, v_tokens;
end $$;

-- Schedule nightly at 04:10 UTC if pg_cron is available (it is on Supabase:
-- Dashboard -> Database -> Extensions -> enable pg_cron, or this block does it).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      execute 'create extension if not exists pg_cron with schema extensions';
    exception when others then
      begin
        execute 'create extension if not exists pg_cron';
      exception when others then null;
      end;
    end;
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
      perform cron.unschedule(jobid)
      from cron.job where jobname = 'plumbline_purge_expired_auth';
      perform cron.schedule('plumbline_purge_expired_auth',
                            '10 4 * * *',
                            $job$select purge_expired_auth();$job$);
    end if;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- Verification (read-only)
-- ---------------------------------------------------------------------------
select 'identity tables with RLS on' as check, count(*) as value
from pg_tables
where schemaname = 'public' and rowsecurity
  and tablename in ('users','sessions','remember_tokens','activity_log',
                    'capabilities','saved_workflows','audit_log')
union all
select 'audit append-only trigger', count(*)
from pg_trigger where tgname = 'trg_audit_append_only' and not tgisinternal
union all
select 'helper functions (expect 3)', count(*)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_reset_password','admin_revoke_sessions','purge_expired_auth')
union all
select 'anon grants remaining on identity tables (expect 0)', count(*)
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
  and table_name in ('users','sessions','remember_tokens','activity_log',
                     'capabilities','saved_workflows','audit_log');

-- Smoke test the audit trigger (should FAIL with 'audit_log is append-only'):
--   update audit_log set action = 'X' where audit_id = (select min(audit_id) from audit_log);
-- Smoke test password reset (as rob, self-service):
--   select admin_reset_password(
--     (select id from users where username='rob'),
--     (select id from users where username='rob'),
--     'a-real-password-now');
