/* ============================================================================
 * studio/shared/workspace.ts — the document model
 * ----------------------------------------------------------------------------
 * Phase 1, step 2. Sole owner of docs[] / active / sel and everything that
 * reads or mutates them. Declarations were MOVED VERBATIM from studio/main.ts
 * (ui-modules.gen.js at commit 462ebb7); the original line range is noted
 * above each one. Where a declaration reached UP into a screen module, the
 * call was replaced by a hook - every such change is marked HOOK below and
 * listed in docs/PHASE1_ASSIGNMENT.md.
 *
 * DEPENDENCY RULE: this file may require studio/shared/dom.ts and the engine,
 * and nothing else. It must never require a screen module. Screens reach it;
 * it reaches them only through fire().
 * ==========================================================================*/
__PL.define("studio/shared/workspace.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var dom_1 = require("studio/shared/dom.ts");
/* PHASE2: ingest() validates through the engine. When the engine moves behind
 * the API this require disappears and ingest() becomes async. */
var io_1 = require("@plumbline/io");

/* ---------------------------------------------------------------------------
 * Hooks. A screen module registers on mount and calls the returned handle on
 * unmount. When nothing is mounted the sets are empty, fire() is a no-op, and
 * state changes still persist correctly - that property is what makes the
 * split safe.
 *
 *   change          state changed; re-render
 *   recomputeTools  { doc, tool } - recompute one tool's suggestions
 *   pushToEditor    push the current model back to the editor iframe
 * -------------------------------------------------------------------------*/
var hooks = { change: [], recomputeTools: [], pushToEditor: [] };

function register(kind, fn) {
  if (!hooks[kind]) throw new Error("workspace: unknown hook " + kind);
  hooks[kind].push(fn);
  return function () {
    var i = hooks[kind].indexOf(fn);
    if (i >= 0) hooks[kind].splice(i, 1);
  };
}
function fire(kind, arg) {
  var list = hooks[kind].slice();          /* copy: a handler may deregister */
  for (var i = 0; i < list.length; i++) {
    try { list[i](arg); }
    catch (e) { console.error("workspace: hook '" + kind + "' failed", e); }
  }
}
exports.onChange         = function (fn) { return register("change", fn); };
/* Ask every mounted screen to re-render. Used when something outside the
   workspace has changed the documents — the library loading a folder, for
   instance — and the screens need to catch up. */
exports.emitChange       = function (arg) { fire("change", arg); };
exports.onRecomputeTools = function (fn) { return register("recomputeTools", fn); };
exports.onPushToEditor   = function (fn) { return register("pushToEditor", fn); };

/* NOTE: USER_DB_KEY and SESSION_KEY are declared together on one line in
 * main.ts (both are legacy browser-storage keys that restoreState() clears);
 * that declaration is moved below verbatim. */



/* main.ts:8-8 */
const ROLES = ["step", "quality", "hold", "decision", "rework", "terminal"];

/* main.ts:9-9 */
const ROLE_COLOR = { step: "#1F7A6F", quality: "#3A9D90", hold: "#7B8694", decision: "#16243B", rework: "#B8862F", terminal: "#2E7D32" };

/* main.ts:10-15 */
const CHIPS = [
    { k: "start", label: "Start", role: "step", init: true }, { k: "step", label: "Step", role: "step" },
    { k: "quality", label: "Quality", role: "quality" }, { k: "decision", label: "Decision", role: "decision" },
    { k: "hold", label: "Hold", role: "hold" }, { k: "rework", label: "Rework", role: "rework" },
    { k: "accept", label: "Accept", role: "terminal", acc: true }, { k: "reject", label: "Reject", role: "terminal", rej: true }
];

/* main.ts:16-16 */
const NW = 140, NH = 58, COLW = 200, ROWH = 104, PAD = 40;

/* main.ts:17-17 */
const GRID = 20;

/* main.ts:22-22 */
const USER_DB_KEY = "plumbline_users_v2", SESSION_KEY = "plumbline_session_v2";

/* main.ts:258-276 */
const SCAFFOLD = `{
  "workflow": {
    "id": "my_workflow",
    "name": "My workflow",
    "states": [
      { "id": "Start",    "label": "Start",    "role": "step",     "initial": true },
      { "id": "Review",   "label": "Review",   "role": "decision"  },
      { "id": "Done",     "label": "Done",     "role": "terminal", "accept": true },
      { "id": "Rejected", "label": "Rejected", "role": "terminal", "reject": true }
    ],
    "transitions": [
      { "from": "Start",  "on": "submit",  "to": "Review" },
      { "from": "Review", "on": "approve", "to": "Done" },
      { "from": "Review", "on": "deny",    "to": "Rejected" }
    ]
  },
  "cost": { "stepCost": { "Start": 50, "Review": 40, "Done": 0, "Rejected": 0 } },
  "time": { "stepMinutes": { "Start": 30, "Review": 15, "Done": 0, "Rejected": 0 } }
}`;

/* main.ts:20-20 */
let docs = [];

/* main.ts:23-23 */
let active = 0; // index into docs, or -1 for Sigma view

/* main.ts:24-24 */
let lastTool = -2; // -2 none, -1 apply-all, 0..5 a tool

/* main.ts:25-25 */
let panelHidden = false;

/* main.ts:26-26 */
let sel = null;

/* main.ts:48-48 */
function emptyOverlay() { return { bands: [], flag: {}, edge: {}, ghosts: [], stageTag: {} }; }

/* main.ts:53-70 */
function estimate(d) {
    var _a;
    for (const s of d.wf.states) {
        const r = s.role, h = dom_1.labelHash((s.label || s.id) + r);
        const baseC = r === "terminal" ? 0 : r === "rework" ? 120 : r === "decision" ? 45 : r === "quality" ? 70 : r === "hold" ? 25 : 55;
        const baseT = r === "terminal" ? 0 : r === "rework" ? 95 : r === "decision" ? 18 : r === "quality" ? 50 : r === "hold" ? 65 : 32;
        const cBump = r === "terminal" ? 0 : ((h % 5) - 2) * 5;
        const tBump = r === "terminal" ? 0 : ((Math.floor(h / 7) % 5) - 2) * 4;
        d.cost[s.id] = Math.max(0, baseC + cBump);
        d.time[s.id] = Math.max(0, baseT + tBump);
    }
    const deg = {};
    for (const t of d.wf.transitions)
        deg[t.from] = ((_a = deg[t.from]) !== null && _a !== void 0 ? _a : 0) + 1;
    d.branch = {};
    for (const t of d.wf.transitions)
        d.branch[t.from + "::" + t.on] = +(1 / (deg[t.from] || 1)).toFixed(3);
}

/* main.ts:71-77 */
function mkDoc(wf) {
    const d = { id: wf.id + "_" + Math.random().toString(36).slice(2, 6), name: wf.name, wf: dom_1.clone(wf), pos: {}, cost: {}, time: {}, branch: {}, owner: {}, stage: {},
        sugs: {}, toolIds: [[], [], [], [], [], []], applied: new Set(), overruled: new Set(), overlay: emptyOverlay() };
    estimate(d);
    d.pos = autoLayout(d.wf);
    return d;
}

/* main.ts:78-78 */
function emptyWf(name) { return { id: "wf" + Date.now().toString(36), name, alphabet: [], states: [], transitions: [], initial: "", accepts: [], rejects: [] }; }

/* main.ts:79-79 */
function startWf(name) { return { id: "wf" + Date.now().toString(36), name, alphabet: [], states: [{ id: "Start", label: "Start", role: "step", initial: true }], transitions: [], initial: "Start", accepts: [], rejects: [] }; }

/* main.ts:80-95 */
function addAfter(fromId) {
    const d = ensureDoc();
    const id = uid(d, "S");
    d.wf.states.push({ id, label: "New", role: "step" });
    d.cost[id] = 50;
    d.time[id] = 30;
    const p = d.pos[fromId] || { x: PAD, y: PAD };
    let y = p.y;
    while (Object.values(d.pos).some((q) => q && Math.abs(q.x - (p.x + COLW)) < 4 && Math.abs(q.y - y) < 4))
        y += ROWH;
    d.pos[id] = { x: p.x + COLW, y };
    d.wf.transitions.push({ from: fromId, on: "event" + d.wf.transitions.length, to: id });
    resetTools(d);
    sel = { kind: "state", key: id };
    commit();
}

/* main.ts:158-163 */
function blankWf(name) {
    return { id: "wf" + Date.now().toString(36), name, alphabet: ["start"],
        states: [{ id: "Start", label: "Start", role: "step", initial: true }, { id: "End", label: "Done", role: "terminal", accept: true }],
        transitions: [{ from: "Start", on: "start", to: "End" }], initial: "Start", accepts: ["End"], rejects: [] };
}
/* ---------- normalisation + layout ---------- */

/* main.ts:164-169 */
function normalise(w) {
    var _a, _b, _c, _d;
    const alphabet = Array.from(new Set(w.transitions.map(t => t.on))).sort();
    const initial = (_d = (_b = ((_a = w.states.find(s => s.initial)) === null || _a === void 0 ? void 0 : _a.id)) !== null && _b !== void 0 ? _b : (_c = w.states[0]) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : "";
    return { ...w, alphabet, initial, accepts: w.states.filter(s => s.accept).map(s => s.id), rejects: w.states.filter(s => s.reject).map(s => s.id) };
}

/* main.ts:170-207 */
function autoLayout(w) {
    var _a, _b, _c;
    var _d;
    const start = (_b = ((_a = w.states.find(s => s.initial)) === null || _a === void 0 ? void 0 : _a.id)) !== null && _b !== void 0 ? _b : (_c = w.states[0]) === null || _c === void 0 ? void 0 : _c.id;
    const adj = {};
    for (const t of w.transitions)
        (adj[_d = t.from] || (adj[_d] = [])).push(t.to);
    const depth = {};
    const q = [];
    if (start) {
        depth[start] = 0;
        q.push(start);
    }
    while (q.length) {
        const c = q.shift();
        for (const n of adj[c] || []) {
            if (depth[n] === undefined) {
                depth[n] = depth[c] + 1;
                q.push(n);
            }
        }
    }
    const ds = Object.keys(depth).map(k => depth[k]);
    const maxD = ds.length ? Math.max(...ds) : 0;
    const byCol = {};
    let extra = 0;
    for (const st of w.states) {
        const col = depth[st.id] !== undefined ? depth[st.id] : (maxD + 1) + (extra++ % 3);
        (byCol[col] || (byCol[col] = [])).push(st);
    }
    const roleRank = (r) => ROLES.indexOf(r);
    const p = {};
    for (const col of Object.keys(byCol).map(Number).sort((a, b) => a - b)) {
        byCol[col].sort((a, b) => (roleRank(a.role) - roleRank(b.role)) || String(a.label || a.id).localeCompare(String(b.label || b.id)));
        byCol[col].forEach((st, row) => { p[st.id] = { x: PAD + col * COLW, y: PAD + row * ROWH }; });
    }
    return p;
}

/* main.ts:208-225 */
function tidyLayout(d) {
    const w = d.wf, dep = depthMap(w), roleRank = (r) => ROLES.indexOf(r);
    const groups = {};
    let extra = 0;
    const vals = Object.values(dep);
    const maxD = vals.length ? Math.max(...vals) : 0;
    for (const st of w.states) {
        const col = dep[st.id] !== undefined ? dep[st.id] : (maxD + 1) + (extra++ % 3);
        (groups[col] || (groups[col] = [])).push(st);
    }
    const out = {};
    for (const col of Object.keys(groups).map(Number).sort((a, b) => a - b)) {
        groups[col].sort((a, b) => String(d.stage[a.id] || "").localeCompare(String(d.stage[b.id] || "")) || roleRank(a.role) - roleRank(b.role) || String(a.label || a.id).localeCompare(String(b.label || b.id)));
        groups[col].forEach((st, row) => { out[st.id] = { x: PAD + col * COLW, y: PAD + row * ROWH }; });
    }
    return out;
}
// first free on-screen grid slot, so a newly added tile never lands on top of another

/* main.ts:226-236 */
function placeNew(d) {
    const used = Object.values(d.pos);
    for (let i = 0; i < 60; i++) {
        const x = PAD + (i % 4) * COLW, y = PAD + Math.floor(i / 4) * ROWH;
        if (!used.some(u => u && Math.abs(u.x - x) < COLW - 20 && Math.abs(u.y - y) < ROWH - 20))
            return { x, y };
    }
    const n = d.wf.states.length;
    return { x: PAD + (n % 4) * COLW, y: PAD + Math.floor(n / 4) * ROWH };
}
// assign an on-screen position to any state that does not already have one (never relocates existing tiles)

/* main.ts:237-256 */
function layoutMissing(d) {
    const need = d.wf.states.some(s => !d.pos[s.id]);
    if (!need)
        return;
    const auto = autoLayout(d.wf);
    const used = Object.values(d.pos);
    let k = 0;
    for (const s of d.wf.states) {
        if (d.pos[s.id])
            continue;
        let pcand = auto[s.id] || { x: PAD, y: PAD };
        // avoid dropping exactly on top of an existing tile
        while (used.some(u => u && Math.abs(u.x - pcand.x) < 6 && Math.abs(u.y - pcand.y) < 6)) {
            pcand = { x: pcand.x + 34, y: pcand.y + 34 };
        }
        d.pos[s.id] = pcand;
        used.push(pcand);
        k++;
    }
}

/* main.ts:257-257 */
function D() { return docs[active]; }

/* main.ts:277-282 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function ensureDoc() { if (active < 0) {
    docs.push(mkDoc(emptyWf("New workflow")));
    active = docs.length - 1;
    fire("change");
} return docs[active]; }
/* ---------- structural analysis helpers ---------- */

/* main.ts:283-283 */
function outOf(w, id) { return w.transitions.filter(t => t.from === id); }

/* main.ts:284-284 */
function roleOf(w, id) { var _a; return (_a = w.states.find(s => s.id === id)) === null || _a === void 0 ? void 0 : _a.role; }

/* main.ts:285-303 */
function reachable(w) {
    var _a;
    var _b;
    const adj = {};
    for (const t of w.transitions)
        (adj[_b = t.from] || (adj[_b] = [])).push(t.to);
    const seen = new Set([w.initial || ((_a = w.states[0]) === null || _a === void 0 ? void 0 : _a.id)]);
    const q = [...seen];
    while (q.length) {
        const c = q.shift();
        for (const n of adj[c] || []) {
            if (!seen.has(n)) {
                seen.add(n);
                q.push(n);
            }
        }
    }
    return seen;
}

/* main.ts:304-324 */
function depthMap(w) {
    var _a;
    var _b;
    const adj = {};
    for (const t of w.transitions)
        (adj[_b = t.from] || (adj[_b] = [])).push(t.to);
    const start = w.initial || ((_a = w.states[0]) === null || _a === void 0 ? void 0 : _a.id);
    const dep = {};
    const q = [start];
    dep[start] = 0;
    while (q.length) {
        const c = q.shift();
        for (const n of adj[c] || []) {
            if (dep[n] === undefined) {
                dep[n] = dep[c] + 1;
                q.push(n);
            }
        }
    }
    return dep;
}

/* main.ts:325-347 */
function backEdges(w) {
    var _a;
    var _b;
    const adj = {};
    for (const t of w.transitions)
        (adj[_b = t.from] || (adj[_b] = [])).push({ on: t.on, to: t.to });
    const color = {};
    const stack = new Set();
    const res = [];
    const dfs = (u) => { color[u] = 1; stack.add(u); for (const e of adj[u] || []) {
        if (stack.has(e.to))
            res.push({ from: u, on: e.on, to: e.to });
        else if (!color[e.to])
            dfs(e.to);
    } stack.delete(u); color[u] = 2; };
    const start = w.initial || ((_a = w.states[0]) === null || _a === void 0 ? void 0 : _a.id);
    if (start)
        dfs(start);
    for (const s of w.states)
        if (!color[s.id])
            dfs(s.id);
    return res;
}

/* main.ts:348-367 */
function pathBetween(w, start, goal) {
    var _a;
    const adj = {};
    for (const t of w.transitions)
        (adj[_a = t.from] || (adj[_a] = [])).push(t.to);
    const seen = new Set(), path = [];
    const dfs = (u) => { path.push(u); if (u === goal)
        return true; seen.add(u); for (const v of adj[u] || []) {
        if (!seen.has(v) && dfs(v))
            return true;
    } path.pop(); return false; };
    if (start && goal && dfs(start))
        return path;
    const out = [];
    for (const x of [start, goal])
        if (x && !out.includes(x))
            out.push(x);
    return out;
}
/* ---------- per-tool suggestion computation ---------- */

/* main.ts:495-499 */
function effective(d) { const out = []; for (const ids of d.toolIds)
    for (const id of ids) {
        if (d.applied.has(id) && !d.overruled.has(id))
            out.push(d.sugs[id]);
    } return out; }

/* main.ts:500-509 */
function rebuild(d) {
    // recompute layout-affecting suggestions cleanly. Editor-sourced graphs keep exact editor positions.
    const keepEditorPos = hasEditorCanvas(d) ? dom_1.clone(d.pos) : null;
    layoutMissing(d);
    d.overlay = emptyOverlay();
    for (const s of effective(d))
        s.apply(d.overlay, d);
    if (keepEditorPos)
        d.pos = keepEditorPos;
}

/* main.ts:510-514 */
function totals(d) { let c = 0, t = 0; for (const s of effective(d)) {
    c += s.cost;
    t += s.time;
} return { c, t }; }
/* ---------- editor-matched Analysis Studio canvas ---------- */

/* main.ts:777-777 */
function hasEditorCanvas(d) { return !!(d.editorData && isEditorData(d.editorData)); }

/* main.ts:1326-1328 */
function uid(d, p) { let n = 1; const ids = new Set(d.wf.states.map(s => s.id)); while (ids.has(p + n))
    n++; return p + n; }
/* unified JSON: workflow + cost + time in one document */

/* main.ts:1307-1325 */
function rename(d, i, n) { const old = d.wf.states[i].id; if (!n)
    return; d.wf.states[i].id = n; d.wf.transitions.forEach(t => { if (t.from === old)
    t.from = n; if (t.to === old)
    t.to = n; }); if (d.cost[old] !== undefined) {
    d.cost[n] = d.cost[old];
    delete d.cost[old];
} if (d.time[old] !== undefined) {
    d.time[n] = d.time[old];
    delete d.time[old];
} if (d.owner[old] !== undefined) {
    d.owner[n] = d.owner[old];
    delete d.owner[old];
} if (d.stage[old] !== undefined) {
    d.stage[n] = d.stage[old];
    delete d.stage[old];
} if (d.pos[old]) {
    d.pos[n] = d.pos[old];
    delete d.pos[old];
} }

/* main.ts:1329-1331 */
function activeToolIndexes(d) { const out = []; for (let i = 0; i < d.toolIds.length; i++)
    if (toolActive(d, i))
        out.push(i); return out; }

/* main.ts:1332-1333 */
function unified(d) { const meta = { layout: d.pos, owner: d.owner, stage: d.stage, activeTools: activeToolIndexes(d), overruled: [...d.overruled] }; if (d.editorData)
    meta.editorData = d.editorData; return { workflow: normalise(d.wf), cost: { stepCost: d.cost, branchProb: d.branch }, time: { stepMinutes: d.time }, meta }; }

/* main.ts:1340-1345 */
function safe(s) { try {
    return JSON.parse(s);
}
catch (e) {
    return { __e: String(e) };
} }

/* main.ts:1346-1402 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function ingest(raw, src) {
    const wfRaw = raw && raw.workflow ? raw.workflow : raw; // accept unified OR bare workflow
    if (!wfRaw || !Array.isArray(wfRaw.states) || !wfRaw.states.length) {
        const st = dom_1.$("status");
        st.className = "status bad";
        st.textContent = "\u2715 " + src + ": needs a workflow with at least one state.";
        return;
    }
    const res = (0, io_1.parseWorkflow)(normalise(wfRaw));
    if (!res.ok) {
        const st = dom_1.$("status");
        st.className = "status bad";
        st.textContent = "✕ " + src + ": " + res.errors.join(" • ");
        return;
    }
    const d = mkDoc(res.value);
    if (raw && raw.cost && raw.cost.stepCost)
        d.cost = { ...d.cost, ...raw.cost.stepCost };
    if (raw && raw.cost && raw.cost.branchProb)
        d.branch = { ...d.branch, ...raw.cost.branchProb };
    if (raw && raw.time && raw.time.stepMinutes)
        d.time = { ...d.time, ...raw.time.stepMinutes };
    const meta = (raw && raw.meta) || (wfRaw && wfRaw.meta) || {};
    const lay = meta && meta.layout;
    if (lay)
        for (const k in lay) {
            const v = lay[k];
            if (v && typeof v.x === "number")
                d.pos[k] = { x: v.x, y: v.y };
        }
    if (meta && meta.owner)
        d.owner = { ...d.owner, ...meta.owner };
    if (meta && meta.stage)
        d.stage = { ...d.stage, ...meta.stage };
    if (meta && meta.editorData && isEditorData(meta.editorData))
        d.editorData = meta.editorData;
    if (meta && Array.isArray(meta.activeTools)) {
        for (const i of meta.activeTools) {
            if (typeof i === "number" && i >= 0 && i < 6) {
                fire("recomputeTools", { doc: d, tool: i });
                for (const id of d.toolIds[i])
                    d.applied.add(id);
            }
        }
    }
    if (meta && Array.isArray(meta.overruled))
        for (const id of meta.overruled)
            d.overruled.add(id);
    rebuild(d);
    docs[active >= 0 ? active : docs.length] = d;
    if (active < 0)
        active = docs.length - 1;
    sel = null;
    lastTool = -2;
    fire("change");
}
/* ---------- Workflow Editor -> Analysis Studio sync ---------- */

/* main.ts:1403-1403 */
function editorNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* main.ts:1404-1404 */
function editorMid(min, max) { const a = editorNum(min); const b = (max === undefined || max === null || max === "") ? a : editorNum(max); return (a + b) / 2; }

/* main.ts:1405-1405 */
function editorKey(v, fallback) { const raw = String(v !== null && v !== void 0 ? v : "").trim() || fallback; return raw.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.:-]/g, "_"); }

/* main.ts:1406-1419 */
function editorRole(type) {
    const t = String(type || "").toUpperCase();
    if (t.includes("FINAL") || t.includes("END") || t.includes("DONE"))
        return "terminal";
    if (t.includes("ERROR") || t.includes("REJECT") || t.includes("FAIL"))
        return "rework";
    if (t.includes("WARN") || t.includes("REVIEW") || t.includes("RISK"))
        return "quality";
    if (t.includes("DECISION") || t.includes("GATE"))
        return "decision";
    if (t.includes("HOLD") || t.includes("WAIT") || t.includes("PAUSE"))
        return "hold";
    return "step";
}

/* main.ts:1420-1425 */
function editorDataSignature(data) { try {
    return JSON.stringify(data || null);
}
catch (e) {
    return String(Date.now());
} }

/* main.ts:1432-1432 */
function isEditorData(data) { return !!(data && data.process && Array.isArray(data.states) && Array.isArray(data.transitions)); }

/* main.ts:1433-1550 */
function editorDataToUnified(data) {
    if (!isEditorData(data))
        return null;
    const process = data.process || {};
    const statesIn = [...(data.states || [])];
    const transitionsIn = [...(data.transitions || [])];
    const stagesIn = [...(data.stages || [])];
    const stageByKey = new Map(stagesIn.map((s) => [String(s.stage_key || ""), s]));
    const outgoing = new Map();
    transitionsIn.forEach((t) => outgoing.set(String(t.from_state_key || ""), (outgoing.get(String(t.from_state_key || "")) || 0) + 1));
    const seenStateIds = new Set();
    const idFor = new Map();
    statesIn.forEach((state, index) => {
        let id = editorKey(state.state_key, "S" + (index + 1));
        const base = id;
        let n = 2;
        while (seenStateIds.has(id)) {
            id = base + "_" + (n++);
        }
        seenStateIds.add(id);
        idFor.set(String(state.state_key || id), id);
    });
    const initialSource = statesIn.find((s) => String(s.state_type || "").toUpperCase() === "START" || s.is_initial) || statesIn[0];
    const initialId = idFor.get(String((initialSource === null || initialSource === void 0 ? void 0 : initialSource.state_key) || "")) || [...seenStateIds][0] || "Start";
    const wfStates = statesIn.map((state, index) => {
        const id = idFor.get(String(state.state_key || "")) || editorKey(state.state_key, "S" + (index + 1));
        const type = String(state.state_type || "").toUpperCase();
        const hasOut = (outgoing.get(String(state.state_key || "")) || 0) > 0;
        const st = { id, label: String(state.name || state.label || state.state_key || id), role: editorRole(type) };
        if (id === initialId)
            st.initial = true;
        if (!hasOut && (type.includes("FINAL") || type.includes("DONE") || type.includes("COMPLETE")))
            st.accept = true;
        if (!hasOut && (type.includes("ERROR") || type.includes("REJECT") || type.includes("FAIL") || type.includes("CANCEL")))
            st.reject = true;
        return st;
    });
    const usedByFrom = new Set();
    const wfTransitions = [];
    transitionsIn.forEach((transition, index) => {
        const from = idFor.get(String(transition.from_state_key || ""));
        const to = idFor.get(String(transition.to_state_key || ""));
        if (!from || !to)
            return;
        let on = editorKey(transition.event_name || transition.transition_key, "event" + (index + 1));
        const base = on;
        let n = 2;
        while (usedByFrom.has(from + "::" + on)) {
            on = base + "_" + (n++);
        }
        usedByFrom.add(from + "::" + on);
        wfTransitions.push({ from, on, to });
    });
    const alphabet = Array.from(new Set(wfTransitions.map(t => t.on))).sort();
    const accepts = wfStates.filter((s) => s.accept).map((s) => s.id);
    const rejects = wfStates.filter((s) => s.reject).map((s) => s.id);
    const wf = { id: "editor_" + editorKey(process.process_key || process.name, "workflow"), name: String(process.name || "Workflow Editor Process"), alphabet, states: wfStates, transitions: wfTransitions, initial: initialId, accepts, rejects };
    const stepCost = {};
    const stepMinutes = {};
    const owner = {};
    const stage = {};
    const layout = {};
    statesIn.forEach((state, index) => {
        var _a;
        const id = idFor.get(String(state.state_key || "")) || editorKey(state.state_key, "S" + (index + 1));
        stepCost[id] = 0;
        stepMinutes[id] = editorNum((_a = state.expected_duration_minutes) !== null && _a !== void 0 ? _a : state.step_minutes);
        owner[id] = String(state.owner_role || "");
        const stg = stageByKey.get(String(state.stage_key || ""));
        stage[id] = String((stg === null || stg === void 0 ? void 0 : stg.name) || state.stage_name || state.stage_key || "");
        const sx = Number(state.manual_x), sy = Number(state.manual_y);
        if (Number.isFinite(sx) && Number.isFinite(sy))
            layout[id] = { x: sx, y: sy };
        else
            layout[id] = { x: PAD + Math.max(0, editorNum(state.stage_order || (stg === null || stg === void 0 ? void 0 : stg.stage_order) || 1) - 1) * COLW, y: PAD + index * ROWH };
    });
    const costs = Array.isArray(data.costs) ? data.costs : [];
    if (costs.length) {
        costs.forEach((cost) => {
            var _a;
            const v = editorMid(cost.unit_cost_min, cost.unit_cost_max);
            if (!v)
                return;
            if (cost.state_key) {
                const id = idFor.get(String(cost.state_key));
                if (id)
                    stepCost[id] = (stepCost[id] || 0) + v;
            }
            else if (cost.transition_key) {
                const tr = transitionsIn.find((t) => String(t.transition_key) === String(cost.transition_key));
                const id = idFor.get(String((tr === null || tr === void 0 ? void 0 : tr.from_state_key) || ""));
                if (id)
                    stepCost[id] = (stepCost[id] || 0) + v;
            }
            else if (cost.stage_key) {
                const inStage = statesIn.filter((s) => String(s.stage_key) === String(cost.stage_key)).map((s) => idFor.get(String(s.state_key))).filter(Boolean);
                const targets = inStage.length ? inStage : [(_a = wfStates[0]) === null || _a === void 0 ? void 0 : _a.id].filter(Boolean);
                targets.forEach(id => stepCost[id] = (stepCost[id] || 0) + v / targets.length);
            }
        });
    }
    else {
        statesIn.forEach((state, index) => { const id = idFor.get(String(state.state_key || "")); if (id)
            stepCost[id] = (stepCost[id] || 0) + editorMid(state.cost_min, state.cost_max); });
        transitionsIn.forEach((transition) => { const id = idFor.get(String(transition.from_state_key || "")); if (id)
            stepCost[id] = (stepCost[id] || 0) + editorMid(transition.cost_min, transition.cost_max); });
    }
    const xs = Object.values(layout).map(p => p.x), ys = Object.values(layout).map(p => p.y);
    const minX = xs.length ? Math.min(...xs) : PAD, minY = ys.length ? Math.min(...ys) : PAD;
    for (const id in layout) {
        layout[id] = { x: Math.max(PAD, Math.round((layout[id].x - minX + PAD) / GRID) * GRID), y: Math.max(PAD, Math.round((layout[id].y - minY + PAD) / GRID) * GRID) };
    }
    const branchProb = {};
    const deg = {};
    wfTransitions.forEach(t => deg[t.from] = (deg[t.from] || 0) + 1);
    wfTransitions.forEach(t => branchProb[t.from + "::" + t.on] = +(1 / (deg[t.from] || 1)).toFixed(3));
    return { workflow: wf, cost: { stepCost, branchProb }, time: { stepMinutes }, meta: { layout, owner, stage, activeTools: [], overruled: [], source: "workflow-editor", editorProcessKey: process.process_key || "" } };
}

/* main.ts:605-606 */
function editorWorkflowIdMap(data) { const seen = new Set(); const out = new Map(); (Array.isArray(data === null || data === void 0 ? void 0 : data.states) ? data.states : []).forEach((state, index) => { let id = editorKey(state.state_key, "S" + (index + 1)); const base = id; let n = 2; while (seen.has(id))
    id = base + "_" + (n++); seen.add(id); out.set(String(state.state_key || id), id); }); return out; }

/* main.ts:607-609 */
function editorDocTransitionKey(data, transition, index, idFor) { const from = idFor.get(String(transition.from_state_key || "")) || editorKey(transition.from_state_key, "from"); const to = idFor.get(String(transition.to_state_key || "")) || editorKey(transition.to_state_key, "to"); const used = new Set(); (Array.isArray(data === null || data === void 0 ? void 0 : data.transitions) ? data.transitions : []).slice(0, index).forEach((t, i) => { if (String(t.from_state_key || "") === String(transition.from_state_key || ""))
    used.add(editorKey(t.event_name || t.transition_key, "event" + (i + 1))); }); let on = editorKey(transition.event_name || transition.transition_key, "event" + (index + 1)); const base = on; let n = 2; while (used.has(on))
    on = base + "_" + (n++); return from + "|" + on + "|" + to; }

/* main.ts:1674-1689 */
function studioStateTypeForRole(st) {
    if (st.initial)
        return "START";
    if (st.accept)
        return "FINAL";
    if (st.reject)
        return "ERROR";
    const r = String(st.role || "").toLowerCase();
    if (r === "terminal")
        return "FINAL";
    if (r === "rework")
        return "ERROR";
    if (r === "quality" || r === "hold")
        return "WARNING";
    return "NORMAL";
}

/* main.ts:1690-1813 */

/* ---------------------------------------------------------------------------
 * studioIRToEditorData(d)
 *
 * Build editor data for a document that has none.
 *
 * studioDocToEditorData() is an UPDATE function: it takes an editor-authored
 * process and writes the Studio's changes back into it, and returns null when
 * there is nothing to update. That is correct for its job, but it leaves the
 * five Analysis Studio presets and the three engine fixtures unusable in the
 * Workflow Editor — they are bare engine IR with no stages, no state_key and
 * no editor structure at all, so the Editor received nothing and showed no
 * transitions.
 *
 * This synthesises that structure from the IR, mirroring the conventions
 * editorDataToUnified() uses in the other direction so a round trip is stable:
 *   · state ids become state_key via editorKey()
 *   · state_type comes from studioStateTypeForRole()
 *   · one stage, because the editor requires every state to sit in one and
 *     the IR has no notion of them
 *   · each { from, on, to } becomes a transition row with a generated,
 *     de-duplicated transition_key
 * Cost and duration already held on the doc are carried across, so a preset
 * opened in the Editor shows the same figures the Studio does.
 * ------------------------------------------------------------------------- */
function studioIRToEditorData(d) {
  if (!d || !d.wf || !Array.isArray(d.wf.states) || !d.wf.states.length) return null;

  const wf = d.wf;
  const pkey = editorKey(wf.id, "workflow");

  /* state id -> state_key, de-duplicated exactly as editorDataToUnified does */
  const seen = new Set();
  const keyFor = new Map();
  wf.states.forEach(function (st, i) {
    let k = editorKey(st.id, "S" + (i + 1));
    const base = k;
    let n = 2;
    while (seen.has(k)) { k = base + "_" + (n++); }
    seen.add(k);
    keyFor.set(st.id, k);
  });

  /* -------------------------------------------------------------------------
   * Stages.
   *
   * The IR has none, and the editor requires every state to sit in one. A
   * single "All" lane is valid but renders as one long row and looks nothing
   * like an editor-authored process.
   *
   * Two things in the IR are real and can carry the structure:
   *   · role   — authored on every state (step / quality / decision / hold /
   *              rework / terminal). This is what the Studio already colours by.
   *   · depth  — breadth-first distance from the start state, i.e. the actual
   *              topology.
   *
   * So: group by role, order the lanes by each role's mean depth, and name
   * them from a fixed vocabulary. Nothing is invented — the grouping and the
   * ordering both come from data that is already there. Descriptions and
   * entry/exit actions are deliberately left empty rather than fabricated,
   * so the difference between derived structure and authored detail stays
   * visible.
   * ---------------------------------------------------------------------- */
  const ROLE_LANE = {
    step:     { name: "Processing",      color: "#2563eb" },
    quality:  { name: "Checks",          color: "#3A9D90" },
    decision: { name: "Decisions",       color: "#9333ea" },
    hold:     { name: "Holds",           color: "#7B8694" },
    rework:   { name: "Exceptions",      color: "#B8862F" },
    terminal: { name: "Closed Outcomes", color: "#2E7D32" }
  };

  /* breadth-first depth from the start state */
  const outEdges = {};
  (wf.transitions || []).forEach(function (t) {
    (outEdges[t.from] = outEdges[t.from] || []).push(t.to);
  });
  const startId = wf.initial ||
    ((wf.states.find(function (x) { return x.initial; }) || wf.states[0]).id);
  const depth = {};
  depth[startId] = 0;
  const queue = [startId];
  while (queue.length) {
    const n = queue.shift();
    (outEdges[n] || []).forEach(function (m) {
      if (depth[m] === undefined) { depth[m] = depth[n] + 1; queue.push(m); }
    });
  }
  const maxDepth = Math.max(0, ...Object.keys(depth).map(function (k) { return depth[k]; }));
  const depthOf = function (id) {
    /* unreachable states sort last, before the terminals */
    return depth[id] === undefined ? maxDepth + 1 : depth[id];
  };

  /* one lane per role actually present, ordered by mean depth */
  const laneOf = {};
  wf.states.forEach(function (st) {
    const r = String(st.role || "step").toLowerCase();
    const key = ROLE_LANE[r] ? r : "step";
    (laneOf[key] = laneOf[key] || []).push(st);
  });
  const laneKeys = Object.keys(laneOf).sort(function (a, b) {
    /* terminals always last, whatever their depth */
    if (a === "terminal") return 1;
    if (b === "terminal") return -1;
    const mean = function (k) {
      const ds = laneOf[k].map(function (st) { return depthOf(st.id); });
      return ds.reduce(function (x, y) { return x + y; }, 0) / ds.length;
    };
    return mean(a) - mean(b);
  });
  const stageKeyFor = {};
  const stages = laneKeys.map(function (k, i) {
    stageKeyFor[k] = k;
    return {
      process_key: pkey,
      stage_key: k,
      stage_order: i + 1,
      name: ROLE_LANE[k].name,
      owner_role: "",
      description: "Derived from the workflow's own state roles and topology.",
      visual_color: ROLE_LANE[k].color
    };
  });

  const ordered = wf.states.slice().sort(function (a, b) {
    return depthOf(a.id) - depthOf(b.id);
  });
  const withinLane = {};
  const states = ordered.map(function (st) {
    const key = keyFor.get(st.id);
    const role = String(st.role || "step").toLowerCase();
    const lane = ROLE_LANE[role] ? role : "step";
    withinLane[lane] = (withinLane[lane] || 0) + 1;
    const stage = stages.find(function (g) { return g.stage_key === lane; });
    const cost = d.cost && typeof d.cost[st.id] === "number" ? d.cost[st.id] : 0;
    const mins = d.time && typeof d.time[st.id] === "number" ? d.time[st.id] : null;
    return {
      process_key: pkey,
      state_key: key,
      stage_key: lane,
      stage_name: stage ? stage.name : "Processing",
      stage_order: stage ? stage.stage_order : 1,
      sort_order: withinLane[lane] * 10,
      state_type: studioStateTypeForRole(st),
      name: st.label || st.id || key,
      entry_action: "",
      exit_action: "",
      description: "",
      owner_role: (d.owner && d.owner[st.id]) || st.role || "",
      sla_minutes: null,
      expected_duration_minutes: mins,
      cost_min: cost,
      cost_max: cost,
      /* NOTE: manual_x and manual_y are deliberately NOT SET AT ALL — not
         even to null.
         editorDataToUnified() tests them with
             const sx = Number(state.manual_x);
             if (Number.isFinite(sx) && Number.isFinite(sy)) layout[id] = {x:sx,y:sy};
         and Number(null) is 0, which IS finite. Setting them to null therefore
         pins every state to (0,0) and stacks the whole workflow in one spot.
         Leaving the keys absent gives Number(undefined) -> NaN, the check
         fails, and the editor computes its own layout — which is what the
         authored samples rely on, since they omit these keys too.
         d.pos is Studio coordinates in any case; the editor canvas is a
         different coordinate space (EDITOR_CANVAS_SIZE = 12000). */
    };
  });

  const usedKeys = new Set();
  const transitions = (wf.transitions || []).reduce(function (out, t, i) {
    const from = keyFor.get(t.from);
    const to = keyFor.get(t.to);
    if (!from || !to) return out;              /* drop dangling edges */
    let tkey = editorKey(from + "_" + t.on + "_" + to, "T" + (i + 1));
    const base = tkey;
    let n = 2;
    while (usedKeys.has(tkey)) { tkey = base + "_" + (n++); }
    usedKeys.add(tkey);
    const p = d.branch && d.branch[t.from + "::" + t.on];
    out.push({
      process_key: pkey,
      transition_key: tkey,
      from_state_key: from,
      to_state_key: to,
      event_name: t.on || "event",
      guard_condition: "",
      action: "",
      description: "",
      sort_order: (i + 1) * 10,
      cost_min: 0,
      cost_max: 0,
      branch_probability: typeof p === "number" ? p : null
    });
    return out;
  }, []);

  return {
    process: {
      process_key: pkey,
      name: d.name || wf.name || "Workflow",
      description: "",
      process_domain: "",
      owner_team: "",
      naming_convention: "",
      default_currency: "USD"
    },
    stages: stages,
    states: states,
    transitions: transitions,
    costs: []
  };
}

function studioDocToEditorData(d) {
    /* No editor structure to update: synthesise one from the IR, so presets and
       engine fixtures open in the Workflow Editor instead of arriving empty. */
    if (d && d.wf && (!d.editorData || !isEditorData(d.editorData)))
        return studioIRToEditorData(d);
    if (!d || !d.editorData || !isEditorData(d.editorData))
        return null;
    const data = dom_1.clone(d.editorData);
    const idFor = editorWorkflowIdMap(data); // state_key -> studio id (same derivation as import)
    const keyForId = new Map();
    idFor.forEach((id, key) => keyForId.set(id, key));
    const wfStates = Array.isArray(d.wf && d.wf.states) ? d.wf.states : [];
    const byId = new Map(wfStates.map(s => [s.id, s]));
    const hasCostRows = Array.isArray(data.costs) && data.costs.length > 0;
    // Baselines the import derived, so we only write back genuine changes.
    const derivedCost = {};
    const derivedMin = {};
    (data.states || []).forEach((state) => {
        const id = idFor.get(String(state.state_key || ""));
        if (!id)
            return;
        derivedMin[id] = editorNum(state.expected_duration_minutes !== null && state.expected_duration_minutes !== undefined ? state.expected_duration_minutes : state.step_minutes);
        if (!hasCostRows)
            derivedCost[id] = (derivedCost[id] || 0) + editorMid(state.cost_min, state.cost_max);
    });
    if (!hasCostRows)
        (data.transitions || []).forEach((tr) => {
            const id = idFor.get(String(tr.from_state_key || ""));
            if (id)
                derivedCost[id] = (derivedCost[id] || 0) + editorMid(tr.cost_min, tr.cost_max);
        });
    // 1. Update or remove existing editor states.
    const removedKeys = new Set();
    data.states = (data.states || []).filter((state) => {
        const key = String(state.state_key || "");
        const id = idFor.get(key);
        const ws = id ? byId.get(id) : null;
        if (!ws) {
            removedKeys.add(key);
            return false;
        }
        const derivedLabel = String(state.name || state.label || state.state_key || id);
        if (ws.label && String(ws.label) !== derivedLabel)
            state.name = String(ws.label);
        const mins = Number(d.time && d.time[id]);
        if (Number.isFinite(mins) && mins !== derivedMin[id])
            state.expected_duration_minutes = mins;
        if (!hasCostRows) {
            const c = Number(d.cost && d.cost[id]);
            if (Number.isFinite(c) && c !== (derivedCost[id] || 0)) {
                state.cost_min = c; // lossy by design: transition costs fold into the box
                state.cost_max = c;
            }
        }
        return true;
    });
    // Clean per-state dependency lists of removed prerequisites.
    if (removedKeys.size)
        data.states.forEach((state) => {
            if (Array.isArray(state.depends_on))
                state.depends_on = state.depends_on.filter((k) => !removedKeys.has(String(k)));
        });
    // 2. Append states created in the Studio.
    const sortedStages = (Array.isArray(data.stages) ? data.stages.slice() : [])
        .sort((a, b) => editorNum(a.stage_order) - editorNum(b.stage_order));
    const firstStage = sortedStages[0] || null;
    const stageKeyByName = new Map((data.stages || []).map((s) => [String(s.name || ""), String(s.stage_key || "")]));
    wfStates.forEach((ws, index) => {
        if (keyForId.has(ws.id))
            return;
        const stageName = String((d.stage && d.stage[ws.id]) || "");
        const stage_key = stageKeyByName.get(stageName) || String((firstStage && firstStage.stage_key) || "stage_1");
        const state_key = editorKey(ws.id, "S" + (index + 1));
        data.states.push({
            process_key: data.process && data.process.process_key,
            state_key,
            stage_key,
            sort_order: 100 + index,
            state_type: studioStateTypeForRole(ws),
            name: String(ws.label || ws.id),
            owner_role: String((d.owner && d.owner[ws.id]) || ""),
            expected_duration_minutes: Number(d.time && d.time[ws.id]) || 0,
            cost_min: Number(d.cost && d.cost[ws.id]) || 0,
            cost_max: Number(d.cost && d.cost[ws.id]) || 0
        });
        keyForId.set(ws.id, state_key);
        idFor.set(state_key, ws.id);
    });
    // 3. Reconcile transitions (matched by from|event|to in the Studio's terms).
    const wfTrans = Array.isArray(d.wf && d.wf.transitions) ? d.wf.transitions : [];
    const wanted = new Set(wfTrans.map(t => t.from + "|" + t.on + "|" + t.to));
    const allTr = data.transitions || [];
    const trKeys = allTr.map((tr, index) => editorDocTransitionKey(data, tr, index, idFor));
    const present = new Set();
    data.transitions = allTr.filter((tr, index) => {
        if (removedKeys.has(String(tr.from_state_key || "")) || removedKeys.has(String(tr.to_state_key || "")))
            return false;
        const k = trKeys[index];
        if (!wanted.has(k))
            return false;
        present.add(k);
        return true;
    });
    const usedTrKeys = new Set(data.transitions.map((t) => String(t.transition_key || "")));
    let seq = 1;
    wfTrans.forEach((t) => {
        const k = t.from + "|" + t.on + "|" + t.to;
        if (present.has(k))
            return;
        const fromKey = keyForId.get(t.from), toKey = keyForId.get(t.to);
        if (!fromKey || !toKey)
            return;
        let tk = "T_" + editorKey(t.from + "_" + t.on + "_" + t.to, "t" + seq);
        while (usedTrKeys.has(tk))
            tk = tk + "_" + (seq++);
        usedTrKeys.add(tk);
        data.transitions.push({
            process_key: data.process && data.process.process_key,
            transition_key: tk,
            event_name: String(t.on || "go"),
            from_state_key: fromKey,
            to_state_key: toKey,
            sort_order: 100
        });
        present.add(k);
    });
    return data;
}

/* main.ts:2376-2376 */
function toolHasComputed(d, i) { return (d.toolIds[i] || []).length > 0; }

/* main.ts:2377-2377 */
function toolActive(d, i) { return (d.toolIds[i] || []).some(id => d.applied.has(id)); }

/* main.ts:2379-2379 */
function resetTools(d) { d.sugs = {}; d.toolIds = [[], [], [], [], [], []]; d.applied = new Set(); d.overruled = new Set(); d.overlay = emptyOverlay(); layoutMissing(d); }

/* main.ts:2426-2426 */
function plainDoc(dd) { return { id: dd.id, name: dd.name, wf: dd.wf, pos: dd.pos, cost: dd.cost, time: dd.time, branch: dd.branch, owner: dd.owner, stage: dd.stage, editorData: dd.editorData, activeTools: activeToolIndexes(dd), overruled: [...dd.overruled] }; }

/* main.ts:2427-2443 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function hydrateDoc(dd) {
    const d = { id: dd.id || ("wf" + Math.random().toString(36).slice(2, 6)), name: dd.name || "Workflow", wf: dd.wf, pos: dd.pos || {}, cost: dd.cost || {}, time: dd.time || {}, branch: dd.branch || {}, owner: dd.owner || {}, stage: dd.stage || {}, editorData: dd.editorData, sugs: {}, toolIds: [[], [], [], [], [], []], applied: new Set(), overruled: new Set(), overlay: emptyOverlay() };
    if (Array.isArray(dd.activeTools)) {
        for (const i of dd.activeTools) {
            if (typeof i === "number" && i >= 0 && i < 6) {
                fire("recomputeTools", { doc: d, tool: i });
                for (const id of d.toolIds[i])
                    d.applied.add(id);
            }
        }
    }
    if (Array.isArray(dd.overruled))
        for (const id of dd.overruled)
            d.overruled.add(id);
    rebuild(d);
    return d;
}

/* main.ts:2444-2450 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function persist() {
    const current = active >= 0 ? D() : null;
    const access = current && (current.adminWorkflowAccess ||
        current.adminWorkflowEdit || current.adminWorkflowView);
    if (access && access.mode === "view")
        return;
    /* workspace view state is ephemeral; saved workflows live in the database.
     * Prompt1: keep the Workflow Editor showing the same thing the Analysis
     * screen is working on — push the (possibly changed) model back. */
    try { fire("pushToEditor"); }
    catch (e) { }
}

/* main.ts:2451-2455 */
function restoreState() { try {
    // one-time cleanup of pre-database browser storage
    ["plumbline_remember", "plumbline_studio_v1", USER_DB_KEY, SESSION_KEY].forEach(k => localStorage.removeItem(k));
}
catch (e) { } }

/* main.ts:2456-2459 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function commit() {
    if (active < 0) { fire("change"); return; }
    const d = D();
    const access = d && (d.adminWorkflowAccess || d.adminWorkflowEdit || d.adminWorkflowView);
    if (access && access.mode === "view") {
        fire("change");
        return;
    }
    resetTools(d);
    /* was: renderCanvas(); renderTable(); renderInspector(); syncJson();
       renderTools(); syncToolButtons();  - now the "change" hook. */
    fire("change");
    persist();
}


/* ---------------------------------------------------------------------------
 * Accessors. Screen modules must use these rather than importing the bindings,
 * so there is exactly one docs[]/active in the application.
 * -------------------------------------------------------------------------*/
exports.getDocs      = function () { return docs; };
exports.setDocs      = function (a) { docs = a; };   /* init() resets the list */
exports.closeDoc     = function (index) {
    if (docs.length <= 1 || index < 0 || index >= docs.length)
        return false;
    docs.splice(index, 1);
    if (active === index)
        active = Math.min(index, docs.length - 1);
    else if (active > index)
        active--;
    sel = null;
    lastTool = -2;
    fire("change");
    return true;
};
exports.getActive    = function () { return active; };
exports.setActive    = function (i) { active = i; };
exports.getSel       = function () { return sel; };
exports.setSel       = function (s) { sel = s; };
exports.getLastTool  = function () { return lastTool; };
exports.setLastTool  = function (t) { lastTool = t; };
exports.isPanelHidden= function () { return panelHidden; };
exports.setPanelHidden = function (v) { panelHidden = v; };

/* ---- exports ---- */
exports["ROLES"] = ROLES;
exports["ROLE_COLOR"] = ROLE_COLOR;
exports["CHIPS"] = CHIPS;
exports["NW"] = NW;
exports["GRID"] = GRID;
exports["USER_DB_KEY"] = USER_DB_KEY;
exports["SCAFFOLD"] = SCAFFOLD;
exports["emptyOverlay"] = emptyOverlay;
exports["estimate"] = estimate;
exports["mkDoc"] = mkDoc;
exports["emptyWf"] = emptyWf;
exports["startWf"] = startWf;
exports["addAfter"] = addAfter;
exports["blankWf"] = blankWf;
exports["normalise"] = normalise;
exports["autoLayout"] = autoLayout;
exports["tidyLayout"] = tidyLayout;
exports["placeNew"] = placeNew;
exports["layoutMissing"] = layoutMissing;
exports["D"] = D;
exports["ensureDoc"] = ensureDoc;
exports["outOf"] = outOf;
exports["roleOf"] = roleOf;
exports["reachable"] = reachable;
exports["depthMap"] = depthMap;
exports["backEdges"] = backEdges;
exports["pathBetween"] = pathBetween;
exports["effective"] = effective;
exports["rebuild"] = rebuild;
exports["totals"] = totals;
exports["hasEditorCanvas"] = hasEditorCanvas;
exports["uid"] = uid;
exports["rename"] = rename;
exports["activeToolIndexes"] = activeToolIndexes;
exports["unified"] = unified;
exports["safe"] = safe;
exports["ingest"] = ingest;
exports["editorNum"] = editorNum;
exports["editorMid"] = editorMid;
exports["editorKey"] = editorKey;
exports["editorRole"] = editorRole;
exports["editorDataSignature"] = editorDataSignature;
exports["isEditorData"] = isEditorData;
exports["editorDataToUnified"] = editorDataToUnified;
exports["editorWorkflowIdMap"] = editorWorkflowIdMap;
exports["editorDocTransitionKey"] = editorDocTransitionKey;
exports["studioStateTypeForRole"] = studioStateTypeForRole;
exports["studioDocToEditorData"] = studioDocToEditorData;
exports["studioIRToEditorData"] = studioIRToEditorData;
exports["toolHasComputed"] = toolHasComputed;
exports["toolActive"] = toolActive;
exports["resetTools"] = resetTools;
exports["plainDoc"] = plainDoc;
exports["hydrateDoc"] = hydrateDoc;
exports["persist"] = persist;
exports["restoreState"] = restoreState;
exports["commit"] = commit;

}, {"@plumbline/io":"packages/io/src/index.ts"});

