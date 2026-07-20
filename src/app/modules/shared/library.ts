/* ============================================================================
 * studio/shared/library.ts — the workflow navigation pane
 * ----------------------------------------------------------------------------
 * A pop-up sidebar for reading and saving workflows. Opened from the Editor's
 * Read/Save button and from the Analysis Studio's Read/Save button, and it
 * overlays whichever screen is showing.
 *
 * It is a SHARED module, not a screen: two screens open it, its markup lives
 * in shell.html outside the router outlet, and it is initialised once at boot.
 * A screen module would have to be duplicated or reached into by the other,
 * which the Phase 1 dependency rule forbids.
 *
 * READING
 *   · a single workflow          -> replaces nothing, adds a document
 *   · a whole folder             -> loads every workflow in it, one document
 *                                   each. workspace.docs[] already drives the
 *                                   tab strip in both screens, so tabs come
 *                                   for free.
 *   Because Editor and Analysis share one workspace, whatever is loaded here
 *   appears identically in both.
 *
 * SAVING
 *   · the active workflow, or every open one
 *   · to the same folder or a different one (or none)
 *   · under the same name or a new one
 *   · each with a description
 *
 * SAMPLES (migration 004)
 *   Read-only for everyone but a superuser. The panel offers "Copy to my
 *   workflows" instead of Save, so a sample is a starting point rather than a
 *   dead end.
 * ==========================================================================*/
__PL.define("studio/shared/library.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var dom_1 = require("studio/shared/dom.ts");
var ws_1  = require("studio/shared/workspace.ts");

var CTX     = null;
var MODE    = "editor";     /* where a loaded workflow is delivered */
var groups  = [];           /* folder rows */
var items   = [];           /* workflow rows, with visibility + isMine */
var open    = {};           /* groupId -> expanded */
var pick    = null;         /* { kind: 'workflow'|'group', id } */
var filter  = "";
var busy    = false;

var $ = function (id) { return document.getElementById(id); };

function status(msg, bad) {
  var n = $("libStatus");
  if (!n) return;
  n.textContent = msg || "";
  n.className = "libStatus" + (bad ? " bad" : "");
}

function api() {
  if (!CTX || !CTX.data) throw new Error("library: no data gateway");
  return CTX.data;
}

/* ---------------------------------------------------------------------------
 * data
 * -------------------------------------------------------------------------*/
function refresh() {
  return Promise.all([
    api().listGroups().catch(function () { return []; }),
    api().listWorkflows().catch(function () { return []; })
  ]).then(function (r) {
    groups = Array.isArray(r[0]) ? r[0] : [];
    items  = Array.isArray(r[1]) ? r[1] : [];
    render();
  });
}
exports.refresh = refresh;

function mine()    { return items.filter(function (w) { return w.isMine !== false && w.visibility !== "SAMPLE"; }); }
function samples() { return items.filter(function (w) { return w.visibility === "SAMPLE"; }); }

function matches(text) {
  if (!filter) return true;
  return String(text || "").toLowerCase().indexOf(filter) >= 0;
}

/* ---------------------------------------------------------------------------
 * rendering
 * -------------------------------------------------------------------------*/
function row(opts) {
  var el = document.createElement("div");
  el.className = "libRow" + (opts.sel ? " sel" : "") + (opts.dim ? " dim" : "");
  var tw = document.createElement("span");
  tw.className = "twist";
  tw.textContent = opts.twist || "";
  el.appendChild(tw);
  var ic = document.createElement("span");
  ic.className = "ico";
  ic.textContent = opts.icon || "";
  el.appendChild(ic);
  var nm = document.createElement("span");
  nm.className = "nm";
  nm.textContent = opts.label;
  el.appendChild(nm);
  if (opts.note) {
    var v = document.createElement("span");
    v.className = "ver";
    v.textContent = opts.note;
    el.appendChild(v);
  }
  if (opts.onClick) el.addEventListener("click", opts.onClick);
  return el;
}

function renderFolder(g, host, depth) {
  var kids = mine().filter(function (w) { return w.groupId === g.groupId; });
  var subs = groups.filter(function (x) { return x.parentGroupId === g.groupId; });
  var hit = matches(g.name) ||
            kids.some(function (w) { return matches(w.name); });
  if (!hit) return;

  var expanded = open[g.groupId] || !!filter;
  host.appendChild(row({
    twist: (kids.length + subs.length) ? (expanded ? "\u25be" : "\u25b8") : "",
    icon: "\u25a2",
    label: g.name,
    note: kids.length ? String(kids.length) : "",
    sel: pick && pick.kind === "group" && pick.id === g.groupId,
    onClick: function () {
      open[g.groupId] = !expanded;
      pick = { kind: "group", id: g.groupId, name: g.name };
      render();
    }
  }));
  if (!expanded) return;

  var box = document.createElement("div");
  box.className = "libKids";
  subs.forEach(function (s) { renderFolder(s, box, depth + 1); });
  kids.filter(function (w) { return matches(w.name); })
      .forEach(function (w) { box.appendChild(workflowRow(w)); });
  host.appendChild(box);
}

function workflowRow(w) {
  return row({
    icon: "\u2261",
    label: w.name,
    note: w.versionNumber ? ("v" + w.versionNumber) : "",
    sel: pick && pick.kind === "workflow" && pick.id === w.id,
    onClick: function () {
      pick = { kind: "workflow", id: w.id, name: w.name,
               sample: w.visibility === "SAMPLE" };
      render();
    }
  });
}

function section(host, title, note) {
  var h = document.createElement("div");
  h.className = "libSection";
  h.textContent = title;
  if (note) {
    var s = document.createElement("span");
    s.textContent = note;
    h.appendChild(s);
  }
  host.appendChild(h);
}

function render() {
  var tree = $("libTree");
  if (!tree) return;
  tree.innerHTML = "";

  var roots = groups.filter(function (g) { return !g.parentGroupId; });
  var loose = mine().filter(function (w) { return !w.groupId && matches(w.name); });
  var samp  = samples().filter(function (w) { return matches(w.name); });

  if (roots.length || loose.length) {
    section(tree, "My workflows");
    roots.forEach(function (g) { renderFolder(g, tree, 0); });
    if (loose.length) {
      section(tree, "Not in a folder");
      loose.forEach(function (w) { tree.appendChild(workflowRow(w)); });
    }
  }
  if (samp.length) {
    section(tree, "Samples", "read-only");
    samp.forEach(function (w) { tree.appendChild(workflowRow(w)); });
  }
  if (!tree.children.length) {
    var e = document.createElement("div");
    e.className = "libEmpty";
    e.textContent = filter ? "Nothing matches \u201C" + filter + "\u201D."
                           : "No saved workflows yet.";
    tree.appendChild(e);
  }
  paintActions();
}

/* The footer changes with the selection: open a folder, open a workflow,
 * or copy a sample. */
function paintActions() {
  var openBtn = $("libOpen");
  var lbl = "Open";
  var can = !!pick;
  if (pick && pick.kind === "group") {
    var n = mine().filter(function (w) { return w.groupId === pick.id; }).length;
    lbl = n ? ("Open folder (" + n + ")") : "Folder is empty";
    can = n > 0;
  } else if (pick && pick.kind === "workflow") {
    lbl = pick.sample ? "Copy to my workflows" : "Open workflow";
  }
  if (openBtn) {
    openBtn.textContent = lbl;
    openBtn.disabled = !can || busy;
  }

  var d = ws_1.D();
  var nm = $("libSaveName");
  if (nm && !nm.value && d) nm.value = d.name || "";
  var sel = $("libSaveFolder");
  if (sel) {
    var cur = sel.value;
    sel.innerHTML = "";
    var none = document.createElement("option");
    none.value = ""; none.textContent = "(no folder)";
    sel.appendChild(none);
    groups.forEach(function (g) {
      var o = document.createElement("option");
      o.value = g.groupId; o.textContent = g.name;
      sel.appendChild(o);
    });
    var nw = document.createElement("option");
    nw.value = "__new"; nw.textContent = "New folder\u2026";
    sel.appendChild(nw);
    sel.value = cur || "";
  }
  var count = ws_1.getDocs().length;
  var all = $("libSaveAll");
  if (all) {
    all.parentNode.style.display = count > 1 ? "" : "none";
    all.nextSibling && (all.nextSibling.textContent = " Save all " + count + " open workflows");
  }
}

/* ---------------------------------------------------------------------------
 * reading
 * -------------------------------------------------------------------------*/
function deliver() {
  /* The workspace hooks do the rest: Analysis re-renders through onChange,
     the Editor receives the active document through onPushToEditor. Neither
     screen is called directly from here. */
  ws_1.emitChange();
  if (MODE === "editor") ws_1.persist();
}

/* workspace.ingest() writes into the ACTIVE slot:
 *     docs[active >= 0 ? active : docs.length] = d
 * so it replaces the current document unless active is -1. Opening from the
 * library should add a tab rather than overwrite whatever the user has open,
 * so park active at -1 first and let it append. */
function appendDoc(raw, label) {
  ws_1.setActive(-1);
  ws_1.ingest(raw, label || "Library");
}

function openWorkflow(id, asCopy) {
  busy = true; paintActions();
  status("Loading\u2026");
  return api().loadWorkflow(id).then(function (rec) {
    if (!rec) throw new Error("not found");
    appendDoc(rec.workflow);
    var d = ws_1.D();
    if (d) d.name = asCopy ? ((rec.name || "Workflow") + " (copy)")
                           : (rec.name || d.name);
    deliver();
    status("");
    close();
  })["catch"](function (e) {
    status("Could not open: " + (e && e.message || e), true);
  })["finally"](function () { busy = false; paintActions(); });
}

function openFolder(groupId) {
  busy = true; paintActions();
  status("Loading folder\u2026");
  return api().listGroupWorkflows(groupId).then(function (rows) {
    if (!rows || !rows.length) throw new Error("the folder is empty");
    /* one document per workflow — the tab strip in both screens follows */
    rows.forEach(function (r) {
      appendDoc(r.workflow, r.name || "Library");
      var d = ws_1.D();
      if (d && r.name) d.name = r.name;
    });
    deliver();
    status("");
    close();
  })["catch"](function (e) {
    status("Could not open folder: " + (e && e.message || e), true);
  })["finally"](function () { busy = false; paintActions(); });
}

/* ---------------------------------------------------------------------------
 * saving
 * -------------------------------------------------------------------------*/
function chosenFolder() {
  var sel = $("libSaveFolder");
  return sel && sel.value && sel.value !== "__new" ? sel.value : null;
}

function saveOne(doc, name, description, groupId) {
  return api().saveWorkflow({
    name: name,
    description: description || "",
    workflow: ws_1.unified(doc),
    config: {},
    toolsExecuted: ws_1.activeToolIndexes(doc),
    layout: doc.pos,
    groupId: groupId
  });
}

function doSave() {
  var docs = ws_1.getDocs();
  var d = ws_1.D();
  if (!docs.length) { status("Nothing open to save.", true); return; }

  var all = $("libSaveAll") && $("libSaveAll").checked;
  var name = ($("libSaveName") && $("libSaveName").value || "").trim();
  var desc = ($("libSaveDesc") && $("libSaveDesc").value || "").trim();
  var gid  = chosenFolder();

  if (!all && !d) { status("No active workflow.", true); return; }
  if (!all && !name) { status("Give the workflow a name.", true); return; }

  busy = true; paintActions();
  status("Saving\u2026");

  var newFolder = $("libSaveFolder") && $("libSaveFolder").value === "__new";
  var prep = newFolder
    ? api().createGroup((name || "New folder") + " folder", null)
        .then(function (g) { return g && (g.groupId || g.id); })
    : Promise.resolve(gid);

  return prep.then(function (folder) {
    /* Saving all: each document keeps its own name, so a folder round-trips.
       Saving one: the name field wins, so "save as" works. */
    var list = all ? docs.map(function (x) {
                       return { doc: x, name: x.name || "Workflow" };
                     })
                   : [{ doc: d, name: name }];
    var i = 0;
    var next = function () {
      if (i >= list.length) return Promise.resolve();
      var one = list[i++];
      return saveOne(one.doc, one.name, desc, folder).then(next);
    };
    return next().then(function () {
      status(all ? ("Saved " + list.length + " workflows.") : "Saved.");
      return refresh();
    });
  })["catch"](function (e) {
    var m = String(e && e.message || e);
    if (/duplicate|unique/i.test(m))
      m = "You already have a workflow with that name. Choose another.";
    status("Could not save: " + m, true);
  })["finally"](function () { busy = false; paintActions(); });
}

/* ---------------------------------------------------------------------------
 * open / close
 * -------------------------------------------------------------------------*/
function close() {
  var o = $("libraryOverlay");
  if (o) o.style.display = "none";
  document.removeEventListener("keydown", onKey);
}
exports.close = close;

function onKey(e) { if (e.key === "Escape") close(); }

exports.open = function (opts) {
  MODE = (opts && opts.mode) || "editor";
  var o = $("libraryOverlay");
  if (!o) return Promise.resolve();
  o.style.display = "flex";
  document.addEventListener("keydown", onKey);
  status("");
  var d = ws_1.D();
  var nm = $("libSaveName");
  if (nm) nm.value = d ? (d.name || "") : "";
  var ds = $("libSaveDesc");
  if (ds) ds.value = "";
  return refresh()["catch"](function (e) {
    status("Could not load the library: " + (e && e.message || e), true);
  });
};

/* ---------------------------------------------------------------------------
 * init — called once from ui-boot, after auth and before the router
 * -------------------------------------------------------------------------*/
exports.init = function (ctx) {
  CTX = ctx;

  var bind = function (id, ev, fn) {
    var n = $(id);
    if (n) n.addEventListener(ev, fn);
  };

  bind("libClose", "click", close);
  bind("libraryOverlay", "click", function (e) {
    if (e.target && e.target.id === "libraryOverlay") close();
  });
  bind("libSearch", "input", function (e) {
    filter = String(e.target.value || "").trim().toLowerCase();
    render();
  });
  bind("libOpen", "click", function () {
    if (!pick || busy) return;
    if (pick.kind === "group") return openFolder(pick.id);
    return openWorkflow(pick.id, !!pick.sample);
  });
  bind("libSave", "click", function () { if (!busy) doSave(); });
  bind("libNewFolder", "click", function () {
    var name = window.prompt("Name for the new folder");
    if (!name) return;
    busy = true; paintActions();
    api().createGroup(name.trim(), null)
      .then(refresh)
      .then(function () { status("Folder created."); })
      ["catch"](function (e) { status("Could not create folder: " +
        (e && e.message || e), true); })
      ["finally"](function () { busy = false; paintActions(); });
  });

  /* The editor iframe asks for this panel by name; the editor document is a
     separate document and cannot reach the module registry. */
  window.plumblineOpenLibrary = function (mode) {
    return exports.open({ mode: mode || "editor" });
  };
};

});
