/* Superuser-only maintenance console. The router and server both enforce the
 * role boundary; hiding the navigation link is presentation, never security. */
__PL.define("studio/modules/maintenance.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var auth_1 = require("studio/shared/auth.ts");
var ws_1 = require("studio/shared/workspace.ts");

var state = { users: [], audit: [], status: null, query: "", workflowUser: null,
  workflows: [], selectedWorkflow: null };
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
  state.workflows = [];
  state.selectedWorkflow = null;
}
function workflowDocument(detail) {
  var snapshot = detail && detail.workflow;
  return snapshot && snapshot.workflow ? snapshot.workflow : (snapshot || {});
}
function renderWorkflowDetail(detail) {
  var target = byId("maintenanceWorkflowDetail");
  if (!target) return;
  target.innerHTML = "";
  if (!detail) {
    target.appendChild(node("div", "maintenanceWorkflowEmpty",
      "Select View to inspect a workflow without changing it."));
    return;
  }
  var workflow = workflowDocument(detail);
  var states = Array.isArray(workflow.states) ? workflow.states : [];
  var transitions = Array.isArray(workflow.transitions) ? workflow.transitions : [];
  var header = node("div", "maintenanceWorkflowDetailHead");
  var heading = node("div", "");
  heading.appendChild(node("div", "maintenanceEyebrow", "Database view mode"));
  heading.appendChild(node("h3", "", detail.name || "Untitled workflow"));
  heading.appendChild(node("p", "", "@" + (detail.ownerUsername || "unknown") +
    " · version " + (detail.versionNumber || "—") + " · " +
    dateLabel(detail.versionCreatedAt || detail.savedAt)));
  header.appendChild(heading);
  header.appendChild(button("Edit in Studio", "btn", function () {
    openWorkflowEdit(detail.id, detail);
  }));
  target.appendChild(header);

  var metrics = node("div", "maintenanceWorkflowSummary");
  [["States", states.length], ["Transitions", transitions.length],
   ["Lifecycle", detail.lifecycle || "ACTIVE"], ["Visibility", detail.visibility || "PRIVATE"]]
    .forEach(function (item) {
      var card = node("div", "");
      card.appendChild(node("span", "", item[0]));
      card.appendChild(node("strong", "", item[1]));
      metrics.appendChild(card);
    });
  target.appendChild(metrics);
  var codeLabel = node("div", "maintenanceWorkflowJsonLabel");
  codeLabel.appendChild(node("strong", "", "Current database snapshot"));
  codeLabel.appendChild(node("span", "", "Read-only"));
  target.appendChild(codeLabel);
  var code = node("pre", "maintenanceWorkflowJson");
  code.textContent = JSON.stringify(detail.workflow || {}, null, 2);
  target.appendChild(code);
}
function renderWorkflowList() {
  var target = byId("maintenanceWorkflowList");
  if (!target) return;
  target.innerHTML = "";
  if (!state.workflows.length) {
    target.appendChild(node("div", "maintenanceWorkflowEmpty", "This account has no workflows."));
    return;
  }
  state.workflows.forEach(function (workflow) {
    var row = node("article", "maintenanceWorkflowItem" +
      (state.selectedWorkflow && state.selectedWorkflow.id === workflow.id ? " on" : ""));
    var copy = node("div", "maintenanceWorkflowItemCopy");
    copy.appendChild(node("strong", "", workflow.name || "Untitled workflow"));
    copy.appendChild(node("span", "", "v" + (workflow.versionNumber || "—") +
      " · " + dateLabel(workflow.savedAt)));
    row.appendChild(copy);
    var actions = node("div", "maintenanceWorkflowItemActions");
    actions.appendChild(button("View", "btn tiny ghost", function () {
      openWorkflowView(workflow.id);
    }));
    actions.appendChild(button("Edit", "btn tiny", function () {
      openWorkflowEdit(workflow.id);
    }));
    row.appendChild(actions);
    target.appendChild(row);
  });
}
async function openWorkflowView(workflowId) {
  setWorkflowStatus("Loading the current database version…", false);
  try {
    state.selectedWorkflow = await window.PlumblineData.admin.loadWorkflow(workflowId);
    renderWorkflowList();
    renderWorkflowDetail(state.selectedWorkflow);
    setWorkflowStatus("Viewing the latest saved version. No changes can be made in this panel.", false);
  } catch (error) {
    setWorkflowStatus(String(error && error.message || error), true);
  }
}
async function openWorkflowEdit(workflowId, loaded) {
  setWorkflowStatus("Opening the latest database version for editing…", false);
  try {
    var detail = loaded && loaded.id === workflowId
      ? loaded : await window.PlumblineData.admin.loadWorkflow(workflowId);
    ws_1.ingest(detail.workflow, "Maintenance workflow");
    var document = ws_1.D();
    document.name = detail.name || document.name;
    if (document.wf) document.wf.name = detail.name || document.wf.name;
    document.adminWorkflowEdit = {
      workflowId: detail.id,
      ownerUserId: detail.ownerUserId,
      ownerUsername: detail.ownerUsername || "user",
      versionNumber: detail.versionNumber
    };
    closeWorkflows();
    setStatus("Editing " + detail.name + " for @" + detail.ownerUsername +
      ". Save appends a synchronized database version.", false);
    if (routeContext) routeContext.navigate("/analysis");
  } catch (error) {
    setWorkflowStatus(String(error && error.message || error), true);
  }
}
async function openUserWorkflows(user) {
  state.workflowUser = user;
  state.workflows = [];
  state.selectedWorkflow = null;
  var modal = byId("maintenanceWorkflowModal");
  var title = byId("maintenanceWorkflowTitle");
  var subtitle = byId("maintenanceWorkflowSubtitle");
  if (title) title.textContent = (user.displayName || user.username || "User") + " workflows";
  if (subtitle) subtitle.textContent = "View the current database version or open an audited edit for @" +
    (user.username || "unknown") + ".";
  if (modal) modal.style.display = "flex";
  renderWorkflowList();
  renderWorkflowDetail(null);
  setWorkflowStatus("Loading workflows…", false);
  try {
    var result = await window.PlumblineData.admin.listUserWorkflows(user.id);
    state.workflows = Array.isArray(result && result.workflows) ? result.workflows : [];
    renderWorkflowList();
    setWorkflowStatus(state.workflows.length + " workflow" +
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
