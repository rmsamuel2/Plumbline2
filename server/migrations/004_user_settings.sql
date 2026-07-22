-- Account-backed UI preferences.
-- JSONB keeps the settings surface extensible while the API allow-lists the
-- keys clients may currently change (darkMode only).

begin;

alter table users
  add column if not exists settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_settings_object'
      and conrelid = 'users'::regclass
  ) then
    alter table users
      add constraint users_settings_object
      check (jsonb_typeof(settings) = 'object');
  end if;
end $$;

commit;
