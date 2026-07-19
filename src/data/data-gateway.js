/* ============================================================================
 * Plumbline — Data interaction layer (window.PlumblineData)
 * ----------------------------------------------------------------------------
 * The ONLY channel through which the UI reads or writes persistent state.
 * The presentation layer never touches localStorage, fetch, or SQL directly —
 * it calls this gateway.
 *
 * Plumbline is DATABASE-BACKED: every account, session, saved workflow
 * version, folder, analysis run, and history event lives in the Plumbline
 * PostgreSQL database (Supabase), reached through the Plumbline API
 * (server/) over REST with httpOnly session cookies. There is no
 * browser-storage fallback — if the API is unreachable the gateway reports
 * it honestly instead of silently keeping data in the browser.
 *
 * Persistence model (production schema 002 + patch 003):
 *   users(bcrypt password) · demographics/profile · workflow FOLDERS
 *   (recursive groups) · workflows with IMMUTABLE VERSIONS (name, datetime,
 *   EXACT config, tools executed, tile positions — and the snapshot is also
 *   decomposed server-side into normalized process/stage/state/transition/
 *   dependency/cost rows) · analysis lineage (runs + certified findings) ·
 *   per-user online history · capabilities / superuser · append-only audit.
 *
 * Every method returns a Promise and resolves to plain data (or throws an
 * Error with a human message).
 * ==========================================================================*/
window.PlumblineData = (function () {
  "use strict";

  var base = (window.PLUMBLINE_API || "").replace(/\/$/, "");
  var lastHealth = null;

  async function api(path, opts) {
    opts = opts || {};
    var res;
    try {
      res = await fetch(base + path, {
        method: opts.method || "GET",
        credentials: "include",
        headers: opts.body ? { "Content-Type": "application/json" } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      throw new Error("Plumbline database is unreachable" +
        (base ? " at " + base : "") +
        ". Start the Plumbline API (server/) or set window.PLUMBLINE_API to its URL.");
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  }

  var gateway = {
    /* ---- configuration ---------------------------------------------------- */
    // configure({ baseUrl: 'https://api.example.com' }) — points the gateway
    // at the Plumbline API. (mode is always 'remote': the database IS the app's
    // memory; a 'local' request is accepted but ignored for compatibility.)
    configure: function (opts) {
      opts = opts || {};
      if (typeof opts.baseUrl === "string") base = opts.baseUrl.replace(/\/$/, "");
      return gateway;
    },
    mode: function () { return "remote"; },
    baseUrl: function () { return base; },
    // Verifies the API/database is reachable. Resolves "remote" on success,
    // "offline" when unreachable (callers can surface that to the user).
    autodetect: async function (baseUrl) {
      if (typeof baseUrl === "string") base = baseUrl.replace(/\/$/, "");
      try {
        lastHealth = await api("/api/health");
        return lastHealth && lastHealth.ok ? "remote" : "offline";
      } catch (e) { lastHealth = null; return "offline"; }
    },
    health: function () { return api("/api/health"); },
    lastHealth: function () { return lastHealth; },

    /* ---- auth (bcrypt in the DB; httpOnly cookie sessions; remember
     *      tokens are hashed in remember_tokens; §3.1 password flow is
     *      atomic in the database via admin_reset_password) ----------------- */
    signup: function (profile) { return api("/api/signup", { method: "POST", body: profile }); },
    login: function (u, p, remember) {
      return api("/api/login", { method: "POST",
        body: { usernameOrEmail: u, password: p, remember: !!remember } });
    },
    logout: function () { return api("/api/logout", { method: "POST" }); },
    session: function () { return api("/api/session"); },
    changePassword: function (currentPassword, newPassword) {
      return api("/api/password", { method: "POST",
        body: { currentPassword: currentPassword, newPassword: newPassword } });
    },

    /* ---- profile / demographics ------------------------------------------- */
    getProfile: function () { return api("/api/profile"); },
    updateProfile: function (dm) { return api("/api/profile", { method: "POST", body: dm }); },

    /* ---- workflow folders (recursive groups) -------------------------------- */
    listGroups: function () { return api("/api/groups"); },
    createGroup: function (name, parentGroupId, description) {
      return api("/api/groups", { method: "POST",
        body: { name: name, parentGroupId: parentGroupId || null, description: description || null } });
    },
    updateGroup: function (groupId, patch) {
      return api("/api/groups/" + encodeURIComponent(groupId), { method: "PATCH", body: patch || {} });
    },
    deleteGroup: function (groupId) {
      return api("/api/groups/" + encodeURIComponent(groupId), { method: "DELETE" });
    },

    /* ---- saved workflows: immutable versions --------------------------------
     * saveWorkflow({ name, workflow, config, toolsExecuted, layout, groupId })
     *   → first save of a name creates the workflow + its ORIGINAL version;
     *     saving the same name again appends the next EDIT/ANALYSIS version.
     * loadWorkflow(id)        → the CURRENT version of workflow id.
     * loadVersion(versionId)  → one specific immutable version.
     * listVersions(id)        → the workflow's full version history.          */
    listWorkflows: function () { return api("/api/workflows"); },
    saveWorkflow: function (snap) { return api("/api/workflows", { method: "POST", body: snap }); },
    loadWorkflow: function (id) { return api("/api/workflows/" + encodeURIComponent(id)); },
    deleteWorkflow: function (id) {
      return api("/api/workflows/" + encodeURIComponent(id), { method: "DELETE" });
    },
    saveVersion: function (workflowId, body) {
      return api("/api/v2/workflows/" + encodeURIComponent(workflowId) + "/versions",
        { method: "POST", body: body || {} });
    },
    listVersions: async function (workflowId) {
      var w = await api("/api/v2/workflows/" + encodeURIComponent(workflowId));
      return w.versions || [];
    },
    loadVersion: function (versionId) {
      return api("/api/v2/versions/" + encodeURIComponent(versionId));
    },
    updateWorkflow: function (workflowId, patch) {
      return api("/api/v2/workflows/" + encodeURIComponent(workflowId),
        { method: "PATCH", body: patch || {} });
    },

    /* ---- analysis lineage ------------------------------------------------------ */
    startAnalysis: function (versionId, engineVersion) {
      return api("/api/v2/versions/" + encodeURIComponent(versionId) + "/analyses",
        { method: "POST", body: { engineVersion: engineVersion || null } });
    },
    finishAnalysis: function (runId, result) {
      return api("/api/v2/analyses/" + encodeURIComponent(runId),
        { method: "PATCH", body: result || { status: "DONE" } });
    },
    listAnalyses: function (versionId) {
      return api("/api/v2/versions/" + encodeURIComponent(versionId) + "/analyses");
    },

    /* ---- online history (activity_log) ------------------------------------------ */
    appendHistory: function (a, m) {
      return api("/api/history", { method: "POST", body: { action: a, meta: m } });
    },
    listHistory: function () { return api("/api/history"); },

    /* ---- superuser maintenance ("see everything BUT passwords") ------------------ */
    admin: {
      listUsers: function () { return api("/api/admin/users"); },
      resetPassword: function (userId, newPassword) {
        return api("/api/admin/users/" + encodeURIComponent(userId) + "/password",
          { method: "POST", body: { newPassword: newPassword } });
      },
      revokeSessions: function (userId) {
        return api("/api/admin/users/" + encodeURIComponent(userId) + "/revoke-sessions",
          { method: "POST", body: {} });
      },
      setActive: function (userId, isActive) {
        return api("/api/admin/users/" + encodeURIComponent(userId) + "/active",
          { method: "POST", body: { isActive: !!isActive } });
      },
      auditLog: function () { return api("/api/admin/audit"); },
      purgeExpiredAuth: function (retainDays) {
        return api("/api/admin/purge-expired-auth",
          { method: "POST", body: { retainDays: retainDays || 30 } });
      }
    }
  };

  return gateway;
})();
