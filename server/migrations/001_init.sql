-- Plumbline API schema (Postgres / Supabase).
-- Encapsulates the DB-Interaction spec: users(encrypted password), demographics,
-- saved workflow snapshots (name, datetime, EXACT config, tools executed, tile
-- positions), per-user online history, and capabilities / superuser.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---- users + demographics -------------------------------------------------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text unique,
  email         text unique,
  password_hash text not null,            -- bcrypt; never store clear text
  user_type     text not null default 'user'
                  check (user_type in ('user','analyst','superuser')),
  is_active     boolean not null default true,
  -- demographics
  display_name  text default '',
  team          text default '',
  role          text default '',
  region        text default '',
  created_at    timestamptz not null default now()
);

-- ---- saved workflow snapshots --------------------------------------------
-- One row = the whole workflow captured EXACTLY as the user left it.
create table if not exists saved_workflows (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  name           text not null,
  workflow       jsonb not null,          -- the canonical workflow / IR
  config         jsonb not null default '{}'::jsonb,   -- exact UI configuration
  tools_executed jsonb not null default '[]'::jsonb,   -- which tools were run
  layout         jsonb not null default '{}'::jsonb,   -- tile screen positions
  saved_at       timestamptz not null default now()
);
create index if not exists saved_workflows_user_idx on saved_workflows(user_id, saved_at desc);

-- ---- per-user online history ---------------------------------------------
create table if not exists activity_log (
  id       bigserial primary key,
  user_id  uuid not null references users(id) on delete cascade,
  action   text not null,                 -- login, save_workflow, open_workflow, ...
  meta     jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index if not exists activity_user_idx on activity_log(user_id, at desc);

-- ---- sessions + remember-me ----------------------------------------------
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

-- ---- capabilities by user_type (superuser gets '*') ----------------------
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
