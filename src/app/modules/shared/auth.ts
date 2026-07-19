/* ============================================================================
 * studio/shared/auth.ts — session, account modal, saved workflows, history
 * ----------------------------------------------------------------------------
 * Phase 1, step 3. Declarations MOVED VERBATIM from studio/main.ts
 * (ui-modules.gen.js at commit 462ebb7); original line ranges noted above each.
 * Only two kinds of edit were made:
 *   - references to dom/workspace helpers were prefixed dom_1. / ws_1.
 *   - `active` became ws_1.getActive()
 *
 * Auth is a SERVICE, not a screen. Its markup (#authModal) lives in shell.html
 * outside the router outlet, because it is opened from Home, from the Studio
 * toolbar, and from the editor iframe by postMessage. No module owns it.
 *
 * KNOWN DEFECT, DELIBERATELY PRESERVED: signIn() and createUser() lowercase
 * the username before sending it, while the server matches exactly. An account
 * created in SQL with a capital letter can never sign in. This is moved
 * unchanged - fixing it inside a refactor would make the refactor unreviewable.
 * Track it separately.
 * ==========================================================================*/
__PL.define("studio/shared/auth.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var dom_1 = require("studio/shared/dom.ts");
var ws_1  = require("studio/shared/workspace.ts");

/* Injected by init(); avoids reading window.PlumblineData from module code. */
var CTX = null;



/* main.ts:21-21 */
let currentUser = null;

/* main.ts:1951-1951 */
let accountWorkflows = [];   // list cache for the account modal

/* main.ts:1952-1952 */
let accountHistory = [];     // history cache for the account modal

/* main.ts:1950-1950 */
function PData() { return window.PlumblineData; }

/* main.ts:1953-1957 */
function dataProblem(e) {
    const status = document.getElementById("authStatus");
    if (status)
        status.textContent = String((e && e.message) || e);
}

/* main.ts:1958-1958 */
function authVal(id) { return (dom_1.$((id)).value || "").trim(); }

/* main.ts:1959-1959 */
function authChecked(id) { return !!(dom_1.$((id)).checked); }

/* main.ts:1960-1960 */
function blankProfile() { return { displayName: "", email: "", team: "", role: "", region: "" }; }

/* main.ts:1961-1961 */
function profileFromInputs() { return { displayName: authVal("prof_displayName"), email: authVal("prof_email"), team: authVal("prof_team"), role: authVal("prof_role"), region: authVal("prof_region") }; }

/* main.ts:1962-1971 */
function broadcastAuthToEditor() {
    try {
        const f = document.getElementById("workflowEditorFrame");
        if (f && f.contentWindow)
            f.contentWindow.postMessage({ type: "plumbline-auth-state",
                user: currentUser ? (currentUser.displayName || currentUser.username || currentUser.email || "") : "" }, "*");
    }
    catch (e) { }
}
window.plumblineBroadcastAuth = broadcastAuthToEditor;

/* main.ts:1972-1978 */
function logHistory(action, detail) {
    if (!currentUser)
        return;
    // Fire-and-forget append to the database's activity_log.
    try { PData().appendHistory(action, { detail }).catch(() => { }); }
    catch (e) { }
}

/* main.ts:1979-1996 */
function renderUserBadge() {
    const label = currentUser ? (currentUser.displayName || currentUser.username || currentUser.email) : "not signed in";
    const b = document.getElementById("userBadge");
    if (b) {
        b.textContent = label;
        b.classList.toggle("on", !!currentUser);
    }
    // Logged-in name in the upper right of the Editor and Analysis pages.
    document.querySelectorAll(".navUserBadge").forEach(n => {
        n.textContent = label;
        n.classList.toggle("on", !!currentUser);
    });
    // Landing page: superusers get a Maintenance button (stub for now).
    const maint = document.getElementById("homeMaintenance");
    if (maint)
        maint.style.display = (currentUser && String(currentUser.userType || "").toLowerCase() === "superuser") ? "" : "none";
    broadcastAuthToEditor();
}

/* main.ts:1997-1998 */
function showAuth(open = true) { const m = dom_1.$("authModal"); m.style.display = open ? "flex" : "none"; if (open)
    renderAuth(); }

/* main.ts:1999-2009 */
async function refreshAccountData() {
    if (!currentUser)
        return;
    try {
        const [wfs, hist] = await Promise.all([PData().listWorkflows(), PData().listHistory()]);
        accountWorkflows = Array.isArray(wfs) ? wfs : [];
        accountHistory = Array.isArray(hist) ? hist : [];
        paintAccountLists();
    }
    catch (e) { dataProblem(e); }
}

/* main.ts:2010-2027 */
function paintAccountLists() {
    const saveBox = dom_1.$("savedList");
    saveBox.innerHTML = "";
    if (!currentUser) {
        saveBox.append(dom_1.el("p", { class: "hint" }, "Sign in to see saved workflows."));
    }
    else if (!accountWorkflows.length) {
        saveBox.append(dom_1.el("p", { class: "hint" }, "No saved workflows yet. Use Save workflow while signed in."));
    }
    else
        accountWorkflows.forEach(w => { const row = dom_1.el("div", { class: "saveditem" }); const when = new Date(w.savedAt).toLocaleString(); const tools = Array.isArray(w.tools) ? w.tools : []; row.append(dom_1.el("div", { class: "savedtitle" }, w.name + (w.versionNumber ? "  ·  v" + w.versionNumber : ""))); row.append(dom_1.el("div", { class: "saveddetail" }, when + " · tools: " + (tools.length ? tools.map(i => i + 1).join(", ") : "none"))); const load = dom_1.btn("Load", () => loadSavedWorkflow(w.id), "btn tiny"); row.append(load); const del = dom_1.btn("Delete", () => deleteSavedWorkflow(w.id, w.name), "btn tiny ghost"); row.append(del); saveBox.append(row); });
    const hist = dom_1.$("historyList");
    hist.innerHTML = "";
    if (!currentUser)
        hist.append(dom_1.el("p", { class: "hint" }, "History appears after sign-in."));
    else
        accountHistory.slice(0, 40).forEach(h => { const meta = h.meta || {}; const detail = meta.detail || meta.name || ""; const row = dom_1.el("div", { class: "histitem" }, dom_1.el("b", {}, h.action), (detail ? " — " + detail : "") + " · " + new Date(h.at).toLocaleString()); hist.append(row); });
}

/* main.ts:2028-2048 */
function renderAuth() {
    const title = dom_1.$("authTitle");
    title.textContent = currentUser ? "Account — " + (currentUser.displayName || currentUser.username || currentUser.email) : "Sign in or create user";
    const status = dom_1.$("authStatus");
    if (!status.textContent)
        status.textContent = currentUser
            ? "Signed in. Your account, workflows, and history live in the Plumbline database."
            : "Sign in to the Plumbline database, or create an account (passwords are bcrypt-hashed server-side).";
    const rememberLogin = document.querySelector(".authremember");
    if (rememberLogin)
        rememberLogin.style.display = currentUser ? "none" : "inline-flex";
    const pwRow = document.getElementById("authPwChange");
    if (pwRow)
        pwRow.style.display = currentUser ? "" : "none";
    const p = currentUser || blankProfile();
    ["displayName", "email", "team", "role", "region"].forEach(k => { const input = document.getElementById("prof_" + k); if (input)
        input.value = p[k] || ""; });
    paintAccountLists();
    if (currentUser)
        refreshAccountData();
}

/* main.ts:2049-2071 */
async function createUser() {
    const username = authVal("authUser").toLowerCase(), pw = dom_1.$(("authPass")).value;
    if (!username || !pw) {
        dom_1.$("authStatus").textContent = "Username and password are required.";
        return;
    }
    try {
        const prof = profileFromInputs();
        const isEmail = username.indexOf("@") >= 0;
        await PData().signup({ username: isEmail ? null : username, email: isEmail ? username : (prof.email || null),
            password: pw, displayName: prof.displayName, team: prof.team, role: prof.role, region: prof.region });
        await PData().login(username, pw, authChecked("authRemember"));
        currentUser = await PData().getProfile();
        const s = await PData().session();
        currentUser.userType = s.userType;
        currentUser.capabilities = s.capabilities || [];
        dom_1.$("authStatus").textContent = "Created and signed in — account stored in the Plumbline database.";
        logHistory("login", "Created account");
        renderAuth();
        renderUserBadge();
    }
    catch (e) { dataProblem(e); }
}

/* main.ts:2072-2086 */
async function signIn() {
    const username = authVal("authUser").toLowerCase(), pw = dom_1.$(("authPass")).value;
    try {
        await PData().login(username, pw, authChecked("authRemember"));
        currentUser = await PData().getProfile();
        const s = await PData().session();
        currentUser.userType = s.userType;
        currentUser.capabilities = s.capabilities || [];
        dom_1.$("authStatus").textContent = "Signed in.";
        logHistory("login", "Signed in");
        renderAuth();
        renderUserBadge();
    }
    catch (e) { dataProblem(e); }
}

/* main.ts:2087-2099 */
async function signOut() {
    try {
        if (currentUser)
            await PData().logout();
    }
    catch (e) { }
    currentUser = null;
    accountWorkflows = [];
    accountHistory = [];
    dom_1.$("authStatus").textContent = "Signed out.";
    renderAuth();
    renderUserBadge();
}

/* main.ts:2100-2115 */
async function changePassword() {
    const cur = document.getElementById("authPwCurrent"), nw = document.getElementById("authPwNew");
    if (!cur || !nw)
        return;
    if (!currentUser) {
        dom_1.$("authStatus").textContent = "Sign in before changing the password.";
        return;
    }
    try {
        await PData().changePassword(cur.value, nw.value);
        cur.value = ""; nw.value = "";
        dom_1.$("authStatus").textContent = "Password changed. Every other session and remembered login was revoked (audited in the database).";
        logHistory("password", "Changed password");
    }
    catch (e) { dataProblem(e); }
}

/* main.ts:2116-2127 */
async function restoreSession() {
    try {
        const s = await PData().session();
        if (!s || !s.signedIn)
            return;
        currentUser = await PData().getProfile();
        currentUser.userType = s.userType;
        currentUser.capabilities = s.capabilities || [];
        renderUserBadge();
    }
    catch (e) { /* database unreachable or signed out — badge stays "not signed in" */ }
}

/* main.ts:2128-2151 */
async function saveCurrentWorkflow() {
    if (ws_1.getActive() < 0) {
        dom_1.flash("Open a workflow first.");
        return;
    }
    if (!currentUser) {
        showAuth(true);
        dom_1.$("authStatus").textContent = "Sign in first, then save the workflow.";
        return;
    }
    const d = ws_1.D();
    const name = d.name || d.wf.name || "Workflow";
    try {
        const r = await PData().saveWorkflow({ name, workflow: ws_1.unified(d), config: {},
            toolsExecuted: ws_1.activeToolIndexes(d), layout: d.pos });
        dom_1.flash("Saved to database: " + name + (r && r.versionNumber ? "  (v" + r.versionNumber + ")" : ""));
        logHistory("save", "Saved \u201C" + name + "\u201D with exact layout and tools");
        refreshAccountData();
    }
    catch (e) {
        dom_1.flash("Save failed: " + ((e && e.message) || e));
        dataProblem(e);
    }
}

/* main.ts:2152-2164 */
async function loadSavedWorkflow(id) {
    if (!currentUser)
        return;
    try {
        const rec = await PData().loadWorkflow(id);
        if (!rec)
            return;
        ws_1.ingest(rec.workflow, "Saved workflow");
        logHistory("load", "Loaded \u201C" + rec.name + "\u201D (v" + rec.versionNumber + ") from " + new Date(rec.savedAt).toLocaleString());
        showAuth(false);
    }
    catch (e) { dataProblem(e); }
}

/* main.ts:2165-2174 */
async function deleteSavedWorkflow(id, name) {
    if (!currentUser)
        return;
    try {
        await PData().deleteWorkflow(id);
        logHistory("delete", "Deleted \u201C" + (name || id) + "\u201D (audited)");
        refreshAccountData();
    }
    catch (e) { dataProblem(e); }
}

/* main.ts:2175-2189 */
async function updateProfile() {
    if (!currentUser) {
        dom_1.$("authStatus").textContent = "Sign in before updating demographics.";
        return;
    }
    try {
        await PData().updateProfile(profileFromInputs());
        currentUser = Object.assign({}, currentUser, await PData().getProfile());
        logHistory("profile", "Updated demographics");
        dom_1.$("authStatus").textContent = "Demographics updated in the database.";
        renderUserBadge();
    }
    catch (e) { dataProblem(e); }
}
/* ---------- top workflow bar ---------- */


/* ---------------------------------------------------------------------------
 * init(ctx) — called ONCE by ui-boot.js, before the router starts.
 * Wires the modal's own controls. These live outside the outlet and are never
 * torn down, so they are bound once rather than per-mount.
 * -------------------------------------------------------------------------*/
exports.init = function (ctx) {
  CTX = ctx;
  var bind = function (id, fn) {
    var n = document.getElementById(id);
    if (n) n.addEventListener("click", fn);
  };
  bind("btnSignIn",       function () { signIn(); });
  bind("btnCreateUser",   function () { createUser(); });
  bind("btnSignOut",      signOut);
  bind("btnUpdateProfile", updateProfile);
  bind("btnChangePw",     changePassword);
  bind("authClose",       function () { showAuth(false); });
  bind("btnSavedWorkflows", function () { showAuth(true); });
  bind("btnLogin",        function () { showAuth(true); });

  /* C2: the editor iframe calls this by name at any time. */
  window.plumblineShowAuth = function (open) { return showAuth(open !== false); };
  window.plumblineBroadcastAuth = broadcastAuthToEditor;
};

exports.currentUser = function () { return currentUser; };

/* ---- exports ---- */
exports["PData"] = PData;
exports["dataProblem"] = dataProblem;
exports["authVal"] = authVal;
exports["authChecked"] = authChecked;
exports["blankProfile"] = blankProfile;
exports["profileFromInputs"] = profileFromInputs;
exports["broadcastAuthToEditor"] = broadcastAuthToEditor;
exports["logHistory"] = logHistory;
exports["renderUserBadge"] = renderUserBadge;
exports["showAuth"] = showAuth;
exports["refreshAccountData"] = refreshAccountData;
exports["paintAccountLists"] = paintAccountLists;
exports["renderAuth"] = renderAuth;
exports["createUser"] = createUser;
exports["signIn"] = signIn;
exports["signOut"] = signOut;
exports["changePassword"] = changePassword;
exports["restoreSession"] = restoreSession;
exports["saveCurrentWorkflow"] = saveCurrentWorkflow;
exports["loadSavedWorkflow"] = loadSavedWorkflow;
exports["deleteSavedWorkflow"] = deleteSavedWorkflow;
exports["updateProfile"] = updateProfile;

});

