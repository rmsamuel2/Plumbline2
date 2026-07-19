/* ============================================================================
 * Plumbline — Presentation boot
 * ----------------------------------------------------------------------------
 * Registers the presentation modules (render + app + studio UI, see
 * ui-modules.gen.js) and starts the Analysis Studio. By the time this runs,
 * engine.js has already published window.PlumblineEngine, data-gateway.js has
 * published window.PlumblineData, and llm-gateway.js has published
 * window.PlumblineLLM. The UI calls those facades; it contains no math.
 * ==========================================================================*/
(function () {
  if (!window.__PL) { throw new Error("Plumbline runtime missing (load order?)"); }

  // Expose the three service facades to the UI module under stable globals so
  // studio/main.ts and future UI code can reach them without importing math.
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

  try {
    window.__PL.load("studio/main.ts");   // boot the Studio UI
  } catch (e) {
    var box = document.getElementById("err");
    if (box) { box.style.display = "block";
      box.textContent = "Studio failed to start: " + (e && e.message || e); }
    throw e;
  }
})();
