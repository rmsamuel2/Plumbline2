// Plumbline API — the server half of the Data interaction layer + LLM proxy.
// Express + Postgres (Supabase), speaking the FULL production schema:
//   001 base      users · sessions · remember_tokens · activity_log · capabilities
//   002 schema    audit_log · workflow_group · workflow · workflow_version ·
//                 process/stage/state/transition/state_dependency/cost_item/
//                 custom_state_type · analysis_run · analysis_finding
//   003 patch     admin_reset_password() · admin_revoke_sessions() ·
//                 purge_expired_auth() · append-only audit
//
// Every authenticated request runs inside db.tx(), which sets the RLS context
// (app.user_id / app.is_superuser) the schema's policies read.
//
// Saved workflows are IMMUTABLE VERSIONS: saving an existing name appends the
// next version (kind EDIT/ANALYSIS); a new name creates the workflow plus its
// ORIGINAL version. Each version's snapshot is also decomposed into the
// normalized FSM tables by normalize.js — the database, not the browser, is
// the system of record.
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { query, one, tx } = require("./db.js");
const { persistVersionContent } = require("./normalize.js");
const llm = require("./llm.js");

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

// Serve the built single-file app from the same origin as the API, so the
// browser's fetches and the SameSite=strict session cookies just work.
// Open the app at http://localhost:8080 (do not open the dist file from disk).
const path = require("path");
const DIST = path.join(__dirname, "..", "..", "dist");
app.use(express.static(DIST));
app.get("/", (_req, res) =>
  res.sendFile(path.join(DIST, "Plumbline_Studio_V2.html")));

const IS_PROD = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
const SESSION_HOURS = 12;
const REMEMBER_DAYS = 30;
const cookieBase = { httpOnly: true, sameSite: "strict", secure: IS_PROD, path: "/" };

/* ---- signed session cookie + hashed remember token ----------------------- */
function sign(id) {
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(id).digest("base64url");
  return id + "." + mac;
}
function unsign(raw) {
  if (!raw || raw.indexOf(".") < 0) return null;
  const i = raw.lastIndexOf("."), id = raw.slice(0, i), mac = raw.slice(i + 1);
  const good = crypto.createHmac("sha256", SESSION_SECRET).update(id).digest("base64url");
  try { return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good)) ? id : null; }
  catch (e) { return null; }
}
function setSession(res, sid) {
  res.cookie("pl_session", sign(sid), Object.assign({ maxAge: SESSION_HOURS * 36e5 }, cookieBase));
}
function hashToken(t) { return crypto.createHash("sha256").update(t).digest("hex"); }

async function createSession(req, res, userId) {
  const s = await one(
    "insert into sessions(user_id, expires_at, ip, user_agent) " +
    "values ($1, now() + ($2 || ' hours')::interval, $3, $4) returning id",
    [userId, String(SESSION_HOURS), req.ip, req.get("user-agent") || null]);
  setSession(res, s.id);
  return s.id;
}
async function issueRememberToken(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await query("insert into remember_tokens(token_hash, user_id, expires_at) " +
              "values ($1, $2, now() + ($3 || ' days')::interval)",
    [hashToken(token), userId, String(REMEMBER_DAYS)]);
  res.cookie("pl_remember", token,
    Object.assign({ maxAge: REMEMBER_DAYS * 864e5 }, cookieBase));
}

/* ---- attach session (cookie first, remember-token fallback) --------------- */
app.use(async (req, res, next) => {
  try {
    const sid = unsign(req.cookies && req.cookies.pl_session);
    if (sid) {
      const s = await one(
        "select s.id sessionid, s.user_id userid, u.user_type usertype " +
        "from sessions s join users u on u.id = s.user_id " +
        "where s.id = $1 and s.expires_at > now() and s.revoked_at is null " +
        "  and u.is_active", [sid]);
      if (s) { req.session = s; return next(); }
    }
    const remember = req.cookies && req.cookies.pl_remember;
    if (remember) {
      const t = await one(
        "select t.user_id userid, u.user_type usertype " +
        "from remember_tokens t join users u on u.id = t.user_id " +
        "where t.token_hash = $1 and t.expires_at > now() and u.is_active",
        [hashToken(remember)]);
      if (t) {                               // silent re-login from the token
        const sessionid = await createSession(req, res, t.userid);
        req.session = { sessionid, userid: t.userid, usertype: t.usertype };
      }
    }
    next();
  } catch (e) { next(e); }
});
function requireSession(req, res, next) {
  if (!req.session) return res.status(401).json({ error: "Not signed in" });
  next();
}
function requireSuperuser(req, res, next) {
  if (!req.session) return res.status(401).json({ error: "Not signed in" });
  if (req.session.usertype !== "superuser")
    return res.status(403).json({ error: "Superuser only" });
  next();
}
function ctx(req) {
  return { userId: req.session ? req.session.userid : null,
           isSuperuser: !!(req.session && req.session.usertype === "superuser") };
}
async function logActivity(userId, action, meta) {
  await query("insert into activity_log(user_id, action, meta) values ($1,$2,$3)",
    [userId, action, JSON.stringify(meta || {})]);
}

/* ---- health ---------------------------------------------------------------- */
app.get("/api/health", async (_req, res, next) => {
  try { await query("select 1"); res.json({ ok: true, schema: "002+003" }); }
  catch (e) { next(e); }
});

/* =============================================================================
 * AUTH
 * ===========================================================================*/
app.post("/api/signup", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.username && !b.email)
      return res.status(400).json({ error: "Username or email required" });
    if (!b.password || String(b.password).length < 8)
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    const hash = await bcrypt.hash(String(b.password), 10);
    const row = await one(
      "insert into users(username,email,password_hash,display_name,team,role,region) " +
      "values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [b.username || null, b.email || null, hash, b.displayName || "", b.team || "",
       b.role || "", b.region || ""]);
    await query("insert into audit_log(actor_user_id, action, entity_type, entity_id) " +
                "values ($1,'USER_CREATED','users',$1)", [row.id]);
    res.status(201).json({ userId: row.id });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Username or email already exists" });
    next(e);
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const { usernameOrEmail, password, remember } = req.body || {};
    const u = await one(
      "select id, password_hash from users where (username=$1 or email=$1) and is_active",
      [usernameOrEmail]);
    if (!u || !(await bcrypt.compare(String(password || ""), u.password_hash)))
      return res.status(401).json({ error: "Invalid credentials" });
    const sessionId = await createSession(req, res, u.id);
    if (remember) await issueRememberToken(res, u.id);
    await logActivity(u.id, "login", { sessionId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.post("/api/logout", requireSession, async (req, res, next) => {
  try {
    await query("update sessions set revoked_at = now() where id = $1", [req.session.sessionid]);
    const remember = req.cookies && req.cookies.pl_remember;
    if (remember)
      await query("delete from remember_tokens where token_hash = $1", [hashToken(remember)]);
    await logActivity(req.session.userid, "logout", {});
    res.clearCookie("pl_session", cookieBase);
    res.clearCookie("pl_remember", cookieBase);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/api/session", async (req, res, next) => {
  try {
    if (!req.session) return res.json({ signedIn: false });
    const caps = (await query("select capability from capabilities where user_type=$1",
      [req.session.usertype])).map(r => r.capability);
    res.json({ signedIn: true, userType: req.session.usertype, capabilities: caps });
  } catch (e) { next(e); }
});

/* ---- password change: the §3.1 flow, ATOMIC in the database ---------------
 * admin_reset_password() re-hashes (bcrypt $2a$10), revokes every session,
 * deletes every remember token, and appends PASSWORD_CHANGED to audit_log —
 * one transaction, defined once, in patch 003. The API only verifies the
 * current password first (self-service) and re-issues the caller's session. */
app.post("/api/password", requireSession, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const u = await one("select password_hash from users where id=$1", [req.session.userid]);
    if (!u || !(await bcrypt.compare(String(currentPassword || ""), u.password_hash)))
      return res.status(401).json({ error: "Current password is incorrect" });
    await tx(ctx(req), ({ q }) =>
      q("select admin_reset_password($1, $1, $2)", [req.session.userid, String(newPassword || "")]));
    const sessionId = await createSession(req, res, req.session.userid); // continue signed-in
    res.clearCookie("pl_remember", cookieBase);
    await logActivity(req.session.userid, "password_change", { sessionId });
    res.json({ ok: true });
  } catch (e) {
    if (/at least 8 characters/.test(e.message || ""))
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    next(e);
  }
});

/* ---- profile / demographics ------------------------------------------------ */
app.get("/api/profile", requireSession, async (req, res, next) => {
  try {
    const u = await one("select username,email,user_type,display_name,team,role,region " +
      "from users where id=$1", [req.session.userid]);
    res.json({ username: u.username, email: u.email, userType: u.user_type,
      displayName: u.display_name, team: u.team, role: u.role, region: u.region });
  } catch (e) { next(e); }
});
app.post("/api/profile", requireSession, async (req, res, next) => {
  try {
    const b = req.body || {};
    await query("update users set display_name=coalesce($2,display_name), " +
      "team=coalesce($3,team), role=coalesce($4,role), region=coalesce($5,region) where id=$1",
      [req.session.userid, b.displayName, b.team, b.role, b.region]);
    await logActivity(req.session.userid, "update_profile", {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* =============================================================================
 * WORKFLOW GROUPS (folders) — recursive, cycle-guarded by trg_group_no_cycle
 * ===========================================================================*/
app.get("/api/groups", requireSession, async (req, res, next) => {
  try {
    const rows = await tx(ctx(req), ({ q }) =>
      q("select group_id as \"groupId\", parent_group_id as \"parentGroupId\", " +
        " name, depth, path from v_workflow_tree where owner_user_id = $1 " +
        "order by path", [req.session.userid]));
    res.json(rows);
  } catch (e) { next(e); }
});
app.post("/api/groups", requireSession, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: "Group name required" });
    const row = await tx(ctx(req), ({ o }) =>
      o("insert into workflow_group(owner_user_id, parent_group_id, name, description) " +
        "values ($1,$2,$3,$4) returning group_id as \"groupId\"",
        [req.session.userid, b.parentGroupId || null, b.name, b.description || null]));
    await logActivity(req.session.userid, "create_group", { groupId: row.groupId, name: b.name });
    res.status(201).json(row);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "A folder with that name already exists here" });
    next(e);
  }
});
app.patch("/api/groups/:id", requireSession, async (req, res, next) => {
  try {
    const b = req.body || {};
    const row = await tx(ctx(req), ({ o }) =>
      o("update workflow_group set name = coalesce($2, name), " +
        " description = coalesce($3, description), " +
        " parent_group_id = case when $4 then $5::uuid else parent_group_id end " +
        "where group_id = $1 and owner_user_id = $6 returning group_id",
        [req.params.id, b.name, b.description,
         Object.prototype.hasOwnProperty.call(b, "parentGroupId"),
         b.parentGroupId || null, req.session.userid]));
    if (!row) return res.status(404).json({ error: "Folder not found" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.delete("/api/groups/:id", requireSession, async (req, res, next) => {
  try {
    await tx(ctx(req), ({ q }) =>
      q("delete from workflow_group where group_id = $1 and owner_user_id = $2",
        [req.params.id, req.session.userid]));
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "23503")
      return res.status(409).json({ error: "Folder is not empty (move or delete its contents first)" });
    next(e);
  }
});

/* =============================================================================
 * WORKFLOWS + IMMUTABLE VERSIONS (the v2 surface)
 * ===========================================================================*/
async function createVersion(t, workflowId, kind, label, b, userId) {
  const { o, q } = t;
  const v = await o(
    "insert into workflow_version (workflow_id, version_number, kind, label, " +
    " snapshot, config, tools_executed, layout, created_by) " +
    "select $1, coalesce(max(version_number), 0) + 1, $2, $3, $4, $5, $6, $7, $8 " +
    "from workflow_version where workflow_id = $1 " +
    "returning version_id as \"versionId\", version_number as \"versionNumber\"",
    [workflowId, kind, label || null,
     JSON.stringify(b.workflow || b.snapshot || {}),
     JSON.stringify(b.config || {}),
     JSON.stringify(b.toolsExecuted || []),
     JSON.stringify(b.layout || {}), userId]);
  const content = await persistVersionContent(t, v.versionId, b.workflow || b.snapshot || {});
  await q("update workflow set current_version_id = $2 where workflow_id = $1",
    [workflowId, v.versionId]);
  return { version: v, content: content };
}

app.get("/api/v2/workflows", requireSession, async (req, res, next) => {
  try {
    const rows = await tx(ctx(req), ({ q }) =>
      q("select w.workflow_id as id, w.name, w.group_id as \"groupId\", " +
        " w.created_at as \"createdAt\", w.updated_at as \"savedAt\", " +
        " v.version_id as \"currentVersionId\", v.version_number as \"currentVersion\", " +
        " v.kind as \"currentKind\", v.tools_executed as tools " +
        "from workflow w left join workflow_version v on v.version_id = w.current_version_id " +
        "where w.owner_user_id = $1 order by w.updated_at desc", [req.session.userid]));
    res.json(rows);
  } catch (e) { next(e); }
});

async function saveWorkflowHandler(req, res, next) {
  try {
    const b = req.body || {};
    const name = b.name || "Untitled";
    const out = await tx(ctx(req), async (t) => {
      const existing = await t.o(
        "select workflow_id from workflow where owner_user_id = $1 and name = $2",
        [req.session.userid, name]);
      if (existing) {                       // same name → next immutable version
        const r = await createVersion(t, existing.workflow_id,
          b.kind === "ANALYSIS" ? "ANALYSIS" : "EDIT", b.label, b, req.session.userid);
        return Object.assign({ workflowId: existing.workflow_id, created: false }, r);
      }
      const w = await t.o(
        "insert into workflow (owner_user_id, group_id, name, description) " +
        "values ($1,$2,$3,$4) returning workflow_id",
        [req.session.userid, b.groupId || null, name, b.description || null]);
      const r = await createVersion(t, w.workflow_id, "ORIGINAL", b.label, b, req.session.userid);
      return Object.assign({ workflowId: w.workflow_id, created: true }, r);
    });
    await logActivity(req.session.userid, "save_workflow",
      { workflowId: out.workflowId, versionId: out.version.versionId,
        version: out.version.versionNumber, name });
    res.status(201).json({
      savedWorkflowId: out.workflowId, workflowId: out.workflowId,
      versionId: out.version.versionId, versionNumber: out.version.versionNumber,
      normalized: out.content
    });
  } catch (e) { next(e); }
}
app.post("/api/v2/workflows", requireSession, saveWorkflowHandler);

app.get("/api/v2/workflows/:id", requireSession, async (req, res, next) => {
  try {
    const out = await tx(ctx(req), async ({ o, q }) => {
      const w = await o(
        "select workflow_id as id, name, description, group_id as \"groupId\", " +
        " current_version_id as \"currentVersionId\", created_at as \"createdAt\", " +
        " updated_at as \"updatedAt\" from workflow " +
        "where workflow_id = $1 and (owner_user_id = $2 or $3)",
        [req.params.id, req.session.userid, req.session.usertype === "superuser"]);
      if (!w) return null;
      w.versions = await q(
        "select version_id as \"versionId\", version_number as \"versionNumber\", " +
        " kind, label, created_at as \"createdAt\" from workflow_version " +
        "where workflow_id = $1 order by version_number desc", [req.params.id]);
      return w;
    });
    if (!out) return res.status(404).json({ error: "Not found" });
    res.json(out);
  } catch (e) { next(e); }
});

app.post("/api/v2/workflows/:id/versions", requireSession, async (req, res, next) => {
  try {
    const b = req.body || {};
    const kind = b.kind === "ANALYSIS" ? "ANALYSIS" : "EDIT";
    const out = await tx(ctx(req), async (t) => {
      const w = await t.o("select workflow_id from workflow " +
        "where workflow_id = $1 and owner_user_id = $2",
        [req.params.id, req.session.userid]);
      if (!w) return null;
      return createVersion(t, w.workflow_id, kind, b.label, b, req.session.userid);
    });
    if (!out) return res.status(404).json({ error: "Not found" });
    await logActivity(req.session.userid, "save_version",
      { workflowId: req.params.id, versionId: out.version.versionId, kind });
    res.status(201).json({ versionId: out.version.versionId,
      versionNumber: out.version.versionNumber, normalized: out.content });
  } catch (e) { next(e); }
});

app.get("/api/v2/versions/:versionId", requireSession, async (req, res, next) => {
  try {
    const v = await tx(ctx(req), ({ o }) =>
      o("select v.version_id as id, v.workflow_id as \"workflowId\", w.name, " +
        " v.version_number as \"versionNumber\", v.kind, v.label, " +
        " v.snapshot as workflow, v.config, v.tools_executed as \"toolsExecuted\", " +
        " v.layout, v.created_at as \"savedAt\" " +
        "from workflow_version v join workflow w on w.workflow_id = v.workflow_id " +
        "where v.version_id = $1 and (w.owner_user_id = $2 or $3)",
        [req.params.versionId, req.session.userid, req.session.usertype === "superuser"]));
    if (!v) return res.status(404).json({ error: "Not found" });
    await logActivity(req.session.userid, "open_workflow",
      { workflowId: v.workflowId, versionId: v.id });
    res.json(v);
  } catch (e) { next(e); }
});

app.patch("/api/v2/workflows/:id", requireSession, async (req, res, next) => {
  try {
    const b = req.body || {};
    const row = await tx(ctx(req), ({ o }) =>
      o("update workflow set name = coalesce($2, name), " +
        " description = coalesce($3, description), " +
        " group_id = case when $4 then $5::uuid else group_id end " +
        "where workflow_id = $1 and owner_user_id = $6 returning workflow_id",
        [req.params.id, b.name, b.description,
         Object.prototype.hasOwnProperty.call(b, "groupId"), b.groupId || null,
         req.session.userid]));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "You already have a workflow with that name" });
    next(e);
  }
});

async function deleteWorkflowHandler(req, res, next) {
  try {
    const out = await tx(ctx(req), async ({ o, q }) => {
      const w = await o("select name from workflow where workflow_id = $1 and owner_user_id = $2",
        [req.params.id, req.session.userid]);
      if (!w) return null;
      await q("insert into audit_log(actor_user_id, action, entity_type, entity_id, details) " +
              "values ($1,'WORKFLOW_DELETED','workflow',$2,$3)",
        [req.session.userid, req.params.id, JSON.stringify({ name: w.name })]);
      await q("delete from workflow where workflow_id = $1", [req.params.id]);
      return w;
    });
    if (!out) return res.status(404).json({ error: "Not found" });
    await logActivity(req.session.userid, "delete_workflow", { workflowId: req.params.id });
    res.json({ ok: true });
  } catch (e) { next(e); }
}
app.delete("/api/v2/workflows/:id", requireSession, deleteWorkflowHandler);

/* =============================================================================
 * ANALYSIS LINEAGE
 * ===========================================================================*/
app.post("/api/v2/versions/:versionId/analyses", requireSession, async (req, res, next) => {
  try {
    const b = req.body || {};
    const row = await tx(ctx(req), ({ o }) =>
      o("insert into analysis_run (version_id, run_by, engine_version) " +
        "select v.version_id, $2, $3 from workflow_version v " +
        "join workflow w on w.workflow_id = v.workflow_id " +
        "where v.version_id = $1 and w.owner_user_id = $2 " +
        "returning run_id as \"runId\"",
        [req.params.versionId, req.session.userid, b.engineVersion || null]));
    if (!row) return res.status(404).json({ error: "Not found" });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

app.patch("/api/v2/analyses/:runId", requireSession, async (req, res, next) => {
  try {
    const b = req.body || {};
    const status = b.status === "FAILED" ? "FAILED" : "DONE";
    const out = await tx(ctx(req), async ({ o, q }) => {
      const r = await o(
        "update analysis_run set status = $2, finished_at = now(), summary = $3 " +
        "from workflow_version v, workflow w " +
        "where analysis_run.run_id = $1 and v.version_id = analysis_run.version_id " +
        "  and w.workflow_id = v.workflow_id and w.owner_user_id = $4 " +
        "returning analysis_run.run_id",
        [req.params.runId, status, b.summary ? JSON.stringify(b.summary) : null,
         req.session.userid]);
      if (!r) return null;
      let findings = 0;
      for (const f of (Array.isArray(b.findings) ? b.findings : [])) {
        await q("insert into analysis_finding (run_id, finding_code, severity, status, " +
                " target_kind, target_key, title, detail) values ($1,$2,$3,$4,$5,$6,$7,$8)",
          [req.params.runId, String(f.code || "FINDING"), f.severity || null,
           ["PROVEN", "REFUTED", "OPEN"].includes(f.status) ? f.status : "OPEN",
           ["PROCESS", "STAGE", "STATE", "TRANSITION"].includes(f.targetKind) ? f.targetKind : "PROCESS",
           f.targetKey || null, String(f.title || f.code || "Finding"),
           f.detail ? JSON.stringify(f.detail) : null]);
        findings++;
      }
      return { findings: findings };
    });
    if (!out) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, findings: out.findings });
  } catch (e) { next(e); }
});

app.get("/api/v2/versions/:versionId/analyses", requireSession, async (req, res, next) => {
  try {
    const rows = await tx(ctx(req), ({ q }) =>
      q("select r.run_id as \"runId\", r.status, r.engine_version as \"engineVersion\", " +
        " r.started_at as \"startedAt\", r.finished_at as \"finishedAt\", r.summary, " +
        " coalesce(json_agg(json_build_object('code', f.finding_code, 'severity', f.severity, " +
        "   'status', f.status, 'targetKind', f.target_kind, 'targetKey', f.target_key, " +
        "   'title', f.title, 'detail', f.detail)) filter (where f.finding_id is not null), '[]') as findings " +
        "from analysis_run r " +
        "join workflow_version v on v.version_id = r.version_id " +
        "join workflow w on w.workflow_id = v.workflow_id " +
        "left join analysis_finding f on f.run_id = r.run_id " +
        "where r.version_id = $1 and (w.owner_user_id = $2 or $3) " +
        "group by r.run_id order by r.started_at desc",
        [req.params.versionId, req.session.userid, req.session.usertype === "superuser"]));
    res.json(rows);
  } catch (e) { next(e); }
});

/* =============================================================================
 * LEGACY COMPATIBILITY — the original /api/workflows surface, now mapped onto
 * workflow + workflow_version. Old clients keep working; nothing touches the
 * retired saved_workflows table (it remains readable for the 002 backfill).
 * ===========================================================================*/
app.get("/api/workflows", requireSession, async (req, res, next) => {
  try {
    const rows = await tx(ctx(req), ({ q }) =>
      q("select w.workflow_id as id, w.name, w.updated_at as \"savedAt\", " +
        " coalesce(v.tools_executed, '[]'::jsonb) as tools, " +
        " v.version_number as \"versionNumber\" " +
        "from workflow w left join workflow_version v on v.version_id = w.current_version_id " +
        "where w.owner_user_id = $1 order by w.updated_at desc", [req.session.userid]));
    res.json(rows);
  } catch (e) { next(e); }
});
app.post("/api/workflows", requireSession, saveWorkflowHandler);
app.get("/api/workflows/:id", requireSession, async (req, res, next) => {
  try {
    const v = await tx(ctx(req), ({ o }) =>
      o("select w.workflow_id as id, w.name, v.snapshot as workflow, v.config, " +
        " v.tools_executed as \"toolsExecuted\", v.layout, v.created_at as \"savedAt\", " +
        " v.version_id as \"versionId\", v.version_number as \"versionNumber\" " +
        "from workflow w join workflow_version v on v.version_id = w.current_version_id " +
        "where w.workflow_id = $1 and w.owner_user_id = $2",
        [req.params.id, req.session.userid]));
    if (!v) return res.status(404).json({ error: "Not found" });
    await logActivity(req.session.userid, "open_workflow",
      { workflowId: req.params.id, versionId: v.versionId });
    res.json(v);
  } catch (e) { next(e); }
});
app.delete("/api/workflows/:id", requireSession, deleteWorkflowHandler);

/* =============================================================================
 * HISTORY (activity_log)
 * ===========================================================================*/
app.get("/api/history", requireSession, async (req, res, next) => {
  try {
    res.json(await query("select action, meta, at from activity_log " +
      "where user_id=$1 order by at desc limit 200", [req.session.userid]));
  } catch (e) { next(e); }
});
app.post("/api/history", requireSession, async (req, res, next) => {
  try {
    const b = req.body || {};
    await logActivity(req.session.userid, b.action || "event", b.meta || {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* =============================================================================
 * SUPERUSER MAINTENANCE — "see everything BUT passwords"
 * v_users_admin structurally has no hash column; reads are audited.
 * ===========================================================================*/
app.get("/api/admin/users", requireSuperuser, async (req, res, next) => {
  try {
    const rows = await query("select id, username, email, user_type as \"userType\", " +
      " is_active as \"isActive\", display_name as \"displayName\", team, role, region, " +
      " created_at as \"createdAt\", updated_at as \"updatedAt\" " +
      "from v_users_admin order by created_at");
    await query("insert into audit_log(actor_user_id, action, entity_type, details) " +
      "values ($1,'SU_VIEWED_USER_DATA','users',$2)",
      [req.session.userid, JSON.stringify({ rows: rows.length })]);
    res.json(rows);
  } catch (e) { next(e); }
});
app.post("/api/admin/users/:id/password", requireSuperuser, async (req, res, next) => {
  try {
    await tx(ctx(req), ({ q }) =>
      q("select admin_reset_password($1, $2, $3)",
        [req.session.userid, req.params.id, String((req.body || {}).newPassword || "")]));
    res.json({ ok: true });
  } catch (e) {
    if (/at least 8 characters|not found/.test(e.message || ""))
      return res.status(400).json({ error: e.message.split("\n")[0] });
    next(e);
  }
});
app.post("/api/admin/users/:id/revoke-sessions", requireSuperuser, async (req, res, next) => {
  try {
    const rows = await tx(ctx(req), ({ q }) =>
      q("select admin_revoke_sessions($1, $2) as revoked",
        [req.session.userid, req.params.id]));
    res.json({ ok: true, revoked: rows[0] ? rows[0].revoked : 0 });
  } catch (e) { next(e); }
});
app.post("/api/admin/users/:id/active", requireSuperuser, async (req, res, next) => {
  try {
    const active = !!(req.body || {}).isActive;
    await query("update users set is_active = $2 where id = $1", [req.params.id, active]);
    await query("insert into audit_log(actor_user_id, action, entity_type, entity_id, details) " +
      "values ($1, $2, 'users', $3, '{}')",
      [req.session.userid, active ? "SU_ACTIVATED_USER" : "SU_DEACTIVATED_USER", req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.get("/api/admin/audit", requireSuperuser, async (req, res, next) => {
  try {
    res.json(await query("select audit_id as \"auditId\", actor_user_id as \"actorUserId\", " +
      " action, entity_type as \"entityType\", entity_id as \"entityId\", details, " +
      " occurred_at as \"occurredAt\" from audit_log order by occurred_at desc limit 500"));
  } catch (e) { next(e); }
});
app.post("/api/admin/purge-expired-auth", requireSuperuser, async (req, res, next) => {
  try {
    const rows = await query("select * from purge_expired_auth($1)",
      [Number((req.body || {}).retainDays) || 30]);
    res.json(Object.assign({ ok: true }, rows[0]));
  } catch (e) { next(e); }
});

/* ---- LLM proxy (key stays here, never in the browser) --------------------- */
app.post("/api/llm", async (req, res, next) => {
  try {
    const { intent, payload, model } = req.body || {};
    res.json(await llm.handle(intent, payload, model));
  } catch (e) {
    if (e.status === 400) return res.status(400).json({ error: e.message });
    next(e);
  }
});

/* ---- errors ------------------------------------------------------------------ */
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: "Server error" });
});

const PORT = process.env.PORT || 8080;
if (require.main === module)
  app.listen(PORT, () => console.log("Plumbline API (schema 002+003) on :" + PORT));
module.exports = app;