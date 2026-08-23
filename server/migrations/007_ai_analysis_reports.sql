-- Durable, account-scoped history for manually generated AI optimization reports.
--
-- Workflow references are deliberately stored as text snapshots instead of
-- foreign keys. A report is historical evidence: renaming, editing, archiving,
-- or deleting a live workflow must never change or remove the report context.

begin;

create table if not exists ai_analysis_report (
  report_id             uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  title                 text not null check (char_length(title) between 1 and 160),
  report                 jsonb not null,
  mathematical_snapshot jsonb not null,
  input_signature       text not null default '',
  ai_generated_at       timestamptz,
  created_at            timestamptz not null default now(),
  check (jsonb_typeof(report) = 'object'),
  check (jsonb_typeof(mathematical_snapshot) = 'object')
);

create table if not exists ai_analysis_report_workflow (
  report_id                 uuid not null references ai_analysis_report(report_id) on delete cascade,
  position                  integer not null check (position >= 0),
  source_workflow_key       text not null,
  source_workflow_id        text,
  workflow_name             text not null,
  workflow_created_at       timestamptz,
  source_version_id         text,
  workflow_snapshot         jsonb not null,
  captured_at               timestamptz not null default now(),
  primary key (report_id, position),
  check (jsonb_typeof(workflow_snapshot) = 'object')
);

create index if not exists ai_analysis_report_user_created_idx
  on ai_analysis_report(user_id, created_at desc);
create index if not exists ai_analysis_report_workflow_key_idx
  on ai_analysis_report_workflow(source_workflow_key, report_id);
create index if not exists ai_analysis_report_workflow_name_idx
  on ai_analysis_report_workflow(lower(workflow_name), report_id);

alter table ai_analysis_report enable row level security;
alter table ai_analysis_report_workflow enable row level security;

drop policy if exists ai_analysis_report_owner on ai_analysis_report;
create policy ai_analysis_report_owner on ai_analysis_report
  using (user_id = app_current_user_id() or app_is_superuser())
  with check (user_id = app_current_user_id() or app_is_superuser());

drop policy if exists ai_analysis_report_workflow_owner on ai_analysis_report_workflow;
create policy ai_analysis_report_workflow_owner on ai_analysis_report_workflow
  using (exists (
    select 1 from ai_analysis_report r
    where r.report_id = ai_analysis_report_workflow.report_id
      and (r.user_id = app_current_user_id() or app_is_superuser())
  ))
  with check (exists (
    select 1 from ai_analysis_report r
    where r.report_id = ai_analysis_report_workflow.report_id
      and (r.user_id = app_current_user_id() or app_is_superuser())
  ));

commit;
