/* ============================================================================
 * Plumbline — Presentation boot
 * ----------------------------------------------------------------------------
 * Phase 1. Previously this file ended with __PL.load("studio/main.ts"), which
 * booted the whole UI as one module. It now:
 *   1. wires the three facades (unchanged from before),
 *   2. builds the ctx that every screen module receives,
 *   3. initialises the two boot-time services (auth modal, editor bridge),
 *   4. starts the router, which mounts the screen named by location.hash.
 *
 * Modules receive their dependencies through ctx and must not read
 * window.PlumblineData / PlumblineLLM / PlumblineServices directly.
 * ==========================================================================*/
(function () {
  if (!window.__PL) { throw new Error("Plumbline runtime missing (load order?)"); }

  /* ---------------------------------------------------------------------
   * WHY THIS IS DEFERRED
   * shell.html inlines this script INSIDE <section id="studioPage">, which
   * comes before #authModal and the editor payload. Running immediately means
   * document.getElementById("authClose") - and every other node after this
   * point - returns null, so auth.init()'s bindings silently do nothing and
   * the login modal cannot be closed.
   * The pre-split code had the same constraint and met it with
   * DOMContentLoaded at the foot of studio/main.ts. Keep this guard.
   * ------------------------------------------------------------------- */
  function boot() {

  // Point the data gateway at the Plumbline API (the database's front door)
  // before anything in the UI can ask it for data. window.PLUMBLINE_API is set
  // by shell.html; autodetect() verifies reachability in the background.
  if (window.PlumblineData) {
    window.PlumblineData.configure({ baseUrl: window.PLUMBLINE_API || "" });
    try { window.PlumblineData.autodetect(window.PLUMBLINE_API || "").then(function (m) {
      if (m !== "remote") console.warn("Plumbline database is unreachable at '" +
        (window.PLUMBLINE_API || "(same origin)") + "' — sign-in and saving will fail until the API is up.");
    }); } catch (e) { }
  }
  if (window.PlumblineLLM && window.PlumblineLLM.autodetect) {
    try { window.PlumblineLLM.autodetect(window.PLUMBLINE_API || ""); } catch (e) { }
  }

  window.PlumblineServices = {
    engine: window.PlumblineEngine || null,
    data:   window.PlumblineData   || null,
    llm:    window.PlumblineLLM    || null
  };

  /* A minimal pub/sub for crosscutting signals only (session-expired,
   * api-unreachable). Screen-to-screen communication is the URL, and
   * state-change notification is workspace.onChange - not this. */
  var bus = (function () {
    var m = {};
    return {
      on:   function (k, f) { (m[k] || (m[k] = [])).push(f); },
      off:  function (k, f) { m[k] = (m[k] || []).filter(function (g) { return g !== f; }); },
      emit: function (k, v) { (m[k] || []).forEach(function (f) {
              try { f(v); } catch (e) { console.error("bus '" + k + "' handler failed", e); } }); }
    };
  })();

  try {
    var auth = window.__PL.load("studio/shared/auth.ts");
    var ws   = window.__PL.load("studio/shared/workspace.ts");
    var ed   = window.__PL.load("studio/modules/editor.ts");
    var lib  = window.__PL.load("studio/shared/library.ts");
    var lib  = window.__PL.load("studio/shared/library.ts");

    var ctx = {
      data:      window.PlumblineData,
      llm:       window.PlumblineLLM,
      engine:    window.PlumblineEngine,   /* PHASE2: becomes the engine client */
      workspace: ws,
      auth:      auth,
      library:   lib,
      library:   lib,
      bus:       bus
    };

    /* Boot-time services. Both install listeners that must exist regardless of
     * which screen is showing:
     *  - auth owns the modal, which is opened from Home, from the Studio
     *    toolbar, and from the editor iframe by postMessage;
     *  - the editor bridge must be listening before the pre-loaded iframe
     *    pushes its first snapshot, or a user who goes straight to Analysis
     *    never receives editor data. */
    auth.init(ctx);
    ed.init(ctx);
    lib.init(ctx);
    /* after auth (the library needs a session) and before the router (a screen
       may open it during its own mount). */
    lib.init(ctx);

    auth.restoreSession();

    window.__PL.load("studio/router.ts").start(ctx);
  } catch (e) {
    var box = document.getElementById("err");
    if (box) { box.style.display = "block";
      box.textContent = "Studio failed to start: " + (e && e.message || e); }
    throw e;
  }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else
    boot();
})();
