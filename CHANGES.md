# Plumbline — Workflow Editor screen changes (2026-07)

These files replace the same-named files in `PlumblineBuild1`. Copy each one over
its original, then rebuild with `python build.py` (or `build.cmd` / `build.ps1`).

    src/editor/workflow-editor.html   <- all 11 screen changes
    src/app/loader.js                 <- routes the editor's Login/Sign up to the app account modal
    src/app/dev-loader.js             <- same routing for the no-build dev shell
    build.py / build.ps1 / build.cmd  <- rewritten build scripts

Everything else in your tree is unchanged. `shell.html`, `studio.css`, and the
engine/data/llm/ui layers were **not** modified, so keep your originals.

## Instruction -> change

1. **Preset "Load" button removed** — button + its click handler deleted. Choosing
   an item in the Preset dropdown still loads it (the dropdown's own change handler).
2. **Finance "Cost / Time Analysis" button removed** — button + handler deleted.
   "Add Cost/Time" is kept.
3. **Cloud SQL box removed** — the whole `cloudGroup` toolbar box *and* the Supabase
   settings panel (`cloudPanel`) removed, plus all their event handlers. The now-unused
   cloud helper functions were left in place but made safe (they no longer run, and
   `loadCloudSettings()` is guarded so boot can't throw on the missing fields).
4 & 10. **File box removed** — Import JSON / Export JSON / Export PNG box + handlers deleted.
5. **Login button added** (Account box, top-right of the toolbar).
6. **Sign up button added** (Account box). Both post a `plumbline-auth` message to the
   Plumbline shell, which opens the app's existing account modal (see loader changes).
   A `not signed in` badge sits next to them; it updates if the shell posts back a
   `plumbline-auth-state` message.
7. **Copy / paste a box** — works three ways: **Ctrl+C / Ctrl+V**, **Copy / Paste buttons**
   in the Edit box, and **right-click a box -> Copy / Paste / Duplicate**. A pasted box gets
   a fresh key, a `(copy)` name, and is nudged so it doesn't sit exactly on the original.
8. **Dependencies** — select a box and use the new **"Dependencies (must finish first)"**
   checklist in its panel to mark which other boxes must complete first. Dependencies draw
   as dashed purple arrows on the canvas and are stored on the box (`depends_on`), so they
   travel with the workflow through Save / Download / Upload and into Analysis Studio.
9. **Right-side summary trimmed + Edit Process grows** — the "Open Cost / Time Analysis"
   button was removed from the Edit Process form (consistent with change 2), and the
   Description and Naming-convention fields now grow tall and are resizable so they hold
   as much text as needed. *(Interpretation note: the screenshot marked the read-only
   summary/analysis area above the form; the concrete, requested outcome was expandable
   Edit Process fields, which is what this delivers.)*
11. **More canvas** — removing the Cloud SQL and File boxes shortens the toolbar, and the
   default side-panel width was reduced (360px -> 300px), giving the editing area more room.
   The side panel is still resizable via its drag handle, and Edit Mode still hides the top bar.

## Consistency / build

- Dependencies persist through the editor's own serialization (the snapshot it posts to
  the shell and its JSON export both stringify the full model, which now includes
  `depends_on`), so Analysis Studio receives them without any engine change.
- The build contract is unchanged: the editor is still embedded verbatim as base64. The
  rewritten `build.py` / `build.ps1` produce a byte-identical file and share one marker
  list; `build.cmd` uses Python if present, else PowerShell. `--check` verifies every
  marker is filled and every facade global is present.

Verified: the editor's script passes `node --check`; the rewritten build re-embeds the
editor and it round-trips byte-for-byte; `build.py --check` passes.
