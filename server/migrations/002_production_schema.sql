-- =============================================================================
--  PLUMBLINE — PRODUCTION DATABASE SETUP (Supabase / PostgreSQL)
-- =============================================================================
--  Implements: Plumbline Production Database Design v2.0 (001 + migration 002)
--  Grounded in github.com/rmsamuel2/plumbline:
--    server/migrations/001_init.sql, server/src/index.js (bcryptjs cost 10),
--    src/data/data-gateway.js, docs/RECOVERY.md
--
--  HOW TO RUN (interactively, in Supabase):
--    1. Supabase Dashboard -> SQL Editor -> New query
--    2. Paste this entire file -> Run
--    3. Re-running is safe: every statement is idempotent.
--
--  Or from a shell:  psql "$SUPABASE_DB_URL" -f plumbline_supabase_setup.sql
--
--  WHAT IT CREATES
--    * The full 001 base schema (users, saved_workflows, activity_log,
--      sessions, remember_tokens, capabilities) if not already present.
--    * Migration 002: audit_log, workflow_group, workflow, workflow_version,
--      process, stage, state, transition, state_dependency, cost_item,
--      custom_state_type, analysis_run, analysis_finding.
--    * All integrity triggers (fully implemented, not stubs).
--    * Views: v_state_cost, v_workflow_tree, v_users_admin (NO password_hash —
--      the superuser "see everything BUT passwords" surface).
--    * Row-level security policies (ENABLEd, not FORCEd — the existing
--      Express API, which connects as the table owner, keeps working;
--      Supabase's anon/authenticated roles are locked down).
--    * Backfill of any existing saved_workflows rows into workflow/version.
--    * Two superuser accounts:  rob / password   and   max / password
--      (bcrypt $2a$10 hashes via pgcrypto — verifiable by the app's
--      bcryptjs.compare(); change these passwords before real use).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Extensions
--    pgcrypto supplies gen_random_uuid(), crypt(), gen_salt().
--    On Supabase it usually lives in the "extensions" schema which is already
--    on the search_path; on vanilla Postgres it installs into public.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    execute 'create extension if not exists pgcrypto with schema extensions';
  exception when others then
    execute 'create extension if not exists pgcrypto';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Base schema (001_init.sql) — created only if missing, so this script
--    works on a brand-new Supabase project OR on top of a running 001 DB.
-- ---------------------------------------------------------------------------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique,
  email         text unique,
  password_hash text not null,             -- bcrypt; never store clear text
  user_type     text not null default 'user'
                  check (user_type in ('user','analyst','superuser')),
  is_active     boolean not null default true,
  display_name  text default '',
  team          text default '',
  role          text default '',
  region        text default '',
  created_at    timestamptz not null default now()
);

create table if not exists saved_workflows (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  name           text not null,
  workflow       jsonb not null,
  config         jsonb not null default '{}'::jsonb,
  tools_executed jsonb not null default '[]'::jsonb,
  layout         jsonb not null default '{}'::jsonb,
  saved_at       timestamptz not null default now()
);
create index if not exists saved_workflows_user_idx on saved_workflows(user_id, saved_at desc);

create table if not exists activity_log (
  id       bigserial primary key,
  user_id  uuid not null references users(id) on delete cascade,
  action   text not null,
  meta     jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index if not exists activity_user_idx on activity_log(user_id, at desc);

create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ip          text,
  user_agent  text
);

create table if not exists remember_tokens (
  token_hash  text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  expires_at  timestamptz not null
);

create table if not exists capabilities (
  user_type   text not null,
  capability  text not null,
  primary key (user_type, capability)
);
insert into capabilities(user_type, capability) values
  ('user','save_workflow'),
  ('analyst','save_workflow'), ('analyst','run_conformance'),
  ('superuser','*')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. 002.1 — extend the identity tables
-- ---------------------------------------------------------------------------
alter table users    add column if not exists updated_at timestamptz not null default now();
alter table sessions add column if not exists revoked_at timestamptz;

-- ADD CONSTRAINT has no IF NOT EXISTS: guard it.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'users_login_present'
                   and conrelid = 'users'::regclass) then
    alter table users
      add constraint users_login_present
      check (username is not null or email is not null);
  end if;
end $$;

create index if not exists sessions_user_valid_idx on sessions(user_id, revoked_at);

-- ---------------------------------------------------------------------------
-- 3. 002.2 — security-grade audit log (append-only)
-- ---------------------------------------------------------------------------
create table if not exists audit_log (
  audit_id       bigint generated always as identity primary key,
  actor_user_id  uuid references users(id) on delete set null,
  action         text not null,   -- PASSWORD_CHANGED, SU_VIEWED_USER_DATA, ...
  entity_type    text,
  entity_id      uuid,
  details        jsonb,
  occurred_at    timestamptz not null default now()
);
create index if not exists audit_actor_idx  on audit_log(actor_user_id, occurred_at desc);
create index if not exists audit_entity_idx on audit_log(entity_type, entity_id);

-- Append-only for Supabase client roles (guarded: roles exist only on Supabase)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke update, delete on audit_log from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke update, delete on audit_log from anon;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. 002.3 — recursive workflow groups (folders)
-- ---------------------------------------------------------------------------
create table if not exists workflow_group (
  group_id        uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references users(id) on delete restrict,
  parent_group_id uuid references workflow_group(group_id) on delete restrict,
  name            text not null,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint group_not_own_parent check (parent_group_id <> group_id)
);
create unique index if not exists group_sibling_name_uq on workflow_group
  (owner_user_id, coalesce(parent_group_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

-- Trigger: reject folder cycles by walking ancestors.
create or replace function trg_group_no_cycle_fn() returns trigger
language plpgsql as $$
declare
  cur uuid := new.parent_group_id;
begin
  while cur is not null loop
    if cur = new.group_id then
      raise exception 'workflow_group cycle detected: group % cannot be its own ancestor', new.group_id;
    end if;
    select parent_group_id into cur from workflow_group where group_id = cur;
  end loop;
  return new;
end $$;

drop trigger if exists trg_group_no_cycle on workflow_group;
create trigger trg_group_no_cycle
  before insert or update of parent_group_id on workflow_group
  for each row execute function trg_group_no_cycle_fn();

-- ---------------------------------------------------------------------------
-- 5. 002.4 — workflows + immutable versions
-- ---------------------------------------------------------------------------
create table if not exists workflow (
  workflow_id        uuid primary key default gen_random_uuid(),
  owner_user_id      uuid not null references users(id) on delete restrict,
  group_id           uuid references workflow_group(group_id) on delete restrict,
  name               text not null,
  description        text,
  current_version_id uuid,                 -- FK added below (circular)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (owner_user_id, name)
);
create index if not exists workflow_owner_group_idx on workflow(owner_user_id, group_id);

-- Trigger: the folder's owner must equal the workflow's owner.
create or replace function trg_workflow_group_owner_fn() returns trigger
language plpgsql as $$
declare
  g_owner uuid;
begin
  if new.group_id is not null then
    select owner_user_id into g_owner from workflow_group where group_id = new.group_id;
    if g_owner is distinct from new.owner_user_id then
      raise exception 'workflow % owner does not match folder owner', new.workflow_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_workflow_group_owner on workflow;
create trigger trg_workflow_group_owner
  before insert or update of group_id, owner_user_id on workflow
  for each row execute function trg_workflow_group_owner_fn();

create table if not exists workflow_version (
  version_id      uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references workflow(workflow_id) on delete cascade,
  version_number  integer not null,
  kind            text not null check (kind in ('ORIGINAL','EDIT','ANALYSIS')),
  label           text,
  snapshot        jsonb not null,                        -- = 001 saved_workflows.workflow
  config          jsonb not null default '{}'::jsonb,    -- EXACT UI configuration
  tools_executed  jsonb not null default '[]'::jsonb,    -- analysis tools run
  layout          jsonb not null default '{}'::jsonb,    -- tile screen positions
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (workflow_id, version_number)
);
create unique index if not exists one_original_per_workflow
  on workflow_version(workflow_id) where kind = 'ORIGINAL';
create index if not exists version_recency_idx on workflow_version(workflow_id, version_number desc);

-- Trigger: versions are immutable; ORIGINAL cannot even be deleted directly.
-- (Deleting the whole workflow still cascades — that is the audited path.)
create or replace function trg_version_immutable_fn() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'workflow_version rows are immutable (version %)', old.version_id;
  elsif tg_op = 'DELETE' then
    if old.kind = 'ORIGINAL'
       and exists (select 1 from workflow w where w.workflow_id = old.workflow_id) then
      raise exception 'the ORIGINAL version of a workflow cannot be deleted (version %)', old.version_id;
    end if;
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_version_immutable on workflow_version;
create trigger trg_version_immutable
  before update or delete on workflow_version
  for each row execute function trg_version_immutable_fn();

-- Circular FK: workflow.current_version_id -> workflow_version (deferrable).
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'workflow_current_version_fk'
                   and conrelid = 'workflow'::regclass) then
    alter table workflow
      add constraint workflow_current_version_fk
      foreign key (current_version_id) references workflow_version(version_id)
      on delete set null deferrable initially deferred;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. 002.5 — FSM content (one process per version)
-- ---------------------------------------------------------------------------
create table if not exists process (
  process_id        uuid primary key default gen_random_uuid(),
  version_id        uuid not null unique references workflow_version(version_id) on delete cascade,
  process_key       text not null,
  name              text not null,
  description       text,
  process_domain    text,
  owner_team        text,
  naming_convention text,
  default_currency  text not null default 'USD',
  is_custom_process boolean not null default false,
  infinite_canvas   boolean not null default false,
  ext               jsonb not null default '{}'::jsonb
);

create table if not exists stage (
  stage_id     uuid primary key default gen_random_uuid(),
  process_id   uuid not null references process(process_id) on delete cascade,
  stage_key    text not null,
  name         text not null,
  stage_order  integer not null check (stage_order >= 1),
  owner_role   text,
  description  text,
  visual_color text,
  manual_x     numeric,
  manual_y     numeric,
  unique (process_id, stage_key)
);
create index if not exists stage_order_idx on stage(process_id, stage_order);

create table if not exists custom_state_type (
  custom_type_id uuid primary key default gen_random_uuid(),
  process_id     uuid not null references process(process_id) on delete cascade,
  type_key       text not null,
  label          text not null,
  fill_color     text not null,
  stroke_color   text not null,
  description    text,
  unique (process_id, type_key)
);

create table if not exists state (
  state_id                  uuid primary key default gen_random_uuid(),
  process_id                uuid not null references process(process_id) on delete cascade,
  stage_id                  uuid not null references stage(stage_id) on delete restrict,
  state_key                 text not null check (state_key ~ '^[A-Za-z0-9_-]+$'),
  name                      text not null,
  sort_order                integer not null default 100 check (sort_order >= 1),
  state_type                text not null,
  is_initial                boolean not null default false,
  entry_action              text,
  exit_action               text,
  description               text,
  owner_role                text,
  expected_duration_minutes numeric check (expected_duration_minutes >= 0),
  sla_minutes               numeric check (sla_minutes >= 0),
  manual_x                  numeric,
  manual_y                  numeric,
  ext                       jsonb not null default '{}'::jsonb,
  unique (process_id, state_key)
);
create index if not exists state_stage_idx   on state(stage_id);
create index if not exists state_initial_idx on state(process_id) where is_initial;

-- Trigger: state's stage must belong to the state's process;
--          state_type must be built-in or a custom type of the same process;
--          keep is_initial = (state_type = 'START').
create or replace function trg_state_guard_fn() returns trigger
language plpgsql as $$
declare
  stage_proc uuid;
begin
  select process_id into stage_proc from stage where stage_id = new.stage_id;
  if stage_proc is distinct from new.process_id then
    raise exception 'state %: stage belongs to a different process', new.state_key;
  end if;

  if upper(new.state_type) not in ('START','NORMAL','WARNING','ERROR','FINAL')
     and not exists (select 1 from custom_state_type c
                     where c.process_id = new.process_id
                       and c.type_key   = new.state_type) then
    raise exception 'state %: unknown state_type "%" (not built-in, no matching custom_state_type)',
      new.state_key, new.state_type;
  end if;

  new.is_initial := (upper(new.state_type) = 'START');
  return new;
end $$;

drop trigger if exists trg_state_guard on state;
create trigger trg_state_guard
  before insert or update on state
  for each row execute function trg_state_guard_fn();

create table if not exists transition (
  transition_id   uuid primary key default gen_random_uuid(),
  process_id      uuid not null references process(process_id) on delete cascade,
  transition_key  text not null check (transition_key ~ '^[A-Za-z0-9_-]+$'),
  event_name      text not null,
  from_state_id   uuid not null references state(state_id) on delete cascade,
  to_state_id     uuid not null references state(state_id) on delete cascade,
  guard_condition text,
  action          text,
  description     text,
  sort_order      integer not null default 100 check (sort_order >= 1),
  ext             jsonb not null default '{}'::jsonb,
  unique (process_id, transition_key)
);
create index if not exists transition_from_idx on transition(from_state_id);
create index if not exists transition_to_idx   on transition(to_state_id);

-- Trigger: both endpoints must belong to the transition's process (self-loops legal).
create or replace function trg_transition_same_process_fn() returns trigger
language plpgsql as $$
declare
  from_proc uuid; to_proc uuid;
begin
  select process_id into from_proc from state where state_id = new.from_state_id;
  select process_id into to_proc   from state where state_id = new.to_state_id;
  if from_proc is distinct from new.process_id
     or to_proc is distinct from new.process_id then
    raise exception 'transition %: endpoints must belong to the same process', new.transition_key;
  end if;
  return new;
end $$;

drop trigger if exists trg_transition_same_process on transition;
create trigger trg_transition_same_process
  before insert or update on transition
  for each row execute function trg_transition_same_process_fn();

create table if not exists state_dependency (
  state_id            uuid not null references state(state_id) on delete cascade,
  depends_on_state_id uuid not null references state(state_id) on delete cascade,
  primary key (state_id, depends_on_state_id),
  constraint dep_not_self check (state_id <> depends_on_state_id)
);

-- Trigger: same-process check + dependency-cycle rejection
-- (mirrors the editor's dependencyCycle guard at the database boundary).
create or replace function trg_dependency_guard_fn() returns trigger
language plpgsql as $$
declare
  p1 uuid; p2 uuid; has_cycle boolean;
begin
  select process_id into p1 from state where state_id = new.state_id;
  select process_id into p2 from state where state_id = new.depends_on_state_id;
  if p1 is distinct from p2 then
    raise exception 'state_dependency: both states must belong to the same process';
  end if;

  -- If, starting from the prerequisite, we can already reach the dependent
  -- state through existing edges, adding this edge closes a cycle.
  with recursive walk(sid) as (
    select new.depends_on_state_id
    union
    select d.depends_on_state_id
    from state_dependency d join walk w on d.state_id = w.sid
  )
  select exists (select 1 from walk where sid = new.state_id) into has_cycle;

  if has_cycle then
    raise exception 'state_dependency: cycle detected (% <-> %)', new.state_id, new.depends_on_state_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_dependency_guard on state_dependency;
create trigger trg_dependency_guard
  before insert or update on state_dependency
  for each row execute function trg_dependency_guard_fn();

create table if not exists cost_item (
  cost_item_id  uuid primary key default gen_random_uuid(),
  process_id    uuid not null references process(process_id) on delete cascade,
  applies_to    text not null check (applies_to in ('STATE','TRANSITION')),
  state_id      uuid references state(state_id) on delete cascade,
  transition_id uuid references transition(transition_id) on delete cascade,
  cost_category text not null,
  unit_name     text not null default 'occurrence',
  unit_cost_min numeric(12,2) not null check (unit_cost_min >= 0),
  unit_cost_max numeric(12,2) not null,
  source_name   text,
  cost_kind     text not null default 'COST'     check (cost_kind  = 'COST'),
  cost_scope    text not null default 'BOX_TASK' check (cost_scope = 'BOX_TASK'),
  constraint cost_minmax check (unit_cost_max >= unit_cost_min),
  constraint cost_target check (
       (applies_to = 'STATE'      and state_id is not null and transition_id is null)
    or (applies_to = 'TRANSITION' and transition_id is not null and state_id is null))
);
create index if not exists cost_state_idx on cost_item(state_id);

-- Derived cost roll-up: computed, never stored.
create or replace view v_state_cost as
  select s.state_id,
         coalesce(sum(c.unit_cost_min), 0) as cost_min,
         coalesce(sum(c.unit_cost_max), 0) as cost_max
  from state s
  left join cost_item c on c.state_id = s.state_id and c.cost_kind = 'COST'
  group by s.state_id;

-- ---------------------------------------------------------------------------
-- 7. 002.6 — analysis lineage
-- ---------------------------------------------------------------------------
create table if not exists analysis_run (
  run_id         uuid primary key default gen_random_uuid(),
  version_id     uuid not null references workflow_version(version_id) on delete cascade,
  run_by         uuid references users(id) on delete set null,
  engine_version text,
  status         text not null default 'RUNNING' check (status in ('RUNNING','DONE','FAILED')),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  summary        jsonb
);
create index if not exists run_version_idx on analysis_run(version_id, started_at desc);

create table if not exists analysis_finding (
  finding_id            uuid primary key default gen_random_uuid(),
  run_id                uuid not null references analysis_run(run_id) on delete cascade,
  finding_code          text not null,
  severity              text,
  status                text not null check (status in ('PROVEN','REFUTED','OPEN')),
  target_kind           text not null check (target_kind in ('PROCESS','STAGE','STATE','TRANSITION')),
  target_key            text,
  title                 text not null,
  detail                jsonb,
  applied_in_version_id uuid references workflow_version(version_id) on delete set null,
  applied_at            timestamptz
);
create index if not exists finding_run_idx     on analysis_finding(run_id);
create index if not exists finding_applied_idx on analysis_finding(applied_in_version_id);

-- ---------------------------------------------------------------------------
-- 8. Views for the UI and the superuser maintenance screens
-- ---------------------------------------------------------------------------
-- Folder tree (recursive CTE) for the folder UI.
create or replace view v_workflow_tree as
  with recursive tree as (
    select g.group_id, g.owner_user_id, g.parent_group_id, g.name,
           1 as depth, array[g.name] as path
    from workflow_group g
    where g.parent_group_id is null
    union all
    select c.group_id, c.owner_user_id, c.parent_group_id, c.name,
           t.depth + 1, t.path || c.name
    from workflow_group c join tree t on c.parent_group_id = t.group_id
  )
  select * from tree;

-- Superuser user browser: EVERYTHING except password_hash.
-- "See everything but passwords" is structural — this view has no hash column.
create or replace view v_users_admin as
  select id, username, email, user_type, is_active,
         display_name, team, role, region, created_at, updated_at
  from users;

-- ---------------------------------------------------------------------------
-- 9. updated_at bookkeeping triggers
-- ---------------------------------------------------------------------------
create or replace function trg_touch_updated_at_fn() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_touch_users on users;
create trigger trg_touch_users
  before update on users
  for each row execute function trg_touch_updated_at_fn();

drop trigger if exists trg_touch_workflow on workflow;
create trigger trg_touch_workflow
  before update on workflow
  for each row execute function trg_touch_updated_at_fn();

drop trigger if exists trg_touch_group on workflow_group;
create trigger trg_touch_group
  before update on workflow_group
  for each row execute function trg_touch_updated_at_fn();

-- ---------------------------------------------------------------------------
-- 10. Row-level security
--     The API sets, per transaction after validating the session:
--        SET LOCAL app.user_id = '<uuid>';
--        SET LOCAL app.is_superuser = 'true'|'false';
--     Helpers use current_setting(..., true) so a missing setting means
--     "no access" rather than an error. RLS is ENABLEd (not FORCEd), so the
--     table-owner role the Express API uses today is unaffected until it
--     opts in; Supabase's anon/authenticated roles are governed immediately.
-- ---------------------------------------------------------------------------
create or replace function app_current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app_is_superuser() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('app.is_superuser', true), '')::boolean, false)
$$;

alter table workflow_group   enable row level security;
alter table workflow         enable row level security;
alter table workflow_version enable row level security;
alter table process          enable row level security;
alter table stage            enable row level security;
alter table state            enable row level security;
alter table transition       enable row level security;
alter table state_dependency enable row level security;
alter table cost_item        enable row level security;
alter table custom_state_type enable row level security;
alter table analysis_run     enable row level security;
alter table analysis_finding enable row level security;

-- Direct ownership.
drop policy if exists group_owner on workflow_group;
create policy group_owner on workflow_group
  using (owner_user_id = app_current_user_id() or app_is_superuser());

drop policy if exists workflow_owner on workflow;
create policy workflow_owner on workflow
  using (owner_user_id = app_current_user_id() or app_is_superuser());

-- One hop: version -> workflow.
drop policy if exists version_owner on workflow_version;
create policy version_owner on workflow_version
  using (app_is_superuser() or exists (
    select 1 from workflow w
    where w.workflow_id = workflow_version.workflow_id
      and w.owner_user_id = app_current_user_id()));

-- Content: process -> version -> workflow.
drop policy if exists process_owner on process;
create policy process_owner on process
  using (app_is_superuser() or exists (
    select 1 from workflow_version v join workflow w on w.workflow_id = v.workflow_id
    where v.version_id = process.version_id
      and w.owner_user_id = app_current_user_id()));

drop policy if exists stage_owner on stage;
create policy stage_owner on stage
  using (app_is_superuser() or exists (
    select 1 from process p
    join workflow_version v on v.version_id = p.version_id
    join workflow w on w.workflow_id = v.workflow_id
    where p.process_id = stage.process_id
      and w.owner_user_id = app_current_user_id()));

drop policy if exists state_owner on state;
create policy state_owner on state
  using (app_is_superuser() or exists (
    select 1 from process p
    join workflow_version v on v.version_id = p.version_id
    join workflow w on w.workflow_id = v.workflow_id
    where p.process_id = state.process_id
      and w.owner_user_id = app_current_user_id()));

drop policy if exists transition_owner on transition;
create policy transition_owner on transition
  using (app_is_superuser() or exists (
    select 1 from process p
    join workflow_version v on v.version_id = p.version_id
    join workflow w on w.workflow_id = v.workflow_id
    where p.process_id = transition.process_id
      and w.owner_user_id = app_current_user_id()));

drop policy if exists dependency_owner on state_dependency;
create policy dependency_owner on state_dependency
  using (app_is_superuser() or exists (
    select 1 from state s
    join process p on p.process_id = s.process_id
    join workflow_version v on v.version_id = p.version_id
    join workflow w on w.workflow_id = v.workflow_id
    where s.state_id = state_dependency.state_id
      and w.owner_user_id = app_current_user_id()));

drop policy if exists cost_owner on cost_item;
create policy cost_owner on cost_item
  using (app_is_superuser() or exists (
    select 1 from process p
    join workflow_version v on v.version_id = p.version_id
    join workflow w on w.workflow_id = v.workflow_id
    where p.process_id = cost_item.process_id
      and w.owner_user_id = app_current_user_id()));

drop policy if exists custom_type_owner on custom_state_type;
create policy custom_type_owner on custom_state_type
  using (app_is_superuser() or exists (
    select 1 from process p
    join workflow_version v on v.version_id = p.version_id
    join workflow w on w.workflow_id = v.workflow_id
    where p.process_id = custom_state_type.process_id
      and w.owner_user_id = app_current_user_id()));

drop policy if exists run_owner on analysis_run;
create policy run_owner on analysis_run
  using (app_is_superuser() or exists (
    select 1 from workflow_version v join workflow w on w.workflow_id = v.workflow_id
    where v.version_id = analysis_run.version_id
      and w.owner_user_id = app_current_user_id()));

drop policy if exists finding_owner on analysis_finding;
create policy finding_owner on analysis_finding
  using (app_is_superuser() or exists (
    select 1 from analysis_run r
    join workflow_version v on v.version_id = r.version_id
    join workflow w on w.workflow_id = v.workflow_id
    where r.run_id = analysis_finding.run_id
      and w.owner_user_id = app_current_user_id()));

-- ---------------------------------------------------------------------------
-- 11. Backfill: existing saved_workflows rows -> workflow + version 1
--     Idempotent — only rows not already migrated (matched by id) are moved.
--     Duplicate names per owner get a " (n)" suffix, oldest keeps the name.
-- ---------------------------------------------------------------------------
with ranked as (
  select sw.*,
         row_number() over (partition by sw.user_id, sw.name order by sw.saved_at, sw.id) as rn
  from saved_workflows sw
  where not exists (select 1 from workflow w where w.workflow_id = sw.id)
)
insert into workflow (workflow_id, owner_user_id, name, created_at, updated_at)
select id, user_id,
       name || case when rn = 1 then '' else ' (' || rn || ')' end,
       saved_at, saved_at
from ranked
on conflict (workflow_id) do nothing;

insert into workflow_version (workflow_id, version_number, kind, label,
                              snapshot, config, tools_executed, layout,
                              created_by, created_at)
select sw.id, 1, 'ORIGINAL', 'Imported from saved_workflows',
       sw.workflow, sw.config, sw.tools_executed, sw.layout,
       sw.user_id, sw.saved_at
from saved_workflows sw
where exists (select 1 from workflow w where w.workflow_id = sw.id)
  and not exists (select 1 from workflow_version v
                  where v.workflow_id = sw.id and v.version_number = 1);

update workflow w
set current_version_id = v.version_id
from workflow_version v
where v.workflow_id = w.workflow_id
  and v.version_number = 1
  and w.current_version_id is null;

-- Normalized FSM content rows are loaded from snapshot by the application's
-- own parser (engine layer) in the deploy script — one parser, no drift.

-- ---------------------------------------------------------------------------
-- 12. Seed the two superuser accounts
--     bcrypt via pgcrypto: gen_salt('bf', 10) produces $2a$10$... hashes,
--     which the app's bcryptjs.compare() verifies (same algorithm and cost
--     as server/src/index.js signup: bcrypt.hash(pw, 10)).
--     Re-running NEVER overwrites an existing password — it only guarantees
--     the account exists, is a superuser, and is active.
-- ---------------------------------------------------------------------------
insert into users (username, password_hash, user_type, is_active, display_name)
values
  ('rob', crypt('password', gen_salt('bf', 10)), 'superuser', true, 'Rob'),
  ('max', crypt('password', gen_salt('bf', 10)), 'superuser', true, 'Max')
on conflict (username) do update
  set user_type = 'superuser',
      is_active = true;

insert into audit_log (actor_user_id, action, entity_type, details)
select null, 'SUPERUSER_SEEDED', 'users',
       jsonb_build_object('username', u.username, 'note', 'created by setup script')
from users u
where u.username in ('rob','max');

commit;

-- ---------------------------------------------------------------------------
-- 13. Verification (read-only) — run after COMMIT so you see the final state.
-- ---------------------------------------------------------------------------
select 'tables' as check, count(*) as value
from information_schema.tables
where table_schema = 'public'
  and table_name in ('users','saved_workflows','activity_log','sessions',
                     'remember_tokens','capabilities','audit_log',
                     'workflow_group','workflow','workflow_version','process',
                     'stage','state','transition','state_dependency',
                     'cost_item','custom_state_type','analysis_run','analysis_finding')
union all
select 'superusers (rob, max)', count(*)
from users where username in ('rob','max') and user_type = 'superuser' and is_active
union all
select 'rob password verifies', count(*)
from users where username = 'rob' and password_hash = crypt('password', password_hash)
union all
select 'max password verifies', count(*)
from users where username = 'max' and password_hash = crypt('password', password_hash)
union all
select 'rls-protected tables', count(*)
from pg_tables where schemaname = 'public' and rowsecurity;
