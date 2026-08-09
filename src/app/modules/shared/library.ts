/* ============================================================================
 * studio/shared/library.ts — the workflow navigation pane
 * ----------------------------------------------------------------------------
 * The organized Explorer sidebar plus the focused Save dialog. Both are
 * shared by the Editor and Analysis Studio and overlay whichever screen is
 * showing.
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
 * EXAMPLES
 *   The legacy database SAMPLE rows are not shown. The editable local example
 *   catalog is the single examples experience and supports the same rename,
 *   move, duplicate, and delete interactions as ordinary workflows.
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
var exampleOpen = {};       /* built-in category id -> expanded */
var pick    = null;         /* { kind: 'workflow'|'group'|'example', id } */
var filter  = "";
var busy    = false;
var draggingId = null;
var draggingKind = null;
var editingId = null;
var editingKind = null;
var editingCollectionId = null;
var pendingConfirmation = null;
var exampleCollections = [];
var exampleStateScope = null;
var selectedIds = new Set(); /* workflow/example ids selected in Explorer */
var selectedKind = null;     /* keep a batch homogeneous so its actions are clear */
var selectionAnchor = null;
var folderOrder = [];        /* account-backed sibling order for database folders */
var exampleUndoState = null; /* last bulk-removed editable example catalog */

var $ = function (id) { return document.getElementById(id); };

/* Guest-ready examples use the same unified shape as saved workflows. Their
 * mutable catalog is scoped to the guest or signed-in account and stored
 * locally, so examples can be renamed, moved, duplicated, and deleted without
 * requiring a database connection. */
function reviewExample(id, name, description, labels, owner, scale, approveProb) {
  var ids = ["Start", "Prepare", "Review", "Execute", "Revise", "Done"];
  var roles = ["step", "step", "decision", "step", "rework", "terminal"];
  var states = ids.map(function (stateId, i) {
    return {
      id: stateId, label: labels[i], role: roles[i],
      initial: i === 0, accept: i === ids.length - 1
    };
  });
  var transitions = [
    { from: "Start", on: "begin", to: "Prepare" },
    { from: "Prepare", on: "submit", to: "Review" },
    { from: "Review", on: "approved", to: "Execute" },
    { from: "Review", on: "changes_requested", to: "Revise" },
    { from: "Revise", on: "resubmit", to: "Review" },
    { from: "Execute", on: "complete", to: "Done" }
  ];
  var costs = [12, 45, 35, 85, 110, 0];
  var minutes = [8, 35, 25, 60, 90, 0];
  var stepCost = {}, stepMinutes = {}, ownership = {}, stage = {};
  ids.forEach(function (stateId, i) {
    stepCost[stateId] = Math.round(costs[i] * scale);
    stepMinutes[stateId] = Math.round(minutes[i] * scale);
    ownership[stateId] = i === 2 ? "Reviewer" : owner;
    stage[stateId] = i < 2 ? "Intake" : (i === 2 ? "Review" : (i === 4 ? "Rework" : "Delivery"));
  });
  return {
    id: id, name: name, description: description,
    document: {
      workflow: { id: id, name: name, states: states, transitions: transitions },
      cost: {
        stepCost: stepCost,
        branchProb: {
          "Start::begin": 1, "Prepare::submit": 1,
          "Review::approved": approveProb,
          "Review::changes_requested": +(1 - approveProb).toFixed(2),
          "Revise::resubmit": 1, "Execute::complete": 1
        }
      },
      time: { stepMinutes: stepMinutes },
      meta: { owner: ownership, stage: stage }
    }
  };
}

var DEFAULT_EXAMPLE_COLLECTIONS = [
  { id: "operations", name: "Operations", examples: [
    reviewExample("employee_onboarding", "Employee onboarding", "Coordinate people, IT, and manager onboarding tasks.",
      ["Offer accepted", "Prepare access and equipment", "Readiness review", "Welcome new employee", "Resolve onboarding gaps", "Onboarding complete"], "People operations", 1.0, .82),
    reviewExample("purchase_approval", "Purchase request approval", "Test budget review, corrections, and order placement.",
      ["Request received", "Prepare purchase case", "Budget approval", "Place purchase order", "Revise request", "Order confirmed"], "Procurement", 1.2, .68),
    reviewExample("service_incident", "Service incident response", "Move an incident through triage, mitigation, and closure.",
      ["Alert received", "Triage and contain", "Recovery check", "Restore service", "Continue remediation", "Incident closed"], "Incident response", 2.4, .74)
  ]},
  { id: "customer_revenue", name: "Customer & revenue", examples: [
    reviewExample("lead_qualification", "Lead qualification", "Qualify an inbound lead and progress it to an opportunity.",
      ["Lead captured", "Enrich and qualify", "Fit review", "Open opportunity", "Nurture and requalify", "Qualified opportunity"], "Revenue operations", .8, .57),
    reviewExample("support_escalation", "Customer support escalation", "Test tier-one resolution and engineering escalation loops.",
      ["Ticket received", "Investigate issue", "Resolution review", "Confirm with customer", "Escalate and rework", "Ticket solved"], "Customer support", 1.1, .66),
    reviewExample("renewal_risk", "Subscription renewal risk", "Assess account health and recover a renewal at risk.",
      ["Renewal window opens", "Prepare health assessment", "Renewal risk review", "Issue renewal offer", "Build recovery plan", "Subscription renewed"], "Customer success", 1.3, .7)
  ]},
  { id: "risk_compliance", name: "Risk & compliance", examples: [
    reviewExample("vendor_risk", "Vendor risk review", "Run vendor due diligence with a remediation loop.",
      ["Vendor submitted", "Collect due diligence", "Risk decision", "Approve vendor", "Remediate findings", "Vendor active"], "Risk management", 1.8, .63),
    reviewExample("expense_audit", "Expense audit", "Validate receipts, policy exceptions, and reimbursement.",
      ["Expense submitted", "Validate receipt and policy", "Exception review", "Issue reimbursement", "Correct expense", "Expense paid"], "Finance", .65, .84),
    reviewExample("access_request", "Privileged access request", "Exercise approval, correction, provisioning, and verification.",
      ["Access requested", "Document business need", "Security approval", "Provision access", "Revise request", "Access granted"], "Identity operations", 1.0, .76)
  ]},
  { id: "product_technology", name: "Product & technology", examples: [
    reviewExample("feature_release", "Feature release", "Test QA gating, blocker rework, and production release.",
      ["Feature ready", "Prepare release candidate", "Release gate", "Deploy and monitor", "Fix release blockers", "Release complete"], "Product engineering", 2.0, .72),
    reviewExample("bug_triage", "Bug triage", "Move a reported defect through severity review and verification.",
      ["Bug reported", "Reproduce and diagnose", "Severity review", "Release correction", "Repair defect", "Bug resolved"], "Engineering", 1.6, .61),
    reviewExample("pipeline_recovery", "Data pipeline recovery", "Diagnose a failed batch, replay it, and validate output.",
      ["Failure detected", "Diagnose pipeline", "Recovery review", "Replay and validate", "Repair source or code", "Pipeline healthy"], "Data platform", 2.2, .69)
  ]}
];

function cloneExamples(value) {
  return JSON.parse(JSON.stringify(value));
}

function exampleScope() {
  var user = CTX && CTX.auth && CTX.auth.currentUser && CTX.auth.currentUser();
  if (!user) return "guest";
  return String(user.id || user.userId || user.username || user.email || "account");
}

function exampleStorageKey(scope) {
  return "plumbline.example-library.v2." + encodeURIComponent(scope || exampleScope());
}

function validExampleCollections(value) {
  return Array.isArray(value) && value.every(function (collection) {
    return collection && collection.id && collection.name && Array.isArray(collection.examples) &&
      collection.examples.every(function (example) {
        return example && example.id && example.name && example.document && example.document.workflow;
      });
  });
}

function loadExampleState(force) {
  var scope = exampleScope();
  if (!force && exampleStateScope === scope && exampleCollections.length) return;
  exampleStateScope = scope;
  var stored = null;
  try { stored = JSON.parse(localStorage.getItem(exampleStorageKey(scope)) || "null"); }
  catch (e) { stored = null; }
  exampleCollections = validExampleCollections(stored)
    ? stored
    : cloneExamples(DEFAULT_EXAMPLE_COLLECTIONS);
  exampleCollections.forEach(function (collection) {
    if (exampleOpen[collection.id] === undefined) exampleOpen[collection.id] = true;
  });
  loadExampleUndoState();
}

function persistExampleState() {
  try { localStorage.setItem(exampleStorageKey(exampleStateScope), JSON.stringify(exampleCollections)); }
  catch (e) { status("The example change is active for this session but could not be saved locally.", true); }
}

function exampleUndoKey(scope) {
  return "plumbline.example-library.undo.v1." + encodeURIComponent(scope || exampleScope());
}

function loadExampleUndoState() {
  var stored = null;
  try { stored = JSON.parse(localStorage.getItem(exampleUndoKey(exampleStateScope)) || "null"); }
  catch (e) { stored = null; }
  exampleUndoState = validExampleCollections(stored) && stored.length ? stored : null;
}

function paintExampleUndoActions() {
  var total = exampleCollections.reduce(function (sum, collection) { return sum + collection.examples.length; }, 0);
  var remove = $("libRemoveExamples"), undo = $("libUndoExamples");
  if (remove) remove.disabled = total === 0;
  if (undo) undo.disabled = !exampleUndoState;
}

function removeAllExamples() {
  var total = exampleCollections.reduce(function (sum, collection) { return sum + collection.examples.length; }, 0);
  if (!total) return;
  exampleUndoState = cloneExamples(exampleCollections);
  try { localStorage.setItem(exampleUndoKey(exampleStateScope), JSON.stringify(exampleUndoState)); } catch (e) {}
  exampleCollections = [];
  exampleOpen = {};
  if (selectedKind === "example") clearSelection(false);
  if (pick && pick.kind === "example") pick = null;
  persistExampleState();
  status(total + " examples removed. Undo remains available until the next bulk removal.");
  render();
}

function undoRemoveAllExamples() {
  if (!exampleUndoState) loadExampleUndoState();
  if (!exampleUndoState) { status("There is no removed example set to restore.", true); return; }
  exampleCollections = cloneExamples(exampleUndoState);
  exampleCollections.forEach(function (collection) { exampleOpen[collection.id] = true; });
  exampleUndoState = null;
  try { localStorage.removeItem(exampleUndoKey(exampleStateScope)); } catch (e) {}
  persistExampleState();
  status("Examples restored.");
  render();
}

loadExampleState(true);

function findExample(id) {
  for (var i = 0; i < exampleCollections.length; i++) {
    for (var j = 0; j < exampleCollections[i].examples.length; j++) {
      if (exampleCollections[i].examples[j].id === id) return exampleCollections[i].examples[j];
    }
  }
  return null;
}

function findExampleLocation(id) {
  for (var i = 0; i < exampleCollections.length; i++) {
    var index = exampleCollections[i].examples.findIndex(function (example) { return example.id === id; });
    if (index >= 0) return { collection: exampleCollections[i], index: index, example: exampleCollections[i].examples[index] };
  }
  return null;
}

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
    api().listWorkflows().catch(function () { return []; }),
    isGuest() ? Promise.resolve({}) : api().getSettings().catch(function () { return {}; })
  ]).then(function (r) {
    groups = Array.isArray(r[0]) ? r[0] : [];
    items  = Array.isArray(r[1]) ? r[1] : [];
    groups.forEach(function (g, i) { g._listIndex = i; });
    items.forEach(function (w, i) { w._listIndex = i; });
    var accountOrder = r[2] && Array.isArray(r[2].explorerFolderOrder) ? r[2].explorerFolderOrder : [];
    folderOrder = accountOrder.length ? accountOrder.map(String) : loadLocalFolderOrder();
    render();
  });
}
exports.refresh = refresh;

function mine()    { return items.filter(function (w) { return w.isMine !== false && w.visibility !== "SAMPLE"; }); }
function isGuest() { return !!(CTX && CTX.auth && CTX.auth.isGuest && CTX.auth.isGuest()); }
function ordered(list) {
  return list.slice().sort(function (a, b) {
    var ap = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : ((a._listIndex || 0) + 1) * 100;
    var bp = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : ((b._listIndex || 0) + 1) * 100;
    return ap - bp || String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function folderOrderKey() {
  return "plumbline.explorer.folder-order.v1." + encodeURIComponent(exampleScope());
}

function loadLocalFolderOrder() {
  try {
    var stored = JSON.parse(localStorage.getItem(folderOrderKey()) || "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch (e) { return []; }
}

function completeFolderOrder() {
  var known = new Set(groups.map(function (g) { return String(g.groupId); }));
  var next = [], seen = new Set();
  folderOrder.forEach(function (id) {
    id = String(id);
    if (known.has(id) && !seen.has(id)) { seen.add(id); next.push(id); }
  });
  groups.forEach(function (g) {
    var id = String(g.groupId);
    if (!seen.has(id)) { seen.add(id); next.push(id); }
  });
  return next;
}

function orderedGroups(list) {
  var rank = new Map(completeFolderOrder().map(function (id, index) { return [id, index]; }));
  return list.slice().sort(function (a, b) {
    var ar = rank.has(String(a.groupId)) ? rank.get(String(a.groupId)) : Number.MAX_SAFE_INTEGER;
    var br = rank.has(String(b.groupId)) ? rank.get(String(b.groupId)) : Number.MAX_SAFE_INTEGER;
    return ar - br || String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function persistFolderOrder() {
  folderOrder = completeFolderOrder();
  try { localStorage.setItem(folderOrderKey(), JSON.stringify(folderOrder)); } catch (e) {}
  return api().updateSettings({ explorerFolderOrder: folderOrder });
}

function closeConfirmation() {
  pendingConfirmation = null;
  var modal = $("libraryConfirmModal");
  if (modal) modal.style.display = "none";
}

function askConfirmation(title, message, action) {
  pendingConfirmation = action;
  if ($("libraryConfirmTitle")) $("libraryConfirmTitle").textContent = title;
  if ($("libraryConfirmMessage")) $("libraryConfirmMessage").textContent = message;
  var modal = $("libraryConfirmModal");
  if (modal) modal.style.display = "flex";
}

function acceptConfirmation() {
  var action = pendingConfirmation;
  closeConfirmation();
  if (typeof action === "function") action();
}

function matches(text) {
  if (!filter) return true;
  return String(text || "").toLowerCase().indexOf(filter) >= 0;
}

/* ---------------------------------------------------------------------------
 * rendering
 * -------------------------------------------------------------------------*/
function explorerIcon(kind) {
  var paths = {
    folder: '<path d="M3.5 6.5h6l2 2h9v10h-17z"></path>',
    workflow: '<path d="M7 3.5h8l4 4v13H7z"></path><path d="M15 3.5v4h4M10 12h6m-6 4h6"></path>',
    example: '<path d="M7 3.5h8l4 4v13H7z"></path><path d="M15 3.5v4h4M10 12h6m-6 4h6"></path><path d="m4.5 14 1 1 2-2"></path>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[kind] || paths.workflow) + '</svg>';
}

function row(opts) {
  var el = document.createElement("div");
  el.className = "libRow" + (opts.kind === "folder" ? " libFolderRow" : " libFileRow") +
    (opts.sel ? " sel" : "") + (opts.dim ? " dim" : "");
  el.tabIndex = 0;
  el.setAttribute("role", "treeitem");
  var tw = document.createElement("span");
  tw.className = "twist";
  tw.textContent = opts.twist || "";
  el.appendChild(tw);
  var ic = document.createElement("span");
  ic.className = "ico";
  if (opts.iconKind) ic.innerHTML = explorerIcon(opts.iconKind);
  else ic.textContent = opts.icon || "";
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
  if (opts.onClick) {
    el.addEventListener("click", opts.onClick);
    el.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      opts.onClick(event);
    });
  }
  return el;
}

function clearSelection(shouldRender) {
  selectedIds.clear();
  selectedKind = null;
  selectionAnchor = null;
  pick = null;
  if (shouldRender !== false) render();
}

function selectableKey(kind, id) { return kind + ":" + id; }

function selectItem(kind, id, name, extra, event) {
  var key = selectableKey(kind, id);
  var additive = !!(event && (event.ctrlKey || event.metaKey));
  var range = !!(event && event.shiftKey);
  if (selectedKind !== kind) {
    selectedIds.clear();
    selectedKind = kind;
    selectionAnchor = null;
  }
  if (range && selectionAnchor) {
    var visible = Array.prototype.slice.call(document.querySelectorAll('.libRow[data-select-kind="' + kind + '"]'));
    var from = visible.findIndex(function (node) { return node.dataset.selectKey === selectionAnchor; });
    var to = visible.findIndex(function (node) { return node.dataset.selectKey === key; });
    if (from >= 0 && to >= 0) {
      if (!additive) selectedIds.clear();
      visible.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(function (node) {
        selectedIds.add(node.dataset.selectId);
      });
    } else selectedIds.add(id);
  } else if (additive) {
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
    selectionAnchor = key;
  } else {
    selectedIds.clear();
    selectedIds.add(id);
    selectionAnchor = key;
  }
  if (!selectedIds.size) {
    selectedKind = null;
    selectionAnchor = null;
    pick = null;
  } else if (selectedIds.size === 1) {
    var only = Array.from(selectedIds)[0];
    pick = Object.assign({ kind: kind, id: only, name: only }, only === id ? (extra || { name: name }) : {});
  } else {
    pick = { kind: "multi", selectionKind: kind };
  }
  render();
}

function markSelectable(el, kind, id) {
  el.dataset.selectKind = kind;
  el.dataset.selectId = id;
  el.dataset.selectKey = selectableKey(kind, id);
  el.setAttribute("aria-selected", selectedKind === kind && selectedIds.has(id) ? "true" : "false");
}

function iconSvg(kind) {
  var paths = {
    open: '<path d="M3.5 7h6l2 2h9l-2 10h-15z"></path><path d="m13 13 2 2 4-4"></path>',
    folder: '<path d="M3.5 6.5h6l2 2h9v10h-17z"></path><path d="M12 11v5m-2.5-2.5h5"></path>',
    edit: '<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"></path><path d="m13.5 6.5 4 4"></path>',
    copy: '<rect x="8" y="3" width="13" height="16" rx="3"></rect><path d="M16 21H6a3 3 0 0 1-3-3V8"></path>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"></path>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths[kind] + '</svg>';
}

function iconButton(kind, label, fn) {
  var b = document.createElement("button");
  b.type = "button";
  b.className = "libIconBtn" + (kind === "trash" ? " danger" : "");
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = iconSvg(kind);
  b.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  b.addEventListener("dragstart", function (e) { e.preventDefault(); });
  b.addEventListener("click", function (e) {
    e.preventDefault(); e.stopPropagation(); fn();
  });
  return b;
}

function hideContextMenu() {
  var menu = $("libContextMenu");
  if (!menu) return;
  menu.hidden = true;
  menu.innerHTML = "";
}

function showContextMenu(event, actions) {
  var menu = $("libContextMenu");
  if (!menu || !Array.isArray(actions) || !actions.length) return;
  event.preventDefault();
  event.stopPropagation();
  menu.innerHTML = "";
  actions.forEach(function (action) {
    if (action.separator) {
      var separator = document.createElement("div");
      separator.className = "libContextSeparator";
      separator.setAttribute("role", "separator");
      menu.appendChild(separator);
      return;
    }
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    if (action.danger) button.className = "danger";
    button.innerHTML = iconSvg(action.icon || "edit") + "<span></span>";
    button.querySelector("span").textContent = action.label;
    button.addEventListener("click", function () {
      hideContextMenu();
      action.run();
    });
    menu.appendChild(button);
  });
  menu.style.left = Math.max(8, event.clientX) + "px";
  menu.style.top = Math.max(8, event.clientY) + "px";
  menu.hidden = false;
  var rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8)) + "px";
  var first = menu.querySelector("button");
  if (first) first.focus();
}

function attachContextMenu(el, actionFactory) {
  if (!el) return;
  el.addEventListener("contextmenu", function (event) {
    var actions = typeof actionFactory === "function" ? actionFactory() : actionFactory;
    showContextMenu(event, actions || []);
  });
}

function clearDragMarks() {
  document.querySelectorAll(".libDragging,.libDragBefore,.libDragAfter,.libDropFolder").forEach(function (n) {
    n.classList.remove("libDragging", "libDragBefore", "libDragAfter", "libDropFolder");
  });
}

function makeFolderDropTarget(el, groupId) {
  if (isGuest() || filter) return;
  el.addEventListener("dragover", function (e) {
    if (!draggingId) return;
    if (draggingKind === "folder" && !groupId) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      clearDragMarks(); el.classList.add("libDropFolder");
      return;
    }
    if (draggingKind !== "workflow") return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDragMarks(); el.classList.add("libDropFolder");
  });
  el.addEventListener("drop", function (e) {
    if (!draggingId) return;
    if (draggingKind === "folder" && !groupId) {
      e.preventDefault(); e.stopPropagation();
      var folderId = draggingId;
      draggingId = null; draggingKind = null; clearDragMarks();
      moveFolder(folderId, null, null, false);
      return;
    }
    if (draggingKind !== "workflow") return;
    e.preventDefault(); e.stopPropagation();
    var id = draggingId;
    draggingId = null; draggingKind = null; clearDragMarks();
    moveWorkflow(id, groupId || null, null);
  });
}

function invalidFolderDrop(movingId, targetId) {
  return !movingId || !targetId || movingId === targetId || descendantGroupIds(movingId).has(targetId);
}

function folderDropPlacement(event, element) {
  var rect = element.getBoundingClientRect();
  var ratio = rect.height ? (event.clientY - rect.top) / rect.height : .5;
  return ratio < .28 ? "before" : (ratio > .72 ? "after" : "inside");
}

function makeFolderDraggable(el, group) {
  if (isGuest() || filter || !el || !group) return;
  el.draggable = true;
  el.classList.add("libFolderDraggable");
  el.title = "Drag above or below a folder to reorder, or onto its center to nest";
  el.addEventListener("dragstart", function (event) {
    draggingId = group.groupId;
    draggingKind = "folder";
    el.classList.add("libDragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", group.groupId);
    }
  });
  el.addEventListener("dragend", function () {
    draggingId = null; draggingKind = null; clearDragMarks();
  });
  el.addEventListener("dragover", function (event) {
    if (draggingKind !== "folder" || invalidFolderDrop(draggingId, group.groupId)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    var placement = folderDropPlacement(event, el);
    clearDragMarks();
    el.classList.add(placement === "inside" ? "libDropFolder" : (placement === "after" ? "libDragAfter" : "libDragBefore"));
  });
  el.addEventListener("drop", function (event) {
    if (draggingKind !== "folder" || invalidFolderDrop(draggingId, group.groupId)) return;
    event.preventDefault(); event.stopPropagation();
    var movingId = draggingId;
    var placement = folderDropPlacement(event, el);
    draggingId = null; draggingKind = null; clearDragMarks();
    if (placement === "inside") moveFolder(movingId, group.groupId, null, false);
    else moveFolder(movingId, group.parentGroupId || null, group.groupId, placement === "after");
  });
}

function makeWorkflowDraggable(el, w) {
  if (isGuest() || filter || w.isMine === false || w.visibility === "SAMPLE") return;
  el.draggable = true;
  el.title = "Hold and drag to move or reorder";
  var grip = el.querySelector(".twist");
  if (grip) {
    grip.classList.add("libDrag");
    grip.textContent = "\u28ff";
    grip.setAttribute("aria-hidden", "true");
  }
  el.addEventListener("dragstart", function (e) {
    draggingId = w.id;
    draggingKind = "workflow";
    el.classList.add("libDragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", w.id);
    }
  });
  el.addEventListener("dragend", function () { draggingId = null; draggingKind = null; clearDragMarks(); });
  el.addEventListener("dragover", function (e) {
    if (!draggingId || draggingKind !== "workflow" || draggingId === w.id) return;
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDragMarks(); el.classList.add("libDragBefore");
  });
  el.addEventListener("drop", function (e) {
    if (!draggingId || draggingKind !== "workflow" || draggingId === w.id) return;
    e.preventDefault(); e.stopPropagation();
    var id = draggingId;
    draggingId = null; draggingKind = null; clearDragMarks();
    moveWorkflow(id, w.groupId || null, w.id);
  });
}

function renderFolder(g, host, depth) {
  var kids = ordered(mine().filter(function (w) { return w.groupId === g.groupId; }));
  var subs = orderedGroups(groups.filter(function (x) { return x.parentGroupId === g.groupId; }));
  var hit = matches(g.name) ||
            kids.some(function (w) { return matches(w.name); });
  if (!hit) return;

  var expanded = open[g.groupId] || !!filter;
  var folderEl = row({
    twist: (kids.length + subs.length) ? (expanded ? "\u25be" : "\u25b8") : "",
    iconKind: "folder",
    kind: "folder",
    label: g.name,
    note: kids.length ? String(kids.length) : "",
    sel: pick && pick.kind === "group" && pick.id === g.groupId,
    onClick: function () {
      clearSelection(false);
      open[g.groupId] = !expanded;
      pick = { kind: "group", id: g.groupId, name: g.name };
      render();
    }
  });
  makeFolderDropTarget(folderEl, g.groupId);
  makeFolderDraggable(folderEl, g);
  var folderActions = document.createElement("span");
  folderActions.className = "libRowActions";
  folderActions.appendChild(iconButton("edit", "Edit properties for folder " + g.name, function () { showEditFolder(g); }));
  folderActions.appendChild(iconButton("copy", "Duplicate folder " + g.name, function () { duplicateFolder(g); }));
  folderActions.appendChild(iconButton("trash", "Delete folder " + g.name, function () { deleteFolder(g); }));
  folderEl.appendChild(folderActions);
  attachContextMenu(folderEl, function () { return [
    { icon: "open", label: "Open folder", run: function () { openFolder(g.groupId); } },
    { icon: "folder", label: "New subfolder", run: function () { showCreateFolder(g.groupId); } },
    { separator: true },
    { icon: "edit", label: "Properties", run: function () { showEditFolder(g); } },
    { icon: "copy", label: "Duplicate folder", run: function () { duplicateFolder(g); } },
    { icon: "trash", label: "Delete folder", danger: true, run: function () { deleteFolder(g); } }
  ]; });
  host.appendChild(folderEl);
  if (!expanded) return;

  var box = document.createElement("div");
  box.className = "libKids";
  subs.forEach(function (s) { renderFolder(s, box, depth + 1); });
  kids.filter(function (w) { return matches(w.name); })
      .forEach(function (w) { box.appendChild(workflowRow(w)); });
  host.appendChild(box);
}

function workflowRow(w) {
  var selectable = w.isMine !== false && w.visibility !== "SAMPLE";
  var el = row({
    iconKind: "workflow",
    kind: "workflow",
    label: w.name,
    note: w.versionNumber ? ("v" + w.versionNumber) : "",
    sel: selectable ? (selectedKind === "workflow" && selectedIds.has(w.id))
                    : (pick && pick.kind === "workflow" && pick.id === w.id),
    onClick: function (event) {
      if (selectable) return selectItem("workflow", w.id, w.name, {
        kind: "workflow", id: w.id, name: w.name, sample: false
      }, event);
      clearSelection(false);
      pick = { kind: "workflow", id: w.id, name: w.name, sample: true };
      render();
    }
  });
  if (selectable) markSelectable(el, "workflow", w.id);
  makeWorkflowDraggable(el, w);
  if (w.isMine !== false && w.visibility !== "SAMPLE") {
    var actions = document.createElement("span");
    actions.className = "libRowActions";
    actions.appendChild(iconButton("edit", "Edit properties for " + w.name, function () { showEditWorkflow(w); }));
    actions.appendChild(iconButton("copy", "Duplicate " + w.name, function () { duplicateWorkflow(w); }));
    actions.appendChild(iconButton("trash", "Delete " + w.name, function () { deleteWorkflow(w); }));
    el.appendChild(actions);
  }
  attachContextMenu(el, function () {
    var actions = [
      { icon: "open", label: selectable ? "Open workflow" : "Open a copy", run: function () { openWorkflow(w.id, !selectable); } }
    ];
    if (selectable) actions = actions.concat([
      { separator: true },
      { icon: "edit", label: "Properties", run: function () { showEditWorkflow(w); } },
      { icon: "copy", label: "Duplicate workflow", run: function () { duplicateWorkflow(w); } },
      { icon: "trash", label: "Delete workflow", danger: true, run: function () { deleteWorkflow(w); } }
    ]);
    return actions;
  });
  el.addEventListener("dblclick", function (event) {
    if (event.target && event.target.closest && event.target.closest("button")) return;
    openWorkflow(w.id, !selectable);
  });
  return el;
}

function moveExample(id, collectionId, beforeId) {
  var source = findExampleLocation(id);
  var destination = exampleCollections.find(function (collection) { return collection.id === collectionId; });
  if (!source || !destination) return;
  var sourceCollectionId = source.collection.id;
  var sourceIndex = source.index;
  var targetIndex = beforeId
    ? destination.examples.findIndex(function (example) { return example.id === beforeId; })
    : -1;
  source.collection.examples.splice(source.index, 1);
  var at = beforeId
    ? destination.examples.findIndex(function (example) { return example.id === beforeId; })
    : destination.examples.length;
  if (at < 0) at = destination.examples.length;
  /* When moving downward, inserting before the hovered row is a no-op for an
     adjacent item because removing the source shifts that row up one slot.
     Insert after the hovered row in that direction so a one-step move works. */
  if (beforeId && sourceCollectionId === collectionId && targetIndex > sourceIndex) at += 1;
  destination.examples.splice(at, 0, source.example);
  persistExampleState();
  status("Example moved.");
  render();
}

function makeExampleCollectionDropTarget(el, collectionId) {
  if (filter) return;
  el.addEventListener("dragover", function (e) {
    if (!draggingId || draggingKind !== "example") return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDragMarks(); el.classList.add("libDropFolder");
  });
  el.addEventListener("drop", function (e) {
    if (!draggingId || draggingKind !== "example") return;
    e.preventDefault(); e.stopPropagation();
    var id = draggingId;
    draggingId = null; draggingKind = null; clearDragMarks();
    moveExample(id, collectionId, null);
  });
}

function makeExampleDraggable(el, w, collectionId) {
  if (filter) return;
  el.draggable = true;
  el.title = "Hold and drag to move or reorder";
  var grip = el.querySelector(".twist");
  if (grip) {
    grip.classList.add("libDrag");
    grip.textContent = "\u28ff";
    grip.setAttribute("aria-hidden", "true");
  }
  el.addEventListener("dragstart", function (e) {
    draggingId = w.id;
    draggingKind = "example";
    el.classList.add("libDragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", w.id);
    }
  });
  el.addEventListener("dragend", function () {
    draggingId = null; draggingKind = null; clearDragMarks();
  });
  el.addEventListener("dragover", function (e) {
    if (!draggingId || draggingKind !== "example" || draggingId === w.id) return;
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearDragMarks(); el.classList.add("libDragBefore");
  });
  el.addEventListener("drop", function (e) {
    if (!draggingId || draggingKind !== "example" || draggingId === w.id) return;
    e.preventDefault(); e.stopPropagation();
    var id = draggingId;
    draggingId = null; draggingKind = null; clearDragMarks();
    moveExample(id, collectionId, w.id);
  });
}

function exampleRow(w, collectionId) {
  var el = row({
    iconKind: "example",
    kind: "workflow",
    label: w.name,
    note: "example",
    sel: selectedKind === "example" && selectedIds.has(w.id),
    onClick: function (event) {
      selectItem("example", w.id, w.name, { kind: "example", id: w.id, name: w.name }, event);
    }
  });
  markSelectable(el, "example", w.id);
  makeExampleDraggable(el, w, collectionId);
  var actions = document.createElement("span");
  actions.className = "libRowActions";
  actions.appendChild(iconButton("edit", "Edit properties for " + w.name, function () { showEditExample(w, collectionId); }));
  actions.appendChild(iconButton("copy", "Duplicate " + w.name, function () { duplicateExample(w, collectionId); }));
  actions.appendChild(iconButton("trash", "Delete " + w.name, function () { deleteExample(w); }));
  el.appendChild(actions);
  attachContextMenu(el, function () { return [
    { icon: "open", label: "Open example", run: function () { openExample(w.id); } },
    { separator: true },
    { icon: "edit", label: "Properties", run: function () { showEditExample(w, collectionId); } },
    { icon: "copy", label: "Duplicate example", run: function () { duplicateExample(w, collectionId); } },
    { icon: "trash", label: "Delete example", danger: true, run: function () { deleteExample(w); } }
  ]; });
  el.addEventListener("dblclick", function (event) {
    if (event.target && event.target.closest && event.target.closest("button")) return;
    openExample(w.id);
  });
  return el;
}

function renderExampleCollection(collection, host) {
  var visible = collection.examples.filter(function (w) {
    return matches(collection.name) || matches(w.name) || matches(w.description);
  });
  if (!visible.length && filter && !matches(collection.name)) return;
  var expanded = exampleOpen[collection.id] || !!filter;
  var collectionRow = row({
    twist: expanded ? "\u25be" : "\u25b8",
    iconKind: "folder",
    kind: "folder",
    label: collection.name,
    note: String(visible.length),
    onClick: function () {
      clearSelection(false);
      exampleOpen[collection.id] = !expanded;
      render();
    }
  });
  makeExampleCollectionDropTarget(collectionRow, collection.id);
  var collectionActions = document.createElement("span");
  collectionActions.className = "libRowActions";
  collectionActions.appendChild(iconButton("edit", "Edit properties for folder " + collection.name, function () { showEditExampleCollection(collection); }));
  collectionActions.appendChild(iconButton("copy", "Duplicate folder " + collection.name, function () { duplicateExampleCollection(collection); }));
  collectionActions.appendChild(iconButton("trash", "Delete folder " + collection.name, function () { deleteExampleCollection(collection); }));
  collectionRow.appendChild(collectionActions);
  attachContextMenu(collectionRow, function () { return [
    { icon: "edit", label: "Properties", run: function () { showEditExampleCollection(collection); } },
    { icon: "copy", label: "Duplicate folder", run: function () { duplicateExampleCollection(collection); } },
    { icon: "trash", label: "Delete folder", danger: true, run: function () { deleteExampleCollection(collection); } }
  ]; });
  host.appendChild(collectionRow);
  if (!expanded) return;
  var box = document.createElement("div");
  box.className = "libKids";
  visible.forEach(function (w) { box.appendChild(exampleRow(w, collection.id)); });
  host.appendChild(box);
}

function section(host, title, note, key) {
  var h = document.createElement("div");
  h.className = "libSection";
  if (key) h.dataset.librarySection = key;
  h.textContent = title;
  if (note) {
    var s = document.createElement("span");
    s.textContent = note;
    h.appendChild(s);
  }
  host.appendChild(h);
  return h;
}

function paintPlaces() {
  var mineCount = mine().length;
  var exampleCount = exampleCollections.reduce(function (sum, collection) {
    return sum + collection.examples.length;
  }, 0);
  if ($("libMineCount")) $("libMineCount").textContent = String(mineCount);
  if ($("libExampleCount")) $("libExampleCount").textContent = String(exampleCount);
  var minePlace = $("libPlaceWorkflows");
  if (minePlace) minePlace.hidden = isGuest();
  paintExampleUndoActions();
}

function jumpToSection(key) {
  var tree = $("libTree");
  var target = tree && tree.querySelector('[data-library-section="' + key + '"]');
  if (target && target.scrollIntoView) target.scrollIntoView({ block: "start", behavior: "smooth" });
  ["workflows", "examples"].forEach(function (place) {
    var button = $("libPlace" + place.charAt(0).toUpperCase() + place.slice(1));
    if (button) button.classList.toggle("on", place === key);
  });
}

function render() {
  var tree = $("libTree");
  if (!tree) return;
  tree.innerHTML = "";

  var roots = orderedGroups(groups.filter(function (g) { return !g.parentGroupId; }));
  var loose = ordered(mine().filter(function (w) { return !w.groupId && matches(w.name); }));

  if (!isGuest() && (roots.length || loose.length || (!filter && mine().length === 0))) {
    var mineSection = section(tree, "My workflows", loose.length ? "Root files " + loose.length : "Root", "workflows");
    makeFolderDropTarget(mineSection, null);
    attachContextMenu(mineSection, [
      { icon: "folder", label: "New folder", run: function () { showCreateFolder(null); } }
    ]);
    roots.forEach(function (g) { renderFolder(g, tree, 0); });
    loose.forEach(function (w) { tree.appendChild(workflowRow(w)); });
  }
  /* Database SAMPLE rows are legacy read-only records. They are deliberately
     omitted; the local example catalog below supports rename, move,
     duplicate, and delete and is the single examples experience. */
  section(tree, "Examples", "Editable", "examples");
  exampleCollections.forEach(function (collection) {
    renderExampleCollection(collection, tree);
  });
  if (!tree.children.length) {
    var e = document.createElement("div");
    e.className = "libEmpty";
    e.textContent = filter ? "Nothing matches \u201C" + filter + "\u201D."
                           : "No saved workflows yet.";
    tree.appendChild(e);
  }
  paintPlaces();
  paintActions();
}

/* The footer changes with the selection: open a folder, open a workflow,
 * or copy a sample. */
function paintActions() {
  var openBtn = $("libOpen");
  var lbl = "Open";
  var can = !!pick;
  if (pick && pick.kind === "multi") {
    lbl = "Select one workflow to open";
    can = false;
  } else if (pick && pick.kind === "group") {
    var n = mine().filter(function (w) { return w.groupId === pick.id; }).length;
    lbl = n ? ("Open folder (" + n + ")") : "Folder is empty";
    can = n > 0;
  } else if (pick && pick.kind === "workflow") {
    lbl = pick.sample ? "Copy to my workflows" : "Open workflow";
  } else if (pick && pick.kind === "example") {
    lbl = "Open example";
  }
  if (openBtn) {
    openBtn.textContent = lbl;
    openBtn.disabled = !can || busy;
  }
  paintBatchActions();
}

function fillBatchTarget() {
  var select = $("libBatchTarget");
  if (!select) return;
  var previous = select.value;
  select.innerHTML = "";
  if (selectedKind === "example") {
    exampleCollections.forEach(function (collection) {
      var option = document.createElement("option");
      option.value = collection.id; option.textContent = collection.name;
      select.appendChild(option);
    });
  } else {
    var root = document.createElement("option");
    root.value = ""; root.textContent = "My workflows (root)";
    select.appendChild(root);
    groups.forEach(function (group) {
      var option = document.createElement("option");
      option.value = group.groupId;
      option.textContent = Array(Math.max(0, Number(group.depth) || 0) + 1).join("\u00a0\u00a0") + group.name;
      select.appendChild(option);
    });
  }
  if (Array.prototype.some.call(select.options, function (option) { return option.value === previous; })) select.value = previous;
}

function paintBatchActions() {
  var batch = $("libBatch");
  if (!batch) return;
  var count = selectedIds.size;
  var noun = selectedKind === "example" ? "example" : "workflow";
  batch.hidden = count < 2;
  if ($("libBatchCount")) $("libBatchCount").textContent = count + " " + noun + (count === 1 ? "" : "s") + " selected";
  if ($("libBatchTarget")) $("libBatchTarget").setAttribute("aria-label", "Move selected " + noun + "s to folder");
  if (count >= 2) fillBatchTarget();
  ["libBatchMove", "libBatchDuplicate", "libBatchDelete"].forEach(function (id) {
    if ($(id)) $(id).disabled = busy || count < 2;
  });
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

function openExample(id) {
  var rec = findExample(id);
  if (!rec) { status("That example is unavailable.", true); return; }
  busy = true; paintActions();
  status("Opening example\u2026");
  try {
    appendDoc(rec.document, rec.name);
    var d = ws_1.D();
    if (d) {
      d.name = rec.name;
      /* The Editor bridge derives this exact id when it echoes the example
         back. Matching it prevents that harmless echo from becoming a second
         tab when Explorer is opened again. */
      d.id = "editor_" + rec.document.workflow.id;
    }
    deliver();
    status("");
    close();
  } catch (e) {
    status("Could not open example: " + (e && e.message || e), true);
  } finally {
    busy = false; paintActions();
  }
}

/* ---------------------------------------------------------------------------
 * organizing + workflow property actions
 * -------------------------------------------------------------------------*/
function setEditMessage(message, bad) {
  var n = $("libEditStatus");
  if (!n) return;
  n.textContent = message || "";
  n.className = "libStatus" + (bad ? " bad" : "");
}

function hideEditWorkflow() {
  editingId = null;
  editingKind = null;
  editingCollectionId = null;
  var sheet = $("libEditSheet");
  if (sheet) {
    sheet.hidden = true;
    sheet.setAttribute("aria-label", "Edit workflow properties");
  }
  if ($("libEditSave")) $("libEditSave").textContent = "Save properties";
  setEditMessage("");
}

function descendantGroupIds(groupId) {
  var found = new Set([groupId]);
  var changed = true;
  while (changed) {
    changed = false;
    groups.forEach(function (g) {
      if (g.parentGroupId && found.has(g.parentGroupId) && !found.has(g.groupId)) {
        found.add(g.groupId); changed = true;
      }
    });
  }
  return found;
}

function fillFolderSelect(select, selected, options) {
  if (!select) return;
  options = options || {};
  select.innerHTML = "";
  var none = document.createElement("option");
  none.value = ""; none.textContent = options.noneLabel || "My workflows (root)";
  select.appendChild(none);
  groups.forEach(function (g) {
    if (options.exclude && options.exclude.has(g.groupId)) return;
    var option = document.createElement("option");
    option.value = g.groupId;
    option.textContent = Array(Math.max(0, Number(g.depth) || 0) + 1).join("\u00a0\u00a0") + g.name;
    select.appendChild(option);
  });
  if (options.allowCreate !== false) {
    var create = document.createElement("option");
    create.value = "__create__"; create.textContent = "+ Create new folder…";
    select.appendChild(create);
  }
  select.value = selected || "";
  paintCreateFolderField();
}

function fillExampleCollectionSelect(select, selected) {
  if (!select) return;
  select.innerHTML = "";
  exampleCollections.forEach(function (collection) {
    var option = document.createElement("option");
    option.value = collection.id;
    option.textContent = collection.name;
    select.appendChild(option);
  });
  var create = document.createElement("option");
  create.value = "__create__"; create.textContent = "+ Create new folder…";
  select.appendChild(create);
  select.value = selected || (exampleCollections[0] && exampleCollections[0].id) || "";
  paintCreateFolderField();
}

function paintCreateFolderField() {
  var select = $("libEditFolder"), box = $("libCreateFolderBox");
  if (!select || !box) return;
  box.hidden = select.value !== "__create__";
  if (!box.hidden) setTimeout(function () { $("libCreateFolderName") && $("libCreateFolderName").focus(); }, 0);
}

function setFolderFields(label, visible) {
  var fields = $("libEditFolderFields"), folderLabel = $("libEditFolderLabel");
  if (fields) fields.hidden = visible === false;
  if (folderLabel) folderLabel.textContent = label || "Folder";
  if ($("libCreateFolderName")) $("libCreateFolderName").value = "";
}

function showEditWorkflow(w) {
  if (!w || busy) return;
  editingId = w.id;
  editingKind = "workflow";
  editingCollectionId = null;
  var sheet = $("libEditSheet");
  if (!sheet) return;
  if ($("libEditEyebrow")) $("libEditEyebrow").textContent = "Workflow properties";
  setFolderFields("Folder", true);
  $("libEditTitle").textContent = w.name || "Edit workflow";
  $("libEditName").value = w.name || "";
  $("libEditDesc").value = w.description || "";
  fillFolderSelect($("libEditFolder"), w.groupId || "");
  setEditMessage("");
  sheet.hidden = false;
  setTimeout(function () { $("libEditName") && $("libEditName").focus(); }, 0);
}

function showEditExample(w, collectionId) {
  if (!w || busy) return;
  editingId = w.id;
  editingKind = "example";
  editingCollectionId = collectionId;
  var sheet = $("libEditSheet");
  if (!sheet) return;
  if ($("libEditEyebrow")) $("libEditEyebrow").textContent = "Example properties";
  setFolderFields("Folder", true);
  $("libEditTitle").textContent = w.name || "Edit example";
  $("libEditName").value = w.name || "";
  $("libEditDesc").value = w.description || "";
  fillExampleCollectionSelect($("libEditFolder"), collectionId);
  setEditMessage("");
  sheet.hidden = false;
  setTimeout(function () { $("libEditName") && $("libEditName").focus(); }, 0);
}

function showEditFolder(g) {
  if (!g || busy) return;
  editingId = g.groupId;
  editingKind = "folder";
  editingCollectionId = null;
  var sheet = $("libEditSheet");
  if (!sheet) return;
  if ($("libEditEyebrow")) $("libEditEyebrow").textContent = "Folder properties";
  setFolderFields("Parent folder", true);
  $("libEditTitle").textContent = g.name || "Edit folder";
  $("libEditName").value = g.name || "";
  $("libEditDesc").value = g.description || "";
  fillFolderSelect($("libEditFolder"), g.parentGroupId || "", {
    noneLabel: "Top level",
    exclude: descendantGroupIds(g.groupId)
  });
  setEditMessage("");
  sheet.hidden = false;
  setTimeout(function () { $("libEditName") && $("libEditName").focus(); }, 0);
}

function showCreateFolder(parentGroupId) {
  if (isGuest() || busy) return;
  hideContextMenu();
  editingId = "__new_folder__";
  editingKind = "new-folder";
  editingCollectionId = null;
  var sheet = $("libEditSheet");
  if (!sheet) return;
  if ($("libEditEyebrow")) $("libEditEyebrow").textContent = parentGroupId ? "Nested folder" : "New folder";
  setFolderFields("Parent folder", true);
  $("libEditTitle").textContent = parentGroupId ? "Create a subfolder" : "Create a folder";
  $("libEditName").value = "";
  $("libEditDesc").value = "";
  fillFolderSelect($("libEditFolder"), parentGroupId || "", {
    noneLabel: "My workflows (root)",
    allowCreate: false
  });
  if ($("libEditSave")) $("libEditSave").textContent = "Create folder";
  setEditMessage(parentGroupId ? "The new folder will be placed inside the selected parent." : "Choose a name and optional parent folder.");
  sheet.setAttribute("aria-label", "Create folder");
  sheet.hidden = false;
  setTimeout(function () { $("libEditName") && $("libEditName").focus(); }, 0);
}

function showEditExampleCollection(collection) {
  if (!collection || busy) return;
  editingId = collection.id;
  editingKind = "example-folder";
  editingCollectionId = collection.id;
  var sheet = $("libEditSheet");
  if (!sheet) return;
  if ($("libEditEyebrow")) $("libEditEyebrow").textContent = "Folder properties";
  setFolderFields("Folder", false);
  $("libEditTitle").textContent = collection.name || "Edit folder";
  $("libEditName").value = collection.name || "";
  $("libEditDesc").value = collection.description || "";
  setEditMessage("");
  sheet.hidden = false;
  setTimeout(function () { $("libEditName") && $("libEditName").focus(); }, 0);
}

function requestedNewFolderName() {
  return ($("libCreateFolderName") && $("libCreateFolderName").value || "").trim();
}

function resolveAccountFolderSelection() {
  var selected = $("libEditFolder").value;
  if (selected !== "__create__") return Promise.resolve(selected || null);
  var folderName = requestedNewFolderName();
  if (!folderName) return Promise.reject(new Error("Give the new folder a name."));
  setEditMessage("Creating folder…");
  return api().createGroup(folderName, null, "").then(function (created) {
    if (!created || !created.groupId) throw new Error("The folder was created without an id.");
    return created.groupId;
  });
}

function saveEditedWorkflow() {
  if (!editingId || busy) return;
  var name = ($("libEditName").value || "").trim();
  if (!name) { setEditMessage(editingKind === "new-folder" ? "Give the folder a name." : "Give the workflow a name.", true); return; }
  if (editingKind === "new-folder") {
    var parentId = $("libEditFolder").value || null;
    var folderDescription = ($("libEditDesc").value || "").trim();
    busy = true;
    $("libEditSave").disabled = true;
    setEditMessage("Creating folder\u2026");
    return api().createGroup(name, parentId, folderDescription).then(function (created) {
      if (parentId) open[parentId] = true;
      if (created && created.groupId) open[created.groupId] = true;
      hideEditWorkflow();
      status(parentId ? "Subfolder created." : "Folder created.");
      return refresh();
    })["catch"](function (e) {
      setEditMessage("Could not create folder: " + (e && e.message || e), true);
    })["finally"](function () {
      busy = false;
      if ($("libEditSave")) $("libEditSave").disabled = false;
      paintActions();
    });
  }
  if (editingKind === "example-folder") {
    var exampleFolder = exampleCollections.find(function (collection) { return collection.id === editingId; });
    if (!exampleFolder) { setEditMessage("That folder is no longer available.", true); return; }
    exampleFolder.name = name;
    exampleFolder.description = ($("libEditDesc").value || "").trim();
    persistExampleState();
    hideEditWorkflow();
    status("Folder properties updated.");
    render();
    return;
  }
  if (editingKind === "example") {
    var location = findExampleLocation(editingId);
    var targetId = $("libEditFolder").value;
    if (targetId === "__create__") {
      var newExampleFolderName = requestedNewFolderName();
      if (!newExampleFolderName) { setEditMessage("Give the new folder a name.", true); return; }
      targetId = "example_folder_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
      exampleCollections.push({ id: targetId, name: newExampleFolderName, description: "", examples: [] });
      exampleOpen[targetId] = true;
    }
    var target = exampleCollections.find(function (collection) { return collection.id === targetId; });
    if (!location || !target) { setEditMessage("That example is no longer available.", true); return; }
    location.example.name = name;
    location.example.description = ($("libEditDesc").value || "").trim();
    location.example.document.workflow.name = name;
    if (location.collection.id !== target.id) {
      location.collection.examples.splice(location.index, 1);
      target.examples.push(location.example);
    }
    persistExampleState();
    hideEditWorkflow();
    status("Example properties updated.");
    render();
    return;
  }
  busy = true;
  $("libEditSave").disabled = true;
  setEditMessage("Saving properties\u2026");
  var description = ($("libEditDesc").value || "").trim();
  var savingKind = editingKind;
  return resolveAccountFolderSelection().then(function (folderId) {
    if (savingKind === "folder") {
      return api().updateGroup(editingId, { name: name, description: description, parentGroupId: folderId });
    }
    return api().updateWorkflow(editingId, { name: name, description: description, groupId: folderId });
  }).then(function () {
    hideEditWorkflow();
    status(savingKind === "folder" ? "Folder properties updated." : "Workflow properties updated.");
    return refresh();
  })["catch"](function (e) {
    setEditMessage("Could not update: " + (e && e.message || e), true);
  })["finally"](function () {
    busy = false;
    if ($("libEditSave")) $("libEditSave").disabled = false;
    paintActions();
  });
}

function duplicateName(name) {
  var base = (name || "Workflow") + " copy";
  var used = new Set(mine().map(function (w) { return String(w.name || "").toLowerCase(); }));
  var candidate = base, n = 2;
  while (used.has(candidate.toLowerCase())) candidate = base + " " + n++;
  return candidate;
}

function duplicateWorkflow(w) {
  if (!w || busy) return;
  busy = true; paintActions();
  status("Duplicating " + w.name + "\u2026");
  return api().loadWorkflow(w.id).then(function (rec) {
    if (!rec) throw new Error("workflow not found");
    return api().saveWorkflow({
      name: duplicateName(w.name),
      description: w.description || "",
      workflow: rec.workflow,
      config: rec.config || {},
      toolsExecuted: rec.toolsExecuted || [],
      layout: rec.layout || {},
      groupId: w.groupId || null
    });
  }).then(function () {
    status("Workflow duplicated.");
    return refresh();
  })["catch"](function (e) {
    status("Could not duplicate: " + (e && e.message || e), true);
  })["finally"](function () { busy = false; paintActions(); });
}

function duplicateExample(w, collectionId) {
  if (!w || busy) return;
  var location = findExampleLocation(w.id);
  var collection = exampleCollections.find(function (item) { return item.id === collectionId; });
  if (!location || !collection) return;
  var copy = cloneExamples(w);
  copy.id = "example_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  copy.name = duplicateExampleName(w.name);
  copy.document.workflow.id = copy.id;
  copy.document.workflow.name = copy.name;
  var at = collection.examples.findIndex(function (example) { return example.id === w.id; });
  collection.examples.splice(at < 0 ? collection.examples.length : at + 1, 0, copy);
  persistExampleState();
  pick = { kind: "example", id: copy.id, name: copy.name };
  status("Example duplicated.");
  render();
}

function duplicateExampleName(name) {
  var base = (name || "Example") + " copy";
  var used = new Set();
  exampleCollections.forEach(function (collection) {
    collection.examples.forEach(function (example) { used.add(String(example.name || "").toLowerCase()); });
  });
  var candidate = base, n = 2;
  while (used.has(candidate.toLowerCase())) candidate = base + " " + n++;
  return candidate;
}

function copyNameAmong(name, usedNames) {
  var base = (name || "Folder") + " copy";
  var candidate = base, n = 2;
  while (usedNames.has(candidate.toLowerCase())) candidate = base + " " + n++;
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function duplicateFolder(g) {
  if (!g || busy) return;
  var siblingNames = new Set(groups.filter(function (candidate) {
    return (candidate.parentGroupId || null) === (g.parentGroupId || null);
  }).map(function (candidate) { return String(candidate.name || "").toLowerCase(); }));
  var rootName = copyNameAmong(g.name, siblingNames);
  var reservedWorkflowNames = new Set(mine().map(function (w) { return String(w.name || "").toLowerCase(); }));

  function copiedWorkflowName(name) {
    var base = (name || "Workflow") + " (" + rootName + ")";
    var candidate = base, n = 2;
    while (reservedWorkflowNames.has(candidate.toLowerCase())) candidate = base + " " + n++;
    reservedWorkflowNames.add(candidate.toLowerCase());
    return candidate;
  }

  function cloneBranch(source, parentGroupId, forcedName) {
    return api().createGroup(forcedName || source.name, parentGroupId, source.description || "").then(function (created) {
      if (!created || !created.groupId) throw new Error("The copied folder did not return an id.");
      var workflows = mine().filter(function (w) { return w.groupId === source.groupId; });
      return Promise.all(workflows.map(function (w) {
        return api().loadWorkflow(w.id).then(function (rec) {
          if (!rec) throw new Error("Could not load " + w.name);
          return api().saveWorkflow({
            name: copiedWorkflowName(w.name),
            description: w.description || "",
            workflow: rec.workflow,
            config: rec.config || {},
            toolsExecuted: rec.toolsExecuted || [],
            layout: rec.layout || {},
            groupId: created.groupId
          });
        });
      })).then(function () {
        var children = groups.filter(function (child) { return child.parentGroupId === source.groupId; });
        return children.reduce(function (chain, child) {
          return chain.then(function () { return cloneBranch(child, created.groupId, child.name); });
        }, Promise.resolve());
      });
    });
  }

  busy = true; paintActions();
  status("Duplicating folder " + g.name + "…");
  return cloneBranch(g, g.parentGroupId || null, rootName).then(function () {
    status("Folder duplicated.");
    return refresh();
  })["catch"](function (e) {
    status("Could not duplicate folder: " + (e && e.message || e), true);
  })["finally"](function () { busy = false; paintActions(); });
}

function duplicateExampleCollection(collection) {
  if (!collection || busy) return;
  var used = new Set(exampleCollections.map(function (item) { return String(item.name || "").toLowerCase(); }));
  var copy = cloneExamples(collection);
  copy.id = "example_folder_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  copy.name = copyNameAmong(collection.name, used);
  copy.examples.forEach(function (example, index) {
    example.id = copy.id + "_workflow_" + index + "_" + Math.random().toString(36).slice(2, 6);
    example.document.workflow.id = example.id;
  });
  var at = exampleCollections.findIndex(function (item) { return item.id === collection.id; });
  exampleCollections.splice(at < 0 ? exampleCollections.length : at + 1, 0, copy);
  exampleOpen[copy.id] = true;
  persistExampleState();
  status("Folder duplicated.");
  render();
}

function deleteWorkflow(w) {
  if (!w || busy) return;
  askConfirmation("Delete workflow?", "Delete \u201c" + w.name + "\u201d and its saved version history? This cannot be undone.", function () {
    busy = true; paintActions();
    status("Deleting " + w.name + "\u2026");
    api().deleteWorkflow(w.id).then(function () {
      if (pick && pick.id === w.id) pick = null;
      status("Workflow deleted.");
      return refresh();
    })["catch"](function (e) {
      status("Could not delete: " + (e && e.message || e), true);
    })["finally"](function () { busy = false; paintActions(); });
  });
}

function deleteExample(w) {
  if (!w || busy) return;
  askConfirmation("Delete example?", "Delete example \u201c" + w.name + "\u201d? This cannot be undone.", function () {
    var location = findExampleLocation(w.id);
    if (!location) return;
    location.collection.examples.splice(location.index, 1);
    if (pick && pick.kind === "example" && pick.id === w.id) pick = null;
    persistExampleState();
    status("Example deleted.");
    render();
  });
}

function deleteFolder(g) {
  if (!g || busy) return;
  var ids = descendantGroupIds(g.groupId);
  var workflows = mine().filter(function (w) { return ids.has(w.groupId); });
  var childCount = ids.size - 1;
  var detail = workflows.length + " workflow" + (workflows.length === 1 ? "" : "s") +
    (childCount ? " and " + childCount + " nested folder" + (childCount === 1 ? "" : "s") : "");
  askConfirmation("Delete folder?", "Delete \u201c" + g.name + "\u201d and " + detail + "? This cannot be undone.", function () {
    busy = true; paintActions();
    status("Deleting folder " + g.name + "…");
    Promise.all(workflows.map(function (w) { return api().deleteWorkflow(w.id); })).then(function () {
      var folders = groups.filter(function (folder) { return ids.has(folder.groupId); })
        .sort(function (a, b) { return (Number(b.depth) || 0) - (Number(a.depth) || 0); });
      return folders.reduce(function (chain, folder) {
        return chain.then(function () { return api().deleteGroup(folder.groupId); });
      }, Promise.resolve());
    }).then(function () {
      if (pick && (pick.id === g.groupId || ids.has(pick.id))) pick = null;
      status("Folder deleted.");
      return refresh();
    })["catch"](function (e) {
      status("Could not delete folder: " + (e && e.message || e), true);
      return refresh();
    })["finally"](function () { busy = false; paintActions(); });
  });
}

function deleteExampleCollection(collection) {
  if (!collection || busy) return;
  var count = collection.examples.length;
  askConfirmation("Delete folder?", "Delete \u201c" + collection.name + "\u201d and its " + count +
      " example" + (count === 1 ? "" : "s") + "? This cannot be undone.", function () {
    var at = exampleCollections.findIndex(function (item) { return item.id === collection.id; });
    if (at < 0) return;
    exampleCollections.splice(at, 1);
    delete exampleOpen[collection.id];
    if (pick && (pick.id === collection.id || collection.examples.some(function (w) { return w.id === pick.id; }))) pick = null;
    persistExampleState();
    status("Folder deleted.");
    render();
  });
}

function moveFolder(id, parentGroupId, anchorId, placeAfter) {
  var moving = groups.find(function (group) { return group.groupId === id; });
  var targetParentId = parentGroupId || null;
  if (!moving || busy) return;
  if (targetParentId && descendantGroupIds(moving.groupId).has(targetParentId)) {
    status("A folder cannot be moved into itself or one of its subfolders.", true);
    return;
  }

  var siblings = orderedGroups(groups.filter(function (group) {
    return group.groupId !== moving.groupId && (group.parentGroupId || null) === targetParentId;
  }));
  var at = anchorId ? siblings.findIndex(function (group) { return group.groupId === anchorId; }) : siblings.length;
  if (at < 0) at = siblings.length;
  if (placeAfter && anchorId) at += 1;
  siblings.splice(at, 0, moving);

  var siblingIds = siblings.map(function (group) { return String(group.groupId); });
  var affected = new Set(siblingIds);
  folderOrder = completeFolderOrder().filter(function (groupId) { return !affected.has(String(groupId)); });
  Array.prototype.push.apply(folderOrder, siblingIds);
  moving.parentGroupId = targetParentId;
  if (targetParentId) open[targetParentId] = true;

  busy = true;
  render();
  status("Moving folder…");
  return api().updateGroup(moving.groupId, { parentGroupId: targetParentId }).then(function () {
    return persistFolderOrder();
  }).then(function () {
    return refresh();
  }).then(function () {
    status(targetParentId ? "Folder moved into its new parent." : "Folder moved to My workflows.");
  })["catch"](function (e) {
    status("Could not move folder: " + (e && e.message || e), true);
    return refresh();
  })["finally"](function () { busy = false; paintActions(); });
}

function moveWorkflow(id, groupId, beforeId) {
  var moving = mine().find(function (w) { return w.id === id; });
  if (!moving || busy) return;
  var sourceGroupId = moving.groupId || null;
  var sourceList = ordered(mine().filter(function (w) {
    return (w.groupId || null) === sourceGroupId;
  }));
  var sourceIndex = sourceList.findIndex(function (w) { return w.id === id; });
  var targetIndex = beforeId
    ? sourceList.findIndex(function (w) { return w.id === beforeId; })
    : -1;
  var destination = ordered(mine().filter(function (w) {
    return w.id !== id && (w.groupId || null) === (groupId || null);
  }));
  var at = beforeId ? destination.findIndex(function (w) { return w.id === beforeId; }) : destination.length;
  if (at < 0) at = destination.length;
  if (beforeId && sourceGroupId === (groupId || null) && targetIndex > sourceIndex) at += 1;
  moving.groupId = groupId || null;
  destination.splice(at, 0, moving);
  destination.forEach(function (w, i) { w.sortOrder = (i + 1) * 100; });
  busy = true;
  render();
  status("Moving workflow\u2026");
  return Promise.all(destination.map(function (w) {
    return api().updateWorkflow(w.id, { groupId: w.groupId || null, sortOrder: w.sortOrder });
  })).then(function () {
    status("Workflow moved.");
    return refresh();
  })["catch"](function (e) {
    status("Could not move workflow: " + (e && e.message || e), true);
    return refresh();
  })["finally"](function () { busy = false; paintActions(); });
}

function selectedRecords() {
  if (selectedKind === "example") {
    var selectedExamples = [];
    exampleCollections.forEach(function (collection) {
      collection.examples.forEach(function (example) {
        if (selectedIds.has(example.id)) selectedExamples.push(example);
      });
    });
    return selectedExamples;
  }
  return ordered(mine().filter(function (workflow) { return selectedIds.has(workflow.id); }));
}

function batchMove() {
  if (busy || selectedIds.size < 2) return;
  var targetId = $("libBatchTarget") ? $("libBatchTarget").value : "";
  var records = selectedRecords();
  if (selectedKind === "example") {
    var destination = exampleCollections.find(function (collection) { return collection.id === targetId; });
    if (!destination) { status("Choose an Examples folder.", true); return; }
    var movingIds = new Set(records.map(function (record) { return record.id; }));
    exampleCollections.forEach(function (collection) {
      collection.examples = collection.examples.filter(function (example) { return !movingIds.has(example.id); });
    });
    Array.prototype.push.apply(destination.examples, records);
    persistExampleState();
    status(records.length + " examples moved to " + destination.name + ".");
    render();
    return;
  }
  var targetGroupId = targetId || null;
  var maxTargetOrder = mine().reduce(function (highest, workflow) {
    var workflowGroupId = workflow.groupId || null;
    if (workflowGroupId !== targetGroupId || selectedIds.has(workflow.id)) return highest;
    return Math.max(highest, Number(workflow.sortOrder) || 0);
  }, 0);
  busy = true; paintActions();
  status("Moving " + records.length + " workflows…");
  Promise.all(records.map(function (workflow, index) {
    workflow.groupId = targetGroupId;
    return api().updateWorkflow(workflow.id, {
      groupId: workflow.groupId,
      sortOrder: maxTargetOrder + ((index + 1) * 100)
    });
  })).then(function () {
    status(records.length + " workflows moved.");
    clearSelection(false);
    return refresh();
  })["catch"](function (e) {
    status("Could not move the selected workflows: " + (e && e.message || e), true);
    return refresh();
  })["finally"](function () { busy = false; paintActions(); });
}

function batchDuplicate() {
  if (busy || selectedIds.size < 2) return;
  var records = selectedRecords();
  if (selectedKind === "example") {
    records.forEach(function (example) {
      var location = findExampleLocation(example.id);
      if (!location) return;
      var copy = cloneExamples(example);
      copy.id = "example_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
      copy.name = duplicateExampleName(example.name);
      copy.document.workflow.id = copy.id;
      copy.document.workflow.name = copy.name;
      location.collection.examples.splice(location.index + 1, 0, copy);
    });
    persistExampleState();
    clearSelection(false);
    status(records.length + " examples duplicated.");
    render();
    return;
  }
  var used = new Set(mine().map(function (workflow) { return String(workflow.name || "").toLowerCase(); }));
  function nextName(name) {
    var base = (name || "Workflow") + " copy";
    var candidate = base, n = 2;
    while (used.has(candidate.toLowerCase())) candidate = base + " " + n++;
    used.add(candidate.toLowerCase());
    return candidate;
  }
  busy = true; paintActions();
  status("Duplicating " + records.length + " workflows…");
  Promise.all(records.map(function (workflow) {
    return api().loadWorkflow(workflow.id).then(function (record) {
      if (!record) throw new Error("Could not load " + workflow.name);
      return api().saveWorkflow({
        name: nextName(workflow.name),
        description: workflow.description || "",
        workflow: record.workflow,
        config: record.config || {},
        toolsExecuted: record.toolsExecuted || [],
        layout: record.layout || {},
        groupId: workflow.groupId || null
      });
    });
  })).then(function () {
    clearSelection(false);
    status(records.length + " workflows duplicated.");
    return refresh();
  })["catch"](function (e) {
    status("Could not duplicate the selected workflows: " + (e && e.message || e), true);
  })["finally"](function () { busy = false; paintActions(); });
}

function batchDelete() {
  if (busy || selectedIds.size < 2) return;
  var records = selectedRecords();
  var noun = selectedKind === "example" ? "examples" : "workflows";
  askConfirmation("Delete selected " + noun + "?", "Delete " + records.length + " selected " + noun + "? This cannot be undone.", function () {
    if (selectedKind === "example") {
      var deleting = new Set(records.map(function (record) { return record.id; }));
      exampleCollections.forEach(function (collection) {
        collection.examples = collection.examples.filter(function (example) { return !deleting.has(example.id); });
      });
      persistExampleState();
      clearSelection(false);
      status(records.length + " examples deleted.");
      render();
      return;
    }
    busy = true; paintActions();
    status("Deleting " + records.length + " workflows…");
    Promise.all(records.map(function (workflow) { return api().deleteWorkflow(workflow.id); }))
      .then(function () {
        clearSelection(false);
        status(records.length + " workflows deleted.");
        return refresh();
      })["catch"](function (e) {
        status("Could not delete the selected workflows: " + (e && e.message || e), true);
        return refresh();
      })["finally"](function () { busy = false; paintActions(); });
  });
}

/* ---------------------------------------------------------------------------
 * saving
 * -------------------------------------------------------------------------*/
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

function saveDialogMessage(message, bad) {
  var n = $("workflowSaveStatus");
  if (!n) return;
  n.textContent = message || "";
  n.hidden = !message;
  n.className = "authstatus" + (bad ? " bad" : "");
}

function saveMode() {
  var checked = document.querySelector('input[name="workflowSaveMode"]:checked');
  return checked ? checked.value : "new";
}

function paintSaveMode() {
  var update = saveMode() === "update";
  var newPanel = $("saveAsNewPanel"), updatePanel = $("saveUpdatePanel"), confirm = $("workflowSaveConfirm");
  if (newPanel) newPanel.hidden = update;
  if (updatePanel) updatePanel.hidden = !update;
  if (confirm) confirm.textContent = update ? "Update workflow" : "Save as new";
  document.querySelectorAll(".saveModeCard").forEach(function (card) {
    var input = card.querySelector("input");
    card.classList.toggle("on", !!(input && input.checked));
  });
  saveDialogMessage("");
}

function closeSave() {
  var modal = $("workflowSaveModal");
  if (modal) modal.style.display = "none";
  document.removeEventListener("keydown", saveKey);
  saveDialogMessage("");
}
exports.closeSave = closeSave;

function saveKey(e) { if (e.key === "Escape") closeSave(); }

function populateSaveDialog() {
  var d = ws_1.D();
  if ($("workflowSaveTitle")) $("workflowSaveTitle").textContent = "Save " + ((d && d.name) || "workflow");
  if ($("workflowSaveName")) $("workflowSaveName").value = (d && (d.name || d.wf.name)) || "Workflow";
  if ($("workflowSaveDescription")) $("workflowSaveDescription").value = "";
  fillFolderSelect($("workflowSaveFolder"), "", { allowCreate: false });
  var target = $("workflowSaveTarget");
  if (target) {
    target.innerHTML = "";
    var placeholder = document.createElement("option");
    placeholder.value = ""; placeholder.textContent = "Choose a saved workflow\u2026";
    target.appendChild(placeholder);
    ordered(mine()).forEach(function (w) {
      var option = document.createElement("option");
      var folder = groups.find(function (g) { return g.groupId === w.groupId; });
      option.value = w.id;
      option.textContent = (folder ? folder.name + " / " : "My workflows / ") + w.name;
      target.appendChild(option);
    });
  }
  var newMode = document.querySelector('input[name="workflowSaveMode"][value="new"]');
  if (newMode) newMode.checked = true;
  paintSaveMode();
}

function submitSave() {
  if (busy) return;
  var d = ws_1.D();
  if (!d) { saveDialogMessage("Open a workflow first.", true); return; }
  var update = saveMode() === "update";
  var targetId = $("workflowSaveTarget") && $("workflowSaveTarget").value;
  var name = ($("workflowSaveName") && $("workflowSaveName").value || "").trim();
  if (update && !targetId) { saveDialogMessage("Choose the workflow you want to update.", true); return; }
  if (!update && !name) { saveDialogMessage("Give the new workflow a name.", true); return; }
  if (!update && mine().some(function (w) { return String(w.name).toLowerCase() === name.toLowerCase(); })) {
    saveDialogMessage("That name is already saved. Choose another name or use Update existing.", true);
    return;
  }
  busy = true;
  if ($("workflowSaveConfirm")) $("workflowSaveConfirm").disabled = true;
  saveDialogMessage(update ? "Updating saved workflow\u2026" : "Saving new workflow\u2026");
  var payload = {
    workflow: ws_1.unified(d), config: {}, toolsExecuted: ws_1.activeToolIndexes(d), layout: d.pos
  };
  var action = update
    ? api().saveVersion(targetId, Object.assign({ kind: "EDIT", label: "Updated from " + (d.name || "open workflow") }, payload))
    : saveOne(d, name, ($("workflowSaveDescription").value || "").trim(), $("workflowSaveFolder").value || null);
  return action.then(function (result) {
    var target = update && mine().find(function (w) { return w.id === targetId; });
    var savedName = update ? ((target && target.name) || "workflow") : name;
    closeSave();
    dom_1.flash(update ? ("Updated “" + savedName + "”.") : ("Saved “" + savedName + "” as new."));
    if (CTX && CTX.auth && CTX.auth.logHistory)
      CTX.auth.logHistory(update ? "save-version" : "save", (update ? "Updated “" : "Saved “") + savedName + "”");
    return refresh();
  })["catch"](function (e) {
    var m = String(e && e.message || e);
    saveDialogMessage("Could not save: " + m, true);
  })["finally"](function () {
    busy = false;
    if ($("workflowSaveConfirm")) $("workflowSaveConfirm").disabled = false;
  });
}

exports.openSave = function (opts) {
  MODE = (opts && opts.mode) || "editor";
  if (!CTX || !CTX.auth || !CTX.auth.currentUser || !CTX.auth.currentUser()) {
    if (CTX && CTX.auth && CTX.auth.showAuth) CTX.auth.showAuth(true, "login");
    return Promise.resolve();
  }
  var saveDocument = ws_1.D();
  if (!saveDocument) { dom_1.flash("Open a workflow first."); return Promise.resolve(); }
  var adminAccess = saveDocument.adminWorkflowAccess ||
    saveDocument.adminWorkflowEdit || saveDocument.adminWorkflowView;
  if (adminAccess && adminAccess.mode === "view") {
    dom_1.flash("This workflow is read-only. Choose Edit from Maintenance to save changes.");
    return Promise.resolve();
  }
  /* Maintenance edit mode targets a specific workflow owned by another user.
   * Do not offer Save as new / Update existing against the superuser's own
   * library; append an audited version to the selected owner's workflow. */
  if (adminAccess && CTX.auth.saveCurrentWorkflow)
    return Promise.resolve(CTX.auth.saveCurrentWorkflow());
  close();
  var modal = $("workflowSaveModal");
  if (!modal) return Promise.resolve();
  modal.style.display = "flex";
  document.addEventListener("keydown", saveKey);
  saveDialogMessage("Loading your saved workflows\u2026");
  return refresh().then(function () {
    populateSaveDialog();
    setTimeout(function () { $("workflowSaveName") && $("workflowSaveName").focus(); }, 0);
  })["catch"](function (e) {
    saveDialogMessage("Could not load saved workflows: " + (e && e.message || e), true);
  });
};

/* ---------------------------------------------------------------------------
 * open / close
 * -------------------------------------------------------------------------*/
function close() {
  hideEditWorkflow();
  hideContextMenu();
  closeConfirmation();
  var o = $("libraryOverlay");
  if (o) o.style.display = "none";
  document.removeEventListener("keydown", onKey);
}
exports.close = close;

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === "n" && !isGuest()) {
    e.preventDefault();
    showCreateFolder(pick && pick.kind === "group" ? pick.id : null);
    return;
  }
  if (e.key !== "Escape") return;
  var contextMenu = $("libContextMenu");
  if (contextMenu && !contextMenu.hidden) { hideContextMenu(); return; }
  var confirmation = $("libraryConfirmModal");
  if (confirmation && confirmation.style.display !== "none") { closeConfirmation(); return; }
  var sheet = $("libEditSheet");
  if (sheet && !sheet.hidden) hideEditWorkflow();
  else close();
}

exports.open = function (opts) {
  MODE = (opts && opts.mode) || "editor";
  loadExampleState(false);
  loadExampleUndoState();
  pick = null;
  clearSelection(false);
  hideEditWorkflow();
  var o = $("libraryOverlay");
  if (!o) return Promise.resolve();
  o.style.display = "flex";
  document.addEventListener("keydown", onKey);
  status("");
  var guest = isGuest();
  var createFolder = $("libNewFolder");
  if (createFolder) createFolder.hidden = guest;
  if ($("libPlaceWorkflows")) $("libPlaceWorkflows").classList.toggle("on", !guest);
  if ($("libPlaceExamples")) $("libPlaceExamples").classList.toggle("on", guest);
  var title = document.querySelector(".libTitle");
  if (title) title.textContent = "Explorer";
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
    clearSelection(false);
    filter = String(e.target.value || "").trim().toLowerCase();
    render();
  });
  bind("libPlaceWorkflows", "click", function () { jumpToSection("workflows"); });
  bind("libPlaceExamples", "click", function () { jumpToSection("examples"); });
  bind("libTree", "scroll", hideContextMenu);
  bind("libTree", "contextmenu", function (event) {
    if (isGuest() || event.target !== $("libTree")) return;
    showContextMenu(event, [
      { icon: "folder", label: "New folder", run: function () { showCreateFolder(null); } }
    ]);
  });
  bind("libOpen", "click", function () {
    if (!pick || busy) return;
    if (pick.kind === "group") return openFolder(pick.id);
    if (pick.kind === "example") return openExample(pick.id);
    return openWorkflow(pick.id, !!pick.sample);
  });
  bind("libEditClose", "click", hideEditWorkflow);
  bind("libEditCancel", "click", hideEditWorkflow);
  bind("libEditSave", "click", saveEditedWorkflow);
  bind("libEditName", "keydown", function (e) { if (e.key === "Enter") saveEditedWorkflow(); });
  bind("libEditFolder", "change", paintCreateFolderField);
  bind("libCreateFolderName", "keydown", function (e) { if (e.key === "Enter") saveEditedWorkflow(); });
  bind("libraryConfirmClose", "click", closeConfirmation);
  bind("libraryConfirmCancel", "click", closeConfirmation);
  bind("libraryConfirmAccept", "click", acceptConfirmation);
  bind("libraryConfirmModal", "click", function (e) {
    if (e.target && e.target.id === "libraryConfirmModal") closeConfirmation();
  });
  bind("libBatchClear", "click", function () { clearSelection(true); });
  bind("libBatchMove", "click", batchMove);
  bind("libBatchDuplicate", "click", batchDuplicate);
  bind("libBatchDelete", "click", batchDelete);
  bind("workflowSaveClose", "click", closeSave);
  bind("workflowSaveCancel", "click", closeSave);
  bind("workflowSaveConfirm", "click", submitSave);
  bind("workflowSaveName", "keydown", function (e) { if (e.key === "Enter" && saveMode() === "new") submitSave(); });
  bind("workflowSaveModal", "click", function (e) { if (e.target && e.target.id === "workflowSaveModal") closeSave(); });
  document.querySelectorAll('input[name="workflowSaveMode"]').forEach(function (n) {
    n.addEventListener("change", paintSaveMode);
  });
  bind("libNewFolder", "click", function () {
    showCreateFolder(null);
  });
  bind("libRemoveExamples", "click", removeAllExamples);
  bind("libUndoExamples", "click", undoRemoveAllExamples);
  document.addEventListener("pointerdown", function (event) {
    var menu = $("libContextMenu");
    if (menu && !menu.hidden && !menu.contains(event.target)) hideContextMenu();
  });
  window.addEventListener("resize", hideContextMenu);

  /* The editor iframe asks for this panel by name; the editor document is a
     separate document and cannot reach the module registry. */
  window.plumblineOpenLibrary = function (mode) {
    return exports.open({ mode: mode || "editor" });
  };
  window.plumblineOpenSave = function (mode) {
    return exports.openSave({ mode: mode || "editor" });
  };
};

});
