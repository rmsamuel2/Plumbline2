# Plumbline 6 — Layered Studio

Plumbline models a business process as a finite-state machine, runs six
structural tools over it, and **certifies every finding** (certificate, or the
counterexample that *is* the finding). This repo is the demo re-architected
into clean, testable layers with a build step that still ships **one
self-contained offline HTML file**.

> plumbline · *true by measure*

## The five layers

```
┌──────────────────────────────────────────────────────────────────────┐
│ Presentation  (HTML / CSS / UI)      src/presentation, src/app        │  no math
│   home · workflow editor · analysis studio · toolbar · auth modal     │
└───────────────┬───────────────┬───────────────┬──────────────────────┘
                │ calls         │ calls         │ calls
                ▼               ▼               ▼
   ┌───────────────────┐ ┌──────────────┐ ┌──────────────┐
   │  PlumblineEngine  │ │ PlumblineData│ │ PlumblineLLM │   facades (globals)
   │  (encapsulated    │ │  (DB layer)  │ │ (LLM layer)  │
   │   math)           │ │              │ │              │
   │ io·core·cost·LEMMA│ │ Local/Remote │ │ Mock/Anthropic
   └───────────────────┘ └──────┬───────┘ └──────┬───────┘
      certificate or            │ REST           │ /api/llm proxy
      counterexample            ▼                ▼
                          ┌───────────────────────────────┐
                          │  server/  (DB API + LLM proxy) │  Postgres/Supabase
                          └───────────────────────────────┘
```

1. **Presentation** — `src/presentation/` (`shell.html`, `studio.css`) and
   `src/app/` (`ui-modules.gen.js`, `ui-boot.js`, `loader.js`). Pure front-end.
   **Contains no math** — it only calls the three facades.
2. **Engine (encapsulated math)** — `src/engine/`. `runtime.js` is the shared
   module registry; `modules.gen.js` holds the certifying-algorithm packages
   (`io` importers, `core` IR + analysers + bisimulation, `cost` model,
   **`lemma`** the trusted kernel); `facade.js` exposes them as
   **`window.PlumblineEngine`** — the *only* sanctioned math entry point.
3. **Data interaction layer** — `src/data/data-gateway.js` →
   **`window.PlumblineData`**. Plumbline is **database-backed**: the gateway
   talks REST (httpOnly session cookies) to `server/`, which persists
   everything in the Plumbline PostgreSQL database (Supabase, schema 002+003).
   Users (bcrypt passwords), demographics, workflow **folders**, workflows as
   **immutable versions** (name, datetime, **exact** config, tools executed,
   tile positions — each snapshot also decomposed into normalized
   process/stage/state/transition/dependency/cost rows), analysis lineage,
   online history, capabilities, superuser maintenance, append-only audit.
   There is no browser-storage fallback: no account or workflow data ever
   lives in localStorage.
4. **LLM interaction layer** — `src/llm/llm-gateway.js` →
   **`window.PlumblineLLM`**. Advisory only (never certifies). `Mock` (offline)
   and `Anthropic` (via `server/` proxy — **the API key never reaches the
   browser**). Suggests zoom-out stage names, explains findings in plain
   business terms, names tiles.
5. **Server** — `server/`. Express + Postgres/Supabase over the production
   schema (`migrations/002_production_schema.sql` + `003_security_patch.sql`):
   auth with remember tokens and the atomic §3.1 password-change flow
   (`admin_reset_password`), folders, versioned workflows with server-side
   snapshot normalization, analysis runs/findings, history, superuser
   maintenance ("see everything **but** passwords"), audit, and the
   `/api/llm` proxy. Requests run with the schema's RLS context set
   (`app.user_id` / `app.is_superuser`).

The load order in the built page is load-bearing: runtime → engine modules →
engine facade → data → llm → ui modules → ui boot. Each facade is a global
*before* the UI boots.

## Build

```
# Windows
build.cmd                 # Python if present, else pure PowerShell

# any OS with Python 3.6+
python build.py           # or:  python build.py --check
```

Output: **`dist/Plumbline_Studio_V2.html`** — open it in any browser. The
Python and PowerShell builders produce a byte-identical file.

## Develop without building

Open **`src/plumbline-dev.html`** (or serve `src/` with
`python -m http.server`). It loads every layer from its relative source file —
edit any layer, reload, done. Serving over http additionally enables the
same-origin editor↔studio fast path.

## Layout

```
build.py / build.ps1 / build.cmd   the build (three entry points, one result)
RECOVERY.md                        progress / recovery log
docs/                              architecture Word document
dist/Plumbline_Studio_V2.html      the built, single-file app
server/                            DB API + LLM proxy (Node/Express + SQL)
src/
  presentation/  shell.html  studio.css           layer 1 (UI markup + style)
  app/           ui-modules.gen.js  ui-boot.js  loader.js  dev-loader.js
  engine/        runtime.js  modules.gen.js  facade.js     layer 2 (math)
  data/          data-gateway.js                           layer 3 (DB)
  llm/           llm-gateway.js                            layer 4 (LLM)
  editor/        workflow-editor.html                      embedded editor
  plumbline-dev.html                                       no-build dev shell
```

`*.gen.js` files are mechanically split from the original proven bundle at its
module seams (`tools/split_bundle.py` in history) — the code is unchanged, only
relocated so math and presentation live in separate files.

## Why certified, not asserted

The demo *asserts* findings; this architecture *computes and certifies* them.
Analysers (untrusted, fast) propose a result + witness; **Lemma** (small,
trusted, version-locked) disposes — returning a machine-checkable certificate
or the counterexample a client is paying to discover. Cost figures are
deliberately **not** certified and are labelled *assumption-based*; structural
findings are labelled *lemma-certified*. See `docs/`.
