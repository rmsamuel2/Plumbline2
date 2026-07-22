-- Persistent ordering for the Read/Save workflow navigator.
-- Positions are intentionally sparse so drag/drop can insert between rows;
-- the UI periodically normalizes a folder to 100, 200, 300, ...

alter table workflow
  add column if not exists sort_order integer not null default 1000;

with ranked as (
  select workflow_id,
         row_number() over (
           partition by owner_user_id, group_id
           order by updated_at desc, name, workflow_id
         )::integer * 100 as position
  from workflow
)
update workflow w
set sort_order = ranked.position
from ranked
where ranked.workflow_id = w.workflow_id
  and w.sort_order = 1000;

create index if not exists workflow_owner_group_sort_idx
  on workflow(owner_user_id, group_id, sort_order);
