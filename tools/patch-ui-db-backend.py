#!/usr/bin/env python3
"""Rewire the Studio UI's account/persistence section onto window.PlumblineData.

Replaces the '/* ---------- local account database + saved workflows ---------- */'
block of src/app/ui-modules.gen.js (localStorage users, PBKDF2 hashes, cookies,
in-browser saved workflows and history) with implementations that call the
data gateway — so accounts, sessions, saved workflow versions, demographics
and history all live in the Plumbline PostgreSQL database.

Every public function name and signature used elsewhere in the module is kept:
  renderUserBadge · showAuth · renderAuth · createUser · signIn · signOut ·
  restoreSession · saveCurrentWorkflow · loadSavedWorkflow · updateProfile ·
  logHistory · blankProfile · profileFromInputs · authVal · authChecked
"""
import io, re, sys

PATH = "src/app/ui-modules.gen.js"
src = io.open(PATH, encoding="utf-8").read()

START = "/* ---------- local account database + saved workflows ---------- */"
END = "/* ---------- top workflow bar ---------- */"
i, j = src.index(START), src.index(END)

NEW = r'''/* ---------- database-backed accounts + saved workflows (PlumblineData) ----------
 * Persistent state lives in the Plumbline PostgreSQL database (Supabase),
 * reached through window.PlumblineData → the Plumbline API (server/).
 * The browser keeps NO account data: passwords are bcrypt-hashed in the
 * users table, the session is an httpOnly cookie, saved workflows are
 * immutable workflow_version rows (also decomposed into normalized FSM
 * tables server-side), and history is the activity_log table. */
function PData() { return window.PlumblineData; }
let accountWorkflows = [];   // list cache for the account modal
let accountHistory = [];     // history cache for the account modal
function dataProblem(e) {
    const status = document.getElementById("authStatus");
    if (status)
        status.textContent = String((e && e.message) || e);
}
function authVal(id) { return ($((id)).value || "").trim(); }
function authChecked(id) { return !!($((id)).checked); }
function blankProfile() { return { displayName: "", email: "", team: "", role: "", region: "" }; }
function profileFromInputs() { return { displayName: authVal("prof_displayName"), email: authVal("prof_email"), team: authVal("prof_team"), role: authVal("prof_role"), region: authVal("prof_region") }; }
function broadcastAuthToEditor() {
    try {
        const f = document.getElementById("workflowEditorFrame");
        if (f && f.contentWindow)
            f.contentWindow.postMessage({ type: "plumbline-auth-state",
                user: currentUser ? (currentUser.displayName || currentUser.username || currentUser.email || "") : "" }, "*");
    }
    catch (e) { }
}
function logHistory(action, detail) {
    if (!currentUser)
        return;
    // Fire-and-forget append to the database's activity_log.
    try { PData().appendHistory(action, { detail }).catch(() => { }); }
    catch (e) { }
}
function renderUserBadge() {
    const b = document.getElementById("userBadge");
    if (b) {
        b.textContent = currentUser ? (currentUser.displayName || currentUser.username || currentUser.email) : "not signed in";
        b.classList.toggle("on", !!currentUser);
    }
    broadcastAuthToEditor();
}
function showAuth(open = true) { const m = $("authModal"); m.style.display = open ? "flex" : "none"; if (open)
    renderAuth(); }
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
function paintAccountLists() {
    const saveBox = $("savedList");
    saveBox.innerHTML = "";
    if (!currentUser) {
        saveBox.append(el("p", { class: "hint" }, "Sign in to see saved workflows."));
    }
    else if (!accountWorkflows.length) {
        saveBox.append(el("p", { class: "hint" }, "No saved workflows yet. Use Save workflow while signed in."));
    }
    else
        accountWorkflows.forEach(w => { const row = el("div", { class: "saveditem" }); const when = new Date(w.savedAt).toLocaleString(); const tools = Array.isArray(w.tools) ? w.tools : []; row.append(el("div", { class: "savedtitle" }, w.name + (w.versionNumber ? "  ·  v" + w.versionNumber : ""))); row.append(el("div", { class: "saveddetail" }, when + " · tools: " + (tools.length ? tools.map(i => i + 1).join(", ") : "none"))); const load = btn("Load", () => loadSavedWorkflow(w.id), "btn tiny"); row.append(load); const del = btn("Delete", () => deleteSavedWorkflow(w.id, w.name), "btn tiny ghost"); row.append(del); saveBox.append(row); });
    const hist = $("historyList");
    hist.innerHTML = "";
    if (!currentUser)
        hist.append(el("p", { class: "hint" }, "History appears after sign-in."));
    else
        accountHistory.slice(0, 40).forEach(h => { const meta = h.meta || {}; const detail = meta.detail || meta.name || ""; const row = el("div", { class: "histitem" }, el("b", {}, h.action), (detail ? " — " + detail : "") + " · " + new Date(h.at).toLocaleString()); hist.append(row); });
}
function renderAuth() {
    const title = $("authTitle");
    title.textContent = currentUser ? "Account — " + (currentUser.displayName || currentUser.username || currentUser.email) : "Sign in or create user";
    const status = $("authStatus");
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
async function createUser() {
    const username = authVal("authUser").toLowerCase(), pw = $(("authPass")).value;
    if (!username || !pw) {
        $("authStatus").textContent = "Username and password are required.";
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
        $("authStatus").textContent = "Created and signed in — account stored in the Plumbline database.";
        logHistory("login", "Created account");
        renderAuth();
        renderUserBadge();
    }
    catch (e) { dataProblem(e); }
}
async function signIn() {
    const username = authVal("authUser").toLowerCase(), pw = $(("authPass")).value;
    try {
        await PData().login(username, pw, authChecked("authRemember"));
        currentUser = await PData().getProfile();
        const s = await PData().session();
        currentUser.userType = s.userType;
        currentUser.capabilities = s.capabilities || [];
        $("authStatus").textContent = "Signed in.";
        logHistory("login", "Signed in");
        renderAuth();
        renderUserBadge();
    }
    catch (e) { dataProblem(e); }
}
async function signOut() {
    try {
        if (currentUser)
            await PData().logout();
    }
    catch (e) { }
    currentUser = null;
    accountWorkflows = [];
    accountHistory = [];
    $("authStatus").textContent = "Signed out.";
    renderAuth();
    renderUserBadge();
}
async function changePassword() {
    const cur = document.getElementById("authPwCurrent"), nw = document.getElementById("authPwNew");
    if (!cur || !nw)
        return;
    if (!currentUser) {
        $("authStatus").textContent = "Sign in before changing the password.";
        return;
    }
    try {
        await PData().changePassword(cur.value, nw.value);
        cur.value = ""; nw.value = "";
        $("authStatus").textContent = "Password changed. Every other session and remembered login was revoked (audited in the database).";
        logHistory("password", "Changed password");
    }
    catch (e) { dataProblem(e); }
}
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
async function saveCurrentWorkflow() {
    if (active < 0) {
        flash("Open a workflow first.");
        return;
    }
    if (!currentUser) {
        showAuth(true);
        $("authStatus").textContent = "Sign in first, then save the workflow.";
        return;
    }
    const d = D();
    const name = d.name || d.wf.name || "Workflow";
    try {
        const r = await PData().saveWorkflow({ name, workflow: unified(d), config: {},
            toolsExecuted: activeToolIndexes(d), layout: d.pos });
        flash("Saved to database: " + name + (r && r.versionNumber ? "  (v" + r.versionNumber + ")" : ""));
        logHistory("save", "Saved \u201C" + name + "\u201D with exact layout and tools");
        refreshAccountData();
    }
    catch (e) {
        flash("Save failed: " + ((e && e.message) || e));
        dataProblem(e);
    }
}
async function loadSavedWorkflow(id) {
    if (!currentUser)
        return;
    try {
        const rec = await PData().loadWorkflow(id);
        if (!rec)
            return;
        ingest(rec.workflow, "Saved workflow");
        logHistory("load", "Loaded \u201C" + rec.name + "\u201D (v" + rec.versionNumber + ") from " + new Date(rec.savedAt).toLocaleString());
        showAuth(false);
    }
    catch (e) { dataProblem(e); }
}
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
async function updateProfile() {
    if (!currentUser) {
        $("authStatus").textContent = "Sign in before updating demographics.";
        return;
    }
    try {
        await PData().updateProfile(profileFromInputs());
        currentUser = Object.assign({}, currentUser, await PData().getProfile());
        logHistory("profile", "Updated demographics");
        $("authStatus").textContent = "Demographics updated in the database.";
        renderUserBadge();
    }
    catch (e) { dataProblem(e); }
}
'''

src = src[:i] + NEW + src[j:]

# ---- init(): wire the change-password button (element added to shell.html) --
anchor = '$("btnUpdateProfile").addEventListener("click", updateProfile);'
assert anchor in src
src = src.replace(anchor, anchor +
    '\n    { const pwb = document.getElementById("btnChangePw"); if (pwb) pwb.addEventListener("click", changePassword); }', 1)

# ---- neutralize the studio-state localStorage remember toggle (view pref of a
#      feature that is already disabled; keeps the module localStorage-free) --
src = src.replace(
    '''rem.addEventListener("change", () => { try {
                localStorage.setItem("plumbline_remember", rem.checked ? "1" : "0");
            }
            catch (e) { } if (rem.checked)
                persist();
            else {
                try {
                    localStorage.removeItem("plumbline_studio_v1");
                }
                catch (e) { }
            } });''',
    'rem.addEventListener("change", () => { /* workspace state is not persisted in the browser; workflows are saved to the database */ });', 1)

# ---- persist()/restoreState(): drop the legacy localStorage plumbing --------
src = src.replace(
    '''function persist() { if (!remembering())
    return; try {
    localStorage.setItem("plumbline_studio_v1", JSON.stringify({ v: 2, active, panelHidden, docs: docs.map(plainDoc) }));
}
catch (e) { } }
function restoreState() { try {
    localStorage.removeItem("plumbline_remember");
    localStorage.removeItem("plumbline_studio_v1");
}
catch (e) { } }''',
    '''function persist() { /* workspace view state is ephemeral; saved workflows live in the database */ }
function restoreState() { try {
    // one-time cleanup of pre-database browser storage
    ["plumbline_remember", "plumbline_studio_v1", USER_DB_KEY, SESSION_KEY].forEach(k => localStorage.removeItem(k));
}
catch (e) { } }''', 1)

io.open(PATH, "w", encoding="utf-8").write(src)

# ---- sanity: no localStorage writes of account data remain ------------------
left = [l for l in src.splitlines() if "localStorage.setItem" in l]
print("remaining localStorage.setItem lines:", len(left))
for l in left: print("  ", l.strip()[:100])
print("patched OK")
