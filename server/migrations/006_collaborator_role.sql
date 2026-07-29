-- Migration 006: add 'collaborator' user type
--
-- A collaborator has the same analytical capabilities as an analyst but is
-- identified separately (e.g. for external partners or team members who do
-- not hold a full analyst seat). Superusers can promote a user to collaborator
-- via POST /api/admin/users/:id/type.
--
-- Idempotent: safe to run more than once.

-- 1. Widen the user_type check constraint to include 'collaborator'.
--    The anonymous constraint is named <table>_<column>_check by Postgres.
do $$ begin
  alter table users drop constraint if exists users_user_type_check;
exception when undefined_object then null; end $$;

alter table users
  add constraint users_user_type_check
  check (user_type in ('user','analyst','collaborator','superuser'));

-- 2. Seed capabilities for the new role.
--    A collaborator can save workflows and run conformance checks —
--    identical to an analyst in terms of feature access.
insert into capabilities(user_type, capability) values
  ('collaborator','save_workflow'),
  ('collaborator','run_conformance')
on conflict do nothing;
