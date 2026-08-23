/* Superuser-only maintenance console. The router and server both enforce the
 * role boundary; hiding the navigation link is presentation, never security. */
__PL.define("studio/modules/maintenance.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var auth_1 = require("studio/shared/auth.ts");
var ws_1 = require("studio/shared/workspace.ts");

var state = { users: [], audit: [], status: null, query: "", workflowUser: null,
  groups: [], workflows: [], selectedWorkflow: null, workflowQuery: "",
  expandedGroups: {}, selectedWorkflowIds: new Set(), workflowSelectionAnchor: null };
var pendingAction = null;
var mounted = false;
var routeContext = null;

function byId(id) { return document.getElementById(id); }
function page() { return byId("maintenancePage"); }
function node(tag, className, text) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}
function button(label, className, handler) {
  var el = node("button", className || "btn ghost", label);
  el.type = "button";
  el.addEventListener("click", handler);
  return el;
}
function dateLabel(value) {
  if (!value) return "Never";
  var date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}
function setStatus(message, isError) {
  var target = byId("maintenanceStatus");
  if (!target) return;
  target.textContent = message || "";
  target.classList.toggle("bad", !!isError);
}
function setText(id, value) {
  var target = byId(id);
  if (target) target.textContent = value === undefined || value === null ? "—" : String(value);
}
function currentUsername() {
  var user = auth_1.currentUser && auth_1.currentUser();
  return user && user.username ? String(user.username).toLowerCase() : "";
}

function renderMetrics() {
  var data = state.status || {};
  setText("maintenanceTotalUsers", data.totalUsers);
  setText("maintenanceActiveUsers", (data.activeUsers === undefined ? "—" : data.activeUsers) + " active");
  setText("maintenanceActiveSessions", data.activeSessions);
  setText("maintenanceWorkflows", data.activeWorkflows);
  setText("maintenanceVersions", (data.workflowVersions === undefined ? "—" : data.workflowVersions) + " stored versions");
  setText("maintenanceAnalyses", data.analysisRuns);
  setText("maintenanceAuditCount", (data.auditEvents === undefined ? "—" : data.auditEvents) + " audit events");
  setText("maintenanceDatabaseSize", data.databaseSize);
  setText("maintenanceDatabaseName", data.databaseName || "Unknown database");
  setText("maintenanceSuperusers", data.activeSuperusers);
  setText("maintenanceCheckedAt", dateLabel(data.checkedAt));
  setText("maintenanceDatabaseDetail", data.databaseName
    ? "Connected to " + data.databaseName + " / " + (data.schemaName || "public") + "."
    : "Database status is unavailable.");
}

function closeAction() {
  pendingAction = null;
  var modal = byId("maintenanceActionModal");
  if (modal) modal.style.display = "none";
  var password = byId("maintenanceNewPassword");
  if (password) password.value = "";
  var status = byId("maintenanceActionStatus");
  if (status) { status.hidden = true; status.textContent = ""; status.classList.remove("bad"); }
  var protectedPassword = byId("maintenanceProtectedPassword");
  if (protectedPassword) protectedPassword.hidden = true;
}
function openAction(options) {
  pendingAction = options;
  var modal = byId("maintenanceActionModal");
  var title = byId("maintenanceActionTitle");
  var message = byId("maintenanceActionMessage");
  var field = byId("maintenancePasswordField");
  var protectedPassword = byId("maintenanceProtectedPassword");
  var confirm = byId("maintenanceActionConfirm");
  if (title) title.textContent = options.title || "Confirm action";
  if (message) message.textContent = options.message || "";
  if (field) field.hidden = !options.password;
  if (protectedPassword) protectedPassword.hidden = !options.password;
  if (confirm) {
    confirm.textContent = options.confirmLabel || "Confirm";
    confirm.classList.toggle("danger", !!options.danger);
    confirm.disabled = false;
  }
  if (modal) modal.style.display = "flex";
  if (options.password) {
    var password = byId("maintenanceNewPassword");
    if (password) setTimeout(function () { password.focus(); }, 0);
  }
}
async function confirmAction() {
  if (!pendingAction) return;
  var action = pendingAction;
  var confirm = byId("maintenanceActionConfirm");
  var status = byId("maintenanceActionStatus");
  var password = byId("maintenanceNewPassword");
  var value = password ? password.value : "";
  if (action.password && value.length < 8) {
    if (status) { status.textContent = "Password must be at least 8 characters."; status.hidden = false; status.classList.add("bad"); }
    return;
  }
  if (confirm) confirm.disabled = true;
  if (status) { status.textContent = "Applying audited change…"; status.hidden = false; status.classList.remove("bad"); }
  try {
    await action.run(value);
    closeAction();
    setStatus(action.success || "Maintenance action completed.", false);
    await loadAll();
  } catch (error) {
    if (confirm) confirm.disabled = false;
    if (status) {
      status.textContent = String(error && error.message || error);
      status.hidden = false;
      status.classList.add("bad");
    }
  }
}

function setWorkflowStatus(message, isError) {
  var target = byId("maintenanceWorkflowStatus");
  if (!target) return;
  target.textContent = message || "";
  target.classList.toggle("bad", !!isError);
}
function closeWorkflows() {
  var modal = byId("maintenanceWorkflowModal");
  if (modal) modal.style.display = "none";
  state.workflowUser = null;
  state.groups = [];
  state.workflows = [];
  state.selectedWorkflow = null;
  state.selectedWorkflowIds.clear();
  state.workflowSelectionAnchor = null;
  state.workflowQuery = "";
  state.expandedGroups = {};
  var search = byId("maintenanceWorkflowSearch");
  if (search) search.value = "";
  renderWorkflowSelectionBar();
}
function workflowDocument(detail) {
  var snapshot = detail && detail.workflow;
  return snapshot && snapshot.workflow ? snapshot.workflow : (snapshot || {});
}
function svgNode(tag, attributes) {
  var el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.keys(attributes || {}).forEach(function (key) {
    el.setAttribute(key, String(attributes[key]));
  });
  return el;
}
function workflowNodeColor(workflowState) {
  var role = String(workflowState && workflowState.role || "").toLowerCase();
  if (workflowState && (workflowState.initial || role === "start")) return "#1F7A6F";
  if (workflowState && (workflowState.accept || role === "terminal")) return "#2E7D32";
  if (workflowState && (workflowState.reject || role === "rework")) return "#B2453C";
  if (role === "decision") return "#B8862F";
  if (role === "quality") return "#3A9D90";
  return "#526173";
}
function renderWorkflowPreview(workflow, name) {
  var states = Array.isArray(workflow.states) ? workflow.states : [];
  var transitions = Array.isArray(workflow.transitions) ? workflow.transitions : [];
  var panel = node("section", "maintenanceWorkflowPreview");
  var label = node("div", "maintenanceWorkflowPreviewLabel");
  label.appendChild(node("strong", "", "Workflow preview"));
  label.appendChild(node("span", "", "Spaced overview"));
  panel.appendChild(label);
  if (!states.length) {
    panel.appendChild(node("div", "maintenanceWorkflowEmpty", "This workflow has no states to preview."));
    return panel;
  }

  var basePositions = ws_1.autoLayout(workflow) || {};
  var raw = states.map(function (workflowState, index) {
    var position = basePositions[workflowState.id] || { x: (index % 3) * 220, y: Math.floor(index / 3) * 130 };
    return { state: workflowState, x: Number(position.x) || 0, y: Number(position.y) || 0 };
  });
  var minX = Math.min.apply(null, raw.map(function (entry) { return entry.x; }));
  var minY = Math.min.apply(null, raw.map(function (entry) { return entry.y; }));
  var spacing = 1.42, pad = 34, cardWidth = 136, cardHeight = 54;
  var placed = {}, maxX = 0, maxY = 0;
  raw.forEach(function (entry) {
    var x = pad + (entry.x - minX) * spacing;
    var y = pad + (entry.y - minY) * spacing;
    placed[entry.state.id] = { x: x, y: y, state: entry.state };
    maxX = Math.max(maxX, x + cardWidth + pad);
    maxY = Math.max(maxY, y + cardHeight + pad);
  });
  maxX = Math.max(320, maxX);
  maxY = Math.max(210, maxY);

  var svg = svgNode("svg", {
    viewBox: "0 0 " + maxX + " " + maxY,
    role: "img",
    "aria-label": (name || "Workflow") + " diagram with increased spacing",
    preserveAspectRatio: "xMidYMid meet"
  });
  var markerId = "maintenancePreviewArrow_" + String(name || "workflow").replace(/[^A-Za-z0-9_-]/g, "_");
  var defs = svgNode("defs");
  var marker = svgNode("marker", { id: markerId, viewBox: "0 0 10 10", refX: "8", refY: "5",
    markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse" });
  marker.appendChild(svgNode("path", { d: "M0 1 L9 5 L0 9 z", fill: "#7b8694" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  transitions.forEach(function (transition) {
    var from = placed[transition.from], to = placed[transition.to];
    if (!from || !to) return;
    var x1 = from.x + cardWidth / 2, y1 = from.y + cardHeight / 2;
    var x2 = to.x + cardWidth / 2, y2 = to.y + cardHeight / 2;
    var dx = x2 - x1, dy = y2 - y1;
    var length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    x1 += dx / length * (cardWidth * .46);
    y1 += dy / length * (cardHeight * .42);
    x2 -= dx / length * (cardWidth * .48);
    y2 -= dy / length * (cardHeight * .44);
    var bend = Math.max(28, Math.abs(dx) * .42);
    svg.appendChild(svgNode("path", {
      d: "M" + x1 + " " + y1 + " C" + (x1 + bend) + " " + y1 + " " + (x2 - bend) + " " + y2 + " " + x2 + " " + y2,
      fill: "none", stroke: "#7b8694", "stroke-width": "1.8", "stroke-linecap": "round",
      "marker-end": "url(#" + markerId + ")"
    }));
  });
  raw.forEach(function (entry) {
    var position = placed[entry.state.id], group = svgNode("g");
    var color = workflowNodeColor(entry.state);
    group.appendChild(svgNode("rect", { x: position.x, y: position.y, width: cardWidth, height: cardHeight,
      rx: "9", fill: "var(--surface)", stroke: color, "stroke-width": entry.state.initial ? "2.8" : "1.8" }));
    var title = svgNode("text", { x: position.x + 11, y: position.y + 23, class: "maintenanceWorkflowPreviewName" });
    var text = String(entry.state.label || entry.state.name || entry.state.id || "State");
    title.textContent = text.length > 19 ? text.slice(0, 18) + "…" : text;
    group.appendChild(title);
    var meta = svgNode("text", { x: position.x + 11, y: position.y + 40, class: "maintenanceWorkflowPreviewMeta" });
    meta.textContent = entry.state.initial ? "Start" : (entry.state.accept ? "Final" : (entry.state.role || "State"));
    group.appendChild(meta);
    svg.appendChild(group);
  });
  var canvas = node("div", "maintenanceWorkflowPreviewCanvas");
  canvas.appendChild(svg);
  panel.appendChild(canvas);
  return panel;
}
function renderWorkflowDetail(detail) {
  var target = byId("maintenanceWorkflowDetail");
  if (!target) return;
  target.innerHTML = "";
  if (!detail) {
    target.appendChild(node("div", "maintenanceWorkflowEmpty",
      "Select a workflow to see its diagram. Use the checkboxes to select several workflows and open them together in separate Studio tabs."));
    return;
  }
  var workflow = workflowDocument(detail);
  var states = Array.isArray(workflow.states) ? workflow.states : [];
  var transitions = Array.isArray(workflow.transitions) ? workflow.transitions : [];
  var header = node("div", "maintenanceWorkflowDetailHead");
  var heading = node("div", "");
  heading.appendChild(node("div", "maintenanceEyebrow", "Database preview"));
  heading.appendChild(node("h3", "", detail.name || "Untitled workflow"));
  heading.appendChild(node("p", "", "@" + (detail.ownerUsername || "unknown") +
    " · version " + (detail.versionNumber || "—") + " · " +
    dateLabel(detail.versionCreatedAt || detail.savedAt)));
  header.appendChild(heading);
  var headerActions = node("div", "maintenanceWorkflowDetailActions");
  headerActions.appendChild(button("View in Studio", "btn ghost", function () {
    openWorkflowView(detail.id, detail);
  }));
  headerActions.appendChild(button("Edit in Studio", "btn", function () {
    openWorkflowEdit(detail.id, detail);
  }));
  header.appendChild(headerActions);
  target.appendChild(header);

  var metrics = node("div", "maintenanceWorkflowSummary");
  [["States", states.length], ["Transitions", transitions.length]]
    .forEach(function (item) {
      var card = node("div", "");
      card.appendChild(node("span", "", item[0]));
      card.appendChild(node("strong", "", item[1]));
      metrics.appendChild(card);
    });
  target.appendChild(metrics);
  target.appendChild(renderWorkflowPreview(workflow, detail.name));
}

function explorerIcon(kind) {
  var paths = {
    folder: '<path d="M3.5 6.5h6l2 2h9v10h-17z"></path>',
    workflow: '<path d="M7 3.5h8l4 4v13H7z"></path><path d="M15 3.5v4h4M10 12h6m-6 4h6"></path>',
    view: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle>',
    edit: '<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"></path><path d="m13.5 6.5 4 4"></path>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths[kind] + '</svg>';
}
function explorerAction(kind, label, handler) {
  var action = node("button", "libIconBtn");
  action.type = "button";
  action.title = label;
  action.setAttribute("aria-label", label);
  action.innerHTML = explorerIcon(kind);
  action.addEventListener("click", function (event) {
    event.stopPropagation();
    handler();
  });
  return action;
}
function workflowsInGroup(groupId) {
  var normalized = groupId || null;
  return state.workflows.filter(function (workflow) {
    return (workflow.groupId || null) === normalized;
  }).sort(function (a, b) {
    return (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""));
  });
}
function childGroups(parentId) {
  var normalized = parentId || null;
  return state.groups.filter(function (group) {
    return (group.parentGroupId || null) === normalized;
  }).sort(function (a, b) {
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}
function workflowMatches(workflow) {
  var query = state.workflowQuery.toLowerCase();
  if (!query) return true;
  return [workflow.name, workflow.description, workflow.lifecycle, workflow.visibility]
    .some(function (value) { return String(value || "").toLowerCase().indexOf(query) >= 0; });
}
function groupMatches(group, seen) {
  var query = state.workflowQuery.toLowerCase();
  if (!query) return true;
  seen = seen || {};
  if (seen[group.groupId]) return false;
  seen[group.groupId] = true;
  if ([group.name, group.description, group.path]
    .some(function (value) { return String(value || "").toLowerCase().indexOf(query) >= 0; })) return true;
  if (workflowsInGroup(group.groupId).some(workflowMatches)) return true;
  return childGroups(group.groupId).some(function (child) { return groupMatches(child, seen); });
}
function makeExplorerRow(kind, name, note, selected) {
  var row = node("div", "libRow " + (kind === "folder" ? "libFolderRow" : "libFileRow") +
    (selected ? " sel" : ""));
  row.tabIndex = 0;
  row.setAttribute("role", "treeitem");
  var twist = node("span", "twist", "");
  var icon = node("span", "ico");
  icon.innerHTML = explorerIcon(kind);
  row.appendChild(twist);
  row.appendChild(icon);
  row.appendChild(node("span", "nm", name || (kind === "folder" ? "Folder" : "Untitled workflow")));
  row.appendChild(node("span", "ver", note || ""));
  return row;
}
function selectedWorkflows() {
  return state.workflows.filter(function (workflow) {
    return state.selectedWorkflowIds.has(workflow.id);
  });
}
function renderWorkflowSelectionBar() {
  var bar = byId("maintenanceWorkflowSelectionBar");
  var count = state.selectedWorkflowIds.size;
  if (bar) bar.hidden = count < 2;
  setText("maintenanceWorkflowSelectionCount", count + " workflows selected");
  ["maintenanceWorkflowViewSelected", "maintenanceWorkflowEditSelected"].forEach(function (id) {
    var action = byId(id);
    if (action) action.disabled = count < 2;
  });
}
function updateWorkflowSelection(workflow, event, forceAdditive) {
  var id = workflow.id;
  var additive = forceAdditive || !!(event && (event.ctrlKey || event.metaKey));
  var range = !!(event && event.shiftKey);
  if (range && state.workflowSelectionAnchor) {
    var visible = Array.prototype.slice.call(document.querySelectorAll("#maintenanceWorkflowList .libFileRow[data-workflow-id]"));
    var from = visible.findIndex(function (row) { return row.dataset.workflowId === state.workflowSelectionAnchor; });
    var to = visible.findIndex(function (row) { return row.dataset.workflowId === id; });
    if (from >= 0 && to >= 0) {
      if (!additive) state.selectedWorkflowIds.clear();
      visible.slice(Math.min(from, to), Math.max(from, to) + 1).forEach(function (row) {
        state.selectedWorkflowIds.add(row.dataset.workflowId);
      });
    }
  } else if (additive) {
    if (state.selectedWorkflowIds.has(id)) state.selectedWorkflowIds.delete(id);
    else state.selectedWorkflowIds.add(id);
    state.workflowSelectionAnchor = id;
  } else {
    state.selectedWorkflowIds.clear();
    state.selectedWorkflowIds.add(id);
    state.workflowSelectionAnchor = id;
  }
}
async function loadWorkflowPreview(workflow) {
  var target = byId("maintenanceWorkflowDetail");
  if (target) {
    target.innerHTML = "";
    target.appendChild(node("div", "maintenanceWorkflowEmpty", "Loading the latest database version…"));
  }
  try {
    var detail = await window.PlumblineData.admin.loadWorkflow(workflow.id);
    if (!state.selectedWorkflow || state.selectedWorkflow.id !== workflow.id) return;
    renderWorkflowDetail(detail);
  } catch (error) {
    if (target) {
      target.innerHTML = "";
      target.appendChild(node("div", "maintenanceWorkflowEmpty", String(error && error.message || error)));
    }
  }
}
function selectWorkflow(workflow, event, forceAdditive) {
  updateWorkflowSelection(workflow, event, forceAdditive);
  if (!state.selectedWorkflowIds.has(workflow.id)) {
    if (state.selectedWorkflow && state.selectedWorkflow.id === workflow.id)
      state.selectedWorkflow = selectedWorkflows()[0] || null;
  } else state.selectedWorkflow = workflow;
  renderWorkflowList();
  renderWorkflowSelectionBar();
  if (state.selectedWorkflow) return loadWorkflowPreview(state.selectedWorkflow);
  renderWorkflowDetail(null);
}
function renderWorkflowRow(workflow, host) {
  if (!workflowMatches(workflow)) return false;
  var selected = state.selectedWorkflowIds.has(workflow.id);
  var active = state.selectedWorkflow && state.selectedWorkflow.id === workflow.id;
  var row = makeExplorerRow("workflow", workflow.name,
    "v" + (workflow.versionNumber || "—"), selected);
  row.classList.toggle("active-preview", !!active);
  row.setAttribute("aria-selected", selected ? "true" : "false");
  if (active) row.setAttribute("aria-current", "true");
  row.dataset.workflowId = workflow.id;
  row.title = (workflow.name || "Workflow") + " · " + dateLabel(workflow.savedAt);
  var checkbox = node("input", "maintenanceWorkflowCheckbox");
  checkbox.type = "checkbox";
  checkbox.checked = selected;
  checkbox.setAttribute("aria-label", "Select " + (workflow.name || "workflow"));
  checkbox.addEventListener("click", function (event) {
    event.stopPropagation();
    selectWorkflow(workflow, event, true);
  });
  row.replaceChild(checkbox, row.querySelector(".twist"));
  var actions = node("span", "libRowActions");
  actions.appendChild(explorerAction("view", "View " + (workflow.name || "workflow"), function () {
    openWorkflowView(workflow.id);
  }));
  actions.appendChild(explorerAction("edit", "Edit " + (workflow.name || "workflow"), function () {
    openWorkflowEdit(workflow.id);
  }));
  row.appendChild(actions);
  row.addEventListener("click", function (event) {
    if (event.target && event.target.closest && event.target.closest("button")) return;
    selectWorkflow(workflow, event, false);
  });
  row.addEventListener("dblclick", function (event) {
    if (event.target && event.target.closest && event.target.closest("button")) return;
    openWorkflowView(workflow.id);
  });
  row.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); selectWorkflow(workflow, event, false);
    }
  });
  host.appendChild(row);
  return true;
}
function renderFolder(group, host) {
  if (!groupMatches(group)) return false;
  var searching = !!state.workflowQuery;
  var expanded = searching || state.expandedGroups[group.groupId] !== false;
  var direct = workflowsInGroup(group.groupId);
  var children = childGroups(group.groupId);
  var row = makeExplorerRow("folder", group.name,
    direct.length + " item" + (direct.length === 1 ? "" : "s"), false);
  row.setAttribute("aria-expanded", expanded ? "true" : "false");
  row.querySelector(".twist").textContent = expanded ? "▾" : "▸";
  function toggle() {
    state.expandedGroups[group.groupId] = !expanded;
    renderWorkflowList();
  }
  row.addEventListener("click", toggle);
  row.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
  });
  host.appendChild(row);
  if (!expanded) return true;
  var kids = node("div", "libKids");
  children.forEach(function (child) { renderFolder(child, kids); });
  direct.forEach(function (workflow) { renderWorkflowRow(workflow, kids); });
  host.appendChild(kids);
  return true;
}
function renderWorkflowList() {
  var target = byId("maintenanceWorkflowList");
  if (!target) return;
  target.innerHTML = "";
  if (!state.workflows.length && !state.groups.length) {
    target.appendChild(node("div", "libEmpty", "This account has no folders or workflows."));
    renderWorkflowSelectionBar();
    return;
  }
  var rendered = 0;
  var rootSection = node("div", "libSection");
  rootSection.appendChild(node("strong", "", "My workflows"));
  rootSection.appendChild(node("span", "", state.workflowUser
    ? "@" + (state.workflowUser.username || "user") : "Root"));
  target.appendChild(rootSection);
  childGroups(null).forEach(function (group) { if (renderFolder(group, target)) rendered += 1; });
  workflowsInGroup(null).forEach(function (workflow) { if (renderWorkflowRow(workflow, target)) rendered += 1; });
  if (!rendered) target.appendChild(node("div", "libEmpty", state.workflowQuery
    ? "Nothing matches “" + state.workflowQuery + "”."
    : "This account has no visible workflows."));
  renderWorkflowSelectionBar();
}
async function openWorkflowView(workflowId, loaded) {
  return openWorkflowInStudio(workflowId, "view", loaded);
}
async function openWorkflowEdit(workflowId, loaded) {
  return openWorkflowInStudio(workflowId, "edit", loaded);
}
function appendAdminWorkflow(detail, mode) {
  var readOnly = mode === "view";
  ws_1.setActive(-1);
  ws_1.ingest(detail.workflow, "Maintenance workflow");
  var document = ws_1.D();
  if (!document) throw new Error("The workflow could not be opened in Studio.");
  document.name = detail.name || document.name;
  if (document.wf) document.wf.name = detail.name || document.wf.name;
  document.adminWorkflowAccess = {
    mode: readOnly ? "view" : "edit",
    workflowId: detail.id,
    ownerUserId: detail.ownerUserId,
    ownerUsername: detail.ownerUsername || "user",
    versionNumber: detail.versionNumber
  };
  if (readOnly) document.adminWorkflowView = document.adminWorkflowAccess;
  else document.adminWorkflowEdit = document.adminWorkflowAccess;
  return document;
}
async function openWorkflowInStudio(workflowId, mode, loaded) {
  var readOnly = mode === "view";
  setWorkflowStatus(readOnly
    ? "Opening the latest database version in read-only mode…"
    : "Opening the latest database version for editing…", false);
  try {
    var detail = loaded && loaded.id === workflowId
      ? loaded : await window.PlumblineData.admin.loadWorkflow(workflowId);
    appendAdminWorkflow(detail, mode);
    closeWorkflows();
    setStatus((readOnly ? "Viewing " : "Editing ") + detail.name + " for @" +
      detail.ownerUsername + (readOnly
        ? " in read-only mode."
        : ". Save appends a synchronized database version."), false);
    if (routeContext) routeContext.navigate("/analysis");
  } catch (error) {
    setWorkflowStatus(String(error && error.message || error), true);
  }
}
async function openSelectedWorkflows(mode) {
  var workflows = selectedWorkflows();
  if (workflows.length < 2) return;
  var readOnly = mode === "view";
  var ownerUsername = state.workflowUser && state.workflowUser.username || "user";
  setWorkflowStatus((readOnly ? "Opening " : "Opening for editing: ") + workflows.length + " workflows…", false);
  var viewButton = byId("maintenanceWorkflowViewSelected");
  var editButton = byId("maintenanceWorkflowEditSelected");
  if (viewButton) viewButton.disabled = true;
  if (editButton) editButton.disabled = true;
  try {
    var details = await Promise.all(workflows.map(function (workflow) {
      return window.PlumblineData.admin.loadWorkflow(workflow.id);
    }));
    details.forEach(function (detail) { appendAdminWorkflow(detail, mode); });
    closeWorkflows();
    setStatus((readOnly ? "Viewing " : "Editing ") + details.length + " workflows for @" +
      ownerUsername + " in separate Studio tabs.", false);
    if (routeContext) routeContext.navigate("/analysis");
  } catch (error) {
    setWorkflowStatus(String(error && error.message || error), true);
    renderWorkflowSelectionBar();
  }
}
function clearWorkflowSelection() {
  state.selectedWorkflowIds.clear();
  state.workflowSelectionAnchor = null;
  state.selectedWorkflow = null;
  renderWorkflowList();
  renderWorkflowDetail(null);
}
async function openUserWorkflows(user) {
  state.workflowUser = user;
  state.groups = [];
  state.workflows = [];
  state.selectedWorkflow = null;
  state.selectedWorkflowIds.clear();
  state.workflowSelectionAnchor = null;
  state.workflowQuery = "";
  state.expandedGroups = {};
  var modal = byId("maintenanceWorkflowModal");
  var title = byId("maintenanceWorkflowTitle");
  var subtitle = byId("maintenanceWorkflowSubtitle");
  var breadcrumb = byId("maintenanceWorkflowBreadcrumb");
  var search = byId("maintenanceWorkflowSearch");
  if (title) title.textContent = (user.displayName || user.username || "User") + " Explorer";
  if (subtitle) subtitle.textContent = "Browse @" + (user.username || "unknown") +
    " exactly as their folders are organized. Select one to preview it, or check several to open them together.";
  if (breadcrumb) breadcrumb.textContent = "@" + (user.username || "user") + " / Workflows";
  if (search) search.value = "";
  if (modal) modal.style.display = "flex";
  renderWorkflowList();
  renderWorkflowDetail(null);
  setWorkflowStatus("Loading workflows…", false);
  try {
    var result = await window.PlumblineData.admin.listUserWorkflows(user.id);
    state.workflowUser = result && result.user ? Object.assign({}, user, result.user) : user;
    state.groups = Array.isArray(result && result.groups) ? result.groups : [];
    state.workflows = Array.isArray(result && result.workflows) ? result.workflows : [];
    state.groups.forEach(function (group) { state.expandedGroups[group.groupId] = true; });
    renderWorkflowList();
    setWorkflowStatus(state.groups.length + " folder" + (state.groups.length === 1 ? "" : "s") +
      " and " + state.workflows.length + " workflow" +
      (state.workflows.length === 1 ? "" : "s") + " loaded from the database.", false);
  } catch (error) {
    setWorkflowStatus(String(error && error.message || error), true);
  }
}

function roleSelect(user, isSelf) {
  var select = node("select", "maintenanceRoleSelect");
  ["user", "analyst", "superuser"].forEach(function (type) {
    var option = node("option", "", type === "superuser" ? "Superuser" : (type === "analyst" ? "Analyst" : "User"));
    option.value = type;
    option.selected = user.userType === type;
    select.appendChild(option);
  });
  if (isSelf) {
    select.disabled = true;
    select.title = "Your own superuser access cannot be removed here.";
  } else {
    select.addEventListener("change", function () {
      var next = select.value;
      openAction({
        title: "Change account access?",
        message: "Change " + (user.username || user.email) + " from " + user.userType + " to " + next + ". This affects what the account can access immediately.",
        confirmLabel: "Change access",
        danger: next === "superuser" || user.userType === "superuser",
        success: "User access level updated.",
        run: function () { return window.PlumblineData.admin.setUserType(user.id, next); }
      });
      renderUsers();
    });
  }
  return select;
}

function renderUsers() {
  var body = byId("maintenanceUsersBody");
  if (!body) return;
  body.innerHTML = "";
  var query = state.query.toLowerCase();
  var visible = state.users.filter(function (user) {
    if (!query) return true;
    return [user.displayName, user.username, user.email, user.team, user.role, user.region, user.userType]
      .some(function (value) { return String(value || "").toLowerCase().indexOf(query) >= 0; });
  });
  if (!visible.length) {
    var emptyRow = node("tr", "");
    var emptyCell = node("td", "maintenanceEmpty", query ? "No users match that search." : "No users found.");
    emptyCell.colSpan = 5;
    emptyRow.appendChild(emptyCell);
    body.appendChild(emptyRow);
    return;
  }
  var ownUsername = currentUsername();
  visible.forEach(function (user) {
    var row = node("tr", user.isActive ? "" : "maintenanceInactiveRow");
    var identity = node("td", "maintenanceUserIdentity");
    identity.appendChild(node("strong", "", user.displayName || user.username || "Unnamed user"));
    identity.appendChild(node("span", "", "@" + (user.username || "unknown") + " · " + (user.email || "No email")));
    identity.appendChild(node("small", "", [user.team, user.role, user.region].filter(Boolean).join(" · ") || "No profile details"));
    row.appendChild(identity);

    var isSelf = String(user.username || "").toLowerCase() === ownUsername;
    var access = node("td", "maintenanceAccessCell");
    access.appendChild(roleSelect(user, isSelf));
    if (isSelf) access.appendChild(node("small", "maintenanceCurrentUser", "Current account"));
    row.appendChild(access);

    var activity = node("td", "maintenanceActivityCell");
    activity.appendChild(node("b", "", (user.activeSessions || 0) + " sessions · " + (user.workflowCount || 0) + " workflows"));
    activity.appendChild(node("small", "", "Last login: " + dateLabel(user.lastLogin)));
    row.appendChild(activity);

    var statusCell = node("td", "");
    statusCell.appendChild(node("span", "maintenanceUserStatus " + (user.isActive ? "active" : "inactive"), user.isActive ? "Active" : "Inactive"));
    row.appendChild(statusCell);

    var controls = node("td", "maintenanceUserControls");
    var controlActions = node("div", "maintenanceUserControlActions");
    var managePassword = button("Manage password", "btn tiny ghost", function () {
      openAction({
        title: "Manage password",
        message: "The current password cannot be revealed because only a one-way hash is stored. Set a replacement password for " +
          (user.username || user.email) + ". All sessions and remembered logins will be revoked.",
        confirmLabel: "Change password",
        password: true,
        success: "Password changed and sessions revoked.",
        run: function (newPassword) { return window.PlumblineData.admin.resetPassword(user.id, newPassword); }
      });
    });
    var workflows = button("Workflows", "btn tiny ghost", function () {
      openUserWorkflows(user);
    });
    var revoke = button("Revoke sessions", "btn tiny ghost", function () {
      openAction({
        title: "Revoke all sessions?",
        message: "Sign " + (user.username || user.email) + " out on every device and invalidate remembered logins.",
        confirmLabel: "Revoke sessions",
        danger: true,
        success: "User sessions revoked.",
        run: function () { return window.PlumblineData.admin.revokeSessions(user.id); }
      });
    });
    if (isSelf) {
      managePassword.disabled = true;
      managePassword.title = "Change your own password in Settings.";
      revoke.disabled = true; revoke.title = "Your current maintenance session is protected.";
    }
    controlActions.appendChild(workflows);
    controlActions.appendChild(managePassword);
    controlActions.appendChild(revoke);
    var active = button(user.isActive ? "Deactivate" : "Activate",
      "btn tiny " + (user.isActive ? "danger" : "ghost"), function () {
        openAction({
          title: user.isActive ? "Deactivate account?" : "Activate account?",
          message: (user.isActive ? "Deactivate " : "Activate ") + (user.username || user.email) +
            (user.isActive ? ". The user will be signed out everywhere and unable to sign in." : ". The user will be able to sign in again."),
          confirmLabel: user.isActive ? "Deactivate" : "Activate",
          danger: user.isActive,
          success: user.isActive ? "User account deactivated." : "User account activated.",
          run: function () { return window.PlumblineData.admin.setActive(user.id, !user.isActive); }
        });
      });
    if (isSelf && user.isActive) { active.disabled = true; active.title = "You cannot deactivate your own account."; }
    controlActions.appendChild(active);
    controls.appendChild(controlActions);
    row.appendChild(controls);
    body.appendChild(row);
  });
}

function detailLabel(details) {
  if (!details || (typeof details === "object" && !Object.keys(details).length)) return "—";
  var text = typeof details === "string" ? details : JSON.stringify(details);
  return text.length > 180 ? text.slice(0, 177) + "…" : text;
}
function renderAudit() {
  var body = byId("maintenanceAuditBody");
  if (!body) return;
  body.innerHTML = "";
  if (!state.audit.length) {
    var emptyRow = node("tr", "");
    var emptyCell = node("td", "maintenanceEmpty", "No audit events found.");
    emptyCell.colSpan = 5; emptyRow.appendChild(emptyCell); body.appendChild(emptyRow); return;
  }
  state.audit.forEach(function (event) {
    var row = node("tr", "");
    row.appendChild(node("td", "maintenanceAuditTime", dateLabel(event.occurredAt)));
    row.appendChild(node("td", "maintenanceAuditAction", event.action || "Unknown"));
    row.appendChild(node("td", "maintenanceMono", event.actorUserId || "System"));
    row.appendChild(node("td", "maintenanceMono", [event.entityType, event.entityId].filter(Boolean).join(" / ") || "—"));
    row.appendChild(node("td", "maintenanceAuditDetail", detailLabel(event.details)));
    body.appendChild(row);
  });
}

async function loadAudit() {
  state.audit = await window.PlumblineData.admin.auditLog();
  if (!Array.isArray(state.audit)) state.audit = [];
  if (mounted) renderAudit();
}
async function loadAll() {
  if (!auth_1.isSuperuser()) return;
  setStatus("Loading current system data…", false);
  try {
    var results = await Promise.all([
      window.PlumblineData.admin.status(),
      window.PlumblineData.admin.listUsers(),
      window.PlumblineData.admin.auditLog()
    ]);
    state.status = results[0] || {};
    state.users = Array.isArray(results[1]) ? results[1] : [];
    state.audit = Array.isArray(results[2]) ? results[2] : [];
    if (!mounted) return;
    renderMetrics(); renderUsers(); renderAudit();
    setStatus("Maintenance data refreshed " + new Date().toLocaleTimeString() + ".", false);
  } catch (error) {
    setStatus(String(error && error.message || error), true);
  }
}

function showTab(name) {
  document.querySelectorAll("[data-maintenance-tab]").forEach(function (tab) {
    tab.classList.toggle("on", tab.getAttribute("data-maintenance-tab") === name);
  });
  document.querySelectorAll("[data-maintenance-panel]").forEach(function (panel) {
    panel.hidden = panel.getAttribute("data-maintenance-panel") !== name;
  });
}

exports["default"] = {
  mount: function (outlet, params, ctx) {
    if (!auth_1.isSuperuser()) { ctx.navigate("/home"); return; }
    mounted = true;
    routeContext = ctx;
    this.bound = [];
    var self = this;
    function bind(target, event, handler) {
      if (!target) return;
      target.addEventListener(event, handler);
      self.bound.push([target, event, handler]);
    }
    var targetPage = page();
    if (targetPage) targetPage.classList.add("active");
    document.querySelectorAll("[data-maintenance-tab]").forEach(function (tab) {
      bind(tab, "click", function () { showTab(tab.getAttribute("data-maintenance-tab")); });
    });
    bind(byId("maintenanceRefresh"), "click", loadAll);
    bind(byId("maintenanceAuditRefresh"), "click", async function () {
      setStatus("Refreshing audit log…", false);
      try { await loadAudit(); setStatus("Audit log refreshed.", false); }
      catch (error) { setStatus(String(error && error.message || error), true); }
    });
    bind(byId("maintenanceUserSearch"), "input", function (event) {
      state.query = event.target.value || ""; renderUsers();
    });
    bind(byId("maintenanceWorkflowSearch"), "input", function (event) {
      state.workflowQuery = event.target.value || ""; renderWorkflowList();
    });
    bind(byId("maintenanceWorkflowViewSelected"), "click", function () { openSelectedWorkflows("view"); });
    bind(byId("maintenanceWorkflowEditSelected"), "click", function () { openSelectedWorkflows("edit"); });
    bind(byId("maintenanceWorkflowClearSelection"), "click", clearWorkflowSelection);
    bind(byId("maintenanceActionClose"), "click", closeAction);
    bind(byId("maintenanceActionCancel"), "click", closeAction);
    bind(byId("maintenanceActionConfirm"), "click", confirmAction);
    bind(byId("maintenanceNewPassword"), "keydown", function (event) { if (event.key === "Enter") confirmAction(); });
    bind(byId("maintenanceWorkflowClose"), "click", closeWorkflows);
    bind(byId("maintenancePurge"), "click", function () {
      var input = byId("maintenanceRetainDays");
      var days = Math.max(1, Math.min(365, Number(input && input.value) || 30));
      openAction({
        title: "Purge expired authentication data?",
        message: "Delete expired remember tokens and expired or revoked sessions older than " + days + " days. This does not delete user accounts or audit events.",
        confirmLabel: "Run cleanup",
        danger: true,
        success: "Expired authentication data purged.",
        run: function () { return window.PlumblineData.admin.purgeExpiredAuth(days); }
      });
    });
    showTab("users");
    loadAll();
  },
  unmount: function () {
    mounted = false;
    routeContext = null;
    closeAction();
    closeWorkflows();
    for (var i = 0; i < (this.bound || []).length; i += 1)
      this.bound[i][0].removeEventListener(this.bound[i][1], this.bound[i][2]);
    this.bound = [];
    var targetPage = page();
    if (targetPage) targetPage.classList.remove("active");
  }
};

});
