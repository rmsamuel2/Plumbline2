# Plumbline 6 — Build Progress / Recovery Log

**Goal:** Re-architect the single-file Plumbline Studio (V2) into a clean layered
application. HTML stays mostly front-end with **no math**; the math is
**encapsulated** behind an engine facade; add a **Database interaction layer**
and an **LLM interaction layer**; ship a **build script**; and produce a Word
document with an architecture diagram + detailed description.

Primary working dir: `G:\My Drive\PlumbLine\PlumblineBuild1` (Google Drive)
  — moved here 2026-07-04 from the original build dir `D:\PlumbLine\Plumbline6`
  (now empty). Build scripts use paths relative to their own location, so the
  project builds unchanged from the new location.

## Source material studied
- `D:\PlumbLine\Plumbline_Studio_V2_source_4\...` — decomposed source of the app
  (shell.html + studio.css + studio-main.js bundle + workflow-editor.html + build.py).
- `Plumbline_Studio_V2 (1).html` (Downloads) — the built single file (same bundle).
- Google Drive **PlumbLine** folder — Architecture & Implementation Plan, DB
  Interaction spec, Supabase Integration Guide, `plumbline-api.zip`
  (Express/Postgres prototype: server.ts, auth.ts, snapshots.ts, SQL), New Features.
- Google Drive **Workflow** folder — six-tools methodology docs (AML, CARF, FMV,
  Change-Mgmt), FSM business-process notes, elevator pitch.

## Target architecture (5 layers)
1. Presentation (HTML/CSS/UI) — `src/presentation`, `src/app` — NO math.
2. Engine (encapsulated math) — `src/engine/engine.js` — facade `window.PlumblineEngine`
   wrapping io+core+cost+lemma modules (certifying-algorithm plan; Lemma = trusted kernel).
3. Data interaction layer — `src/data/data-gateway.js` — `window.PlumblineData`
   (LocalAdapter offline + RemoteAdapter REST/Supabase).
4. LLM interaction layer — `src/llm/llm-gateway.js` — `window.PlumblineLLM`
   (MockProvider offline + AnthropicProvider via server proxy).
5. Server — `server/` — DB API + LLM proxy (cleaned Supabase/Express prototype).

Build: `build.py` stitches shell + css + engine + data + llm + ui + loader +
base64(editor) → `dist/Plumbline_Studio_V2.html`. Facades injected before UI.

## Load order in built HTML (critical)
`<style>css</style>` … engine.js → data-gateway.js → llm-gateway.js → studio-ui.js
→ editor b64 → loader.js. Engine/Data/LLM define globals before UI boots.

## STATUS (update as you go)
- [x] Studied all sources
- [x] Task list + dirs scaffolded
- [x] Task 1: scaffold + copy assets (css, editor)
- [x] Task 2: engine facade split (runtime.js + modules.gen.js + facade.js) — smoke-tested
- [x] Task 3: data gateway (Local + Remote) — smoke-tested
- [x] Task 4: llm gateway (Mock + Anthropic) — smoke-tested
- [x] Task 5: server (Express + pg + bcrypt + /api/llm proxy + SQL)
- [x] Task 6: build.py + build.ps1 + build.cmd + dev shell + README (py & ps1 byte-identical, sha f9ca1435)
- [x] Task 7: architecture .docx -> docs/Plumbline_Architecture.docx (diagram + 7 sections, valid XML)

## ALL COMPLETE. Extra verification: module dependency graph — 44 modules, 0 unresolved edges (UI resolves engine across file boundary).

## MONOID LAYER (added later) — src/engine/monoid.js -> window.PlumblineMonoid
- Builds the TRANSITION MONOID M(A) = {δ_w} under composition; η:Σ*↠M(A) homomorphism.
- Six tools recast as monoid operations, each self-verified by checkMonoid (rebuilds M(A) from wf):
  1 transition_morphism (mult table = composition), 2 monoid_congruence (zoom / quotient hom φ),
  3 syntactic_quotient (spot duplicates / Nerode ψ), 4 monoid_iso (redesign), 5 subdirect_product (parallel),
  6 monoid_aperiodic (find loops — Schützenberger; group element = counterexample).
- Facade: PlumblineEngine.{monoid, transitionMonoid, syntacticMonoid, analyzeMonoid, compareRedesignMonoid}.
- Build: @@MONOID_JS@@ after @@ENGINE_FACADE_JS@@ in shell.html; added to build.py, build.ps1, plumbline-dev.html.
- Rebuilt: dist 681,467 bytes, py & ps1 identical sha 1316c8ab.
- Verified: toggle |M|=2 (C2) -> NOT aperiodic (refuted, orbit [s0,s1]); chain aperiodic (certified);
  prod -> subdirect certified; congruence vs non-congruence; chain≅chain iso vs chain≠toggle refuted.
  golden: |M(A)|=60, |M_syn|=48, minimal 10 states; all 5 monoid tools certified.
  NOTE: golden's loop is REFUTED by old SCC+ranking but CERTIFIED APERIODIC by monoid (star-free) — different, both true.

## BUILD VERIFIED
- build.py --check and build.ps1 both -> dist/Plumbline_Studio_V2.html, 655,394 bytes, identical sha256 f9ca1435...
- Engine headless: analyze(golden) -> 4 findings (certified + refuted), redesign bisim ok.
- Data headless: signup/login/session/save(exact config+tools+layout)/list/load/history ok.
- LLM headless: suggestStageNames + explainFinding (mock) ok.

## Key facts
- Bundle module boundaries: math = packages/io, packages/core, packages/cost,
  packages/lemma. UI/render = packages/render, packages/app, studio/main.ts, studio/presets.ts.
- Editor is base64-embedded, decoded to Blob URL at runtime (loader.js).
- Editor<->Studio sync is postMessage (`plumbline-editor-data` / `plumbline-request-editor-data`).
- DB entities: users(encrypted pw), demographics/profile, saved_workflows
  (name, datetime, exact config, executed tools, tile positions), activity history, capabilities/superuser.
