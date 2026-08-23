-- Account-scoped history for Claude-assisted workflow edits.
-- The API stores only the user's instruction and workflow documents; API keys,
-- prompts, cookies, and other credentials are never written to this table.

begin;

create table if not exists ai_workflow_edit (
  edit_id          uuid primary key default gen_random_uuid(),
  user_id          uuid not null references users(id) on delete cascade,
  instruction      text not null check (char_length(instruction) between 1 and 4000),
  summary          text not null default '',
  source_workflow  jsonb not null,
  result_workflow  jsonb not null,
  created_at       timestamptz not null default now(),
  check (jsonb_typeof(source_workflow) = 'object'),
  check (jsonb_typeof(result_workflow) = 'object')
);

create index if not exists ai_workflow_edit_user_created_idx
  on ai_workflow_edit(user_id, created_at desc);

alter table ai_workflow_edit enable row level security;

drop policy if exists ai_workflow_edit_owner on ai_workflow_edit;
create policy ai_workflow_edit_owner on ai_workflow_edit
  using (user_id = app_current_user_id() or app_is_superuser())
  with check (user_id = app_current_user_id() or app_is_superuser());

commit;
