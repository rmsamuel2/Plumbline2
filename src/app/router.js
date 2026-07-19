/* ============================================================================
 * studio/router.ts — hash router and module lifecycle
 * ----------------------------------------------------------------------------
 * Phase 1, step 4. New file; nothing was moved into it.
 *
 * Owns exactly one thing: which module is mounted in #outlet. It is the only
 * caller of mount()/unmount(), and modules never navigate by touching each
 * other — they call ctx.navigate(path), which sets location.hash, which
 * re-enters this file.
 *
 * THE TOKEN GUARD. navigate() awaits twice (unmount, then mount). Between
 * those awaits a newer hashchange can arrive. Every navigation takes a ticket
 * and re-checks it after each await; a superseded navigation abandons itself
 * rather than installing a module the user has already navigated away from.
 * Without this, rapid clicking leaves duplicate event handlers bound and the
 * outlet owned by a module that believes it was unmounted. The symptom is
 * intermittent double-firing, not a clean crash, so it is expensive to debug
 * after the fact. Do not remove either check.
 * ==========================================================================*/
__PL.define("studio/router.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var ROUTES = [
  { re: /^\/?$|^\/home$/,   mod: "studio/modules/home.ts",     path: "/home" },
  { re: /^\/editor$/,       mod: "studio/modules/editor.ts",   path: "/editor" },
  { re: /^\/analysis$/,     mod: "studio/modules/analysis.ts", path: "/analysis" }
];

var current = null;   /* { instance: object, name: string } */
var token   = 0;      /* monotonic navigation ticket */
var ctx     = null;
var started = false;

function outlet() {
  var o = document.getElementById("outlet");
  if (!o) throw new Error("router: #outlet is missing from shell.html");
  return o;
}

function showError(e) {
  var b = document.getElementById("err");
  if (b) {
    b.style.display = "block";
    b.textContent = "Screen failed to load: " + ((e && e.message) || e);
  }
}

function markNav(path) {
  var links = document.querySelectorAll("[data-route]");
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute("href") || "";
    links[i].classList.toggle("active", href === "#" + path);
  }
}

function match(path) {
  for (var i = 0; i < ROUTES.length; i++)
    if (ROUTES[i].re.test(path)) return ROUTES[i];
  return ROUTES[0];
}

function navigate(path) {
  var mine = ++token;
  var hit  = match(path);

  /* Already showing this module: re-mark the nav and stop. Without this,
     clicking the active nav link would unmount and remount for no reason,
     which in the Editor's case would flush and re-handshake the iframe. */
  if (current && current.name === hit.mod) { markNav(hit.path); return Promise.resolve(); }

  var chain = Promise.resolve();

  if (current) {
    var leaving = current;
    current = null;
    chain = chain.then(function () {
      return leaving.instance.unmount();
    })["catch"](function (e) {
      /* A failing unmount must not strand the app on a dead screen. Report
         it and continue; the incoming module will replace the DOM anyway. */
      console.error("router: unmount failed", e);
    });
  }

  return chain.then(function () {
    if (mine !== token) return;              /* superseded while unmounting */

    var mod = require(hit.mod)["default"];
    if (!mod) throw new Error("router: " + hit.mod + " has no default export");
    var instance = Object.create(mod);

    return Promise.resolve(instance.mount(outlet(), {}, ctx)).then(function () {
      if (mine !== token) {                  /* superseded while mounting */
        return Promise.resolve(instance.unmount())["catch"](function (e) {
          console.error("router: unmount of superseded module failed", e);
        });
      }
      current = { instance: instance, name: hit.mod };
      markNav(hit.path);
    });
  })["catch"](function (e) {
    showError(e);
    throw e;
  });
}

function currentPath() {
  return (location.hash || "").slice(1) || "/home";
}

/* ---------------------------------------------------------------------------
 * start(baseCtx) — called once by ui-boot.js after the facades are wired.
 * Adds navigate() to the ctx that modules receive, so a module never has to
 * know that routing is implemented with location.hash.
 * -------------------------------------------------------------------------*/
exports.start = function (baseCtx) {
  if (started) throw new Error("router.start() called twice");
  started = true;

  ctx = Object.assign({}, baseCtx, {
    navigate: function (path) {
      if (typeof path !== "string" || path.charAt(0) !== "/")
        throw new Error("navigate() expects a path beginning with '/'");
      if (currentPath() === path) return navigate(path);  /* force re-eval */
      location.hash = "#" + path;
    }
  });

  window.addEventListener("hashchange", function () { navigate(currentPath()); });
  return navigate(currentPath());
};

/* Exposed for tests and for the editor iframe bridge in loader.js. */
exports.navigate = function (path) { return navigate(path); };
exports.currentModuleName = function () { return current && current.name; };

});
