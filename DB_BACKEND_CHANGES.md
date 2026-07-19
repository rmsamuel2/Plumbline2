# Plumbline — Database-backed rewrite (2026-07-12)

The application is now **fully and completely back-ended by the Plumbline
database** (Supabase/PostgreSQL, project `kuafoevohydjeacpkcrx`, schema =
`plumbline_supabase_setup.sql` + `plumbline_supabase_patch_003.sql`). Before
this change the Studio UI kept its own account system in browser
localStorage (users, PBKDF2 password hashes, saved workflows, history) and
never called the data gateway; the server only knew the old 001
`saved_workflows` blob table. Both are gone.

## What persists where now

| Data | Before | Now |
|---|---|---|
| Accounts + passwords | localStorage, PBKDF2 in the browser | `users` table, bcrypt `$2a$10` server-side |
| Session | localStorage key + plain cookie | `sessions` row + signed httpOnly cookie (`revoked_at` honoured) |
| "Remember me" | username in a readable cookie | hashed token in `remember_tokens` (revoked on password change) |
| Saved workflows | array on the localStorage user record | `workflow` + immutable `workflow_version` rows; the snapshot is **also decomposed** into `process` / `stage` / `state` / `transition` / `state_dependency` / `cost_item` / `custom_state_type` |
| Folders | — (didn't exist) | `workflow_group` (recursive, cycle-guarded), `v_workflow_tree` |
| Analysis results | in-memory only | `analysis_run` + `analysis_finding` lineage |
| History | array on the localStorage user record | `activity_log` |
| Password change | — (didn't exist) | `admin_reset_password()` — atomic re-hash + revoke sessions + delete remember tokens + `PASSWORD_CHANGED` audit |
| Superuser maintenance | — | `v_users_admin` (structurally no hash column), `admin_revoke_sessions()`, activate/deactivate, audit viewer, `purge_expired_auth()` |
| Audit | — | append-only `audit_log` (USER_CREATED, PASSWORD_CHANGED, WORKFLOW_DELETED, SU_*) |

Saving a workflow whose name you already used appends the **next immutable
version** (v2, v3, …) instead of a duplicate row; Load opens the current
version, and every prior version stays retrievable (`/api/v2/versions/:id`).
The only things still in the browser are two cosmetic view preferences (last
open page, editor side-panel width) — no application data.

## Changed files

- `server/src/index.js` — full rewrite over schema 002+003 (see server/README.md
  endpoint table). Legacy `/api/workflows` paths kept, now mapped onto
  workflow + version.
- `server/src/db.js` — pool + `tx()` that sets the schema's RLS context
  (`SET LOCAL app.user_id / app.is_superuser`) on every authenticated request.
- `server/src/normalize.js` — **new**: parses a saved snapshot (either the
  Workflow Editor model in `meta.editorData` or the bare Studio graph) into
  the normalized FSM tables. The 002 triggers stay authoritative; dependency
  edges insert under savepoints so a rejected edge can't sink a version.
- `server/src/migrate.js` + `package.json` — `npm run migrate` now applies
  `migrations/*.sql` in order; `002_production_schema.sql` and
  `003_security_patch.sql` are verbatim copies of the two project SQL files.
- `src/data/data-gateway.js` — rewritten DB-only gateway. LocalAdapter is
  gone; adds folders, versions, analyses, `changePassword`, and the
  superuser `admin.*` surface. Unreachable API → honest error, never a
  silent browser fallback.
- `src/app/ui-modules.gen.js` — the "local account database" block replaced
  with PlumblineData calls (same function names/signatures: `signIn`,
  `createUser`, `signOut`, `restoreSession`, `saveCurrentWorkflow`,
  `loadSavedWorkflow`, `updateProfile`, `logHistory`, `renderAuth`,
  `renderUserBadge`). Adds Delete in the saved list, change-password
  handling, and a `plumbline-auth-state` broadcast so the editor's
  "not signed in" badge tracks the real session.
- `src/presentation/shell.html`, `src/plumbline-dev.html` — `window.
  PLUMBLINE_API` configuration (same-origin when served; `localhost:8080`
  when opened from disk; explicit value always wins), a Change-password
  section in the account modal, honest remember-me wording.
- `src/app/ui-boot.js` — configures/health-checks the gateway before the
  Studio boots. `src/app/loader.js`, `dev-loader.js` — re-broadcast auth
  state when the editor iframe loads.
- `README.md`, `server/README.md` — updated to match.
- `tools/patch-ui-db-backend.py` — the surgical patch applied to
  `ui-modules.gen.js`, kept for the record.

**Workflow Editor:** `src/editor/workflow-editor.html` is the Drive tree's
"Variant B (Inspector)" editor (286,380 bytes, from the local
`fix-workflow-editor-fallback` branch — this branch is NOT on GitHub), byte-
identical to `Plumbline_claude/Plumbline4/src/editor/workflow-editor.html`.
`src/app/loader.js` and `dev-loader.js` are that branch's versions too (they
add the editor's `plumbline-nav` "Analysis Studio →" navigation message),
with the auth-state re-broadcast applied on top. One branch bug fixed: the
branch's dev-loader pointed at `editor/Plumbline-editor.html`, a file that
does not exist in the tree — it now points at the real
`editor/workflow-editor.html` (cache-buster kept). The editor stays the
in-memory design surface; persistence flows through the shell's data layer
per the five-layer contract, and a Variant B snapshot (with its derived
`stage_name`/`cost_min`/`cost_max` state fields) was verified through the
server normalizer: dependencies stored, `v_state_cost` roll-up matches the
editor's own cost totals.

Unchanged: the engine (`src/engine/*` — no math moved), the LLM layer,
and `studio.css`.

## Verified (against PostgreSQL 16 + both SQL files, freshly applied)

- signup / login / remember / logout / session restore; short passwords rejected
- save → workflow + ORIGINAL v1 with normalized rows (stages, states incl.
  custom state types, transitions, dependencies, COST items; REVENUE items
  correctly stay snapshot-only); save again → immutable v2; snapshot
  round-trips deep-equal; old versions loadable
- `v_state_cost` roll-up correct; `workflow_version` UPDATE blocked by trigger
- password change: old password rejected, sessions revoked, `PASSWORD_CHANGED`
  audited; superuser reset + revoke-sessions + audited user browsing
  (`v_users_admin` has no hash column); non-superusers blocked (403)
- folders: create/nest, `v_workflow_tree` paths, move workflow into folder
- analysis run + PROVEN finding recorded and listed
- headless (jsdom) boot of the BUILT single file: account creation, Save
  workflow, saved-list + history painted from the database, Load round-trip,
  change password, sign out — zero page errors
- `python build.py --check` passes; all layers `node --check` clean

## Deploy

1. Supabase SQL Editor → run `plumbline_supabase_setup.sql`, then
   `plumbline_supabase_patch_003.sql` (or `npm run migrate` with
   `DATABASE_URL` set). Both are idempotent.
2. `cd server && cp .env.example .env` — fill `DATABASE_URL` (Supabase URI,
   host = 20-char project ref), a long random `SESSION_SECRET`,
   `ANTHROPIC_API_KEY`. `npm install && npm start`.
3. `python build.py` → open `dist/Plumbline_Studio_V2.html` (talks to
   `http://localhost:8080`), or serve the app from the same origin as the API.
4. Sign in as `rob` / `password` and **change both seeded passwords
   immediately** (Account → Change password).
