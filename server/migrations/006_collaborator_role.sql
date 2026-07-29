-- Migration 006: add 'collaborator' user type
--
-- A collaborator has the same analytical capabilities as an analyst but is
-- identified separately (e.g. for external partners or team members who do
-- not hold a full analyst seat). Superusers can promote a user to any type,
-- including collaborator, via POST /api/admin/users/:id/type.
--
-- Idempotent: safe to run more than once.

-- 1. Widen the user_type check constraint to include 'collaborator'.
--    Postgres names anonymous CHECK constraints <table>_<column>_check.
--    We drop that name (the one 001_init.sql creates) and replace it.
alter table users drop constraint if exists users_user_type_check;

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
