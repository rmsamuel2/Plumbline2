/* ============================================================================
 * Plumbline — shared module runtime (window.__PL)
 * ----------------------------------------------------------------------------
 * A tiny, dependency-free CommonJS-style registry shared by every layer. Each
 * layer file (engine, presentation) registers its modules with __PL.define()
 * and they resolve each other through __PL.load(). This is what lets the math
 * live in engine.js and the UI live in studio-ui.js as separate files while
 * still resolving `require("@plumbline/core")` across the file boundary.
 *
 * Trust note: the runtime itself is trivial and trusted. The certification of
 * findings is done by the Lemma kernel inside the engine, not here.
 * ==========================================================================*/
window.__PL = window.__PL || (function () {
  var modules = {};   // id -> factory(require, exports, module)
  var deps = {};      // id -> { importSpecifier -> resolvedId }
  var cache = {};     // id -> module (memoised singletons)

  function define(id, factory, moduleDeps) {
    modules[id] = factory;
    if (moduleDeps) deps[id] = moduleDeps;
  }

  function load(id) {
    if (cache[id]) return cache[id].exports;
    var factory = modules[id];
    if (!factory) throw new Error("Plumbline module not found: " + id);
    var mod = { exports: {} };
    cache[id] = mod;
    var req = function (spec) {
      return load((deps[id] && deps[id][spec]) || spec);
    };
    factory(req, mod.exports, mod);
    return mod.exports;
  }

  function has(id) { return !!modules[id]; }

  return { modules: modules, deps: deps, cache: cache,
           define: define, load: load, has: has };
})();
