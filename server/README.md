# Plumbline API (server)

The backend for two of Plumbline's five layers, over the **production
database schema** (001 base + migration 002 + security patch 003 + account
settings migration 004 + workflow ordering migration 005):

- **Data interaction layer** — the `PlumblineData` gateway talks here: auth
  (bcrypt, signed httpOnly session cookie, hashed remember tokens), the atomic
  §3.1 password-change flow (`admin_reset_password`: re-hash + revoke every
  session + delete remember tokens + audit, one DB transaction), demographics,
  workflow **folders** (recursive groups), workflows as **immutable versions**
  (name · datetime · exact config · tools executed · tile positions), analysis
  lineage (runs + findings), per-user history, capabilities, superuser
  maintenance, append-only audit.
- **LLM interaction layer** — `POST /api/llm` is the proxy for `PlumblineLLM`.
  **The Anthropic API key lives only here**, never in the browser.

Every authenticated request runs in a transaction that sets the schema's
row-level-security context (`SET LOCAL app.user_id / app.is_superuser`), and
each saved version's snapshot is **also decomposed into the normalized FSM
tables** (`process/stage/state/transition/state_dependency/cost_item/
custom_state_type`) by `src/normalize.js` — the database can query, constrain,
and roll up the content (`v_state_cost`, `v_workflow_tree`), not just store a
blob.

Plumbline is database-backed: the browser keeps no account or workflow data.
Stand this server up (pointed at the Supabase database) before signing in.

## Run

```bash
cd server
cp .env.example .env      # DATABASE_URL (Supabase URI), SESSION_SECRET, ANTHROPIC_API_KEY
npm install
npm run migrate           # applies migrations/*.sql in order — idempotent, safe to re-run
npm run verify-db         # checks connectivity and migrations 004/005 without printing secrets
npm start                 # Plumbline API on :8080
```

The migration runner retries temporary pooler disconnects such as
`ECONNRESET`. Set `MIGRATION_MAX_ATTEMPTS` to override the default of four
attempts (accepted range: 1–8).

## Superuser maintenance

The production schema provisions `rob` and `max` as active superusers. The
**Maintenance** navigation item appears automatically when an authenticated
session reports the superuser capability. Other accounts remain standard users
unless their database role is explicitly changed by a superuser.

Maintenance exposes user status and non-secret profile data, active-session and
workflow counts, database health metrics, and the append-only audit log. It can
reset another user's password, revoke sessions, activate/deactivate accounts,
change access levels, and purge expired authentication records. Every route is
protected by `requireSuperuser`; hiding the button is not the security boundary.

`DATABASE_URL` host must use the Supabase **project reference id** (20 chars),
and `SESSION_SECRET` must be a long random signing secret (never an API key).

The front-end finds the API through `window.PLUMBLINE_API` (set in
`shell.html`): same-origin when the page is served over http(s), or
`http://localhost:8080` when the built file is opened from disk.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | DB reachability + schema tag |
| POST | `/api/signup` | create user from email, optional username, and min 8-char password |
| POST | `/api/login` · `/api/logout` | session cookie; `remember:true` adds a hashed remember token |
| GET  | `/api/session` | signed-in state + capabilities (honours `revoked_at`, remember fallback) |
| POST | `/api/password` | self-service password change → `admin_reset_password()` (atomic, audited) |
| GET/POST | `/api/profile` | demographics |
| GET/PATCH | `/api/settings` | account-backed application preferences (including dark mode) |
| GET/POST | `/api/groups` · PATCH/DELETE `/api/groups/:id` | workflow folders (`v_workflow_tree`) |
| GET  | `/api/workflows` | list (current version per workflow) |
| POST | `/api/workflows` | save: new name → workflow + ORIGINAL v1; existing name → next EDIT version |
| GET  | `/api/workflows/:id` | open the CURRENT version (snapshot/config/tools/layout) |
| DELETE | `/api/workflows/:id` | delete workflow (audited `WORKFLOW_DELETED`) |
| GET  | `/api/v2/workflows/:id` | workflow meta + full version history |
| POST | `/api/v2/workflows/:id/versions` | append an EDIT/ANALYSIS version |
| GET  | `/api/v2/versions/:versionId` | load one immutable version |
| PATCH | `/api/v2/workflows/:id` | rename / move to folder |
| POST | `/api/v2/versions/:id/analyses` · PATCH `/api/v2/analyses/:runId` · GET `/api/v2/versions/:id/analyses` | analysis lineage + findings |
| GET/POST | `/api/history` | online history (activity_log) |
| GET  | `/api/admin/users` | superuser: `v_users_admin` (structurally no password hash; read audited) |
| POST | `/api/admin/users/:id/password` | superuser: `admin_reset_password()` |
| POST | `/api/admin/users/:id/revoke-sessions` | superuser: `admin_revoke_sessions()` |
| POST | `/api/admin/users/:id/active` | superuser: activate / deactivate |
| GET  | `/api/admin/audit` | superuser: append-only audit log |
| POST | `/api/admin/purge-expired-auth` | superuser: `purge_expired_auth()` (pg_cron also runs it nightly on Supabase) |
| POST | `/api/llm` | LLM proxy — `{intent, payload}` |

`/api/llm` intents: `suggest_stage_names`, `explain_finding`,
`suggest_tile_name`, `summarize_workflow`, `health`.

## Files

```
migrations/001_init.sql               original base schema
migrations/002_production_schema.sql  = plumbline_supabase_setup.sql (001 + 002)
migrations/003_security_patch.sql     = plumbline_supabase_patch_003.sql
migrations/004_user_settings.sql      account-backed JSONB preferences
migrations/005_workflow_sort_order.sql persistent library ordering
src/db.js        Postgres pool + RLS-context transactions (SET LOCAL app.user_id)
src/normalize.js snapshot → normalized FSM tables (both snapshot dialects)
src/index.js     Express app: auth, folders, versioned workflows, analyses,
                 history, superuser maintenance, LLM route
src/migrate.js   applies migrations/*.sql in order (idempotent)
src/llm.js       Anthropic proxy (holds the key; JSON-schema per intent)
```
