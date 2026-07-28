/* Account/session service, auth gate, workflow account data, and settings. */
__PL.define("studio/shared/auth.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var dom_1 = require("studio/shared/dom.ts");
var ws_1  = require("studio/shared/workspace.ts");

var CTX = null;
var currentUser = null;
var guestMode = false;
var GUEST_SETTINGS_KEY = "plumbline_guest_settings";
var currentSettings = loadGuestSettings();
var accountWorkflows = [];
var accountHistory = [];
var profileSaveTimer = null;

function PData() { return window.PlumblineData; }
function loadGuestSettings() {
  try {
    var saved = JSON.parse(localStorage.getItem(GUEST_SETTINGS_KEY) || "{}");
    return { darkMode: !!saved.darkMode };
  } catch (e) { return { darkMode: false }; }
}
function saveGuestSettings(settings) {
  try { localStorage.setItem(GUEST_SETTINGS_KEY, JSON.stringify({ darkMode: !!settings.darkMode })); }
  catch (e) { }
}
function byId(id) { return document.getElementById(id); }
function authVal(id) { var n = byId(id); return n ? (n.value || "").trim() : ""; }
function authChecked(id) { var n = byId(id); return !!(n && n.checked); }
function blankProfile() { return { displayName: "", email: "", team: "", role: "", region: "" }; }
function profileFromInputs() {
  return {
    displayName: authVal("settings_displayName"),
    team: authVal("settings_team"),
    role: authVal("settings_role"),
    region: authVal("settings_region")
  };
}

function setMessage(id, message, isError) {
  var n = byId(id);
  if (!n) return;
  n.textContent = String(message || "");
  n.hidden = !message;
  n.classList.toggle("bad", !!isError);
}
function dataProblem(e, targetId) {
  setMessage(targetId || "authStatus", String((e && e.message) || e), true);
}

function hasAccess() { return guestMode || !!currentUser; }
function isGuest() { return guestMode && !currentUser; }
function isSuperuser() {
  return !!(currentUser && (currentUser.userType === "superuser" ||
    (currentUser.capabilities || []).indexOf("*") >= 0));
}

function broadcastAuthToEditor() {
  try {
    var f = byId("workflowEditorFrame");
    if (f && f.contentWindow) {
      f.contentWindow.postMessage({
        type: "plumbline-auth-state",
        user: currentUser ? (currentUser.displayName || currentUser.username || currentUser.email || "") : (guestMode ? "Guest" : ""),
        guest: guestMode,
        darkMode: !!currentSettings.darkMode
      }, "*");
    }
  } catch (e) { }
}
window.plumblineBroadcastAuth = broadcastAuthToEditor;

function applyTheme(darkMode) {
  currentSettings.darkMode = !!darkMode;
  document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  broadcastAuthToEditor();
}

function renderAccessState() {
  var unlocked = hasAccess();
  document.body.classList.toggle("appUnlocked", unlocked);
  document.body.classList.toggle("accountSession", !!currentUser);
  document.querySelectorAll("[data-protected-nav]").forEach(function (n) { n.hidden = !unlocked; });
  document.querySelectorAll("[data-account-only]").forEach(function (n) { n.hidden = !currentUser; });
  document.querySelectorAll("[data-anonymous-only]").forEach(function (n) { n.hidden = !!currentUser; });
  document.querySelectorAll("[data-signed-in-only]").forEach(function (n) { n.hidden = !currentUser; });
  document.querySelectorAll("[data-superuser-only]").forEach(function (n) { n.hidden = !isSuperuser(); });
  document.querySelectorAll("[data-session-badge]").forEach(function (n) { n.hidden = !unlocked; });
  var gate = byId("homeGate"), ready = byId("homeUnlocked");
  if (gate) gate.hidden = unlocked;
  if (ready) ready.hidden = !unlocked;

  var label = currentUser
    ? (currentUser.displayName || currentUser.username || currentUser.email)
    : (guestMode ? "Guest" : "not signed in");
  document.querySelectorAll(".navUserBadge").forEach(function (n) {
    n.textContent = label;
    n.classList.toggle("on", unlocked);
  });
  var b = byId("userBadge");
  if (b) { b.textContent = label; b.classList.toggle("on", unlocked); }
  broadcastAuthToEditor();
}
function renderUserBadge() { renderAccessState(); }

function logHistory(action, detail) {
  if (!currentUser) return;
  try { PData().appendHistory(action, { detail: detail }).catch(function () { }); }
  catch (e) { }
}

function showAuth(open, mode) {
  if (open === undefined) open = true;
  var m = byId("authModal");
  if (!m) return;
  m.style.display = open ? "flex" : "none";
  if (!open) return;
  var authMode = currentUser ? "account" : (mode === "signup" ? "signup" : "login");
  m.setAttribute("data-auth-mode", authMode);
  renderAuth(authMode);
  var focusId = mode === "signup" ? "signupEmail" : "authUser";
  var focusNode = byId(focusId);
  if (focusNode && !currentUser) setTimeout(function () { focusNode.focus(); }, 0);
}

async function refreshAccountData() {
  if (!currentUser) return;
  try {
    var values = await Promise.all([PData().listWorkflows(), PData().listHistory()]);
    accountWorkflows = Array.isArray(values[0]) ? values[0] : [];
    accountHistory = Array.isArray(values[1]) ? values[1] : [];
    paintAccountLists();
  } catch (e) { dataProblem(e); }
}

function paintAccountLists() {
  var saveBox = byId("savedList"), hist = byId("historyList");
  if (!saveBox || !hist) return;
  saveBox.innerHTML = "";
  if (!currentUser) {
    saveBox.append(dom_1.el("p", { class: "hint" }, "Sign in to see saved workflows."));
  } else if (!accountWorkflows.length) {
    saveBox.append(dom_1.el("p", { class: "hint" }, "No saved workflows yet."));
  } else {
    accountWorkflows.forEach(function (w) {
      var row = dom_1.el("div", { class: "saveditem" });
      var when = new Date(w.savedAt).toLocaleString();
      var tools = Array.isArray(w.tools) ? w.tools : [];
      row.append(dom_1.el("div", { class: "savedtitle" }, w.name + (w.versionNumber ? " · v" + w.versionNumber : "")));
      row.append(dom_1.el("div", { class: "saveddetail" }, when + " · tools: " + (tools.length ? tools.map(function (i) { return i + 1; }).join(", ") : "none")));
      row.append(dom_1.btn("Load", function () { loadSavedWorkflow(w.id); }, "btn tiny"));
      row.append(dom_1.btn("Delete", function () { deleteSavedWorkflow(w.id, w.name); }, "btn tiny ghost"));
      saveBox.append(row);
    });
  }
  hist.innerHTML = "";
  if (!currentUser) {
    hist.append(dom_1.el("p", { class: "hint" }, "History appears after sign-in."));
  } else if (!accountHistory.length) {
    hist.append(dom_1.el("p", { class: "hint" }, "No account activity yet."));
  } else {
    accountHistory.slice(0, 40).forEach(function (h) {
      var meta = h.meta || {}, detail = meta.detail || meta.name || "";
      hist.append(dom_1.el("div", { class: "histitem" }, dom_1.el("b", {}, h.action),
        (detail ? " — " + detail : "") + " · " + new Date(h.at).toLocaleString()));
    });
  }
}

function renderAuth(mode) {
  var title = byId("authTitle"), entry = byId("authEntryPanels"), account = byId("authAccountPanel");
  if (title) title.textContent = currentUser
    ? "Account — " + (currentUser.displayName || currentUser.username || currentUser.email)
    : (mode === "signup" ? "Welcome to Plumbline" : "Welcome back");
  if (entry) entry.hidden = !!currentUser;
  if (account) account.hidden = !currentUser;
  if (currentUser) {
    setMessage("authStatus", "Signed in. Workflows, history, and preferences are stored with your account.", false);
    refreshAccountData();
  } else {
    setMessage("authStatus", "", false);
    paintAccountLists();
  }
}

async function loadSignedInAccount() {
  currentUser = await PData().getProfile();
  var s = await PData().session();
  currentUser.userType = s.userType;
  currentUser.capabilities = s.capabilities || [];
  var saved = await PData().getSettings();
  currentSettings = Object.assign({ darkMode: false }, saved || {});
  guestMode = false;
  applyTheme(currentSettings.darkMode);
  renderAccessState();
}

async function createUser() {
  var email = authVal("signupEmail").toLowerCase();
  var username = authVal("signupUsername").toLowerCase();
  var pwNode = byId("signupPassword"), password = pwNode ? pwNode.value : "";
  if (!email || email.indexOf("@") <= 0 || !password) {
    setMessage("authStatus", "Email and password are required. Username is optional.", true);
    return;
  }
  try {
    await PData().signup({ email: email, username: username || null, password: password });
    await PData().login(email, password, true);
    await loadSignedInAccount();
    logHistory("login", "Created account");
    showAuth(false);
    if (CTX) CTX.navigate("/home");
  } catch (e) { dataProblem(e); }
}

async function signIn() {
  var username = authVal("authUser").toLowerCase(), pwNode = byId("authPass");
  var password = pwNode ? pwNode.value : "";
  if (!username || !password) {
    setMessage("authStatus", "Username or email and password are required.", true);
    return;
  }
  try {
    await PData().login(username, password, authChecked("authRemember"));
    await loadSignedInAccount();
    logHistory("login", "Signed in");
    showAuth(false);
    if (CTX) CTX.navigate("/home");
  } catch (e) { dataProblem(e); }
}

function enterGuest() {
  currentUser = null;
  guestMode = true;
  currentSettings = loadGuestSettings();
  applyTheme(currentSettings.darkMode);
  renderAccessState();
  showAuth(false);
  if (CTX) CTX.navigate("/editor");
}

async function signOut() {
  try { if (currentUser) await PData().logout(); } catch (e) { }
  currentUser = null;
  guestMode = false;
  accountWorkflows = [];
  accountHistory = [];
  currentSettings = loadGuestSettings();
  applyTheme(currentSettings.darkMode);
  showAuth(false);
  showSettings(false);
  renderAccessState();
  if (CTX) CTX.navigate("/home");
}

function renderSettings() {
  var username = byId("settingsUsername"), email = byId("settingsEmail"), dark = byId("settingsDarkMode"), eyebrow = byId("settingsEyebrow"), modal = byId("settingsModal");
  if (modal) modal.setAttribute("data-settings-scope", currentUser ? "account" : "local");
  document.querySelectorAll("[data-account-settings]").forEach(function (n) { n.hidden = !currentUser; });
  if (eyebrow) eyebrow.textContent = currentUser ? "Account" : (guestMode ? "Guest preferences" : "Local preferences");
  if (username) username.textContent = currentUser ? (currentUser.username || "Account") : (guestMode ? "Guest" : "Not signed in");
  if (email) email.textContent = currentUser ? (currentUser.email || "") : "Saved on this device";
  ["displayName", "team", "role", "region"].forEach(function (key) {
    var input = byId("settings_" + key);
    if (input) input.value = currentUser ? (currentUser[key] || "") : "";
  });
  if (dark) dark.checked = !!currentSettings.darkMode;
  setMessage("settingsStatus", currentUser
    ? "Changes to profile and appearance save to your account."
    : "Appearance changes are saved on this device.", false);
}

function showSettings(open) {
  if (open === undefined) open = true;
  var modal = byId("settingsModal");
  if (!modal) return;
  modal.style.display = open ? "flex" : "none";
  if (open) { showAuth(false); renderSettings(); }
}

async function updateProfile() {
  if (!currentUser) return;
  try {
    setMessage("settingsStatus", "Saving profile…", false);
    await PData().updateProfile(profileFromInputs());
    currentUser = Object.assign({}, currentUser, await PData().getProfile());
    logHistory("profile", "Updated demographics");
    renderAccessState();
    setMessage("settingsStatus", "Profile saved to your account.", false);
  } catch (e) { dataProblem(e, "settingsStatus"); }
}

function scheduleProfileSave() {
  if (!currentUser) return;
  clearTimeout(profileSaveTimer);
  setMessage("settingsStatus", "Saving profile…", false);
  profileSaveTimer = setTimeout(updateProfile, 350);
}

async function saveAppearance() {
  var toggle = byId("settingsDarkMode"), previous = !!currentSettings.darkMode;
  var darkMode = !!(toggle && toggle.checked);
  applyTheme(darkMode);
  if (!currentUser) {
    saveGuestSettings(currentSettings);
    setMessage("settingsStatus", "Appearance saved on this device.", false);
    return;
  }
  setMessage("settingsStatus", "Saving appearance…", false);
  try {
    var saved = await PData().updateSettings({ darkMode: darkMode });
    currentSettings = Object.assign({ darkMode: false }, saved || { darkMode: darkMode });
    applyTheme(currentSettings.darkMode);
    setMessage("settingsStatus", "Appearance saved to your account.", false);
  } catch (e) {
    applyTheme(previous);
    if (toggle) toggle.checked = previous;
    dataProblem(e, "settingsStatus");
  }
}

async function changePassword() {
  if (!currentUser) return;
  var cur = byId("settingsPwCurrent"), nw = byId("settingsPwNew");
  if (!cur || !nw || !cur.value || !nw.value) {
    setMessage("settingsStatus", "Enter the current and new passwords.", true);
    return;
  }
  try {
    await PData().changePassword(cur.value, nw.value);
    cur.value = ""; nw.value = "";
    logHistory("password", "Changed password");
    setMessage("settingsStatus", "Password changed. Other sessions and remembered logins were revoked.", false);
  } catch (e) { dataProblem(e, "settingsStatus"); }
}

async function restoreSession() {
  try {
    var s = await PData().session();
    if (s && s.signedIn) {
      await loadSignedInAccount();
      return true;
    }
  } catch (e) { }
  currentSettings = loadGuestSettings();
  applyTheme(currentSettings.darkMode);
  renderAccessState();
  return false;
}

async function saveCurrentWorkflow() {
  if (ws_1.getActive() < 0) { dom_1.flash("Open a workflow first."); return; }
  if (!currentUser) {
    if (guestMode) dom_1.flash("Guest workflows are not saved. Sign in to save this workflow.");
    else showAuth(true, "login");
    return;
  }
  var d = ws_1.D();
  if (!d) { dom_1.flash("The selected workflow is not available."); return; }
  var name = d.name || (d.wf && d.wf.name) || "Workflow";
  try {
    var adminAccess = d.adminWorkflowAccess || d.adminWorkflowEdit || d.adminWorkflowView;
    if (adminAccess && adminAccess.mode === "view") {
      dom_1.flash("This workflow is open in read-only mode. Return to Maintenance and choose Edit to make changes.");
      return;
    }
    if (adminAccess && isSuperuser()) {
      var adminEdit = adminAccess;
      var adminResult = await PData().admin.saveWorkflowVersion(adminEdit.workflowId, {
        workflow: ws_1.unified(d),
        config: {},
        toolsExecuted: ws_1.activeToolIndexes(d),
        layout: d.pos,
        label: "Edited in Maintenance by " + (currentUser.username || currentUser.email || "superuser")
      });
      adminEdit.versionNumber = adminResult.versionNumber;
      var adminBanner = byId("maintenanceEditBanner");
      if (adminBanner) adminBanner.textContent = "Editing @" + adminEdit.ownerUsername +
        " · Save creates database version " + ((Number(adminEdit.versionNumber) || 0) + 1);
      dom_1.flash("Saved v" + adminResult.versionNumber + " to @" + adminEdit.ownerUsername + "â€™s workflow.");
      logHistory("superuser-edit", "Updated â€œ" + name + "â€ for @" + adminEdit.ownerUsername);
      return;
    }
    var r = await PData().saveWorkflow({ name: name, workflow: ws_1.unified(d), config: {},
      toolsExecuted: ws_1.activeToolIndexes(d), layout: d.pos });
    dom_1.flash("Saved to database: " + name + (r && r.versionNumber ? " (v" + r.versionNumber + ")" : ""));
    logHistory("save", "Saved “" + name + "” with exact layout and tools");
    refreshAccountData();
  } catch (e) { dom_1.flash("Save failed: " + ((e && e.message) || e)); dataProblem(e); }
}

async function loadSavedWorkflow(id) {
  if (!currentUser) return;
  try {
    var rec = await PData().loadWorkflow(id);
    if (!rec) return;
    ws_1.ingest(rec.workflow, "Saved workflow");
    logHistory("load", "Loaded “" + rec.name + "” (v" + rec.versionNumber + ") from " + new Date(rec.savedAt).toLocaleString());
    showAuth(false);
  } catch (e) { dataProblem(e); }
}

async function deleteSavedWorkflow(id, name) {
  if (!currentUser) return;
  try {
    await PData().deleteWorkflow(id);
    logHistory("delete", "Deleted “" + (name || id) + "” (audited)");
    refreshAccountData();
  } catch (e) { dataProblem(e); }
}

exports.init = function (ctx) {
  CTX = ctx;
  function bind(id, fn) { var n = byId(id); if (n) n.addEventListener("click", fn); }
  bind("btnSignIn", signIn);
  bind("btnCreateUser", createUser);
  bind("btnSignOut", signOut);
  bind("btnChangePw", changePassword);
  bind("authClose", function () { showAuth(false); });
  bind("settingsClose", function () { showSettings(false); });
  bind("btnLogin", function () { showAuth(true, "login"); });
  document.querySelectorAll("[data-auth-mode]").forEach(function (n) {
    n.addEventListener("click", function () { showAuth(true, n.getAttribute("data-auth-mode") || "login"); });
  });
  document.querySelectorAll("[data-signout]").forEach(function (n) {
    n.addEventListener("click", signOut);
  });
  document.querySelectorAll("[data-settings]").forEach(function (n) {
    n.addEventListener("click", function () { showSettings(true); });
  });
  ["settings_displayName", "settings_team", "settings_role", "settings_region"].forEach(function (id) {
    var n = byId(id); if (n) n.addEventListener("change", scheduleProfileSave);
  });
  var dark = byId("settingsDarkMode");
  if (dark) dark.addEventListener("change", saveAppearance);
  ["authUser", "authPass"].forEach(function (id) {
    var n = byId(id); if (n) n.addEventListener("keydown", function (e) { if (e.key === "Enter") signIn(); });
  });
  ["signupEmail", "signupUsername", "signupPassword"].forEach(function (id) {
    var n = byId(id); if (n) n.addEventListener("keydown", function (e) { if (e.key === "Enter") createUser(); });
  });
  window.plumblineShowAuth = function (open, mode) { showAuth(open !== false, mode); };
  window.plumblineBroadcastAuth = broadcastAuthToEditor;
  currentSettings = loadGuestSettings();
  applyTheme(currentSettings.darkMode);
  renderAccessState();
};

exports.currentUser = function () { return currentUser; };
exports.hasAccess = hasAccess;
exports.isGuest = isGuest;
exports.isSuperuser = isSuperuser;
exports.enterGuest = enterGuest;
exports.PData = PData;
exports.dataProblem = dataProblem;
exports.authVal = authVal;
exports.authChecked = authChecked;
exports.blankProfile = blankProfile;
exports.profileFromInputs = profileFromInputs;
exports.broadcastAuthToEditor = broadcastAuthToEditor;
exports.logHistory = logHistory;
exports.renderUserBadge = renderUserBadge;
exports.renderAccessState = renderAccessState;
exports.showAuth = showAuth;
exports.showSettings = showSettings;
exports.refreshAccountData = refreshAccountData;
exports.paintAccountLists = paintAccountLists;
exports.renderAuth = renderAuth;
exports.createUser = createUser;
exports.signIn = signIn;
exports.signOut = signOut;
exports.changePassword = changePassword;
exports.restoreSession = restoreSession;
exports.saveCurrentWorkflow = saveCurrentWorkflow;
exports.loadSavedWorkflow = loadSavedWorkflow;
exports.deleteSavedWorkflow = deleteSavedWorkflow;
exports.updateProfile = updateProfile;
exports.applyTheme = applyTheme;

});
