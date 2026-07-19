__PL.define("studio/main.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const io_1 = require("@plumbline/io");
const app_1 = require("@plumbline/app");
const lemma_1 = require("@plumbline/lemma");
const presets_1 = require("./presets");
const ROLES = ["step", "quality", "hold", "decision", "rework", "terminal"];
const ROLE_COLOR = { step: "#1F7A6F", quality: "#3A9D90", hold: "#7B8694", decision: "#16243B", rework: "#B8862F", terminal: "#2E7D32" };
const CHIPS = [
    { k: "start", label: "Start", role: "step", init: true }, { k: "step", label: "Step", role: "step" },
    { k: "quality", label: "Quality", role: "quality" }, { k: "decision", label: "Decision", role: "decision" },
    { k: "hold", label: "Hold", role: "hold" }, { k: "rework", label: "Rework", role: "rework" },
    { k: "accept", label: "Accept", role: "terminal", acc: true }, { k: "reject", label: "Reject", role: "terminal", rej: true }
];
const NW = 140, NH = 58, COLW = 200, ROWH = 104, PAD = 40;
const GRID = 20;
const fmt = (n) => "$" + Math.round(n).toLocaleString();
const fmin = (n) => Math.round(n) + " min";
let docs = [];
let currentUser = null;
const USER_DB_KEY = "plumbline_users_v2", SESSION_KEY = "plumbline_session_v2";
let active = 0; // index into docs, or -1 for Sigma view
let lastTool = -2; // -2 none, -1 apply-all, 0..5 a tool
let panelHidden = false;
let sel = null;
let latestEditorData = null;
let latestEditorSignature = "";
let latestEditorImportedSignature = "";
function $(id) { return document.getElementById(id); }
function flash(msg) { const h = document.getElementById("cthint"); if (h) {
    const old = h.textContent;
    h.textContent = msg;
    h.style.color = "#B2453C";
    setTimeout(() => { h.textContent = old; h.style.color = ""; }, 2600);
} }
if (typeof window !== "undefined")
    window.addEventListener("error", e => { const b = document.getElementById("err"); if (b) {
        b.style.display = "block";
        b.textContent = "Studio error: " + (e.message || String(e.error || e));
    } });
function el(t, a = {}, ...k) { const n = document.createElement(t); for (const x in a)
    n.setAttribute(x, a[x]); for (const c of k)
    n.append(typeof c === "string" ? document.createTextNode(c) : c); return n; }
function svg(t, a = {}) { const n = document.createElementNS("http://www.w3.org/2000/svg", t); for (const x in a)
    n.setAttribute(x, a[x]); return n; }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function emptyOverlay() { return { bands: [], flag: {}, edge: {}, ghosts: [], stageTag: {} }; }
const ANALYSIS_STAGE_COLORS = ["#1F7A6F", "#3A9D90", "#5B4B8A", "#B8862F", "#2E7D32", "#C8842A", "#2563eb", "#7e22ce"];
/* ---------- doc construction ---------- */
function labelHash(s) { let h = 0; for (let i = 0; i < s.length; i++)
    h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function estimate(d) {
    var _a;
    for (const s of d.wf.states) {
        const r = s.role, h = labelHash((s.label || s.id) + r);
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
function mkDoc(wf) {
    const d = { id: wf.id + "_" + Math.random().toString(36).slice(2, 6), name: wf.name, wf: clone(wf), pos: {}, cost: {}, time: {}, branch: {}, owner: {}, stage: {},
        sugs: {}, toolIds: [[], [], [], [], [], []], applied: new Set(), overruled: new Set(), overlay: emptyOverlay() };
    estimate(d);
    d.pos = autoLayout(d.wf);
    return d;
}
function emptyWf(name) { return { id: "wf" + Date.now().toString(36), name, alphabet: [], states: [], transitions: [], initial: "", accepts: [], rejects: [] }; }
function startWf(name) { return { id: "wf" + Date.now().toString(36), name, alphabet: [], states: [{ id: "Start", label: "Start", role: "step", initial: true }], transitions: [], initial: "Start", accepts: [], rejects: [] }; }
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
let dragSpec = null;
function makeChip(spec) {
    const c = el("div", { class: "chip" }, spec.label);
    c.style.borderLeftColor = ROLE_COLOR[spec.role];
    c.title = "drag onto the canvas, or click to add";
    let moved = false, sx = 0, sy = 0;
    let ghost = null;
    const onMove = (e) => {
        if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4)
            moved = true;
        if (moved) {
            if (!ghost) {
                ghost = el("div", { class: "chip chipghost" }, spec.label);
                ghost.style.borderLeftColor = ROLE_COLOR[spec.role];
                document.body.append(ghost);
            }
            ghost.style.left = (e.clientX + 10) + "px";
            ghost.style.top = (e.clientY + 8) + "px";
        }
    };
    const onUp = (e) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (ghost) {
            ghost.remove();
            ghost = null;
        }
        if (moved) {
            const sc = $("cvscroll").getBoundingClientRect();
            if (e.clientX >= sc.left && e.clientX <= sc.right && e.clientY >= sc.top && e.clientY <= sc.bottom) {
                const r = $("cv").getBoundingClientRect();
                addChip(spec, e.clientX - r.left + ($("cvscroll").scrollLeft || 0), e.clientY - r.top + ($("cvscroll").scrollTop || 0));
            }
        }
    };
    c.addEventListener("mousedown", (e) => { if (e.button !== 0)
        return; e.preventDefault(); moved = false; sx = e.clientX; sy = e.clientY; document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp); });
    c.addEventListener("click", () => { if (moved) {
        moved = false;
        return;
    } addChip(spec); });
    return c;
}
function addChip(spec, x, y) {
    const d = ensureDoc();
    const id = uid(d, spec.role === "terminal" ? "T" : "S");
    const st = { id, label: spec.role === "terminal" ? (spec.acc ? "Accept" : "Reject") : "New", role: spec.role };
    if (spec.init || !d.wf.states.some(s => s.initial))
        st.initial = true;
    if (spec.acc)
        st.accept = true;
    if (spec.rej)
        st.reject = true;
    d.wf.states.push(st);
    d.cost[id] = spec.role === "terminal" ? 0 : spec.role === "rework" ? 120 : spec.role === "decision" ? 40 : spec.role === "quality" ? 60 : spec.role === "hold" ? 20 : 50;
    d.time[id] = spec.role === "terminal" ? 0 : spec.role === "rework" ? 90 : spec.role === "decision" ? 15 : spec.role === "quality" ? 45 : spec.role === "hold" ? 60 : 30;
    const k = d.wf.states.length;
    d.pos[id] = (x != null && y != null) ? { x: Math.max(0, x - NW / 2), y: Math.max(0, y - NH / 2) } : placeNew(d);
    resetTools(d);
    sel = { kind: "state", key: id };
    commit();
}
function blankWf(name) {
    return { id: "wf" + Date.now().toString(36), name, alphabet: ["start"],
        states: [{ id: "Start", label: "Start", role: "step", initial: true }, { id: "End", label: "Done", role: "terminal", accept: true }],
        transitions: [{ from: "Start", on: "start", to: "End" }], initial: "Start", accepts: ["End"], rejects: [] };
}
/* ---------- normalisation + layout ---------- */
function normalise(w) {
    var _a, _b, _c, _d;
    const alphabet = Array.from(new Set(w.transitions.map(t => t.on))).sort();
    const initial = (_d = (_b = ((_a = w.states.find(s => s.initial)) === null || _a === void 0 ? void 0 : _a.id)) !== null && _b !== void 0 ? _b : (_c = w.states[0]) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : "";
    return { ...w, alphabet, initial, accepts: w.states.filter(s => s.accept).map(s => s.id), rejects: w.states.filter(s => s.reject).map(s => s.id) };
}
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
function D() { return docs[active]; }
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
function ensureDoc() { if (active < 0) {
    docs.push(mkDoc(emptyWf("New workflow")));
    active = docs.length - 1;
    renderWfBar();
} return docs[active]; }
/* ---------- structural analysis helpers ---------- */
function outOf(w, id) { return w.transitions.filter(t => t.from === id); }
function roleOf(w, id) { var _a; return (_a = w.states.find(s => s.id === id)) === null || _a === void 0 ? void 0 : _a.role; }
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
function computeTool(d, i) {
    var _a, _b, _c, _d, _e;
    var _f;
    if (d.toolIds[i].length)
        return; // cached
    const w = normalise(d.wf);
    const made = [];
    const add = (s) => { const id = "t" + i + "_" + made.length; const full = { ...s, id, tool: i }; made.push(full); d.sugs[id] = full; d.toolIds[i].push(id); };
    if (i === 0) { // zoom out
        const dep = depthMap(w);
        const bands = {};
        for (const s of w.states) {
            const dd = (_a = dep[s.id]) !== null && _a !== void 0 ? _a : 0;
            (bands[dd] || (bands[dd] = [])).push(s.id);
        }
        const ids = Object.keys(bands).map(Number).sort((a, b) => a - b);
        add({ title: "Label " + ids.length + " big-picture stages", found: "The " + w.states.length + " statuses roll up cleanly into " + ids.length + " stages by depth from the start. Instead of drawing extra grouping boxes, each tile is labeled and outlined by its analysis stage.",
            time: w.states.length * 2, cost: 0, clarity: true,
            apply: (o) => { ids.forEach((dd, k) => { const label = "Stage " + (k + 1), color = ANALYSIS_STAGE_COLORS[k % ANALYSIS_STAGE_COLORS.length]; (bands[dd] || []).forEach(id => { o.stageTag[id] = { label, color }; }); }); } });
    }
    else if (i === 1) { // spot duplicates + dead
        const reach = reachable(w);
        const sig = {};
        for (const s of w.states) {
            if (s.terminal || s.initial) { }
            const o = outOf(w, s.id).map(t => roleOf(w, t.to)).sort().join(",");
            if (s.role !== "terminal" && !s.initial) {
                (sig[_f = s.role + "::" + o] || (sig[_f] = [])).push(s.id);
            }
        }
        for (const k in sig) {
            if (sig[k].length >= 2) {
                const grp = sig[k];
                const keep = grp[0];
                const drop = grp.slice(1);
                add({ title: drop.length + 1 + " identical steps → keep one", found: grp.join(", ") + " run the identical transitions. Maintain one, retire " + drop.join(", ") + ".",
                    time: drop.reduce((a, x) => a + (d.time[x] || 0), 0) / 2, cost: drop.reduce((a, x) => a + (d.cost[x] || 0), 0),
                    apply: (o) => { drop.forEach(x => o.flag[x] = { dim: true, badge: "merge → " + keep }); } });
            }
        }
        for (const s of w.states) {
            if (!reach.has(s.id))
                add({ title: "Dead branch: " + s.id, found: s.id + " cannot be reached from the start — it is dead and can be deleted.",
                    time: 0, cost: d.cost[s.id] || 0, apply: (o) => { o.flag[s.id] = { dim: true, badge: "unreachable — delete" }; } });
        }
        if (!made.length)
            add({ title: "No duplicates or dead branches", found: "Every step is reachable and behaviourally distinct — a clean result.", time: 0, cost: 0, clarity: true, apply: () => { } });
    }
    else if (i === 2) { // plan vs reality
        const hold = w.states.find(s => s.role === "hold") || w.states.find(s => s.role === "quality");
        const anchor = hold || w.states.find(s => s.role !== "terminal" && !s.initial) || w.states[0];
        const p = d.pos[anchor.id] || { x: PAD, y: PAD };
        const down = w.states.filter(s => s.role !== "terminal").reduce((a, s) => a + (d.cost[s.id] || 0), 0);
        add({ title: "Unplanned hold seen in the logs", found: "At “" + anchor.label + "” the executed logs show an out-of-order hold the documented process never authorises.",
            time: 30, cost: Math.round(down * 0.10),
            apply: (o) => { o.ghosts.push({ x: p.x, y: p.y - 58, text: "⚠ unplanned hold (in logs, not in plan)" }); o.flag[anchor.id] = { color: "#B2453C" }; } });
    }
    else if (i === 3) { // move the decision
        const decs = w.states.filter(s => s.role === "decision");
        const dep = depthMap(w);
        if (decs.length) {
            const late = decs.slice().sort((a, b) => { var _a, _b; return ((_a = dep[b.id]) !== null && _a !== void 0 ? _a : 0) - ((_b = dep[a.id]) !== null && _b !== void 0 ? _b : 0); })[0];
            const upstream = w.states.filter(s => { var _a, _b; return ((_a = dep[s.id]) !== null && _a !== void 0 ? _a : 0) < ((_b = dep[late.id]) !== null && _b !== void 0 ? _b : 0) && s.role !== "terminal"; });
            const saveC = Math.round(upstream.reduce((a, s) => a + (d.cost[s.id] || 0), 0) * 0.15);
            const saveT = Math.round(upstream.reduce((a, s) => a + (d.time[s.id] || 0), 0) * 0.15);
            add({ title: "Decide earlier at “" + late.label + "”", found: "The go/no-go at “" + late.label + "” can move ahead of the costly work upstream, scrapping cheap instead of finished.",
                time: saveT, cost: saveC,
                apply: (o, dd) => { const p = dd.pos[late.id]; if (p) {
                    dd.pos[late.id] = { x: Math.max(PAD, p.x - COLW), y: p.y };
                } o.flag[late.id] = { color: "#5B4B8A", badge: "moved earlier" }; } });
        }
        else
            add({ title: "No relocatable decision", found: "This workflow has no decision gate to move.", time: 0, cost: 0, clarity: true, apply: () => { } });
    }
    else if (i === 4) { // run in parallel
        const indeg = {};
        const outd = {};
        for (const t of w.transitions) {
            outd[t.from] = ((_b = outd[t.from]) !== null && _b !== void 0 ? _b : 0) + 1;
            indeg[t.to] = ((_c = indeg[t.to]) !== null && _c !== void 0 ? _c : 0) + 1;
        }
        const chain = [];
        for (const s of w.states) {
            if ((s.role === "step" || s.role === "quality") && ((_d = indeg[s.id]) !== null && _d !== void 0 ? _d : 0) <= 1 && ((_e = outd[s.id]) !== null && _e !== void 0 ? _e : 0) <= 1) {
                chain.push(s.id);
            }
        }
        // pick the two consecutive ones if any
        let pair = null;
        for (const t of w.transitions) {
            if (chain.includes(t.from) && chain.includes(t.to)) {
                pair = [t.from, t.to];
                break;
            }
        }
        if (pair) {
            const grp = pair;
            const tt = grp.map(x => d.time[x] || 0);
            const save = tt.reduce((a, b) => a + b, 0) - Math.max(...tt);
            add({ title: "Run “" + grp.map(x => w.states.find(s => s.id === x).label).join("” ∥ “") + "” in parallel", found: "These steps don’t depend on each other; running them together overlaps their time.",
                time: save, cost: 0,
                apply: (o, dd) => { const base = dd.pos[grp[0]]; if (base) {
                    grp.forEach((x, k) => dd.pos[x] = { x: base.x, y: base.y + k * 64 });
                } o.bands.push({ label: "parallel", ids: grp }); } });
        }
        else
            add({ title: "No independent steps to overlap", found: "The flow here is a strict sequence — nothing safely overlaps.", time: 0, cost: 0, clarity: true, apply: () => { } });
    }
    else if (i === 5) { // find the loops
        const be = backEdges(w);
        if (be.length) {
            be.forEach((e) => {
                const body = pathBetween(w, e.to, e.from);
                const saveC = Math.round(body.reduce((a, x) => a + (d.cost[x] || 0), 0) * 0.15);
                const saveT = Math.round(body.reduce((a, x) => a + (d.time[x] || 0), 0) * 0.15);
                add({ title: "Cap the loop “" + e.from + " → " + e.to + "”", found: "Work can cycle through " + body.join(" → ") + " → " + e.to + " with no bound — cap it (e.g. after 2 passes force an exit).",
                    time: saveT, cost: saveC,
                    apply: (o) => { o.edge[e.from + "|" + e.on + "|" + e.to] = "cap ≤ 2"; for (const id of body) {
                        o.flag[id] = { ...(o.flag[id] || {}), color: "#C8842A" };
                    } } });
            });
        }
        else
            add({ title: "No unbounded loops", found: "All flow moves forward — no rework cycle to cap.", time: 0, cost: 0, clarity: true, apply: () => { } });
    }
}
/* ---------- overlay + savings ---------- */
function effective(d) { const out = []; for (const ids of d.toolIds)
    for (const id of ids) {
        if (d.applied.has(id) && !d.overruled.has(id))
            out.push(d.sugs[id]);
    } return out; }
function rebuild(d) {
    // recompute layout-affecting suggestions cleanly. Editor-sourced graphs keep exact editor positions.
    const keepEditorPos = hasEditorCanvas(d) ? clone(d.pos) : null;
    layoutMissing(d);
    d.overlay = emptyOverlay();
    for (const s of effective(d))
        s.apply(d.overlay, d);
    if (keepEditorPos)
        d.pos = keepEditorPos;
}
function totals(d) { let c = 0, t = 0; for (const s of effective(d)) {
    c += s.cost;
    t += s.time;
} return { c, t }; }
/* ---------- editor-matched Analysis Studio canvas ---------- */
const EDITOR_CANVAS_SIZE = 12000;
const EDITOR_OFFSET = { x: Math.round(EDITOR_CANVAS_SIZE / 2 - 800), y: Math.round(EDITOR_CANVAS_SIZE / 2 - 340) };
const EDITOR_NODE_W = 176, EDITOR_NODE_H = 82;
let lastEditorScrollDoc = "";
let analysisViewDoc = "", analysisViewSig = "";
const analysisPan = { x: 0, y: 0, zoom: 1 };
let analysisShowAllLines = false;
let analysisIncreasedSpacing = false;
let currentAnalysisModel = null;
function analysisEditorPanActive() { return active >= 0 && !!docs[active] && hasEditorCanvas(docs[active]) && $("cv").classList.contains("analysisEditorCanvas"); }
function clampNum(n, min, max) { return Math.max(min, Math.min(max, n)); }
function editorContentBounds(model) { var _a, _b, _c, _d; let x0 = Number.POSITIVE_INFINITY, y0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY, y1 = Number.NEGATIVE_INFINITY; const add = (p) => { if (!p)
    return; const x = Number(p.x), y = Number(p.y), w = Number(p.w || 0), h = Number(p.h || 0); if (!Number.isFinite(x) || !Number.isFinite(y))
    return; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }; (_a = model.stagePositions) === null || _a === void 0 ? void 0 : _a.forEach((p) => add(p)); (_b = model.positions) === null || _b === void 0 ? void 0 : _b.forEach((p) => add(p)); if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 900;
    y1 = 520;
} const ox = Number(((_c = model.contentOffset) === null || _c === void 0 ? void 0 : _c.x) || 0), oy = Number(((_d = model.contentOffset) === null || _d === void 0 ? void 0 : _d.y) || 0), pad = 64; return { x: x0 + ox - pad, y: y0 + oy - pad, w: Math.max(1, x1 - x0 + pad * 2), h: Math.max(1, y1 - y0 + pad * 2) }; }
function updateAnalysisZoomUi() {
    const scroll = $("cvscroll");
    const z = analysisPan.zoom;
    scroll.classList.toggle("analysisZoomTiny", z < 0.30);
    scroll.classList.toggle("analysisZoomSmall", z >= 0.30 && z < 0.58);
    scroll.classList.toggle("analysisZoomNormal", z >= 0.58);
    const pct = document.getElementById("analysisZoomPct");
    if (pct)
        pct.textContent = Math.round(z * 100) + "%";
}
function applyAnalysisPanZoom() { const cv = $("cv"); cv.style.transformOrigin = "0 0"; cv.style.transform = `translate(${analysisPan.x}px, ${analysisPan.y}px) scale(${analysisPan.zoom})`; updateAnalysisZoomUi(); }
function fitEditorAnalysisToView(model) { const scroll = $("cvscroll"); const b = editorContentBounds(model); const vw = Math.max(1, scroll.clientWidth || 900), vh = Math.max(1, scroll.clientHeight || 560); const margin = 104; const z = clampNum(Math.min((vw - margin) / b.w, (vh - margin) / b.h), 0.055, 1.15); analysisPan.zoom = z; analysisPan.x = (vw - b.w * z) / 2 - b.x * z; analysisPan.y = (vh - b.h * z) / 2 - b.y * z; applyAnalysisPanZoom(); }
function zoomAnalysisAt(mx, my, factor) { const beforeX = (mx - analysisPan.x) / analysisPan.zoom, beforeY = (my - analysisPan.y) / analysisPan.zoom; analysisPan.zoom = clampNum(analysisPan.zoom * factor, 0.055, 2.75); analysisPan.x = mx - beforeX * analysisPan.zoom; analysisPan.y = my - beforeY * analysisPan.zoom; applyAnalysisPanZoom(); }
function zoomAnalysisCenter(factor) { const scroll = $("cvscroll"); zoomAnalysisAt((scroll.clientWidth || 900) / 2, (scroll.clientHeight || 560) / 2, factor); }
function ensureAnalysisHud() {
    const scroll = $("cvscroll");
    let hud = document.getElementById("analysisNavHud");
    if (!hud) {
        hud = document.createElement("div");
        hud.id = "analysisNavHud";
        hud.innerHTML = '<div class="analysisHudTitle">Analysis view</div><div class="analysisHudHint">Drag the background · wheel to zoom · click a tile or connector to inspect</div><div class="analysisHudToggles"><label><input id="analysisShowAllLines" type="checkbox"> Show all lines</label><label><input id="analysisIncreasedSpacing" type="checkbox"> Increased spacing</label></div><div class="analysisHudActions"><button id="analysisFitBtn" type="button">Fit</button><button id="analysisOneBtn" type="button">100%</button><button id="analysisMinusBtn" type="button">−</button><span id="analysisZoomPct">100%</span><button id="analysisPlusBtn" type="button">+</button></div>';
        hud.title = "Drag the background · wheel to zoom · click a tile or connector to inspect";
        // Prompt1: the Analysis View controls live in the header (upper right),
        // laid out horizontally. Fall back to the canvas overlay if the dock
        // is missing (e.g. older shells).
        (document.getElementById("analysisHudDock") || scroll).appendChild(hud);
        const showAll = document.getElementById("analysisShowAllLines");
        const roomy = document.getElementById("analysisIncreasedSpacing");
        showAll.checked = analysisShowAllLines;
        roomy.checked = analysisIncreasedSpacing;
        showAll.onchange = () => { analysisShowAllLines = showAll.checked; renderCanvas(); };
        roomy.onchange = () => { analysisIncreasedSpacing = roomy.checked; analysisViewSig = ""; renderCanvas(); };
        document.getElementById("analysisFitBtn").onclick = () => { if (currentAnalysisModel)
            fitEditorAnalysisToView(currentAnalysisModel); };
        document.getElementById("analysisOneBtn").onclick = () => { const sc = $("cvscroll"); zoomAnalysisAt((sc.clientWidth || 900) / 2, (sc.clientHeight || 560) / 2, 1 / analysisPan.zoom); };
        document.getElementById("analysisMinusBtn").onclick = () => zoomAnalysisCenter(0.82);
        document.getElementById("analysisPlusBtn").onclick = () => zoomAnalysisCenter(1.22);
    }
    updateAnalysisZoomUi();
}
function setAnalysisPanMode(on) { var _a; const scroll = $("cvscroll"); scroll.classList.toggle("analysisPanView", on); scroll.classList.remove("panning"); document.body.classList.remove("analysisPanning"); if (on) {
    ensureAnalysisHud();
}
else {
    const cv = $("cv");
    cv.style.transform = "";
    cv.style.transformOrigin = "";
    scroll.classList.remove("analysisZoomTiny", "analysisZoomSmall", "analysisZoomNormal");
    (_a = document.getElementById("analysisNavHud")) === null || _a === void 0 ? void 0 : _a.remove();
    currentAnalysisModel = null;
} }
function setupAnalysisPanZoom() { const scroll = $("cvscroll"); let dragging = false, sx = 0, sy = 0, px = 0, py = 0; const interactive = (target) => { const el = target; return !!(el && typeof el.closest === "function" && el.closest(".analysisEditorNode,.analysisEditorEdge,.analysisEditorEdgeHit,.analysisEditorLabel,.analysisEditorLabelBg,.analysisExitText,.analysisNodeKey,.analysisNodeName,.analysisNodeMeta,.analysisNodeBadge,#analysisNavHud,#analysisNavHud *")); }; scroll.addEventListener("pointerdown", (ev) => { if (!analysisEditorPanActive() || ev.button !== 0 || interactive(ev.target))
    return; ev.preventDefault(); dragging = true; sx = ev.clientX; sy = ev.clientY; px = analysisPan.x; py = analysisPan.y; scroll.classList.add("panning"); document.body.classList.add("analysisPanning"); try {
    scroll.setPointerCapture(ev.pointerId);
}
catch (e) { } }); scroll.addEventListener("pointermove", (ev) => { if (!dragging)
    return; ev.preventDefault(); analysisPan.x = px + (ev.clientX - sx); analysisPan.y = py + (ev.clientY - sy); applyAnalysisPanZoom(); }); const end = (ev) => { if (!dragging)
    return; dragging = false; scroll.classList.remove("panning"); document.body.classList.remove("analysisPanning"); try {
    scroll.releasePointerCapture(ev.pointerId);
}
catch (e) { } }; scroll.addEventListener("pointerup", end); scroll.addEventListener("pointercancel", end); scroll.addEventListener("lostpointercapture", end); scroll.addEventListener("dblclick", (ev) => { if (!analysisEditorPanActive() || interactive(ev.target))
    return; if (currentAnalysisModel) {
    ev.preventDefault();
    fitEditorAnalysisToView(currentAnalysisModel);
} }); scroll.addEventListener("wheel", (ev) => { if (!analysisEditorPanActive())
    return; ev.preventDefault(); const rect = scroll.getBoundingClientRect(); const mx = ev.clientX - rect.left, my = ev.clientY - rect.top; const factor = Math.exp(-ev.deltaY * 0.0012); zoomAnalysisAt(mx, my, factor); }, { passive: false }); }
function hexToRgba(hex, alpha) { const raw = String(hex || "").replace("#", ""); const full = raw.length === 3 ? raw.split("").map(x => x + x).join("") : raw; const n = parseInt(full, 16); if (!Number.isFinite(n))
    return `rgba(31,122,111,${alpha})`; return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`; }
function editorVisualKey(v) { return String(v || "NORMAL").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "NORMAL"; }
function editorTypeDef(data, type) { const key = editorVisualKey(type); const built = { START: { fill: "#dbeafe", stroke: "#2563eb" }, NORMAL: { fill: "#f8fafc", stroke: "#94a3b8" }, WARNING: { fill: "#fef3c7", stroke: "#b45309" }, ERROR: { fill: "#fee2e2", stroke: "#b91c1c" }, FINAL: { fill: "#dcfce7", stroke: "#047857" } }; if (built[key])
    return built[key]; const custom = (Array.isArray(data === null || data === void 0 ? void 0 : data.custom_state_types) ? data.custom_state_types : []).find((x) => editorVisualKey(x.type_key || x.key || x.name || x.label) === key); return { fill: (custom === null || custom === void 0 ? void 0 : custom.fill_color) || (custom === null || custom === void 0 ? void 0 : custom.fillColor) || "#eef2ff", stroke: (custom === null || custom === void 0 ? void 0 : custom.stroke_color) || (custom === null || custom === void 0 ? void 0 : custom.strokeColor) || "#4f46e5" }; }
function editorWorkflowIdMap(data) { const seen = new Set(); const out = new Map(); (Array.isArray(data === null || data === void 0 ? void 0 : data.states) ? data.states : []).forEach((state, index) => { let id = editorKey(state.state_key, "S" + (index + 1)); const base = id; let n = 2; while (seen.has(id))
    id = base + "_" + (n++); seen.add(id); out.set(String(state.state_key || id), id); }); return out; }
function editorDocTransitionKey(data, transition, index, idFor) { const from = idFor.get(String(transition.from_state_key || "")) || editorKey(transition.from_state_key, "from"); const to = idFor.get(String(transition.to_state_key || "")) || editorKey(transition.to_state_key, "to"); const used = new Set(); (Array.isArray(data === null || data === void 0 ? void 0 : data.transitions) ? data.transitions : []).slice(0, index).forEach((t, i) => { if (String(t.from_state_key || "") === String(transition.from_state_key || ""))
    used.add(editorKey(t.event_name || t.transition_key, "event" + (i + 1))); }); let on = editorKey(transition.event_name || transition.transition_key, "event" + (index + 1)); const base = on; let n = 2; while (used.has(on))
    on = base + "_" + (n++); return from + "|" + on + "|" + to; }
function editorBuildBuckets(data) { const stages = [...(Array.isArray(data === null || data === void 0 ? void 0 : data.stages) ? data.stages : [])].sort((a, b) => editorNum(a.stage_order) - editorNum(b.stage_order)); const byStage = new Map(); stages.forEach((stage) => byStage.set(String(stage.stage_key || ""), [])); (Array.isArray(data === null || data === void 0 ? void 0 : data.states) ? data.states : []).forEach((state) => { const k = String(state.stage_key || ""); if (!byStage.has(k))
    byStage.set(k, []); byStage.get(k).push(state); }); byStage.forEach(list => list.sort((a, b) => (editorNum(a.sort_order) || 100) - (editorNum(b.sort_order) || 100))); return { stageOrder: stages, byStage }; }
function editorCanvasLayout(data) { const { stageOrder, byStage } = editorBuildBuckets(data); const nodeWidth = EDITOR_NODE_W, nodeHeight = EDITOR_NODE_H, rowGap = 50, categoryGap = 110, localColumnGap = 34, singleColumnStagger = 18, left = 58, top = 118; const positions = new Map(), stagePositions = new Map(); let cursorX = left, maxX = 0, maxY = 0; const yOffsets = [0, 84, 34, 112, 58]; stageOrder.forEach((stage, col) => { const nodes = byStage.get(String(stage.stage_key || "")) || []; const dense = nodes.length > 5, localCols = dense ? 2 : 1; const localWidth = localCols * nodeWidth + (localCols - 1) * localColumnGap; const baseX = Number.isFinite(Number(stage.manual_x)) ? Number(stage.manual_x) + 18 : cursorX; const baseY = Number.isFinite(Number(stage.manual_y)) ? Number(stage.manual_y) + 62 : top + yOffsets[col % yOffsets.length]; nodes.forEach((state, index) => { const localCol = localCols === 2 ? index % 2 : 0, localRow = Math.floor(index / localCols); const staggerX = localCols === 1 ? (localRow % 2) * singleColumnStagger : 0; const staggerY = localCols === 2 && localCol ? 24 : 0; const autoX = baseX + localCol * (nodeWidth + localColumnGap) + staggerX; const autoY = baseY + localRow * (nodeHeight + rowGap) + staggerY; const x = Number.isFinite(Number(state.manual_x)) ? Number(state.manual_x) : autoX; const y = Number.isFinite(Number(state.manual_y)) ? Number(state.manual_y) : autoY; positions.set(String(state.state_key || ""), { x, y, w: nodeWidth, h: nodeHeight, stage, row: index, col }); maxX = Math.max(maxX, x + nodeWidth); maxY = Math.max(maxY, y + nodeHeight); }); const ps = nodes.map((state) => positions.get(String(state.state_key || ""))).filter(Boolean); let panel; if (ps.length) {
    const minNodeX = Math.min(...ps.map((pos) => pos.x)), minNodeY = Math.min(...ps.map((pos) => pos.y)), maxNodeX = Math.max(...ps.map((pos) => pos.x + pos.w)), maxNodeY = Math.max(...ps.map((pos) => pos.y + pos.h));
    panel = { x: minNodeX - 28, y: Math.max(18, minNodeY - 62), w: Math.max(localWidth + 56, maxNodeX - minNodeX + 56), h: Math.max(142, maxNodeY - minNodeY + 92), col };
}
else
    panel = { x: baseX - 28, y: Math.max(18, baseY - 62), w: localWidth + 56, h: 142, col }; stagePositions.set(String(stage.stage_key || ""), panel); maxX = Math.max(maxX, panel.x + panel.w); maxY = Math.max(maxY, panel.y + panel.h); cursorX += localWidth + categoryGap; }); return { layoutStyle: "freeform", stageOrder, byStage, positions, stagePositions, width: EDITOR_CANVAS_SIZE, height: EDITOR_CANVAS_SIZE, contentOffset: EDITOR_OFFSET, nodeWidth, nodeHeight }; }
function editorRouteKind(from, to) { if (from.col === to.col)
    return "same"; if (to.col > from.col + 1)
    return "longForward"; if (to.col > from.col)
    return "adjacentForward"; return "backward"; }
function editorAssignRouteLanes(data, model) { const counters = new Map(), lanes = new Map(); (Array.isArray(data === null || data === void 0 ? void 0 : data.transitions) ? data.transitions : []).forEach((transition) => { const from = model.positions.get(String(transition.from_state_key || "")), to = model.positions.get(String(transition.to_state_key || "")); if (!from || !to)
    return; const kind = editorRouteKind(from, to), key = `${kind}:${Math.min(from.col, to.col)}:${Math.max(from.col, to.col)}`; const lane = counters.get(key) || 0; counters.set(key, lane + 1); lanes.set(String(transition.transition_key || transition.event_name || ""), lane); }); return lanes; }
function editorMakeEdgePath(from, to, index, lane = 0) { const fromCx = from.x + from.w / 2, fromCy = from.y + from.h / 2, toCx = to.x + to.w / 2, toCy = to.y + to.h / 2; const dx = toCx - fromCx, dy = toCy - fromCy, spread = ((lane % 7) - 3) * 14 + (index % 3 - 1) * 5; if (from.x === to.x && from.y === to.y) {
    const sx = from.x + from.w, sy = fromCy - 10, tx = from.x + from.w, ty = fromCy + 10, loopX = from.x + from.w + 64 + lane * 8;
    return { d: `M ${sx} ${sy} C ${loopX} ${sy - 58} ${loopX} ${ty + 58} ${tx} ${ty}`, labelX: loopX - 12, labelY: fromCy - 2 };
} if (Math.abs(dx) >= Math.abs(dy)) {
    const forward = dx >= 0, sx = forward ? from.x + from.w : from.x, sy = fromCy, tx = forward ? to.x - 10 : to.x + to.w + 10, ty = toCy, c1x = sx + (forward ? 0.42 : -0.42) * Math.max(120, Math.abs(dx)), c1y = sy + spread, c2x = tx - (forward ? 0.42 : -0.42) * Math.max(120, Math.abs(dx)), c2y = ty - spread;
    return { d: `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${tx} ${ty}`, labelX: (sx + tx + c1x + c2x) / 4, labelY: (sy + ty + c1y + c2y) / 4 - 8 };
} const downward = dy >= 0, sx = fromCx, sy = downward ? from.y + from.h : from.y, tx = toCx, ty = downward ? to.y - 10 : to.y + to.h + 10, c1x = sx + spread, c1y = sy + (downward ? 0.42 : -0.42) * Math.max(120, Math.abs(dy)), c2x = tx - spread, c2y = ty - (downward ? 0.42 : -0.42) * Math.max(120, Math.abs(dy)); return { d: `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${tx} ${ty}`, labelX: (sx + tx + c1x + c2x) / 4, labelY: (sy + ty + c1y + c2y) / 4 - 8 }; }
function editorWrapText(text, maxChars) { const words = String(text || "").split(/\s+/).filter(Boolean), lines = []; let current = ""; words.forEach(word => { const next = current ? `${current} ${word}` : word; if (next.length > maxChars && current) {
    lines.push(current);
    current = word;
}
else
    current = next; }); if (current)
    lines.push(current); return lines.slice(0, 2); }
function editorEllipsize(text, maxChars) { const s = String(text || "").replace(/\s+/g, " ").trim(); const n = Math.max(3, Math.floor(Number(maxChars) || 24)); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…"; }
function editorLabelize(text) { return String(text || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "transition"; }
function editorMoney(min, max) { const a = editorNum(min), b = (max === undefined || max === null || max === "") ? a : editorNum(max); if (!a && !b)
    return "$0"; if (a === b)
    return "$" + a.toLocaleString(undefined, { maximumFractionDigits: 2 }); return "$" + a.toLocaleString(undefined, { maximumFractionDigits: 2 }) + "-$" + b.toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function editorIsMainFlowTransition(data, transition, model) { const from = model.positions.get(String(transition.from_state_key || "")), to = model.positions.get(String(transition.to_state_key || "")); const toState = (data.states || []).find((s) => String(s.state_key) === String(transition.to_state_key)), fromState = (data.states || []).find((s) => String(s.state_key) === String(transition.from_state_key)); if (!from || !to || !toState || !fromState)
    return false; if (to.col < from.col)
    return false; if (["ERROR", "WARNING"].includes(editorVisualKey(toState.state_type)))
    return false; if (["ERROR", "WARNING"].includes(editorVisualKey(fromState.state_type)))
    return false; if (/cancel|reject|fail|fraud|chargeback|dispute|jam|locked|timeout|low|no_show|leaves|worsened|sos/i.test(transition.event_name || ""))
    return false; return true; }
function analysisRebuildStagePanels(model) {
    const byStage = model.byStage || new Map();
    (model.stageOrder || []).forEach((stage) => {
        const key = String(stage.stage_key || ""), nodes = (byStage.get(key) || []).map((state) => model.positions.get(String(state.state_key || ""))).filter(Boolean);
        const old = model.stagePositions.get(key) || { x: 58, y: 18, w: 220, h: 142, col: 0 };
        if (!nodes.length) {
            model.stagePositions.set(key, old);
            return;
        }
        const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
        const maxX = Math.max(...nodes.map((n) => n.x + n.w)), maxY = Math.max(...nodes.map((n) => n.y + n.h));
        model.stagePositions.set(key, { ...old, x: minX - 38, y: Math.max(18, minY - 72), w: Math.max(220, maxX - minX + 76), h: Math.max(150, maxY - minY + 112) });
    });
}
function analysisScaleModel(model, factor) {
    const f = Math.max(1, Number(factor) || 1), originX = 58, originY = 18;
    if (f > 1.01) {
        const spread = (v, o) => Math.max(0, Math.round(o + (Number(v) - o) * f));
        model.positions.forEach((p) => { p.x = spread(p.x, originX); p.y = spread(p.y, originY); });
    }
    analysisRebuildStagePanels(model);
    model.adaptiveSpacingFactor = f;
    return model;
}
function analysisHasAppliedVisuals(d) { return !!(effective(d).length && (d.overlay.bands.length || d.overlay.ghosts.length || Object.keys(d.overlay.flag).length || Object.keys(d.overlay.edge).length || Object.keys(d.overlay.stageTag).length)); }
function analysisBuildAdaptiveModel(data, d, idFor) {
    const base = analysisIncreasedSpacing ? 1.45 : 1;
    const has = analysisHasAppliedVisuals(d);
    const start = has ? Math.max(base, 1.22) : base;
    const tries = has ? [start, Math.max(start, 1.45), Math.max(start, 1.72), Math.max(start, 2.04), Math.max(start, 2.36)] : [start];
    let best = null, bestScore = Number.POSITIVE_INFINITY;
    for (const f of [...new Set(tries.map(x => Math.round(x * 100) / 100))]) {
        const m = analysisScaleModel(editorCanvasLayout(data), f);
        const score = analysisOverlapScore(m, data, d, idFor);
        if (score < bestScore) {
            best = m;
            bestScore = score;
        }
        if (score === 0)
            break;
    }
    best.adaptiveOverlapScore = bestScore;
    return best;
}
function analysisSpreadModel(model) { return analysisScaleModel(model, analysisIncreasedSpacing ? 1.45 : 1); }
function analysisTransitionRelatedToSelection(transition, key, idFor) { if (!sel)
    return false; if (sel.kind === "trans")
    return sel.key === key; if (sel.kind === "state") {
    const from = idFor.get(String(transition.from_state_key || ""));
    const to = idFor.get(String(transition.to_state_key || ""));
    return sel.key === from || sel.key === to;
} return false; }
function analysisShouldDrawTransition(data, transition, model, key, idFor, badge) { if (analysisShowAllLines || badge)
    return true; if (analysisTransitionRelatedToSelection(transition, key, idFor))
    return true; return editorIsMainFlowTransition(data, transition, model); }
function analysisRectOverlap(a, b, pad = 6) { return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y); }
function analysisBaseObstacles(model) {
    var _a, _b;
    const out = [];
    (_a = model.positions) === null || _a === void 0 ? void 0 : _a.forEach((p) => out.push({ x: p.x, y: p.y, w: p.w, h: p.h, kind: "node" }));
    (_b = model.stagePositions) === null || _b === void 0 ? void 0 : _b.forEach((p) => {
        out.push({ x: p.x + 10, y: p.y + 12, w: Math.min(190, Math.max(80, p.w - 20)), h: 44, kind: "stageText" });
        out.push({ x: p.x, y: p.y, w: p.w, h: 1, kind: "stageEdge" });
    });
    return out;
}
function analysisCandidateOffsets() {
    const out = [{ x: 0, y: 0 }];
    const radii = [34, 58, 86, 118, 154, 196, 246, 304];
    for (const r of radii) {
        out.push({ x: 0, y: -r }, { x: 0, y: r }, { x: r, y: 0 }, { x: -r, y: 0 }, { x: r, y: -r }, { x: -r, y: -r }, { x: r, y: r }, { x: -r, y: r }, { x: Math.round(r * 1.45), y: 0 }, { x: -Math.round(r * 1.45), y: 0 });
    }
    return out;
}
function analysisCountOverlaps(box, obstacles, pad = 8) { let n = 0; for (const o of obstacles)
    if (analysisRectOverlap(box, o, pad))
        n++; return n; }
function analysisPlaceLabelAwayFromNodes(x, y, w, h, model) {
    const placed = model.__analysisLabelBoxes || (model.__analysisLabelBoxes = []);
    const obstacles = analysisBaseObstacles(model).concat(placed);
    let best = { x, y, w, h }, bestScore = Number.POSITIVE_INFINITY, bestDist = Number.POSITIVE_INFINITY;
    for (const off of analysisCandidateOffsets()) {
        const cand = { x: Math.max(6, Math.min(EDITOR_CANVAS_SIZE - w - 6, x + off.x)), y: Math.max(6, Math.min(EDITOR_CANVAS_SIZE - h - 6, y + off.y)), w, h };
        const score = analysisCountOverlaps(cand, obstacles, 10);
        const dist = Math.abs(off.x) + Math.abs(off.y);
        if (score < bestScore || (score === bestScore && dist < bestDist)) {
            best = cand;
            bestScore = score;
            bestDist = dist;
        }
        if (score === 0)
            break;
    }
    placed.push(best);
    model.__analysisLastLabelOverlap = (model.__analysisLastLabelOverlap || 0) + bestScore;
    return { x: best.x, y: best.y };
}
function analysisApproxLabel(model, x, y, w, h) { return analysisPlaceLabelAwayFromNodes(x, y, w, h, model); }
function analysisOverlapScore(model, data, d, idFor) {
    model.__analysisLabelBoxes = [];
    model.__analysisLastLabelOverlap = 0;
    const transitions = Array.isArray(data === null || data === void 0 ? void 0 : data.transitions) ? data.transitions : [], lanes = editorAssignRouteLanes(data, model);
    transitions.forEach((transition, index) => {
        const from = model.positions.get(String(transition.from_state_key || "")), to = model.positions.get(String(transition.to_state_key || ""));
        if (!from || !to)
            return;
        const key = editorDocTransitionKey(data, transition, index, idFor), badge = d.overlay.edge[key];
        if (!analysisShouldDrawTransition(data, transition, model, key, idFor, badge))
            return;
        const route = editorMakeEdgePath(from, to, index, lanes.get(String(transition.transition_key || transition.event_name || "")) || 0);
        const labelText = badge || editorLabelize(transition.event_name || transition.transition_key), lines = editorWrapText(labelText, 16), longest = Math.max(...lines.map(x => x.length), 0), lw = Math.max(66, Math.min(168, longest * 6.7 + 20)), lh = lines.length > 1 ? 32 : 20;
        analysisApproxLabel(model, Math.max(6, route.labelX - 6), Math.max(6, route.labelY - 14), lw, lh);
    });
    d.overlay.bands.forEach((band) => {
        let x0 = Number.POSITIVE_INFINITY, y0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY;
        band.ids.forEach((id) => { var _a; const p = (_a = Array.from(model.positions.entries()).find(([raw, pos]) => idFor.get(String(raw)) === id)) === null || _a === void 0 ? void 0 : _a[1]; if (!p)
            return; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); });
        if (Number.isFinite(x0)) {
            const text = String(band.label || "improvement"), w = Math.max(82, Math.min(160, text.length * 7 + 20));
            analysisApproxLabel(model, x0 - 8, y0 - 47, w, 22);
        }
    });
    d.overlay.ghosts.forEach((gh) => { const text = String(gh.text || ""); analysisApproxLabel(model, Number(gh.x) || 0, Number(gh.y) || 0, Math.max(144, text.length * 6.2 + 22), 24); });
    const score = Number(model.__analysisLastLabelOverlap || 0);
    model.__analysisLabelBoxes = [];
    model.__analysisLastLabelOverlap = 0;
    return score;
}
function hasEditorCanvas(d) { return !!(d.editorData && isEditorData(d.editorData)); }
function renderEditorAnalysisCanvas(d) {
    const data = d.editorData, idFor = editorWorkflowIdMap(data), model = analysisBuildAdaptiveModel(data, d, idFor);
    const posByDocId = new Map();
    (Array.isArray(data.states) ? data.states : []).forEach((state, stateIndex) => { const raw = String(state.state_key || ""), id = idFor.get(raw) || editorKey(raw, "state"), p = model.positions.get(raw); if (p)
        posByDocId.set(id, p); });
    currentAnalysisModel = model;
    const cv = $("cv");
    cv.classList.remove("connect");
    cv.classList.add("analysisEditorCanvas");
    cv.innerHTML = "";
    cv.style.width = model.width + "px";
    cv.style.height = model.height + "px";
    const root = svg("svg", { width: String(model.width), height: String(model.height), viewBox: `0 0 ${model.width} ${model.height}`, class: "analysisEditorSvg", style: "position:absolute;left:0;top:0;overflow:visible" });
    const defs = svg("defs");
    const mk = svg("marker", { id: "edArr", markerWidth: "12", markerHeight: "12", refX: "11", refY: "6", orient: "auto", markerUnits: "strokeWidth" });
    mk.append(svg("path", { d: "M0,0 L12,6 L0,12 z", fill: "#4f5d6d" }));
    defs.append(mk);
    const mkSel = svg("marker", { id: "edArrSel", markerWidth: "12", markerHeight: "12", refX: "11", refY: "6", orient: "auto", markerUnits: "strokeWidth" });
    mkSel.append(svg("path", { d: "M0,0 L12,6 L0,12 z", fill: "#16243B" }));
    defs.append(mkSel);
    root.append(defs);
    const stageLayer = svg("g", { transform: `translate(${model.contentOffset.x} ${model.contentOffset.y})` }), edgeLayer = svg("g", { transform: `translate(${model.contentOffset.x} ${model.contentOffset.y})` }), nodeLayer = svg("g", { transform: `translate(${model.contentOffset.x} ${model.contentOffset.y})` }), labelLayer = svg("g", { transform: `translate(${model.contentOffset.x} ${model.contentOffset.y})` });
    root.append(stageLayer, edgeLayer, nodeLayer, labelLayer);
    model.__analysisLabelBoxes = [];
    model.__analysisLastLabelOverlap = 0;
    model.stageOrder.forEach((stage) => { const p = model.stagePositions.get(String(stage.stage_key || "")); if (!p)
        return; const color = stage.visual_color || "#1F7A6F"; stageLayer.append(svg("rect", { x: String(p.x), y: String(p.y), width: String(p.w), height: String(p.h), rx: "18", ry: "18", fill: hexToRgba(color, 0.055), stroke: color, "stroke-width": "1.2", "stroke-dasharray": "6 5", class: "analysisStagePanel" })); stageLayer.append(svg("line", { x1: String(p.x + 18), x2: String(p.x + p.w - 18), y1: String(p.y + 56), y2: String(p.y + 56), stroke: color, "stroke-width": "2.2", opacity: "0.65" })); const title = svg("text", { x: String(p.x + 18), y: String(p.y + 27), class: "analysisStageHeader" }); title.textContent = String(stage.name || stage.stage_key || ""); stageLayer.append(title); const sub = svg("text", { x: String(p.x + 18), y: String(p.y + 47), class: "analysisStageSub" }); sub.textContent = String(stage.owner_role || stage.stage_key || ""); stageLayer.append(sub); });
    d.overlay.bands.forEach((band) => { let x0 = Number.POSITIVE_INFINITY, y0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY, y1 = Number.NEGATIVE_INFINITY; band.ids.forEach((id) => { const p = posByDocId.get(id); if (!p)
        return; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }); if (!Number.isFinite(x0))
        return; const isParallel = String(band.label || "").toLowerCase().includes("parallel"); stageLayer.append(svg("rect", { x: String(x0 - 16), y: String(y0 - 28), width: String(x1 - x0 + 32), height: String(y1 - y0 + 46), rx: "14", ry: "14", fill: isParallel ? "rgba(184,134,47,0.10)" : "rgba(31,122,111,0.08)", stroke: isParallel ? "#B8862F" : "#1F7A6F", "stroke-width": "2.2", "stroke-dasharray": isParallel ? "0" : "7 5", class: "analysisOverlayBand" })); const label = String(band.label || "improvement"), lw = Math.max(82, Math.min(168, label.length * 7 + 20)); const placed = analysisPlaceLabelAwayFromNodes(x0 - 8, y0 - 47, lw, 22, model); const tx = svg("text", { x: String(placed.x), y: String(placed.y + 15), class: "analysisOverlayLabel" }); tx.textContent = label; stageLayer.append(tx); });
    d.overlay.ghosts.forEach((gh) => { const text = String(gh.text || ""), gw = Math.max(144, text.length * 6.2 + 22); const placed = analysisPlaceLabelAwayFromNodes(Number(gh.x) || 0, Number(gh.y) || 0, gw, 24, model); const g = svg("g", { class: "analysisGhostMark" }); g.append(svg("rect", { x: String(placed.x), y: String(placed.y), width: String(gw), height: "24", rx: "8", ry: "8", fill: "#fff7ed", stroke: "#B2453C", "stroke-width": "1.4", "stroke-dasharray": "5 4" })); const tx = svg("text", { x: String(placed.x + 10), y: String(placed.y + 16), class: "analysisGhostText" }); tx.textContent = text; g.append(tx); stageLayer.append(g); });
    const lanes = editorAssignRouteLanes(data, model), transitions = Array.isArray(data.transitions) ? data.transitions : [];
    transitions.forEach((transition, index) => { const from = model.positions.get(String(transition.from_state_key || "")), to = model.positions.get(String(transition.to_state_key || "")); if (!from || !to)
        return; const route = editorMakeEdgePath(from, to, index, lanes.get(String(transition.transition_key || transition.event_name || "")) || 0), key = editorDocTransitionKey(data, transition, index, idFor), selected = !!(sel && sel.kind === "trans" && sel.key === key), main = editorIsMainFlowTransition(data, transition, model), badge = d.overlay.edge[key]; if (!analysisShouldDrawTransition(data, transition, model, key, idFor, badge))
        return; const stroke = selected ? "#16243B" : (badge ? "#C8842A" : "#526173"); const path = svg("path", { d: route.d, fill: "none", stroke, "stroke-width": selected ? "4.2" : (main ? "3.2" : "2.1"), "stroke-linecap": "round", "stroke-linejoin": "round", "marker-end": selected ? "url(#edArrSel)" : "url(#edArr)", opacity: selected || main || badge ? "0.86" : "0.56", class: "analysisEditorEdge" }); path.onclick = (ev) => { ev.stopPropagation(); sel = { kind: "trans", key }; renderInspector(); showTab("table"); renderCanvas(); }; edgeLayer.append(path); const hit = svg("path", { d: route.d, fill: "none", stroke: "transparent", "stroke-width": "18", class: "analysisEditorEdgeHit" }); hit.onclick = (ev) => { ev.stopPropagation(); sel = { kind: "trans", key }; renderInspector(); showTab("table"); renderCanvas(); }; edgeLayer.append(hit); const labelText = badge || editorLabelize(transition.event_name || transition.transition_key), lines = editorWrapText(labelText, 16), longest = Math.max(...lines.map(x => x.length), 0), lw = Math.max(66, Math.min(168, longest * 6.7 + 20)), lh = lines.length > 1 ? 32 : 20; let lx = Math.max(6, Math.min(EDITOR_CANVAS_SIZE - lw - 6, route.labelX - 6)), ly = Math.max(6, Math.min(EDITOR_CANVAS_SIZE - lh - 6, route.labelY - 14)); const placed = analysisPlaceLabelAwayFromNodes(lx, ly, lw, lh, model); lx = placed.x; ly = placed.y; const bg = svg("rect", { x: String(lx), y: String(ly), width: String(lw), height: String(lh), rx: "7", ry: "7", fill: badge ? "#fff7ed" : "rgba(255,255,255,0.96)", stroke: selected ? "#16243B" : (badge ? "#f59e0b" : "#d9e0ea"), "stroke-width": badge ? "1.4" : "1", class: "analysisEditorLabelBg" }); bg.onclick = (ev) => { ev.stopPropagation(); sel = { kind: "trans", key }; renderInspector(); showTab("table"); renderCanvas(); }; labelLayer.append(bg); const tx = svg("text", { x: String(lx + 8), y: String(ly + 14), class: "analysisEditorLabel" }); lines.forEach((line, i) => { const tsp = svg("tspan", { x: String(lx + 8), dy: i === 0 ? "0" : "12" }); tsp.textContent = line; tx.append(tsp); }); tx.onclick = (ev) => { ev.stopPropagation(); sel = { kind: "trans", key }; renderInspector(); showTab("table"); renderCanvas(); }; labelLayer.append(tx); });
    (Array.isArray(data.states) ? data.states : []).forEach((state, stateIndex) => { const p = model.positions.get(String(state.state_key || "")); if (!p)
        return; const id = idFor.get(String(state.state_key || "")) || editorKey(state.state_key, "state"), selected = !!(sel && sel.kind === "state" && sel.key === id), fl = d.overlay.flag[id] || {}, stageTag = d.overlay.stageTag[id], type = editorTypeDef(data, state.state_type); const g = svg("g", { class: "analysisEditorNode" + (selected ? " selected" : "") + (fl.dim ? " dimmed" : "") + (stageTag ? " analysisStageTagged" : ""), "data-id": id }); g.onclick = (ev) => { ev.stopPropagation(); sel = { kind: "state", key: id }; renderInspector(); showTab("table"); renderCanvas(); }; const loopHighlight = fl.color === "#C8842A"; const nodeStroke = fl.color || (stageTag === null || stageTag === void 0 ? void 0 : stageTag.color) || type.stroke; const nodeStrokeWidth = selected ? "2.8" : (loopHighlight ? "4" : (fl.color || stageTag ? "3" : "1.5")); const rect = svg("rect", { x: String(p.x), y: String(p.y), width: String(p.w), height: String(p.h), rx: "8", ry: "8", fill: type.fill, stroke: nodeStroke, "stroke-width": nodeStrokeWidth, class: loopHighlight ? "analysisLoopNodeRect" : "" }); g.append(rect); const clipId = "analysisNodeTextClip_" + String(id).replace(/[^a-zA-Z0-9_-]/g, "_"); const clip = svg("clipPath", { id: clipId }); clip.append(svg("rect", { x: String(p.x + 8), y: String(p.y + 6), width: String(Math.max(1, p.w - 16)), height: String(Math.max(1, p.h - 12)), rx: "6", ry: "6" })); defs.append(clip); const textG = svg("g", { "clip-path": "url(#" + clipId + ")" }); const keyText = svg("text", { x: String(p.x + 12), y: String(p.y + 19), class: "analysisNodeKey" }); keyText.textContent = editorEllipsize(`${state.state_key} - ${editorVisualKey(state.state_type)}${stageTag ? " · " + stageTag.label : ""}`, Math.max(12, Math.floor((Number(p.w) || EDITOR_NODE_W) / 7.2))); textG.append(keyText); editorWrapText(state.name, Math.max(10, Math.floor((Number(p.w) || EDITOR_NODE_W) / 9.4))).forEach((line, i) => { const nm = svg("text", { x: String(p.x + 12), y: String(p.y + 39 + i * 15), class: "analysisNodeName" }); nm.textContent = editorEllipsize(line, Math.max(8, Math.floor((Number(p.w) || EDITOR_NODE_W) / 8.6))); textG.append(nm); }); const meta = svg("text", { x: String(p.x + 12), y: String(p.y + p.h - 14), class: "analysisNodeMeta" }); const hasCost = !!(editorNum(state.cost_min) || editorNum(state.cost_max)); const mins = editorNum(state.expected_duration_minutes); meta.textContent = editorEllipsize(hasCost ? `Cost: ${editorMoney(state.cost_min, state.cost_max)}${mins ? " · " + mins + " min" : ""}` : (mins ? `${mins} min · ${state.owner_role || ""}` : String(state.owner_role || "")), Math.max(10, Math.floor((Number(p.w) || EDITOR_NODE_W) / 7.2))); textG.append(meta); if (fl.badge) {
        const badge = svg("text", { x: String(p.x + 12), y: String(p.y + p.h - 31), class: "analysisNodeBadge" });
        badge.textContent = editorEllipsize(fl.badge, Math.max(10, Math.floor((Number(p.w) || EDITOR_NODE_W) / 7.2)));
        textG.append(badge);
    } g.append(textG); nodeLayer.append(g); });
    cv.append(root);
    const scroll = $("cvscroll");
    scroll.scrollLeft = 0;
    scroll.scrollTop = 0;
    setAnalysisPanMode(true);
    const sig = analysisEditorViewSignature(data, d);
    if (analysisViewDoc !== d.id || analysisViewSig !== sig) {
        analysisViewDoc = d.id;
        analysisViewSig = sig;
        setTimeout(() => fitEditorAnalysisToView(model), 0);
    }
    else
        setTimeout(() => applyAnalysisPanZoom(), 0);
}
/* ---------- render canvas (with overlay) ---------- */
function edgePoint(cx, cy, tx, ty) { const dx = tx - cx, dy = ty - cy; if (!dx && !dy)
    return { x: cx, y: cy }; const hw = NW / 2 + 2, hh = NH / 2 + 2; const sx = dx ? hw / Math.abs(dx) : 1e9, sy = dy ? hh / Math.abs(dy) : 1e9; const sc = Math.min(sx, sy); return { x: cx + dx * sc, y: cy + dy * sc }; }
function renderCanvas() {
    var _a, _b;
    if (active === -1) {
        renderSigma();
        return;
    }
    $("sigma").style.display = "none";
    $("empty").style.display = "none";
    $("cv").style.display = "block";
    $("canvastools").style.display = "flex";
    if (active < 0 || docs.length === 0) {
        setAnalysisPanMode(false);
        const c0 = $("cv");
        c0.classList.remove("connect", "analysisEditorCanvas");
        c0.style.width = "100%";
        c0.style.height = "100%";
        c0.innerHTML = '<div class="watermark">No workflow loaded. Open the Workflow Editor, then return to Analysis Studio to analyze the current editor graph.</div>';
        return;
    }
    const d = D();
    if (hasEditorCanvas(d)) {
        renderEditorAnalysisCanvas(d);
        return;
    }
    layoutMissing(d);
    $("cv").classList.toggle("connect", connectMode);
    setAnalysisPanMode(false);
    const cv = $("cv");
    cv.classList.remove("analysisEditorCanvas");
    cv.innerHTML = "";
    let maxX = 600, maxY = 360;
    for (const s of d.wf.states) {
        const p = d.pos[s.id];
        if (p) {
            maxX = Math.max(maxX, p.x + NW + PAD);
            maxY = Math.max(maxY, p.y + NH + PAD);
        }
    }
    cv.style.width = maxX + "px";
    cv.style.height = maxY + "px";
    const root = svg("svg", { width: String(maxX), height: String(maxY), style: "position:absolute;left:0;top:0;overflow:visible" });
    const defs = svg("defs");
    const mk = svg("marker", { id: "arr", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    mk.append(svg("path", { d: "M0 1 L9 5 L0 9 z", fill: "#7b8694" }));
    defs.append(mk);
    const mkOn = svg("marker", { id: "arrOn", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    mkOn.append(svg("path", { d: "M0 1 L9 5 L0 9 z", fill: "#16243B" }));
    defs.append(mkOn);
    root.append(defs);
    // user-defined stage bands (tiles sharing a stage name)
    {
        const stages = {};
        for (const s of d.wf.states) {
            const g = (d.stage[s.id] || "").trim();
            if (g)
                (stages[g] || (stages[g] = [])).push(s.id);
        }
        for (const name in stages) {
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const id of stages[name]) {
                const p = d.pos[id];
                if (!p)
                    continue;
                x0 = Math.min(x0, p.x);
                y0 = Math.min(y0, p.y);
                x1 = Math.max(x1, p.x + NW);
                y1 = Math.max(y1, p.y + NH);
            }
            if (x1 < 0)
                continue;
            root.append(svg("rect", { x: String(x0 - 14), y: String(y0 - 28), width: String(x1 - x0 + 28), height: String(y1 - y0 + 42), rx: "12", fill: "#16243B", "fill-opacity": "0.045", stroke: "#16243B", "stroke-opacity": "0.16", "stroke-dasharray": "5 4" }));
            const tx = svg("text", { x: String(x0 - 8), y: String(y0 - 32), "font-size": "11", fill: "#16243B", "font-weight": "bold" });
            tx.textContent = name;
            root.append(tx);
        }
    }
    // bands
    for (const b of d.overlay.bands) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const id of b.ids) {
            const p = d.pos[id];
            if (!p)
                continue;
            x0 = Math.min(x0, p.x);
            y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x + NW);
            y1 = Math.max(y1, p.y + NH);
        }
        if (x1 < 0)
            continue;
        root.append(svg("rect", { x: String(x0 - 12), y: String(y0 - 22), width: String(x1 - x0 + 24), height: String(y1 - y0 + 34), rx: "10", fill: "#1F7A6F", opacity: "0.07" }));
        const tx = svg("text", { x: String(x0 - 6), y: String(y0 - 26), "font-size": "11", fill: "#1F7A6F", "font-weight": "bold" });
        tx.textContent = b.label;
        root.append(tx);
    }
    // edges
    for (const t of d.wf.transitions) {
        const a = d.pos[t.from], b = d.pos[t.to];
        if (!a || !b)
            continue;
        const ax = a.x + NW / 2, ay = a.y + NH / 2, bx = b.x + NW / 2, by = b.y + NH / 2;
        const key = t.from + "|" + t.on + "|" + t.to;
        const badge = d.overlay.edge[key];
        const chosen = !!(sel && sel.kind === "trans" && sel.key === key);
        const stroke = chosen ? "#16243B" : (badge ? "#C8842A" : "#7b8694");
        const marker = chosen ? "url(#arrOn)" : "url(#arr)";
        const eg = svg("g", { class: "edgeg" });
        let dpath = "";
        let lx = ax, ly = ay;
        if (t.from === t.to) {
            dpath = `M ${a.x + NW * 0.62} ${a.y} C ${a.x + NW + 52} ${a.y - 66}, ${a.x - 52} ${a.y - 66}, ${a.x + NW * 0.38} ${a.y}`;
            lx = a.x + NW / 2;
            ly = a.y - 50;
        }
        else {
            const s0 = edgePoint(ax, ay, bx, by), e0 = edgePoint(bx, by, ax, ay);
            const mx = (s0.x + e0.x) / 2;
            dpath = `M ${s0.x} ${s0.y} C ${mx} ${s0.y}, ${mx} ${e0.y}, ${e0.x} ${e0.y}`;
            lx = mx;
            ly = (s0.y + e0.y) / 2;
        }
        eg.append(svg("path", { d: dpath, fill: "none", stroke: "transparent", "stroke-width": "14", "stroke-linecap": "round" }));
        eg.append(svg("path", { d: dpath, fill: "none", stroke, "stroke-width": chosen ? "2.8" : (badge ? "2.4" : "2"), "stroke-linecap": "round", "stroke-linejoin": "round", "marker-end": marker, opacity: "0.96" }));
        eg.onclick = () => { sel = { kind: "trans", key }; renderInspector(); showTab("table"); renderCanvas(); };
        root.append(eg);
        const showL = !!badge || !/^event\d+$/.test(t.on) || chosen;
        if (showL) {
            const txt = badge || t.on;
            const w = Math.max(30, txt.length * 6.2 + 14);
            const g = svg("g", { class: "edgelabel" });
            g.append(svg("rect", { x: String(lx - w / 2), y: String(ly - 10), width: String(w), height: "20", rx: "10", fill: badge ? "#FBEFD9" : "#ffffff", stroke: chosen ? "#16243B" : (badge ? "#C8842A" : "#e2dcca") }));
            const tx = svg("text", { x: String(lx), y: String(ly + 3), "text-anchor": "middle", "font-size": "10", fill: badge ? "#8a5a12" : "#3a4250" });
            tx.textContent = txt;
            g.append(tx);
            g.onclick = (ev) => { ev.stopPropagation(); sel = { kind: "trans", key }; renderInspector(); showTab("table"); renderCanvas(); };
            root.append(g);
        }
        else {
            const g = svg("g", { class: "edgepick" });
            g.append(svg("circle", { cx: String(lx), cy: String(ly), r: "5.5", fill: "#ffffff", stroke: "#dcd7c8" }));
            g.onclick = (ev) => { ev.stopPropagation(); sel = { kind: "trans", key }; renderInspector(); showTab("table"); renderCanvas(); };
            root.append(g);
        }
    }
    cv.append(root);
    // ghosts
    for (const gh of d.overlay.ghosts) {
        const g = el("div", { class: "ghostmark" });
        Object.assign(g.style, { left: gh.x + "px", top: gh.y + "px" });
        g.textContent = gh.text;
        cv.append(g);
    }
    // nodes
    for (const s of d.wf.states) {
        const p = d.pos[s.id];
        if (!p)
            continue;
        const fl = d.overlay.flag[s.id] || {};
        const node = el("div", { class: "node", "data-id": s.id });
        const stageTag = d.overlay.stageTag[s.id];
        Object.assign(node.style, { left: p.x + "px", top: p.y + "px", width: NW + "px", minHeight: NH + "px", borderColor: fl.color || (stageTag === null || stageTag === void 0 ? void 0 : stageTag.color) || ROLE_COLOR[s.role], borderWidth: stageTag ? "3px" : "", opacity: fl.dim ? "0.4" : "1" });
        if (s.initial)
            node.classList.add("is-initial");
        if (s.accept)
            node.classList.add("is-accept");
        if (s.reject)
            node.classList.add("is-reject");
        if (sel && sel.kind === "state" && sel.key === s.id)
            node.classList.add("selected");
        if (connectMode && connectFrom === s.id)
            node.classList.add("connsrc");
        node.append(el("div", { class: "nlabel" }, s.label || s.id));
        node.append(el("div", { class: "nrole" }, stageTag ? `${stageTag.label} · ${fl.badge || s.role}` : (fl.badge || s.role)));
        if ((d.owner[s.id] || "").trim())
            node.append(el("div", { class: "nowner" }, "\ud83d\udc65 " + d.owner[s.id]));
        {
            const ct = el("div", { class: "nct" });
            const ci = el("input", { class: "ctin", type: "number", title: "cost ($)" });
            ci.value = String((_a = d.cost[s.id]) !== null && _a !== void 0 ? _a : 0);
            const ti = el("input", { class: "ctin", type: "number", title: "time (min)" });
            ti.value = String((_b = d.time[s.id]) !== null && _b !== void 0 ? _b : 0);
            const stop = (e) => e.stopPropagation();
            [ci, ti].forEach(x => { x.addEventListener("mousedown", stop); x.addEventListener("click", stop); x.addEventListener("dblclick", stop); });
            ci.addEventListener("input", () => { d.cost[s.id] = +ci.value || 0; syncJson(); renderTools(); });
            ti.addEventListener("input", () => { d.time[s.id] = +ti.value || 0; syncJson(); renderTools(); });
            ct.append("$", ci, el("span", { class: "ctd" }, " · "), ti, el("span", { class: "ctd" }, "m"));
            node.append(ct);
        }
        const del = el("div", { class: "ndel", title: "delete state" }, "\u00d7");
        del.addEventListener("mousedown", ev => ev.stopPropagation());
        del.addEventListener("click", ev => { ev.stopPropagation(); sel = { kind: "state", key: s.id }; deleteSel(); });
        node.append(del);
        const nxt = el("div", { class: "naddnext", title: "add a connected state after this one" }, "+");
        nxt.addEventListener("mousedown", ev => ev.stopPropagation());
        nxt.addEventListener("click", ev => { ev.stopPropagation(); addAfter(s.id); });
        node.append(nxt);
        const h = el("div", { class: "handle", title: "drag to connect" });
        node.append(h);
        wireNode(node, s.id, h);
        cv.append(node);
    }
}
/* ---------- Σ strategic value: top-level + sub-level pictures ---------- */
function renderEmpty() {
    $("cv").style.display = "none";
    $("sigma").style.display = "none";
    $("canvastools").style.display = "none";
    connectMode = false;
    connectFrom = null;
    const e = $("empty");
    e.style.display = "flex";
    e.innerHTML = "";
    const box = el("div", { class: "emptybox" });
    box.append(el("h2", {}, "No workflow loaded"));
    box.append(el("p", { class: "hint" }, "Nothing is loaded by default. Start a new workflow, add a copy, or drop in one of the example processes."));
    const row = el("div", { class: "emptyrow" });
    row.append(btn("New workflow", () => $("btnNew").click(), "btn primary"));
    row.append(btn("Add example…", () => $("exampleSel").focus(), "btn ghost"));
    box.append(row);
    e.append(box);
}
function deleteSel() {
    if (active < 0 || !sel)
        return;
    const d = D();
    if (sel.kind === "state") {
        const id = sel.key;
        d.wf.states = d.wf.states.filter(x => x.id !== id);
        d.wf.transitions = d.wf.transitions.filter(t => t.from !== id && t.to !== id);
        delete d.cost[id];
        delete d.time[id];
        delete d.pos[id];
    }
    else {
        const [f, o, t] = sel.key.split("|");
        d.wf.transitions = d.wf.transitions.filter(x => !(x.from === f && x.on === o && x.to === t));
    }
    sel = null;
    resetTools(d);
    commit();
}
document.addEventListener("keydown", e => {
    var _a;
    if (active < 0 || !sel)
        return;
    const tag = (_a = e.target) === null || _a === void 0 ? void 0 : _a.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return;
    if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSel();
    }
});
function fieldNum(l, v, on) { const i = el("input", { type: "number", value: String(v) }); i.addEventListener("input", () => on(+i.value || 0)); return el("label", { class: "fld" }, el("span", {}, l), i); }
function renderSigma() {
    setAnalysisPanMode(false);
    $("cv").style.display = "none";
    $("empty").style.display = "none";
    $("canvastools").style.display = "none";
    connectMode = false;
    connectFrom = null;
    const box = $("sigma");
    box.style.display = "block";
    box.innerHTML = "";
    box.append(el("h2", { class: "sigh" }, "Σ  Strategic value — combined leverage"));
    if (!docs.length) {
        box.append(el("p", { class: "hint" }, "Add workflows to see how their savings combine."));
        return;
    }
    const rows = docs.map(d => { const tv = totals(d); return { name: d.name, c: tv.c, t: tv.t, n: effective(d).length }; });
    const TC = rows.reduce((a, r) => a + r.c, 0), TT = rows.reduce((a, r) => a + r.t, 0);
    // ----- TOP-LEVEL PICTURE: one shared backbone feeding each workflow -----
    box.append(el("div", { class: "eyebrow2" }, "Top level — one shared backbone, savings that compound"));
    const n = rows.length, Wd = Math.max(860, n * 168), VB = 240;
    const top = svg("svg", { viewBox: "0 0 " + Wd + " " + VB, width: "100%", style: "max-width:" + Wd + "px;display:block;margin:8px 0 18px" });
    const hx = Wd / 2, hy = 178, sw = 148, sh = 50, sy = 28;
    rows.forEach((r, i) => {
        const sx = (Wd / n) * (i + 0.5) - sw / 2;
        top.append(svg("line", { x1: String(sx + sw / 2), y1: String(sy + sh), x2: String(hx), y2: String(hy - 44), stroke: "#bcd6cf", "stroke-width": "1.6" }));
        top.append(svg("rect", { x: String(sx), y: String(sy), width: String(sw), height: String(sh), rx: "9", fill: "#fff", stroke: "#1F7A6F", "stroke-width": "1.5" }));
        const t1 = svg("text", { x: String(sx + sw / 2), y: String(sy + 20), "text-anchor": "middle", "font-size": "12", "font-weight": "bold", fill: "#16243B" });
        t1.textContent = r.name;
        top.append(t1);
        const t2 = svg("text", { x: String(sx + sw / 2), y: String(sy + 37), "text-anchor": "middle", "font-size": "11", fill: "#1F7A6F" });
        t2.textContent = (r.c ? fmt(r.c) : "—") + (r.t ? "  ·  " + fmin(r.t) : "");
        top.append(t2);
    });
    top.append(svg("circle", { cx: String(hx), cy: String(hy), r: "62", fill: "#16243B" }));
    const c1 = svg("text", { x: String(hx), y: String(hy - 16), "text-anchor": "middle", fill: "#fff", "font-size": "12", "font-weight": "bold" });
    c1.textContent = "Shared backbone";
    top.append(c1);
    const c2 = svg("text", { x: String(hx), y: String(hy), "text-anchor": "middle", fill: "#8fd3c8", "font-size": "10" });
    c2.textContent = "data · price once · controls";
    top.append(c2);
    const c3 = svg("text", { x: String(hx), y: String(hy + 20), "text-anchor": "middle", fill: "#fff", "font-size": "15", "font-weight": "bold" });
    c3.textContent = fmt(TC);
    top.append(c3);
    const c4 = svg("text", { x: String(hx), y: String(hy + 36), "text-anchor": "middle", fill: "#8fd3c8", "font-size": "9.5" });
    c4.textContent = fmin(TT) + " combined";
    top.append(c4);
    box.append(top);
    // ----- SUB-LEVEL PICTURE: savings by workflow (bars) -----
    box.append(el("div", { class: "eyebrow2" }, "Sub level — where the saving sits, workflow by workflow"));
    const maxC = Math.max(1, ...rows.map(r => r.c)), maxT = Math.max(1, ...rows.map(r => r.t));
    const bars = el("div", { class: "bars" });
    rows.forEach(r => {
        const row = el("div", { class: "barrow" });
        row.append(el("div", { class: "barlabel" }, r.name));
        const track = el("div", { class: "track" });
        const cf = el("div", { class: "barfill c" });
        cf.style.width = Math.round(r.c / maxC * 100) + "%";
        cf.append(el("span", {}, r.c ? fmt(r.c) : "—"));
        const tf = el("div", { class: "barfill t" });
        tf.style.width = Math.round(r.t / maxT * 100) + "%";
        tf.append(el("span", {}, r.t ? fmin(r.t) : "—"));
        track.append(cf);
        track.append(tf);
        row.append(track);
        bars.append(row);
    });
    box.append(bars);
    box.append(el("div", { class: "barkey" }, el("i", { class: "sw c" }), " cost saved    ", el("i", { class: "sw t" }), " time saved   ", el("span", { class: "ill" }, "(illustrative)")));
    // ----- leverage notes -----
    const ul = el("ul", { class: "leverage" });
    ["One canonical dataset feeds AML, CARF and FMV — fix data once, every workflow benefits.",
        "Prices are computed once and reused — a restatement is a single lineage-driven recall, not three.",
        "One onboarding/change fans out to every service under one approval and one evidence set.",
        "No-bypass approvals and provable lineage are built once and defend all the workflows."].forEach(t => ul.append(el("li", {}, t)));
    box.append(el("h3", {}, "Kept separate where necessary — shared where it pays"));
    box.append(ul);
}
/* ---------- right panel: Tools / Table / JSON / Analysis ---------- */
function renderTools() {
    const box = $("tools");
    box.innerHTML = "";
    box.append(el("div", { class: "eyebrow2" }, "Build — drag a chip onto the canvas"));
    const pal = el("div", { class: "palette" });
    CHIPS.forEach(spec => { pal.append(makeChip(spec)); });
    box.append(pal);
    const brow = el("div", { class: "buildrow" });
    brow.append(btn(connectMode ? "\u2192 Connect: ON (Esc to stop)" : "\u2192 Connect mode", toggleConnectMode, "btn tiny" + (connectMode ? " on" : "")));
    brow.append(btn("\u00d7 Delete selected", () => deleteSel(), "btn tiny"));
    box.append(brow);
    box.append(el("p", { class: "hint" }, "Drag a chip onto the canvas to add a state. Connect mode: click a source state then the target (or drag the teal dot). Drag a node to move it; select one and press Delete to remove it."));
    box.append(el("hr", { class: "sep2" }));
    if (active < 0) {
        box.append(el("p", { class: "hint" }, "Once you have a few states, run a tool from the buttons along the bottom \u2014 findings and savings show here."));
        return;
    }
    const d = D();
    const { c, t } = totals(d);
    box.append(el("div", { class: "savebar" }, "Applied savings: ", el("b", {}, fmt(c)), "  ·  ", el("b", {}, fmin(t)), el("span", { class: "ill" }, " illustrative")));
    const list = [0, 1, 2, 3, 4, 5].filter(i => toolActive(d, i));
    if (!list.length) {
        box.append(el("p", { class: "hint" }, "Run a tool below, or “Apply all improvements”. Each finding can be overruled."));
        return;
    }
    for (const i of list) {
        const meta = presets_1.TOOL_META[i];
        const card = el("div", { class: "toolcard" });
        card.append(el("div", { class: "eyebrow" }, "Tool " + (i + 1) + " · " + meta.name));
        card.append(el("p", { class: "what" }, meta.what));
        for (const id of d.toolIds[i]) {
            const s = d.sugs[id];
            const overr = d.overruled.has(id);
            const row = el("div", { class: "sug" + (overr ? " overr" : "") });
            row.append(el("div", { class: "sugtitle" }, s.title));
            row.append(el("p", { class: "sugfound" }, s.found));
            const gain = s.clarity ? "clarity — the map itself" : ((s.cost ? "+ " + fmt(s.cost) : "") + (s.cost && s.time ? "  ·  " : "") + (s.time ? fmin(s.time) + " saved" : ""));
            row.append(el("div", { class: "suggain" }, gain || "—", el("span", { class: "money" }, meta.money)));
            const t2 = el("button", { class: "btn tiny " + (overr ? "" : "on") }, overr ? "Overruled — restore" : "Accept ✓ (overrule)");
            t2.addEventListener("click", () => { if (overr)
                d.overruled.delete(id);
            else
                d.overruled.add(id); rebuild(d); renderCanvas(); renderTools(); });
            row.append(t2);
            card.append(row);
        }
        box.append(card);
    }
}
function renderTable() {
    const root = $("editor");
    root.innerHTML = "";
    if (active < 0) {
        root.append(el("p", { class: "hint" }, "Empty table \u2014 add a state to start a workflow, then fill in the rows."));
        root.append(el("h3", {}, "States"));
        const st0 = el("table", { class: "grid" });
        st0.append(head(["id", "label", "role", "owner", "stage", "start", "acc", "rej", "cost", "time", ""]));
        root.append(st0);
        root.append(btn("+ state", () => { const d = ensureDoc(); const id = uid(d, "S"); const first = !d.wf.states.some(x => x.initial); d.wf.states.push(first ? { id, label: "New", role: "step", initial: true } : { id, label: "New", role: "step" }); d.cost[id] = 50; d.time[id] = 30; commit(); }));
        root.append(el("h3", {}, "Transitions"));
        const tt0 = el("table", { class: "grid" });
        tt0.append(head(["from", "on", "to", ""]));
        root.append(tt0);
        root.append(btn("+ transition", () => { const d = ensureDoc(); if (!d.wf.states.length) {
            flashTools("Add a state first.");
            return;
        } const id = d.wf.states[0].id; d.wf.transitions.push({ from: id, on: "event" + d.wf.transitions.length, to: id }); commit(); }));
        const e = $("status");
        e.className = "status";
        e.textContent = "Empty \u2014 add states/transitions here, or drag chips on the canvas.";
        return;
    }
    const d = D();
    root.append(fieldRow("Name", d.name, v => { d.name = v; d.wf.name = v; renderWfBar(); }));
    root.append(el("h3", {}, "States"));
    const st = el("table", { class: "grid" });
    st.append(head(["id", "label", "role", "owner", "stage", "start", "acc", "rej", "cost", "time", ""]));
    d.wf.states.forEach((s, i) => st.append(stateRow(d, s, i)));
    root.append(st);
    root.append(btn("+ state", () => { const id = uid(d, "S"); const first = !d.wf.states.some(x => x.initial); d.wf.states.push(first ? { id, label: "New", role: "step", initial: true } : { id, label: "New", role: "step" }); d.cost[id] = 50; d.time[id] = 30; commit(); }));
    root.append(el("h3", {}, "Transitions"));
    const tt = el("table", { class: "grid" });
    tt.append(head(["from", "on", "to", ""]));
    d.wf.transitions.forEach((_, i) => tt.append(transRow(d, i)));
    root.append(tt);
    root.append(btn("+ transition", () => { var _a, _b; const id = (_b = (_a = d.wf.states[0]) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : ""; if (!id) {
        flashTools("Add a state first.");
        return;
    } d.wf.transitions.push({ from: id, on: "event" + d.wf.transitions.length, to: id }); commit(); }));
    if (!d.wf.states.length) {
        const e = $("status");
        e.className = "status";
        e.textContent = "Empty \u2014 add states above, or drag chips on the canvas.";
        return;
    }
    const r = (0, io_1.parseWorkflow)(normalise(d.wf));
    const st2 = $("status");
    st2.className = "status " + (r.ok ? "ok" : "bad");
    st2.textContent = (r.ok ? "✓ valid — " : "✕ ") + (r.ok ? (d.wf.states.length + " states, " + d.wf.transitions.length + " transitions") : r.errors.join(" • "));
}
function fieldRow(l, v, on) { const i = el("input", { value: v }); i.addEventListener("input", () => { on(i.value); syncJson(); }); return el("label", { class: "fld" }, el("span", {}, l), i); }
function head(c) { const tr = el("tr"); c.forEach(x => tr.append(el("th", {}, x))); return tr; }
function btn(t, on, cls = "btn ghost") { const b = el("button", { class: cls }, t); b.addEventListener("click", on); return b; }
function stateRow(d, s, i) {
    var _a, _b;
    const tr = el("tr");
    tr.append(td(inp(s.id, v => { rename(d, i, v); commit(); })));
    tr.append(td(inp(s.label, v => { d.wf.states[i].label = v; syncJson(); renderCanvas(); })));
    const sl = el("select");
    ROLES.forEach(r => { const o = el("option", { value: r }, r); if (r === s.role)
        o.selected = true; sl.append(o); });
    sl.addEventListener("change", () => { d.wf.states[i].role = sl.value; commit(); });
    tr.append(td(sl));
    tr.append(td(inp(d.owner[s.id] || "", v => { d.owner[s.id] = v; syncJson(); renderCanvas(); })));
    tr.append(td(inp(d.stage[s.id] || "", v => { d.stage[s.id] = v; renderCanvas(); syncJson(); })));
    tr.append(td(rad(!!s.initial, () => { d.wf.states.forEach(x => x.initial = false); d.wf.states[i].initial = true; commit(); })));
    tr.append(td(chk(!!s.accept, v => { d.wf.states[i].accept = v; commit(); })));
    tr.append(td(chk(!!s.reject, v => { d.wf.states[i].reject = v; commit(); })));
    tr.append(td(num((_a = d.cost[s.id]) !== null && _a !== void 0 ? _a : 0, v => { d.cost[s.id] = v; syncJson(); })));
    tr.append(td(num((_b = d.time[s.id]) !== null && _b !== void 0 ? _b : 0, v => { d.time[s.id] = v; syncJson(); })));
    tr.append(td(btn("✕", () => { const id = d.wf.states[i].id; d.wf.states.splice(i, 1); d.wf.transitions = d.wf.transitions.filter(t => t.from !== id && t.to !== id); commit(); }, "btn tiny")));
    return tr;
}
function transRow(d, i) {
    const t = d.wf.transitions[i];
    const tr = el("tr");
    tr.append(td(ssel(d, t.from, v => { d.wf.transitions[i].from = v; commit(); })));
    tr.append(td(inp(t.on, v => { d.wf.transitions[i].on = v; commit(); })));
    tr.append(td(ssel(d, t.to, v => { d.wf.transitions[i].to = v; commit(); })));
    tr.append(td(btn("✕", () => { d.wf.transitions.splice(i, 1); commit(); }, "btn tiny")));
    return tr;
}
function td(c) { return el("td", {}, c); }
function inp(v, on) { const i = el("input", { value: v }); i.addEventListener("input", () => on(i.value)); return i; }
function num(v, on) { const i = el("input", { type: "number", value: String(v) }); i.addEventListener("input", () => on(+i.value || 0)); return i; }
function rad(on, cb) { const i = el("input", { type: "radio", name: "start" }); i.checked = on; i.addEventListener("change", cb); return i; }
function chk(on, cb) { const i = el("input", { type: "checkbox" }); i.checked = on; i.addEventListener("change", () => cb(i.checked)); return i; }
function ssel(d, val, on) { const s = el("select"); d.wf.states.forEach(x => { const o = el("option", { value: x.id }, x.id); if (x.id === val)
    o.selected = true; s.append(o); }); s.addEventListener("change", () => on(s.value)); return s; }
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
function uid(d, p) { let n = 1; const ids = new Set(d.wf.states.map(s => s.id)); while (ids.has(p + n))
    n++; return p + n; }
/* unified JSON: workflow + cost + time in one document */
function activeToolIndexes(d) { const out = []; for (let i = 0; i < d.toolIds.length; i++)
    if (toolActive(d, i))
        out.push(i); return out; }
function unified(d) { const meta = { layout: d.pos, owner: d.owner, stage: d.stage, activeTools: activeToolIndexes(d), overruled: [...d.overruled] }; if (d.editorData)
    meta.editorData = d.editorData; return { workflow: normalise(d.wf), cost: { stepCost: d.cost, branchProb: d.branch }, time: { stepMinutes: d.time }, meta }; }
function syncJson() { const ta = $("json"); if (active < 0) {
    if (!ta.value.trim())
        ta.value = SCAFFOLD;
    return;
} ta.value = JSON.stringify(unified(D()), null, 2); persist(); }
function loadJson() { const raw = safe($("json").value); ingest(raw, "JSON"); }
function safe(s) { try {
    return JSON.parse(s);
}
catch (e) {
    return { __e: String(e) };
} }
function ingest(raw, src) {
    const wfRaw = raw && raw.workflow ? raw.workflow : raw; // accept unified OR bare workflow
    if (!wfRaw || !Array.isArray(wfRaw.states) || !wfRaw.states.length) {
        const st = $("status");
        st.className = "status bad";
        st.textContent = "\u2715 " + src + ": needs a workflow with at least one state.";
        return;
    }
    const res = (0, io_1.parseWorkflow)(normalise(wfRaw));
    if (!res.ok) {
        const st = $("status");
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
                computeTool(d, i);
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
    full();
}
/* ---------- Workflow Editor -> Analysis Studio sync ---------- */
function editorNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function editorMid(min, max) { const a = editorNum(min); const b = (max === undefined || max === null || max === "") ? a : editorNum(max); return (a + b) / 2; }
function editorKey(v, fallback) { const raw = String(v !== null && v !== void 0 ? v : "").trim() || fallback; return raw.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_.:-]/g, "_"); }
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
function editorDataSignature(data) { try {
    return JSON.stringify(data || null);
}
catch (e) {
    return String(Date.now());
} }
function analysisEditorViewSignature(data, d) { try {
    return JSON.stringify({ data, applied: [...d.applied].sort(), overruled: [...d.overruled].sort(), showAll: analysisShowAllLines, roomy: analysisIncreasedSpacing, edge: Object.keys(d.overlay.edge).sort(), flag: Object.keys(d.overlay.flag).sort(), stageTag: d.overlay.stageTag, bands: d.overlay.bands.map((b) => ({ label: b.label, ids: b.ids })), ghosts: d.overlay.ghosts.length });
}
catch (e) {
    return String(Date.now());
} }
function isEditorData(data) { return !!(data && data.process && Array.isArray(data.states) && Array.isArray(data.transitions)); }
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
function importEditorData(data, opts = {}) {
    if (!isEditorData(data))
        return false;
    const sig = editorDataSignature(data);
    latestEditorData = clone(data);
    latestEditorSignature = sig;
    if (!opts.force && sig === latestEditorImportedSignature) {
        // Even when the editor process is unchanged, entering the Analysis
        // Studio must make the editor's workflow the ACTIVE one. The previous
        // early return skipped this, leaving whichever workflow was last
        // selected in the Studio active instead.
        const existingIdx = docs.findIndex(x => x.editorData && editorDataSignature(x.editorData) === sig);
        if (existingIdx >= 0) {
            if (opts.openAnalysis) {
                if (active !== existingIdx) {
                    active = existingIdx;
                    sel = null;
                    lastTool = -2;
                    full();
                }
                analysisViewDoc = "";
                renderCanvas();
                showTab("analysis");
            }
            return true;
        }
        // The previously imported editor doc was removed in the Studio —
        // fall through and reimport it fresh.
    }
    const raw = editorDataToUnified(data);
    if (!raw)
        return false;
    const res = (0, io_1.parseWorkflow)(normalise(raw.workflow));
    if (!res.ok) {
        if (!opts.silent)
            flashTools("The Workflow Editor process could not be imported into Analysis Studio: " + res.errors.join(" • "));
        return false;
    }
    const d = mkDoc(res.value);
    d.id = raw.workflow.id;
    d.editorData = clone(data);
    if (raw.cost && raw.cost.stepCost)
        d.cost = { ...d.cost, ...raw.cost.stepCost };
    if (raw.cost && raw.cost.branchProb)
        d.branch = { ...d.branch, ...raw.cost.branchProb };
    if (raw.time && raw.time.stepMinutes)
        d.time = { ...d.time, ...raw.time.stepMinutes };
    const meta = raw.meta || {};
    if (meta.layout)
        d.pos = { ...d.pos, ...meta.layout };
    if (meta.owner)
        d.owner = { ...d.owner, ...meta.owner };
    if (meta.stage)
        d.stage = { ...d.stage, ...meta.stage };
    rebuild(d);
    const idx = docs.findIndex(x => x.id === d.id);
    if (idx >= 0) {
        docs[idx] = d;
        active = idx;
    }
    else {
        docs.push(d);
        active = docs.length - 1;
    }
    sel = null;
    lastTool = -2;
    latestEditorImportedSignature = sig;
    full();
    if (opts.openAnalysis)
        showTab("analysis");
    if (!opts.silent)
        logHistory("editor-sync", "Imported current Workflow Editor process into Analysis Studio");
    return true;
}
function requestEditorSync(opts = {}) {
    var _a, _b;
    const frame = document.getElementById("workflowEditorFrame");
    let got = false;
    try {
        const fn = (_a = frame === null || frame === void 0 ? void 0 : frame.contentWindow) === null || _a === void 0 ? void 0 : _a.plumblineExportForAnalysis;
        if (typeof fn === "function") {
            const data = fn();
            if (data)
                got = importEditorData(data, opts);
        }
    }
    catch (e) { }
    if (!got && latestEditorData)
        got = importEditorData(latestEditorData, opts);
    try {
        (_b = frame === null || frame === void 0 ? void 0 : frame.contentWindow) === null || _b === void 0 ? void 0 : _b.postMessage({ type: "plumbline-request-editor-data", openAnalysis: !!opts.openAnalysis }, "*");
    }
    catch (e) { }
    return got;
}
function setupEditorSync() {
    window.addEventListener("message", (event) => {
        var _a;
        const msg = event.data || {};
        if (msg.type !== "plumbline-editor-data")
            return;
        latestEditorData = msg.data;
        latestEditorSignature = editorDataSignature(msg.data);
        if (latestEditorSignature === lastStudioPushSignature)
            return; // echo of a Studio -> Editor push; both screens already agree
        const studioVisible = (_a = document.getElementById("studioPage")) === null || _a === void 0 ? void 0 : _a.classList.contains("active");
        if (studioVisible)
            importEditorData(msg.data, { openAnalysis: !!msg.openAnalysis, silent: true });
    });
    window.plumblineImportEditorData = (data, opts = {}) => importEditorData(data, opts);
    window.plumblineRequestEditorSync = (opts = {}) => requestEditorSync(opts);
}
/* ---------- Analysis Studio -> Workflow Editor sync (Prompt1) ----------
 * The Editor and the Analysis screen work on the SAME process. The editor
 * already pushes live snapshots into the Studio; this is the reverse leg:
 * whenever the Studio's active document is editor-backed and its model
 * changes (loaded a saved workflow, edited names/cost/time, added or
 * removed states/transitions), the change is merged back into the editor
 * data format and posted into the Workflow Editor iframe. Only changes
 * that map cleanly are written; untouched fields are left byte-identical
 * so an unchanged model produces no push at all. */
let studioPushTimer = null;
let lastStudioPushSignature = "";
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
function studioDocToEditorData(d) {
    if (!d || !d.editorData || !isEditorData(d.editorData))
        return null;
    const data = clone(d.editorData);
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
function pushStudioToEditor() {
    if (active < 0 || !docs[active])
        return;
    const d = docs[active];
    let data = null;
    try {
        data = studioDocToEditorData(d);
    }
    catch (e) {
        console.warn("Studio -> Editor sync skipped:", e && e.message);
        return;
    }
    if (!data)
        return;
    const sig = editorDataSignature(data);
    if (sig === latestEditorSignature || sig === lastStudioPushSignature)
        return; // nothing changed — both screens already show the same thing
    lastStudioPushSignature = sig;
    latestEditorData = clone(data);
    latestEditorSignature = sig;
    latestEditorImportedSignature = sig;
    d.editorData = clone(data);
    try {
        const frame = document.getElementById("workflowEditorFrame");
        if (frame && frame.contentWindow)
            frame.contentWindow.postMessage({ type: "plumbline-studio-data", data }, "*");
    }
    catch (e) { }
    if (hasEditorCanvas(d)) {
        analysisViewDoc = "";
        analysisViewSig = "";
        setTimeout(() => { try { renderCanvas(); } catch (e) { } }, 30);
    }
}
function schedulePushStudioToEditor() {
    clearTimeout(studioPushTimer);
    studioPushTimer = setTimeout(pushStudioToEditor, 180);
}
/* ---------- engine analysis tab ---------- */
function analysisSavingsHost() {
    const pane = document.getElementById("pane_analysis");
    if (!pane)
        return null;
    let host = document.getElementById("analysisSavings");
    if (!host) {
        host = document.createElement("div");
        host.id = "analysisSavings";
        const iframe = document.getElementById("results");
        pane.insertBefore(host, iframe || null);
    }
    return host;
}
function stepSavingsRows(d) {
    var _a;
    const rows = [];
    for (let i = 0; i < 6; i++) {
        computeTool(d, i);
        const ids = d.toolIds[i] || [];
        const usable = ids.filter(id => !d.overruled.has(id) && d.sugs[id]);
        const applied = usable.filter(id => d.applied.has(id));
        const source = applied.length ? applied : usable;
        const cost = source.reduce((sum, id) => { var _a; return sum + (((_a = d.sugs[id]) === null || _a === void 0 ? void 0 : _a.cost) || 0); }, 0);
        const time = source.reduce((sum, id) => { var _a; return sum + (((_a = d.sugs[id]) === null || _a === void 0 ? void 0 : _a.time) || 0); }, 0);
        const count = source.filter(id => { const s = d.sugs[id]; return !!s && (s.cost > 0 || s.time > 0 || !s.clarity); }).length;
        const positive = cost > 0 || time > 0;
        rows.push({
            index: i,
            step: i + 1,
            name: ((_a = presets_1.TOOL_META[i]) === null || _a === void 0 ? void 0 : _a.name) || ("Tool " + (i + 1)),
            cost,
            time,
            count,
            status: applied.length ? "applied" : "available",
            result: positive ? "Saving found" : (count ? "Finding only" : "Clean check"),
            applied: applied.length > 0
        });
    }
    return rows;
}
function renderAnalysisSavings(d) {
    const host = analysisSavingsHost();
    if (!host)
        return;
    host.innerHTML = "";
    if (!d) {
        host.append(el("div", { class: "analysisSavingsBox mutedBox" }, "Open a workflow to see savings by each of the six Plumbline steps."));
        return;
    }
    const rows = stepSavingsRows(d);
    const totalCost = rows.reduce((a, r) => a + r.cost, 0), totalTime = rows.reduce((a, r) => a + r.time, 0);
    const box = el("div", { class: "analysisSavingsBox" });
    box.append(el("div", { class: "analysisSavingsTop" }, el("div", {}, el("div", { class: "analysisSavingsEyebrow" }, "Six-step savings"), el("h3", {}, "Savings result by Plumbline step")), el("div", { class: "analysisSavingsTotal" }, el("b", {}, fmt(totalCost)), el("span", {}, " · " + fmin(totalTime) + " illustrative"))));
    const grid = el("div", { class: "analysisStepGrid" });
    rows.forEach(r => {
        const card = el("div", { class: "analysisStepCard" + (r.cost || r.time ? " hasSaving" : "") });
        card.append(el("div", { class: "analysisStepHead" }, el("span", {}, "Step " + r.step), el("em", {}, r.status)));
        card.append(el("strong", {}, r.name));
        card.append(el("div", { class: "analysisStepResult" }, r.result));
        card.append(el("div", { class: "analysisStepGain" }, (r.cost ? fmt(r.cost) : "$0"), " · ", (r.time ? fmin(r.time) : "0 min")));
        card.append(el("div", { class: "analysisStepMeta" }, r.count + " finding" + (r.count === 1 ? "" : "s")));
        const action = el("button", { class: "analysisStepApply" + (r.applied ? " on" : "") }, r.applied ? "Remove from graph" : "Apply to graph");
        action.addEventListener("click", (ev) => { ev.stopPropagation(); runTool(r.index); });
        card.append(action);
        grid.append(card);
    });
    box.append(grid);
    host.append(box);
}
function runAnalysis() {
    requestEditorSync({ silent: true });
    if (active < 0) {
        renderAnalysisSavings();
        return;
    }
    const d = D();
    renderAnalysisSavings(d);
    if (!d.wf.states.length || !d.wf.states.some(s => s.initial)) {
        $("results").srcdoc = "<p style=\"font:14px Arial;color:#8a93a0;padding:16px\">Add states (with one start) to run the certifying engine.</p>";
        return;
    }
    const r = (0, io_1.parseWorkflow)(normalise(d.wf));
    if (!r.ok) {
        $("results").removeAttribute("srcdoc");
        return;
    }
    const w = r.value;
    const report = (0, io_1.runPipeline)(w, { stepCost: d.cost, branchProb: d.branch }, lemma_1.check);
    $("results").srcdoc = (0, app_1.appToHtml)((0, app_1.buildView)(w, report));
}
/* ---------- database-backed accounts + saved workflows (PlumblineData) ----------
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
window.plumblineBroadcastAuth = broadcastAuthToEditor;
function logHistory(action, detail) {
    if (!currentUser)
        return;
    // Fire-and-forget append to the database's activity_log.
    try { PData().appendHistory(action, { detail }).catch(() => { }); }
    catch (e) { }
}
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
/* ---------- top workflow bar ---------- */
function renderWfBar() {
    const bar = $("wfbar");
    bar.innerHTML = "";
    docs.forEach((d, i) => { const b = el("button", { class: "wfbtn" + (i === active ? " on" : "") }, (i + 1) + ". " + d.name); b.addEventListener("click", () => { active = i; sel = null; lastTool = -2; full(); }); bar.append(b); });
    const sg = el("button", { class: "wfbtn sigma" + (active === -1 ? " on" : "") }, "Σ Strategic value");
    sg.addEventListener("click", () => { active = -1; full(); });
    bar.append(sg);
}
/* ---------- node drag/connect ---------- */
let drag = null;
let conn = null;
let connectMode = false, connectFrom = null;
function updateCtUi() { const b = document.getElementById("ctAddTrans"); if (b)
    b.classList.toggle("on", connectMode); const h = document.getElementById("cthint"); if (h)
    h.textContent = connectMode ? (connectFrom ? "Now click the TARGET node  (Esc to cancel)" : "Click the SOURCE node, then the target  (Esc to cancel)") : "Double-click the canvas to add a state \u00b7 drag a node to move \u00b7 use \u201cAdd transition\u201d (or drag the teal dot) to connect"; }
function toggleConnectMode() { if (active < 0)
    return; connectMode = !connectMode; connectFrom = null; updateCtUi(); renderCanvas(); }
function wireNode(node, id, handle) {
    node.addEventListener("mousedown", e => { if (e.target === handle || active < 0)
        return; const r = $("cv").getBoundingClientRect(); drag = { id, ox: e.clientX - r.left - D().pos[id].x, oy: e.clientY - r.top - D().pos[id].y, moved: false }; e.preventDefault(); });
    node.addEventListener("click", () => {
        if (connectMode) {
            if (!connectFrom) {
                connectFrom = id;
                updateCtUi();
                renderCanvas();
            }
            else {
                const d = D();
                const on = "event" + d.wf.transitions.length;
                d.wf.transitions.push({ from: connectFrom, on, to: id });
                connectFrom = null;
                resetTools(d);
                updateCtUi();
                commit();
            }
            return;
        }
        if (drag && drag.moved)
            return;
        sel = { kind: "state", key: id };
        renderInspector();
    });
    handle.addEventListener("mousedown", e => { const line = svg("path", { fill: "none", stroke: "#1F7A6F", "stroke-width": "2", "stroke-dasharray": "4 3" }); $("cv").querySelector("svg").append(line); conn = { from: id, line }; e.preventDefault(); e.stopPropagation(); });
}
document.addEventListener("mousemove", e => {
    if (active < 0)
        return;
    const r = $("cv").getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (drag) {
        let nx = Math.max(0, mx - drag.ox), ny = Math.max(0, my - drag.oy);
        nx = Math.round(nx / GRID) * GRID;
        ny = Math.round(ny / GRID) * GRID;
        const cur = D().pos[drag.id];
        drag.moved = true;
        if (!cur || cur.x !== nx || cur.y !== ny) {
            D().pos[drag.id] = { x: nx, y: ny };
            renderCanvas();
        }
    }
    else if (conn) {
        const a = D().pos[conn.from];
        conn.line.setAttribute("d", `M ${a.x + NW / 2} ${a.y + NH / 2} L ${mx} ${my}`);
    }
});
document.addEventListener("mouseup", e => {
    if (active < 0) {
        drag = null;
        conn = null;
        return;
    }
    const r = $("cv").getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (conn) {
        conn.line.remove();
        const tgt = hit(mx, my);
        if (tgt) {
            const on = "event" + D().wf.transitions.length;
            D().wf.transitions.push({ from: conn.from, on, to: tgt });
            resetTools(D());
            commit();
        }
        conn = null;
    }
    if (drag) {
        syncJson();
        persist();
        drag = null;
    }
});
function hit(x, y) { for (const s of D().wf.states) {
    const p = D().pos[s.id];
    if (p && x >= p.x && x <= p.x + NW && y >= p.y && y <= p.y + NH)
        return s.id;
} return null; }
/* ---------- inspector ---------- */
function renderInspector() {
    var _a, _b;
    const box = $("inspector");
    box.innerHTML = "";
    if (active < 0 || !sel) {
        box.append(el("p", { class: "hint" }, "Click a node or edge to edit; drag a node to move; drag the teal dot to connect."));
        return;
    }
    const d = D();
    if (sel.kind === "state") {
        const i = d.wf.states.findIndex(s => s.id === sel.key);
        if (i < 0) {
            sel = null;
            return;
        }
        const s = d.wf.states[i];
        box.append(el("h3", {}, "State"));
        box.append(fieldRow("id", s.id, v => { rename(d, i, v); sel = { kind: "state", key: d.wf.states[i].id }; commit(); }));
        box.append(fieldRow("label", s.label, v => { d.wf.states[i].label = v; syncJson(); renderCanvas(); }));
        const sl = el("select");
        ROLES.forEach(r => { const o = el("option", { value: r }, r); if (r === s.role)
            o.selected = true; sl.append(o); });
        sl.addEventListener("change", () => { d.wf.states[i].role = sl.value; commit(); });
        box.append(el("label", { class: "fld" }, el("span", {}, "role"), sl));
        box.append(fieldRow("owner / team", d.owner[s.id] || "", v => { d.owner[s.id] = v; syncJson(); renderCanvas(); }));
        box.append(fieldRow("stage", d.stage[s.id] || "", v => { d.stage[s.id] = v; renderCanvas(); persist(); }));
        box.append(fieldNum("cost", (_a = d.cost[s.id]) !== null && _a !== void 0 ? _a : 0, v => { d.cost[s.id] = v; syncJson(); renderCanvas(); renderTools(); }));
        box.append(fieldNum("time (min)", (_b = d.time[s.id]) !== null && _b !== void 0 ? _b : 0, v => { d.time[s.id] = v; syncJson(); renderCanvas(); renderTools(); }));
        box.append(btn("Delete", () => { const id = s.id; d.wf.states.splice(i, 1); d.wf.transitions = d.wf.transitions.filter(t => t.from !== id && t.to !== id); sel = null; commit(); }, "btn tiny"));
    }
    else {
        const [f, o, t2] = sel.key.split("|");
        const i = d.wf.transitions.findIndex(x => x.from === f && x.on === o && x.to === t2);
        if (i < 0) {
            sel = null;
            return;
        }
        box.append(el("h3", {}, "Transition"));
        box.append(el("label", { class: "fld" }, el("span", {}, "from"), ssel(d, f, v => { d.wf.transitions[i].from = v; commit(); })));
        box.append(fieldRow("on", d.wf.transitions[i].on, v => { d.wf.transitions[i].on = v; commit(); }));
        box.append(el("label", { class: "fld" }, el("span", {}, "to"), ssel(d, t2, v => { d.wf.transitions[i].to = v; commit(); })));
        box.append(btn("Delete", () => { d.wf.transitions.splice(i, 1); sel = null; commit(); }, "btn tiny"));
    }
}
/* ---------- tabs + panel toggle ---------- */
function showTab(t) {
    if (t === "tools")
        t = "analysis";
    document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.getAttribute("data-tab") === t));
    ["tools", "table", "json", "analysis"].forEach(p => $("pane_" + p).style.display = (t === p ? "" : "none"));
    if (t === "table") {
        renderTable();
        renderInspector();
    }
    else if (t === "json")
        syncJson();
    else if (t === "analysis")
        runAnalysis();
}
function flashTools(msg) {
    if (panelHidden)
        togglePanel();
    showTab("analysis");
    const safe = String(msg).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const r = $("results");
    r.srcdoc = `<div style="font:14px Arial,sans-serif;color:#16243B;background:#fffdf7;padding:18px"><b>Analysis notice</b><p>${safe}</p></div>`;
}
function applyPanel() {
    const right = $("right");
    if (right)
        right.style.display = panelHidden ? "none" : "flex";
    const app = $("app");
    if (app)
        app.style.gridTemplateColumns = panelHidden ? "minmax(0,1fr) 14px 0" : "minmax(0,1.5fr) 14px minmax(320px,1fr)";
    const hideBtn = $("btnHide");
    if (hideBtn)
        hideBtn.textContent = panelHidden ? "Show panel" : "Remove right panel";
    const caret = $("rightToggle");
    if (caret) {
        caret.textContent = panelHidden ? "<" : ">";
        caret.setAttribute("aria-expanded", String(!panelHidden));
        caret.title = panelHidden ? "Show the analysis panel" : "Hide the analysis panel";
    }
}
function togglePanel() { panelHidden = !panelHidden; applyPanel(); if (active >= 0 && docs[active] && hasEditorCanvas(docs[active])) {
    analysisViewDoc = "";
    setTimeout(() => renderCanvas(), 40);
} persist(); }
/* ---------- tool running ---------- */
function toolHasComputed(d, i) { return (d.toolIds[i] || []).length > 0; }
function toolActive(d, i) { return (d.toolIds[i] || []).some(id => d.applied.has(id)); }
function syncToolButtons() { const d = active >= 0 ? D() : null; document.querySelectorAll("[data-tool]").forEach(b => { const i = +b.getAttribute("data-tool"); const on = !!d && toolActive(d, i); b.classList.toggle("on", on); b.classList.toggle("off", !on); b.title = on ? "Applied — click to remove this improvement" : "Available — click to apply this improvement"; }); }
function resetTools(d) { d.sugs = {}; d.toolIds = [[], [], [], [], [], []]; d.applied = new Set(); d.overruled = new Set(); d.overlay = emptyOverlay(); layoutMissing(d); }
function runTool(i) {
    var _a;
    if (active < 0) {
        flashTools("Open or create a workflow first — click New, or add an example.");
        return;
    }
    const d = D();
    if (d.wf.states.length < 2) {
        flashTools("Add a few states first — drag chips onto the canvas, then run a tool.");
        return;
    }
    if (toolActive(d, i)) {
        for (const id of d.toolIds[i])
            d.applied.delete(id);
        d.toolIds[i] = [];
    }
    else {
        computeTool(d, i);
        for (const id of d.toolIds[i])
            d.applied.add(id);
    }
    lastTool = i;
    rebuild(d);
    renderCanvas();
    renderTools();
    syncToolButtons();
    if (panelHidden && [0, 1, 2, 3, 4, 5].some(j => toolActive(d, j)))
        togglePanel();
    showTab("analysis");
    persist();
    logHistory("tool", (toolActive(d, i) ? "Ran " : "Turned off ") + (((_a = presets_1.TOOL_META[i]) === null || _a === void 0 ? void 0 : _a.name) || ("Tool " + (i + 1))));
}
function applyAll() { if (active < 0) {
    flashTools("Open or create a workflow first.");
    return;
} const d = D(); if (d.wf.states.length < 2) {
    flashTools("Add a few states first — drag chips onto the canvas, then run the tools.");
    return;
} for (let i = 0; i < 6; i++) {
    computeTool(d, i);
    for (const id of d.toolIds[i])
        d.applied.add(id);
} lastTool = -1; rebuild(d); renderCanvas(); renderTools(); syncToolButtons(); if (panelHidden)
    togglePanel(); showTab("analysis"); persist(); logHistory("tool", "Ran all six tools"); }
/* ---------- commit + full render ---------- */
function remembering() { return false; }
function plainDoc(dd) { return { id: dd.id, name: dd.name, wf: dd.wf, pos: dd.pos, cost: dd.cost, time: dd.time, branch: dd.branch, owner: dd.owner, stage: dd.stage, editorData: dd.editorData, activeTools: activeToolIndexes(dd), overruled: [...dd.overruled] }; }
function hydrateDoc(dd) {
    const d = { id: dd.id || ("wf" + Math.random().toString(36).slice(2, 6)), name: dd.name || "Workflow", wf: dd.wf, pos: dd.pos || {}, cost: dd.cost || {}, time: dd.time || {}, branch: dd.branch || {}, owner: dd.owner || {}, stage: dd.stage || {}, editorData: dd.editorData, sugs: {}, toolIds: [[], [], [], [], [], []], applied: new Set(), overruled: new Set(), overlay: emptyOverlay() };
    if (Array.isArray(dd.activeTools)) {
        for (const i of dd.activeTools) {
            if (typeof i === "number" && i >= 0 && i < 6) {
                computeTool(d, i);
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
function persist() {
    /* workspace view state is ephemeral; saved workflows live in the database.
     * Prompt1: keep the Workflow Editor showing the same thing the Analysis
     * screen is working on — push the (possibly changed) model back. */
    try { schedulePushStudioToEditor(); }
    catch (e) { }
}
function restoreState() { try {
    // one-time cleanup of pre-database browser storage
    ["plumbline_remember", "plumbline_studio_v1", USER_DB_KEY, SESSION_KEY].forEach(k => localStorage.removeItem(k));
}
catch (e) { } }
function commit() { if (active < 0) {
    full();
    return;
} const d = D(); resetTools(d); renderCanvas(); renderTable(); renderInspector(); syncJson(); renderTools(); syncToolButtons(); persist(); }
function full() { renderWfBar(); if (active === -1) {
    renderSigma();
    syncToolButtons();
    return;
} renderCanvas(); renderTable(); renderInspector(); syncJson(); renderTools(); syncToolButtons(); persist(); }
/* ---------- init ---------- */
function init() {
    docs = [];
    active = -2;
    setupEditorSync();
    setupAnalysisPanZoom();
    window.addEventListener("resize", () => { if (active >= 0 && docs[active] && hasEditorCanvas(docs[active])) {
        analysisViewDoc = "";
        renderCanvas();
    } });
    const exSel = $("exampleSel");
    exSel.addEventListener("change", () => { const k = exSel.value; if (!k)
        return; docs.push(mkDoc(presets_1.PRESETS[k])); active = docs.length - 1; sel = null; lastTool = -2; exSel.value = ""; full(); });
    $("btnAddState").addEventListener("click", () => { if (active === -1)
        return; const d = ensureDoc(); const id = uid(d, "S"); d.wf.states.push({ id, label: "New", role: "step" }); d.cost[id] = 50; d.time[id] = 30; d.pos[id] = placeNew(d); resetTools(d); sel = { kind: "state", key: id }; commit(); });
    $("ctAddTrans").addEventListener("click", toggleConnectMode);
    $("ctDelete").addEventListener("click", () => deleteSel());
    document.addEventListener("keydown", e => { if (e.key === "Escape" && connectMode) {
        connectMode = false;
        connectFrom = null;
        updateCtUi();
        renderCanvas();
    } });
    $("btnNew").addEventListener("click", () => { docs.push(mkDoc(startWf("New workflow"))); active = docs.length - 1; sel = null; lastTool = -2; full(); });
    $("btnAdd").addEventListener("click", () => { const src = active >= 0 ? D() : null; const w = src ? clone(src.wf) : blankWf("Workflow " + (docs.length + 1)); w.name = (src ? src.name + " (copy)" : w.name); w.id = w.id + "_c"; docs.push(mkDoc(w)); active = docs.length - 1; sel = null; lastTool = -2; full(); });
    { const hb = $("btnHide"); if (hb) hb.addEventListener("click", togglePanel); }
    { const rt = $("rightToggle"); if (rt) rt.addEventListener("click", togglePanel); }
    $("btnTidy").addEventListener("click", () => { if (active < 0)
        return; const d = D(); d.pos = tidyLayout(d); renderCanvas(); syncJson(); persist(); logHistory("layout", "Re-arranged tiles neatly"); });
    {
        const rem = document.getElementById("remember");
        if (rem)
            rem.addEventListener("change", () => { /* workspace state is not persisted in the browser; workflows are saved to the database */ });
    }
    $("btnEstimate").addEventListener("click", () => { if (active < 0)
        return; estimate(D()); renderTools(); renderTable(); syncJson(); logHistory("estimate", "Added reasonable fictitious cost/time values"); });
    $("btnFill").addEventListener("click", () => { if (active < 0)
        return; const d = D(); if (d.wf.states.length <= 2) {
        d.wf = clone(presets_1.PRESETS.aml);
        d.wf.name = d.name;
    } estimate(d); resetTools(d); full(); });
    $("btnAll").addEventListener("click", applyAll);
    $("btnLoadJson").addEventListener("click", loadJson);
    $("btnDownload").addEventListener("click", () => { if (active < 0)
        return; const blob = new Blob([JSON.stringify(unified(D()), null, 2)], { type: "application/json" }); const a = el("a", { href: URL.createObjectURL(blob), download: (D().wf.id || "workflow") + ".json" }); document.body.append(a); a.click(); a.remove(); logHistory("download", "Downloaded “" + D().name + "” JSON with layout/meta"); });
    { const lb = $("btnLogin"); if (lb) lb.addEventListener("click", () => showAuth(true)); }
    { const hl = $("homeLogin"); if (hl) hl.addEventListener("click", () => showAuth(true)); }
    { const hg = $("homeGuest"); if (hg) hg.addEventListener("click", () => { /* Login as Guest: intentionally does nothing for the moment (Prompt1) */ }); }
    { const hm = $("homeMaintenance"); if (hm) hm.addEventListener("click", () => { /* Superuser Maintenance: intentionally does nothing for now (Prompt1) */ }); }
    window.plumblineShowAuth = (open = true) => showAuth(open);
    $("btnSaveWorkflow").addEventListener("click", saveCurrentWorkflow);
    $("btnSavedWorkflows").addEventListener("click", () => showAuth(true));
    $("authClose").addEventListener("click", () => showAuth(false));
    $("btnSignIn").addEventListener("click", () => { signIn(); });
    $("btnCreateUser").addEventListener("click", () => { createUser(); });
    $("btnSignOut").addEventListener("click", signOut);
    $("btnUpdateProfile").addEventListener("click", updateProfile);
    { const pwb = document.getElementById("btnChangePw"); if (pwb) pwb.addEventListener("click", changePassword); }
    $("fileWf").addEventListener("change", e => { var _a; const f = (_a = e.target.files) === null || _a === void 0 ? void 0 : _a[0]; if (f)
        f.text().then(txt => ingest(safe(txt), "Upload")); });
    document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => runTool(+b.getAttribute("data-tool"))));
    document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.getAttribute("data-tab"))));
    $("cv").addEventListener("dblclick", e => { if (active === -1 || (active >= 0 && docs[active] && hasEditorCanvas(docs[active])))
        return; const r = $("cv").getBoundingClientRect(); const d = ensureDoc(); const id = uid(d, "S"); d.wf.states.push({ id, label: "New", role: "step" }); d.pos[id] = { x: Math.max(0, e.clientX - r.left - NW / 2), y: Math.max(0, e.clientY - r.top - NH / 2) }; d.cost[id] = 50; d.time[id] = 30; resetTools(d); sel = { kind: "state", key: id }; commit(); });
    // ---- drag-and-drop palette ----
    const pal = $("palette");
    CHIPS.forEach(spec => { pal.append(makeChip(spec)); });
    const scroll = $("cvscroll"), cvEl = $("cv");
    scroll.addEventListener("dragover", ev => { if (active === -1)
        return; ev.preventDefault(); const dt = ev.dataTransfer; if (dt)
        dt.dropEffect = "copy"; cvEl.classList.add("dropok"); });
    scroll.addEventListener("dragleave", () => cvEl.classList.remove("dropok"));
    scroll.addEventListener("drop", ev => {
        cvEl.classList.remove("dropok");
        if (active === -1)
            return;
        ev.preventDefault();
        const dt = ev.dataTransfer;
        const k = (dt && dt.getData("text/plain")) || dragSpec;
        dragSpec = null;
        const spec = CHIPS.find(c => c.k === k);
        if (!spec)
            return;
        const r = cvEl.getBoundingClientRect();
        addChip(spec, ev.clientX - r.left, ev.clientY - r.top);
    });
    restoreSession();
    restoreState();
    applyPanel();
    full();
    renderUserBadge();
}
function boot() { try {
    init();
}
catch (err) {
    const b = document.getElementById("err");
    if (b) {
        b.style.display = "block";
        b.textContent = "Studio failed to start: " + String(err && err.message || err);
    }
} }
document.addEventListener("DOMContentLoaded", boot);
if (document.readyState !== "loading")
    boot();

}, {"@plumbline/io":"packages/io/src/index.ts","@plumbline/app":"packages/app/src/index.ts","@plumbline/lemma":"packages/lemma/src/index.ts","@plumbline/core":"packages/core/src/index.ts","./presets":"studio/presets.ts"});
__PL.define("packages/app/src/index.ts", function(require,exports,module){
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeToHtml = exports.renderApp = exports.appToHtml = void 0;
__exportStar(require("./view"), exports);
var html_1 = require("./html");
Object.defineProperty(exports, "appToHtml", { enumerable: true, get: function () { return html_1.appToHtml; } });
var dom_1 = require("./dom");
Object.defineProperty(exports, "renderApp", { enumerable: true, get: function () { return dom_1.renderApp; } });
var analyze_1 = require("./analyze");
Object.defineProperty(exports, "analyzeToHtml", { enumerable: true, get: function () { return analyze_1.analyzeToHtml; } });

}, {"./view":"packages/app/src/view.ts","./html":"packages/app/src/html.ts","./dom":"packages/app/src/dom.ts","./analyze":"packages/app/src/analyze.ts"});
__PL.define("packages/app/src/view.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildView = buildView;
const render_1 = require("@plumbline/render");
// Assemble everything the shell shows from one engine report. The diagram's
// lean is the genuine "out of true" amount: refuted findings plus hard
// validation errors. Certified findings are improvements you can apply.
function buildView(wf, report) {
    const refuted = report.findings.filter((f) => f.provenance === "refuted").length;
    const errors = report.validation.filter((v) => v.level === "error").length;
    const lean = Math.min(8, 1.5 * (refuted + errors));
    return {
        name: wf.name,
        diagram: (0, render_1.irToRenderModel)(wf, lean),
        findings: report.findings.map((f) => ({ tool: f.tool, title: f.title, detail: f.detail, verdict: f.provenance })),
        ledger: report.cost,
        validation: report.validation,
    };
}

}, {"@plumbline/core":"packages/core/src/index.ts","@plumbline/io":"packages/io/src/index.ts","@plumbline/render":"packages/render/src/index.ts","@plumbline/cost":"packages/cost/src/index.ts"});
__PL.define("packages/render/src/index.ts", function(require,exports,module){
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyFinding = exports.render = exports.irToRenderModel = void 0;
__exportStar(require("./model"), exports);
var adapt_1 = require("./adapt");
Object.defineProperty(exports, "irToRenderModel", { enumerable: true, get: function () { return adapt_1.irToRenderModel; } });
var render_1 = require("./render");
Object.defineProperty(exports, "render", { enumerable: true, get: function () { return render_1.render; } });
var apply_1 = require("./apply");
Object.defineProperty(exports, "applyFinding", { enumerable: true, get: function () { return apply_1.applyFinding; } });

}, {"./model":"packages/render/src/model.ts","./adapt":"packages/render/src/adapt.ts","./render":"packages/render/src/render.ts","./apply":"packages/render/src/apply.ts"});
__PL.define("packages/render/src/model.ts", function(require,exports,module){
"use strict";
// The presentation contract. Everything the IR deliberately omits lives here:
// lanes, coordinates, edge styling, and the lean that drives the animation.
Object.defineProperty(exports, "__esModule", { value: true });

}, {});
__PL.define("packages/render/src/adapt.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.irToRenderModel = irToRenderModel;
const laneOf = {
    step: "main",
    quality: "quality",
    hold: "hold",
    decision: "decision",
    rework: "rework",
    terminal: "terminal",
};
const rowOf = {
    main: 0,
    quality: 1,
    hold: 0,
    decision: 0,
    rework: 2,
    terminal: 0,
};
// Column = breadth-first distance from the initial state. Simple on purpose:
// Phase 0 wants parity, not a new layout engine.
function depthFromInitial(wf) {
    var _a, _b;
    const adj = new Map();
    for (const t of wf.transitions) {
        const list = adj.get(t.from);
        if (list)
            list.push(t.to);
        else
            adj.set(t.from, [t.to]);
    }
    const depth = { [wf.initial]: 0 };
    const queue = [wf.initial];
    while (queue.length) {
        const cur = queue.shift();
        const d = (_a = depth[cur]) !== null && _a !== void 0 ? _a : 0;
        for (const n of (_b = adj.get(cur)) !== null && _b !== void 0 ? _b : []) {
            if (!(n in depth)) {
                depth[n] = d + 1;
                queue.push(n);
            }
        }
    }
    return depth;
}
function irToRenderModel(wf, lean = 0) {
    const col = depthFromInitial(wf);
    const nodes = wf.states.map((s) => {
        var _a, _b;
        const lane = (_a = laneOf[s.role]) !== null && _a !== void 0 ? _a : "main";
        return {
            id: s.id,
            label: s.label,
            lane,
            col: (_b = col[s.id]) !== null && _b !== void 0 ? _b : 0,
            row: rowOf[lane],
            accept: s.accept,
            reject: s.reject,
        };
    });
    const rejectIds = new Set(wf.states.filter((s) => s.reject).map((s) => s.id));
    const edges = wf.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        kind: rejectIds.has(t.to) ? "fail" : "forward",
    }));
    return { id: wf.id, name: wf.name, lean, nodes, edges };
}

}, {"@plumbline/core":"packages/core/src/index.ts","./model":"packages/render/src/model.ts"});
__PL.define("packages/render/src/render.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.render = render;
// Phase 0 renderer skeleton. It builds a real SVG from a RenderModel so the
// input contract can be tested end-to-end. In the full repo, the demo's proven
// SVG drawing routine slots in here unchanged; only its input (RenderModel) is new.
const COLW = 160, ROWH = 90, PAD = 40, NODEW = 120, NODEH = 48;
const NS = "http://www.w3.org/2000/svg";
function render(model, mount) {
    const doc = mount.ownerDocument;
    const maxCol = model.nodes.reduce((m, n) => Math.max(m, n.col), 0);
    const maxRow = model.nodes.reduce((m, n) => Math.max(m, n.row), 0);
    const w = PAD * 2 + (maxCol + 1) * COLW;
    const h = PAD * 2 + (maxRow + 1) * ROWH;
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("class", "plumbline-workflow");
    const root = doc.createElementNS(NS, "g");
    // lean drives a small rotation; 0 = plumb (hangs true).
    root.setAttribute("transform", "rotate(" + model.lean + " " + w / 2 + " " + h / 2 + ")");
    svg.appendChild(root);
    const cx = (col) => PAD + col * COLW + NODEW / 2;
    const cy = (row) => PAD + row * ROWH + NODEH / 2;
    const pos = new Map();
    for (const n of model.nodes)
        pos.set(n.id, [cx(n.col), cy(n.row)]);
    for (const e of model.edges) {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b)
            continue;
        const line = doc.createElementNS(NS, "line");
        line.setAttribute("x1", String(a[0]));
        line.setAttribute("y1", String(a[1]));
        line.setAttribute("x2", String(b[0]));
        line.setAttribute("y2", String(b[1]));
        line.setAttribute("class", "edge " + e.kind);
        root.appendChild(line);
    }
    for (const n of model.nodes) {
        const g = doc.createElementNS(NS, "g");
        g.setAttribute("class", "node " + n.lane + (n.accept ? " accept" : "") + (n.reject ? " reject" : ""));
        const rect = doc.createElementNS(NS, "rect");
        rect.setAttribute("x", String(cx(n.col) - NODEW / 2));
        rect.setAttribute("y", String(cy(n.row) - NODEH / 2));
        rect.setAttribute("width", String(NODEW));
        rect.setAttribute("height", String(NODEH));
        rect.setAttribute("rx", "8");
        const text = doc.createElementNS(NS, "text");
        text.setAttribute("x", String(cx(n.col)));
        text.setAttribute("y", String(cy(n.row)));
        text.setAttribute("text-anchor", "middle");
        text.textContent = n.label;
        g.appendChild(rect);
        g.appendChild(text);
        root.appendChild(g);
    }
    mount.appendChild(svg);
    return svg;
}

}, {"./model":"packages/render/src/model.ts"});
__PL.define("packages/render/src/apply.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyFinding = applyFinding;
// Only certified findings change the diagram. Applying one straightens the
// lean toward zero; refuted findings inform but never mutate.
function applyFinding(m, f, remaining) {
    if (f.provenance !== "certified")
        return m;
    const next = {
        ...m,
        nodes: m.nodes.map((n) => ({ ...n })),
        edges: m.edges.map((e) => ({ ...e })),
    };
    next.lean = remaining > 1 ? m.lean - m.lean / remaining : 0;
    return next;
}

}, {"./model":"packages/render/src/model.ts","@plumbline/core":"packages/core/src/index.ts"});
__PL.define("packages/app/src/html.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appToHtml = appToHtml;
const COLW = 170, ROWH = 96, PAD = 40, NW = 128, NH = 46;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function laneStroke(lane) {
    switch (lane) {
        case "quality": return "#3A9D90";
        case "rework": return "#B8862F";
        case "hold": return "#7B8694";
        case "decision": return "#16243B";
        case "terminal": return "#2E7D32";
        default: return "#1F7A6F";
    }
}
// Pure-string SVG (no DOM), so the page renders in plain Node.
function svgMarkup(m) {
    let maxCol = 0, maxRow = 0;
    for (const n of m.nodes) {
        if (n.col > maxCol)
            maxCol = n.col;
        if (n.row > maxRow)
            maxRow = n.row;
    }
    const w = PAD * 2 + (maxCol + 1) * COLW;
    const h = PAD * 2 + (maxRow + 1) * ROWH;
    const cx = (c) => PAD + c * COLW + NW / 2;
    const cy = (r) => PAD + r * ROWH + NH / 2;
    const pos = new Map();
    for (const n of m.nodes)
        pos.set(n.id, [cx(n.col), cy(n.row)]);
    const out = [];
    out.push('<svg viewBox="0 0 ' + w + " " + h + '" xmlns="http://www.w3.org/2000/svg" width="100%">');
    out.push('<g transform="rotate(' + m.lean + " " + w / 2 + " " + h / 2 + ')">');
    for (const e of m.edges) {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b)
            continue;
        const fail = e.kind === "fail";
        out.push('<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] +
            '" stroke="' + (fail ? "#B23A3A" : "#C7CDD6") + '" stroke-width="2"' + (fail ? ' stroke-dasharray="5 4"' : "") + "/>");
    }
    for (const n of m.nodes) {
        const p = pos.get(n.id);
        if (!p)
            continue;
        const stroke = n.accept ? "#2E7D32" : n.reject ? "#B23A3A" : laneStroke(n.lane);
        out.push('<rect x="' + (p[0] - NW / 2) + '" y="' + (p[1] - NH / 2) + '" width="' + NW + '" height="' + NH +
            '" rx="9" fill="#FFFFFF" stroke="' + stroke + '" stroke-width="2"/>');
        out.push('<text x="' + p[0] + '" y="' + (p[1] + 5) + '" text-anchor="middle" font-family="Arial" font-size="14" fill="#16243B">' + esc(n.label) + "</text>");
    }
    out.push("</g></svg>");
    return out.join("");
}
const CSS = [
    "*{box-sizing:border-box}",
    "body{margin:0;background:#F5F2EA;color:#16243B;font-family:Arial,Helvetica,sans-serif;padding:28px}",
    ".pl-head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #1F7A6F;padding-bottom:8px}",
    ".wm{font-weight:700;font-size:22px}.wm .b{color:#1F7A6F}",
    ".eyebrow{color:#1F7A6F;font-weight:700;letter-spacing:.18em;font-size:12px}",
    "h1{font-size:26px;margin:18px 0 4px}h2{font-size:16px;margin:0 0 10px}",
    ".grid{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}",
    "section{background:#fff;border:1px solid #D7E1DE;border-radius:10px;padding:16px;margin-top:16px}",
    ".summary{border-top:4px solid #1F7A6F}",
    ".summarygrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}",
    ".summaryStat{background:#F5F2EA;border:1px solid #E4EAE8;border-radius:8px;padding:10px}",
    ".summaryStat span{display:block;color:#5B6A85;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}",
    ".summaryStat strong{display:block;font-size:22px;line-height:1.15;margin-top:4px;color:#16243B}",
    ".changeList{margin:10px 0 0;padding-left:18px}.changeList li{margin:6px 0}",
    ".diagram{display:none}.findings{flex:1 1 100%}",
    ".findings ul{list-style:none;margin:0;padding:0}",
    ".findings li{border-left:4px solid #C7CDD6;padding:8px 12px;margin-bottom:10px;background:#FAFCFB}",
    ".findings li.cert{border-left-color:#1F7A6F}.findings li.ref{border-left-color:#B23A3A}",
    ".badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.08em;padding:2px 7px;border-radius:4px;margin-right:8px;color:#fff}",
    ".cert .badge{background:#1F7A6F}.ref .badge{background:#B23A3A}",
    ".muted{color:#5B6A85;font-size:13px;margin-top:4px}",
    "table{border-collapse:collapse;width:100%;font-size:14px}",
    "th,td{border-bottom:1px solid #E4EAE8;padding:6px 8px;text-align:left}.r{text-align:right}",
    "tr.total td{font-weight:700;border-top:2px solid #1F7A6F}",
    ".ledger em{color:#1F7A6F;font-style:italic}",
    ".pl-foot{margin-top:22px;color:#1F7A6F;font-weight:700;letter-spacing:.18em;font-size:12px;border-top:2px solid #1F7A6F;padding-top:8px}",
].join("");
function appToHtml(v) {
    const L = [];
    L.push("<!doctype html>");
    L.push('<html lang="en"><head><meta charset="utf-8">');
    L.push("<title>" + esc(v.name) + " — Plumbline</title>");
    L.push("<style>" + CSS + "</style></head><body>");
    L.push('<header class="pl-head"><span class="wm">plum<span class="b">b</span>line</span><span class="eyebrow">TRUE BY MEASURE</span></header>');
    L.push("<h1>" + esc(v.name) + "</h1>");
    const certified = v.findings.filter((f) => f.verdict === "certified");
    const refuted = v.findings.filter((f) => f.verdict === "refuted");
    L.push('<section class="summary"><h2>Summary of what changed</h2>');
    L.push('<p class="muted">The workflow visual is shown on the main Analysis Studio canvas. This side panel now focuses on the analysis results and the changes Plumbline identified.</p>');
    L.push('<div class="summarygrid">');
    L.push('<div class="summaryStat"><span>Certified changes</span><strong>' + certified.length + '</strong></div>');
    L.push('<div class="summaryStat"><span>Refuted checks</span><strong>' + refuted.length + '</strong></div>');
    L.push('<div class="summaryStat"><span>Illustrative expected cost</span><strong>' + (v.ledger.converged ? '$' + v.ledger.total : 'diverges') + '</strong></div>');
    L.push('</div>');
    if (certified.length) {
        L.push('<h2>Changed / recommended</h2><ul class="changeList">');
        for (const f of certified)
            L.push('<li><strong>' + esc(f.title) + '</strong><div class="muted">' + esc(f.detail) + '</div></li>');
        L.push('</ul>');
    }
    else {
        L.push('<p class="muted">No certified workflow change was found. The checks below were either refuted or informational.</p>');
    }
    L.push('</section>');
    L.push('<div class="grid">');
    L.push('<section class="findings"><h2>Findings</h2><ul>');
    for (const f of v.findings) {
        const cls = f.verdict === "certified" ? "cert" : "ref";
        const tag = f.verdict === "certified" ? "CERTIFIED" : "REFUTED";
        L.push('<li class="' + cls + '"><span class="badge">' + tag + "</span><strong>" + esc(f.title) + "</strong><div class=\"muted\">" + esc(f.detail) + "</div></li>");
    }
    if (!v.findings.length)
        L.push('<li class="muted">No findings.</li>');
    L.push("</ul></section>");
    L.push("</div>");
    L.push('<section class="ledger"><h2>Where it saves — <em>illustrative (not certified)</em></h2>');
    if (!v.ledger.converged) {
        L.push('<p class="muted">Expected cost diverges: ' + esc(v.ledger.notes.join(" ")) + "</p>");
    }
    else {
        L.push('<table><thead><tr><th>Step</th><th class="r">Expected visits</th><th class="r">Expected cost</th></tr></thead><tbody>');
        for (const s of v.ledger.perState)
            L.push("<tr><td>" + esc(s.id) + '</td><td class="r">' + s.expectedVisits + '</td><td class="r">$' + s.expectedCost + "</td></tr>");
        L.push('<tr class="total"><td>Total</td><td></td><td class="r">$' + v.ledger.total + "</td></tr>");
        L.push("</tbody></table>");
        L.push('<p class="muted">' + esc(v.ledger.assumptions.join(" ")) + "</p>");
    }
    L.push("</section>");
    if (v.validation.length) {
        L.push('<section class="validation"><h2>Validation</h2><ul>');
        for (const i of v.validation)
            L.push('<li class="' + (i.level === "error" ? "ref" : "muted") + '">' + esc(i.level) + ": " + esc(i.msg) + "</li>");
        L.push("</ul></section>");
    }
    L.push('<footer class="pl-foot">TRUE BY MEASURE</footer>');
    L.push("</body></html>");
    return L.join("\n");
}

}, {"@plumbline/render":"packages/render/src/index.ts","./view":"packages/app/src/view.ts"});
__PL.define("packages/app/src/dom.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderApp = renderApp;
const render_1 = require("@plumbline/render");
// Live-DOM version of the shell (used in the browser / tested with jsdom).
function renderApp(v, mount) {
    const doc = mount.ownerDocument;
    const el = (tag, cls, text) => {
        const e = doc.createElement(tag);
        if (cls)
            e.className = cls;
        if (text !== undefined)
            e.textContent = text;
        return e;
    };
    mount.appendChild(el("h1", undefined, v.name));
    const diagram = el("section", "diagram");
    diagram.appendChild(el("h2", undefined, "Workflow"));
    (0, render_1.render)(v.diagram, diagram);
    mount.appendChild(diagram);
    const findings = el("section", "findings");
    findings.appendChild(el("h2", undefined, "Findings"));
    const ul = doc.createElement("ul");
    for (const f of v.findings) {
        const li = el("li", f.verdict === "certified" ? "cert" : "ref");
        li.appendChild(el("span", "badge", f.verdict.toUpperCase()));
        li.appendChild(el("strong", undefined, f.title));
        ul.appendChild(li);
    }
    findings.appendChild(ul);
    mount.appendChild(findings);
    const ledger = el("section", "ledger");
    ledger.appendChild(el("h2", undefined, "Where it saves — illustrative (not certified)"));
    ledger.appendChild(el("p", undefined, v.ledger.converged ? "Total $" + v.ledger.total : "Diverges: " + v.ledger.notes.join(" ")));
    mount.appendChild(ledger);
}

}, {"@plumbline/render":"packages/render/src/index.ts","./view":"packages/app/src/view.ts"});
__PL.define("packages/app/src/analyze.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeToHtml = analyzeToHtml;
const io_1 = require("@plumbline/io");
const view_1 = require("./view");
const html_1 = require("./html");
// The capstone: supplied JSON in, a standalone page out. Parse failures come
// back as a clear error list rather than an exception.
function analyzeToHtml(workflowJson, costJson, check) {
    const wf = (0, io_1.parseWorkflow)(workflowJson);
    if (!wf.ok)
        return { ok: false, errors: wf.errors };
    const cm = (0, io_1.parseCostModel)(costJson);
    if (!cm.ok)
        return { ok: false, errors: cm.errors };
    const report = (0, io_1.runPipeline)(wf.value, cm.value, check);
    return { ok: true, html: (0, html_1.appToHtml)((0, view_1.buildView)(wf.value, report)) };
}

}, {"@plumbline/core":"packages/core/src/index.ts","@plumbline/io":"packages/io/src/index.ts","./view":"packages/app/src/view.ts","./html":"packages/app/src/html.ts"});
__PL.define("studio/presets.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_META = exports.PRESET_ORDER = exports.PRESETS = void 0;
// Five illustrative preset workflows, each a valid IR with a distinct topology.
exports.PRESETS = {
    aml: { id: "aml", name: "AML / KYC", alphabet: [], initial: "Alert", accepts: ["Cleared"], rejects: ["Filed"],
        states: [
            { id: "Alert", label: "Alert", role: "step", initial: true }, { id: "Score", label: "Score", role: "step" },
            { id: "Triage", label: "Triage", role: "decision" }, { id: "Investigate", label: "Investigate", role: "step" },
            { id: "VerifyID", label: "Verify ID", role: "quality" }, { id: "VerifyFunds", label: "Verify funds", role: "quality" },
            { id: "Review", label: "Review", role: "decision" }, { id: "RFI", label: "RFI", role: "rework" },
            { id: "Cleared", label: "Cleared", role: "terminal", accept: true }, { id: "Filed", label: "Filed", role: "terminal", reject: true }
        ],
        transitions: [
            { from: "Alert", on: "generate", to: "Score" }, { from: "Score", on: "scored", to: "Triage" },
            { from: "Triage", on: "auto_clear", to: "Cleared" }, { from: "Triage", on: "escalate", to: "Investigate" },
            { from: "Investigate", on: "built", to: "VerifyID" }, { from: "VerifyID", on: "id_ok", to: "VerifyFunds" },
            { from: "VerifyFunds", on: "funds_ok", to: "Review" }, { from: "Review", on: "clear", to: "Cleared" },
            { from: "Review", on: "file", to: "Filed" }, { from: "Review", on: "rfi", to: "RFI" }, { from: "RFI", on: "reinvestigate", to: "Investigate" }
        ] },
    data: { id: "data", name: "Data Pipeline", alphabet: [], initial: "Ingest", accepts: ["Publish"], rejects: ["Quarantine"],
        states: [
            { id: "Ingest", label: "Ingest", role: "step", initial: true }, { id: "Route", label: "Route", role: "decision" },
            { id: "Trade", label: "Trade", role: "step" }, { id: "Swap", label: "Swap", role: "step" }, { id: "Misc", label: "Misc", role: "step" },
            { id: "Merge", label: "Merge", role: "step" }, { id: "Price", label: "Price", role: "step" }, { id: "Barrier", label: "Barrier", role: "hold" },
            { id: "Reconcile", label: "Reconcile", role: "decision" }, { id: "Fix", label: "Fix", role: "rework" },
            { id: "Publish", label: "Publish", role: "terminal", accept: true }, { id: "Quarantine", label: "Quarantine", role: "terminal", reject: true }
        ],
        transitions: [
            { from: "Ingest", on: "parsed", to: "Route" }, { from: "Route", on: "trade", to: "Trade" }, { from: "Route", on: "swap", to: "Swap" },
            { from: "Route", on: "other", to: "Misc" }, { from: "Trade", on: "norm", to: "Merge" }, { from: "Swap", on: "norm2", to: "Merge" },
            { from: "Misc", on: "norm3", to: "Merge" }, { from: "Merge", on: "priced", to: "Price" }, { from: "Price", on: "ready", to: "Barrier" },
            { from: "Barrier", on: "batch", to: "Reconcile" }, { from: "Reconcile", on: "ok", to: "Publish" }, { from: "Reconcile", on: "bad", to: "Quarantine" },
            { from: "Reconcile", on: "brk", to: "Fix" }, { from: "Fix", on: "fixed", to: "Reconcile" }
        ] },
    carf: { id: "carf", name: "CARF Reporting", alphabet: [], initial: "Period", accepts: ["Filed"], rejects: ["Rejected"],
        states: [
            { id: "Period", label: "Period close", role: "step", initial: true }, { id: "Map", label: "Map", role: "step" },
            { id: "Value", label: "Value", role: "step" }, { id: "BuildEU", label: "Build EU", role: "step" }, { id: "BuildUK", label: "Build UK", role: "step" },
            { id: "Validate", label: "Validate", role: "decision" }, { id: "Amend", label: "Amend", role: "rework" },
            { id: "Sign", label: "Sign-off", role: "decision" }, { id: "Filed", label: "Filed", role: "terminal", accept: true },
            { id: "Rejected", label: "Rejected", role: "terminal", reject: true }
        ],
        transitions: [
            { from: "Period", on: "close", to: "Map" }, { from: "Map", on: "mapped", to: "Value" }, { from: "Value", on: "val_eu", to: "BuildEU" },
            { from: "Value", on: "val_uk", to: "BuildUK" }, { from: "BuildEU", on: "done_eu", to: "Validate" }, { from: "BuildUK", on: "done_uk", to: "Validate" },
            { from: "Validate", on: "ok", to: "Sign" }, { from: "Validate", on: "fix", to: "Amend" }, { from: "Amend", on: "redo", to: "Validate" },
            { from: "Sign", on: "sign", to: "Filed" }, { from: "Sign", on: "reject", to: "Rejected" }
        ] },
    fmv: { id: "fmv", name: "FMV Pricing", alphabet: [], initial: "Asset", accepts: ["Published"], rejects: ["NoValue"],
        states: [
            { id: "Asset", label: "Asset", role: "step", initial: true }, { id: "Pull", label: "Pull venues", role: "step" },
            { id: "L1", label: "Level 1", role: "decision" }, { id: "L2", label: "Level 2", role: "decision" }, { id: "L3", label: "Level 3 model", role: "step" },
            { id: "Check", label: "Consistency", role: "decision" }, { id: "Override", label: "Override", role: "rework" },
            { id: "Published", label: "Published", role: "terminal", accept: true }, { id: "NoValue", label: "No value", role: "terminal", reject: true }
        ],
        transitions: [
            { from: "Asset", on: "request", to: "Pull" }, { from: "Pull", on: "pulled", to: "L1" }, { from: "L1", on: "l1_ok", to: "Check" },
            { from: "L1", on: "l1_no", to: "L2" }, { from: "L2", on: "l2_ok", to: "Check" }, { from: "L2", on: "l2_no", to: "L3" },
            { from: "L3", on: "modelled", to: "Check" }, { from: "Check", on: "ok", to: "Published" }, { from: "Check", on: "override", to: "Override" },
            { from: "Check", on: "noval", to: "NoValue" }, { from: "Override", on: "reprice", to: "Check" }
        ] },
    change: { id: "change", name: "Change Mgmt", alphabet: [], initial: "Request", accepts: ["Done"], rejects: ["Rollback"],
        states: [
            { id: "Request", label: "Request", role: "step", initial: true }, { id: "Criteria", label: "Criteria", role: "step" },
            { id: "Dev", label: "Dev", role: "step" }, { id: "Test", label: "Test", role: "decision" }, { id: "Refine", label: "Refine", role: "rework" },
            { id: "Stage", label: "Staging", role: "step" }, { id: "Approve", label: "Approve", role: "decision" }, { id: "Prod", label: "Prod", role: "step" },
            { id: "Done", label: "Released", role: "terminal", accept: true }, { id: "Rollback", label: "Rollback", role: "terminal", reject: true }
        ],
        transitions: [
            { from: "Request", on: "raise", to: "Criteria" }, { from: "Criteria", on: "frozen", to: "Dev" }, { from: "Dev", on: "built", to: "Test" },
            { from: "Test", on: "pass", to: "Stage" }, { from: "Test", on: "refine", to: "Refine" }, { from: "Refine", on: "again", to: "Dev" },
            { from: "Stage", on: "staged", to: "Approve" }, { from: "Approve", on: "approve", to: "Prod" }, { from: "Approve", on: "deny", to: "Rollback" },
            { from: "Prod", on: "released", to: "Done" }
        ] },
};
exports.PRESET_ORDER = ["aml", "data", "carf", "fmv", "change"];
exports.TOOL_META = [
    { name: "Zoom out", what: "Bundle fine-grained statuses into a few honest stages — only where work can't secretly skip ahead.", money: "Report cost and cycle time in a few clean buckets instead of dozens of line items." },
    { name: "Spot duplicates", what: "Find steps that differ on paper but behave identically, and branches nothing can reach. Merge the first; delete the second.", money: "Every redundant status costs training, procedure, validation and audit scope. Removing true duplicates is near-free savings." },
    { name: "Plan vs. reality", what: "Line the documented process up against what the logs actually show — out-of-order steps, unplanned holds, skipped checks.", money: "Those drifts are quiet leakage — extra handling, holds, rework — now named and countable." },
    { name: "Move the decision", what: "Check whether the go/no-go can happen earlier without changing the outcomes.", money: "Deciding earlier scraps something cheap instead of something finished — the saving is the work you no longer pour in." },
    { name: "Run in parallel", what: "Pick out independent steps that can run at the same time instead of one after another.", money: "Overlapping independent work shortens the clock and frees cash tied up in half-finished work." },
    { name: "Find the loops", what: "Separate one-way progress from rework loops, and cap any loop with no exit.", money: "Rework is usually the biggest hidden cost — this points at the loop to measure, attack, and cap." },
];

}, {"@plumbline/core":"packages/core/src/index.ts"});