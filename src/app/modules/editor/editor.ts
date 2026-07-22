/* ============================================================================
 * studio/modules/editor.ts — Workflow Editor screen
 * ----------------------------------------------------------------------------
 * Phase 1, step 5c. Declarations MOVED from studio/main.ts (ui-modules.gen.js
 * at commit 462ebb7); original line ranges noted above each. References to
 * shared helpers were prefixed dom_1. / ws_1.; calls that reach into the
 * Analysis screen go through HOOKS (set by mount from ctx) so this module
 * never requires analysis.ts.
 *
 * TWO FACTS ABOUT THIS SCREEN THAT DRIVE ITS LIFECYCLE
 *
 * 1. THE IFRAME IS NOT DESTROYED ON UNMOUNT. loader.js pre-loads the editor at
 *    startup so its process is available to Analysis even if the user never
 *    opens the Editor. Destroying it per navigation would re-parse a 284 KB
 *    document, drop the editor's own undo history, and re-run its handshake.
 *    unmount() hides the container and leaves the frame alive.
 *
 * 2. THE FLUSH IS SYNCHRONOUS. requestEditorSync() calls
 *    frame.contentWindow.plumblineExportForAnalysis() directly - a same-origin
 *    function call, not a message round trip - and falls back to the last
 *    pushed snapshot if the frame has not defined it yet. The trailing
 *    postMessage is a secondary refresh, not the flush. So unmount() does NOT
 *    need to await anything; calling requestEditorSync({silent:true}) before
 *    hiding is sufficient and complete.
 *    (An earlier draft of the Phase 1 document claimed this had to become a
 *    promise. It does not - the direct call already returns the data.)
 *
 * VISIBILITY: studio.css line 180-181 defines .plPage{display:none} and
 * .plPage.active{display:flex;flex-direction:column}. Screens must therefore
 * toggle the "active" CLASS, never style.display - setting display:block
 * would break the flex column layout of every page.
 * ==========================================================================*/
__PL.define("studio/modules/editor.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var dom_1 = require("studio/shared/dom.ts");
var ws_1   = require("studio/shared/workspace.ts");
var auth_1 = require("studio/shared/auth.ts");
/* PHASE2: importEditorData() validates through the engine. This require goes
 * away when the engine moves behind /api/engine/*. */
var io_1   = require("@plumbline/io");

/* Filled by mount() from ctx. Analysis registers these on ITS mount; when
 * Analysis is not mounted they are inert no-ops, which is the correct
 * behaviour - the editor still imports data, nothing re-renders. */
var HOOKS = {
  renderCanvas: function () {},
  renderAll: function () {},
  showTab: function () {},
  flashTools: function () {},
  computeTool: function () {},
  analysisViewDoc: null,
  analysisViewSig: ""
};



/* main.ts:27-27 */
let latestEditorData = null;

/* main.ts:28-28 */
let latestEditorSignature = "";

/* main.ts:29-29 */
let latestEditorImportedSignature = "";

/* main.ts:1551-1624 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function importEditorData(data, opts = {}) {
    if (!ws_1.isEditorData(data))
        return false;
    const sig = ws_1.editorDataSignature(data);
    latestEditorData = dom_1.clone(data);
    latestEditorSignature = sig;
    if (!opts.force && sig === latestEditorImportedSignature) {
        // Even when the editor process is unchanged, entering the Analysis
        // Studio must make the editor's workflow the ACTIVE one. The previous
        // early return skipped this, leaving whichever workflow was last
        // selected in the Studio active instead.
        const existingIdx = ws_1.getDocs().findIndex(x => x.editorData && ws_1.editorDataSignature(x.editorData) === sig);
        if (existingIdx >= 0) {
            if (opts.openAnalysis) {
                if (ws_1.getActive() !== existingIdx) {
                    ws_1.setActive(existingIdx);
                    ws_1.setSel(null);
                    ws_1.setLastTool(-2);
                    HOOKS.renderAll();
                }
                HOOKS.analysisViewDoc = "";
                HOOKS.renderCanvas();
                HOOKS.showTab("analysis");
            }
            return true;
        }
        // The previously imported editor doc was removed in the Studio —
        // fall through and reimport it fresh.
    }
    const raw = ws_1.editorDataToUnified(data);
    if (!raw)
        return false;
    const res = (0, io_1.parseWorkflow)(ws_1.normalise(raw.workflow));
    if (!res.ok) {
        if (!opts.silent)
            HOOKS.flashTools("The Workflow Editor process could not be imported into Analysis Studio: " + res.errors.join(" • "));
        return false;
    }
    const d = ws_1.mkDoc(res.value);
    d.id = raw.workflow.id;
    d.editorData = dom_1.clone(data);
    if (raw.cost && raw.cost.stepCost)
        d.cost = { ...d.cost, ...raw.cost.stepCost };
    if (raw.cost && raw.cost.branchProb)
        d.branch = { ...d.branch, ...raw.cost.branchProb };
    if (raw.time && raw.time.stepMinutes)
        d.time = { ...d.time, ...raw.time.stepMinutes };
    const meta = raw.meta || {};
    if (meta.layout)
        d.pos = { ...d.pos, ...meta.layout };
    if (meta.owner)
        d.owner = { ...d.owner, ...meta.owner };
    if (meta.stage)
        d.stage = { ...d.stage, ...meta.stage };
    ws_1.rebuild(d);
    const idx = ws_1.getDocs().findIndex(x => x.id === d.id);
    if (idx >= 0) {
        ws_1.getDocs()[idx] = d;
        ws_1.setActive(idx);
    }
    else {
        ws_1.getDocs().push(d);
        ws_1.setActive(ws_1.getDocs().length - 1);
    }
    ws_1.setSel(null);
    ws_1.setLastTool(-2);
    latestEditorImportedSignature = sig;
    HOOKS.renderAll();
    if (opts.openAnalysis)
        HOOKS.showTab("analysis");
    if (!opts.silent)
        auth_1.logHistory("editor-sync", "Imported current Workflow Editor process into Analysis Studio");
    return true;
}

/* main.ts:1625-1645 */
function requestEditorSync(opts = {}) {
    var _a, _b;
    const frame = document.getElementById("workflowEditorFrame");
    let got = false;
    try {
        const fn = (_a = frame === null || frame === void 0 ? void 0 : frame.contentWindow) === null || _a === void 0 ? void 0 : _a.plumblineExportForAnalysis;
        if (typeof fn === "function") {
            const data = fn();
            if (data)
                got = importEditorData(data, opts);
        }
    }
    catch (e) { }
    if (!got && latestEditorData)
        got = importEditorData(latestEditorData, opts);
    try {
        (_b = frame === null || frame === void 0 ? void 0 : frame.contentWindow) === null || _b === void 0 ? void 0 : _b.postMessage({ type: "plumbline-request-editor-data", openAnalysis: !!opts.openAnalysis }, "*");
    }
    catch (e) { }
    return got;
}

/* main.ts:1646-1671 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function setupEditorSync() {
    window.addEventListener("message", (event) => {
        var _a;
        const msg = event.data || {};
        if (msg.type !== "plumbline-editor-data")
            return;
        latestEditorData = msg.data;
        latestEditorSignature = ws_1.editorDataSignature(msg.data);
        if (latestEditorSignature === lastStudioPushSignature)
            return; // echo of a Studio -> Editor push; both screens already agree
        const studioVisible = (_a = document.getElementById("studioPage")) === null || _a === void 0 ? void 0 : _a.classList.contains("active");
        if (studioVisible)
            importEditorData(msg.data, { openAnalysis: !!msg.openAnalysis, silent: true });
    });
}
/* ---------- Analysis Studio -> Workflow Editor sync (Prompt1) ----------
 * The Editor and the Analysis screen work on the SAME process. The editor
 * already pushes live snapshots into the Studio; this is the reverse leg:
 * whenever the Studio's active document is editor-backed and its model
 * changes (loaded a saved workflow, edited names/cost/time, added or
 * removed states/transitions), the change is merged back into the editor
 * data format and posted into the Workflow Editor iframe. Only changes
 * that map cleanly are written; untouched fields are left byte-identical
 * so an unchanged model produces no push at all. */

/* main.ts:1672-1672 */
let studioPushTimer = null;

/* main.ts:1673-1673 */
let lastStudioPushSignature = "";

/* main.ts:1814-1847 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function pushStudioToEditor() {
    if (ws_1.getActive() < 0 || !ws_1.getDocs()[ws_1.getActive()])
        return;
    const d = ws_1.getDocs()[ws_1.getActive()];
    let data = null;
    try {
        data = ws_1.studioDocToEditorData(d);
    }
    catch (e) {
        console.warn("Studio -> Editor sync skipped:", e && e.message);
        return;
    }
    if (!data)
        return;
    const sig = ws_1.editorDataSignature(data);
    if (sig === latestEditorSignature || sig === lastStudioPushSignature)
        return; // nothing changed — both screens already show the same thing
    lastStudioPushSignature = sig;
    latestEditorData = dom_1.clone(data);
    latestEditorSignature = sig;
    latestEditorImportedSignature = sig;
    d.editorData = dom_1.clone(data);
    try {
        const frame = document.getElementById("workflowEditorFrame");
        if (frame && frame.contentWindow)
            frame.contentWindow.postMessage({ type: "plumbline-studio-data", data }, "*");
    }
    catch (e) { }
    if (ws_1.hasEditorCanvas(d)) {
        HOOKS.analysisViewDoc = "";
        HOOKS.analysisViewSig = "";
        setTimeout(() => { try { HOOKS.renderCanvas(); } catch (e) { } }, 30);
    }
}

/* main.ts:1848-1852 */
function schedulePushStudioToEditor() {
    clearTimeout(studioPushTimer);
    studioPushTimer = setTimeout(pushStudioToEditor, 180);
}
/* ---------- engine analysis tab ---------- */



/* ---------------------------------------------------------------------------
 * Module contract
 * -------------------------------------------------------------------------*/

/* ---------------------------------------------------------------------------
 * Tab strip.
 * workspace.docs[] already drives the Studio's tab bar; this renders the same
 * list above the editor iframe so both screens show the same open workflows.
 * Switching a tab makes that document active and pushes it into the iframe.
 * ------------------------------------------------------------------------- */
function renderEditorTabs() {
  var bar = document.getElementById("editorWfbar");
  if (!bar) return;
  var docs = ws_1.getDocs();
  bar.innerHTML = "";
  bar.style.display = docs.length > 1 ? "" : "none";
  if (docs.length < 2) return;
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Open workflows");
  docs.forEach(function (d, i) {
    var tab = document.createElement("div");
    tab.className = "wfTab" + (i === ws_1.getActive() ? " on" : "");
    var main = document.createElement("button");
    main.className = "wfTabMain";
    main.setAttribute("role", "tab");
    main.setAttribute("aria-selected", String(i === ws_1.getActive()));
    main.title = d.name || "Workflow";
    var index = document.createElement("span");
    index.className = "wfTabIndex";
    index.textContent = String(i + 1);
    var name = document.createElement("span");
    name.className = "wfTabName";
    name.textContent = d.name || "Workflow";
    main.append(index, name);
    main.addEventListener("click", function () {
      ws_1.setActive(i);
      ws_1.setSel(null);
      pushStudioToEditor();
      ws_1.emitChange();
      renderEditorTabs();
    });
    var close = document.createElement("button");
    close.className = "wfTabClose";
    close.textContent = "×";
    close.title = "Close " + (d.name || "workflow");
    close.setAttribute("aria-label", close.title);
    close.disabled = docs.length <= 1;
    close.addEventListener("click", function (e) {
      e.stopPropagation();
      if (ws_1.closeDoc(i)) {
        pushStudioToEditor();
        renderEditorTabs();
      }
    });
    tab.append(main, close);
    bar.appendChild(tab);
  });
}

function page() { return document.getElementById("editorPage"); }

var recentredOnce = false, recentreTries = 0;
var CTX = null;                 /* set by init(), used by the message handler */
var offChange = null;

exports["default"] = {
  mount: function (outlet, params, ctx) {
    this.ctx = ctx;
    if (ctx && ctx.analysisHooks) HOOKS = Object.assign(HOOKS, ctx.analysisHooks);

    /* loader.js already created and loaded the frame at startup. */
    if (typeof window.plumblineEnsureEditorLoaded === "function")
      window.plumblineEnsureEditorLoaded();

    var el = page();
    if (el) el.classList.add("active");

    /* -------------------------------------------------------------------
     * FIRST-REVEAL RECENTER
     * loader.js pre-loads the editor at startup so Analysis has its data even
     * when the user never opens the Editor. That means the editor lays itself
     * out while #editorPage is display:none, so the canvas pane reports
     * clientWidth/clientHeight of 0. Its recenterCanvas() does
     *     pane.scrollLeft = max(0, centerX - pane.clientWidth / 2)
     * which with a zero-width pane scrolls to centerX instead of centring on
     * it - leaving every box off-viewport. The editor looks empty and "Add
     * Box" appears to do nothing, when in fact it is adding boxes out of view.
     *
     * Once only, on the first time this screen is actually shown: click the
     * editor's own Recenter button, now that the pane has real dimensions.
     * Doing it on every mount would discard the user's scroll position each
     * time they navigate back here.
     * ----------------------------------------------------------------- */
    if (!recentredOnce) {
      recentredOnce = true;
      var recentre = function () {
        try {
          var f = document.getElementById("workflowEditorFrame");
          var doc = f && f.contentWindow && f.contentWindow.document;
          var btn = doc && doc.getElementById("recenterCanvas");
          var pane = doc && doc.querySelector(".canvasScroller");
          /* Wait for the pane to actually have layout; the iframe may still be
             loading on a first visit. Retry a few times, then give up quietly. */
          if (btn && pane && pane.clientWidth > 0) { btn.click(); return; }
          if (recentreTries++ < 20) setTimeout(recentre, 100);
        } catch (e) { /* iframe not ready or not same-origin: nothing to do */ }
      };
      setTimeout(recentre, 50);
    }

    this.offPush = ws_1.onPushToEditor(function () { schedulePushStudioToEditor(); });
    this.offTabs = ws_1.onChange(function () { renderEditorTabs(); });
    renderEditorTabs();
    offChange = ws_1.onChange(renderEditorTabs);
    renderEditorTabs();

    if (typeof window.plumblineBroadcastAuth === "function")
      setTimeout(window.plumblineBroadcastAuth, 60);
  },

  unmount: function () {
    /* FLUSH FIRST. Edits live inside the iframe until asked for; hiding the
     * page without this loses the user's most recent work. Synchronous - see
     * the header. */
    try { requestEditorSync({ silent: true }); } catch (e) {}

    if (this.offPush) { this.offPush(); this.offPush = null; }
    if (this.offTabs) { this.offTabs(); this.offTabs = null; }
    if (offChange) { offChange(); offChange = null; }
    if (studioPushTimer) { clearTimeout(studioPushTimer); studioPushTimer = null; }

    var el = page();
    if (el) el.classList.remove("active");
    /* The iframe element itself is intentionally left in the DOM. */
  }
};

/* ---------------------------------------------------------------------------
 * init(ctx) - called ONCE by ui-boot.js, before the router starts.
 *
 * The message listener and the two window.plumbline* globals must exist from
 * BOOT, not from this screen's first mount: loader.js pre-loads the editor
 * iframe at startup precisely so the Analysis screen has editor data even when
 * the user never opens the Editor. Installing them in mount() would mean a
 * user who goes straight to Analysis gets no editor snapshots at all.
 * -------------------------------------------------------------------------*/
exports.init = function (ctx) {
  CTX = ctx;
  setupEditorSync();

  /* The editor document is separate and cannot reach the module registry, so
     its Save and Explore Saved buttons post messages. Flush first: the user's
     most recent edits live inside the iframe until either path is opened. */
  window.addEventListener("message", function (ev) {
    var d = ev && ev.data;
    if (!d || (d.type !== "plumbline-library" && d.type !== "plumbline-save")) return;
    try { requestEditorSync({ silent: true }); } catch (e) { }
    if (!CTX || !CTX.library) return;
    if (d.type === "plumbline-save") CTX.library.openSave({ mode: "editor" });
    else CTX.library.open({ mode: "editor" });
  });
  /* C2: the iframe is a separate document and calls these by name at any time. */
  window.plumblineImportEditorData = function (data, opts) {
    return importEditorData(data, opts || {});
  };
  window.plumblineRequestEditorSync = function (opts) {
    return requestEditorSync(opts || {});
  };
};

/* ---- exports (for tests and for analysis.ts's editor-backed paths) ---- */
exports["importEditorData"] = importEditorData;
exports["requestEditorSync"] = requestEditorSync;
exports["pushStudioToEditor"] = pushStudioToEditor;
exports["schedulePushStudioToEditor"] = schedulePushStudioToEditor;
/* Explicit entry points retained for non-message callers and tests. */
exports.openLibraryFromEditor = function () {
  try { requestEditorSync({ silent: true }); } catch (e) { }
  if (CTX && CTX.library) CTX.library.open({ mode: "editor" });
};
exports.openSaveFromEditor = function () {
  try { requestEditorSync({ silent: true }); } catch (e) { }
  if (CTX && CTX.library) CTX.library.openSave({ mode: "editor" });
};

exports.setAnalysisHooks = function (h) { HOOKS = Object.assign(HOOKS, h || {}); };

}, {"@plumbline/io":"packages/io/src/index.ts"});

