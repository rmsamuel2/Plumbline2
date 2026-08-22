/* ============================================================================
 * studio/modules/analysis.ts — Analysis Studio screen
 * ----------------------------------------------------------------------------
 * Phase 1, step 5b. 94 declarations MOVED from studio/main.ts (ui-modules.gen.js
 * at ws_1.commit 462ebb7); original line ranges noted above each. Edits were limited
 * to reference rewriting: dom_1. / ws_1. / auth_1. / ed_1. prefixes, and
 * workspace state through accessors (ws_1.getActive() etc).
 *
 * NOTE: io_1 / app_1 / lemma_1 / presets_1 are declared by the moved
 * main.ts:4-7 lines below - they are NOT re-declared here.
 * PHASE2: the io_1 and lemma_1 requires go away when the engine moves behind
 *         /api/engine/*.
 * PHASE4: computeTool() and the six tool branches are engine IP that must move
 *         to the server; the graph helpers they use already live in workspace.
 * Both are marked in place.
 *
 * VISIBILITY: toggles the "active" CLASS on #studioPage. studio.css:180-181
 * defines .plPage{display:none} / .plPage.active{display:flex;flex-direction:
 * column} - setting style.display directly would break the flex layout.
 * ==========================================================================*/
__PL.define("studio/modules/analysis.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var dom_1  = require("studio/shared/dom.ts");
var ws_1   = require("studio/shared/workspace.ts");
var auth_1 = require("studio/shared/auth.ts");
var ed_1   = require("studio/modules/editor.ts");

/* One-time initialisation. See the note above exports.default for why this
 * screen binds once instead of binding per mount. */
var initialised = false;
var CTX = null;   /* set by mount; retained so one-time bindings reach services */
var strategicSort = "opportunity";
var strategicView = "math";
var strategicAiState = { status: "idle", result: null, signature: "", error: "",
    source: "live", reportId: null, createdAt: null, aiGeneratedAt: null,
    mathematicalSnapshot: null, workflowSnapshots: [] };
var strategicAiSaving = false;
var strategicAiSaveMessage = "";
var aiReportExplorerState = { reports: [], selectedId: null, workflowKey: "all", filter: "", busy: false };


/* main.ts:4-4 */
const io_1 = require("@plumbline/io");

/* main.ts:5-5 */
const app_1 = require("@plumbline/app");

/* main.ts:6-6 */
const lemma_1 = require("@plumbline/lemma");

/* main.ts:7-7 */
const presets_1 = require("./presets");

/* main.ts:49-50 */
const ANALYSIS_STAGE_COLORS = ["#1F7A6F", "#3A9D90", "#5B4B8A", "#B8862F", "#2E7D32", "#C8842A", "#2563eb", "#7e22ce"];
/* ---------- doc construction ---------- */

/* main.ts:96-96 */
let dragSpec = null;

/* main.ts:97-138 */
function makeChip(spec) {
    const c = dom_1.el("div", { class: "chip" }, spec.label);
    c.style.borderLeftColor = ws_1.ROLE_COLOR[spec.role];
    c.title = "drag onto the canvas, or click to add";
    let moved = false, sx = 0, sy = 0;
    let ghost = null;
    const onMove = (e) => {
        if (!moved && Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 4)
            moved = true;
        if (moved) {
            if (!ghost) {
                ghost = dom_1.el("div", { class: "chip chipghost" }, spec.label);
                ghost.style.borderLeftColor = ws_1.ROLE_COLOR[spec.role];
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
            const sc = dom_1.$("cvscroll").getBoundingClientRect();
            if (e.clientX >= sc.left && e.clientX <= sc.right && e.clientY >= sc.top && e.clientY <= sc.bottom) {
                const r = dom_1.$("cv").getBoundingClientRect();
                addChip(spec, e.clientX - r.left + (dom_1.$("cvscroll").scrollLeft || 0), e.clientY - r.top + (dom_1.$("cvscroll").scrollTop || 0));
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

/* main.ts:139-157 */
function addChip(spec, x, y) {
    const d = ws_1.ensureDoc();
    const id = ws_1.uid(d, spec.role === "terminal" ? "T" : "S");
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
    d.pos[id] = (x != null && y != null) ? { x: Math.max(0, x - ws_1.NW / 2), y: Math.max(0, y - ws_1.NH / 2) } : ws_1.placeNew(d);
    ws_1.resetTools(d);
    ws_1.setSel({ kind: "state", key: id });
    ws_1.commit();
}

/* main.ts:368-494 */  /* PHASE4: engine IP -> server/src/engine/suggest.js */
function computeTool(d, i) {
    var _a, _b, _c, _d, _e;
    var _f;
    if (d.toolIds[i].length)
        return; // cached
    const w = ws_1.normalise(d.wf);
    const made = [];
    const add = (s) => { const id = "t" + i + "_" + made.length; const full = { ...s, id, tool: i }; made.push(full); d.sugs[id] = full; d.toolIds[i].push(id); };
    if (i === 0) { // zoom out
        const dep = ws_1.depthMap(w);
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
        const reach = ws_1.reachable(w);
        const sig = {};
        for (const s of w.states) {
            if (s.terminal || s.initial) { }
            const o = ws_1.outOf(w, s.id).map(t => ws_1.roleOf(w, t.to)).sort().join(",");
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
        const p = d.pos[anchor.id] || { x: ws_1.PAD, y: ws_1.PAD };
        const down = w.states.filter(s => s.role !== "terminal").reduce((a, s) => a + (d.cost[s.id] || 0), 0);
        add({ title: "Unplanned hold seen in the logs", found: "At “" + anchor.label + "” the executed logs show an out-of-order hold the documented process never authorises.",
            time: 30, cost: Math.round(down * 0.10),
            apply: (o) => { o.ghosts.push({ x: p.x, y: p.y - 58, text: "⚠ unplanned hold (in logs, not in plan)" }); o.flag[anchor.id] = { color: "#B2453C" }; } });
    }
    else if (i === 3) { // move the decision
        const decs = w.states.filter(s => s.role === "decision");
        const dep = ws_1.depthMap(w);
        if (decs.length) {
            const late = decs.slice().sort((a, b) => { var _a, _b; return ((_a = dep[b.id]) !== null && _a !== void 0 ? _a : 0) - ((_b = dep[a.id]) !== null && _b !== void 0 ? _b : 0); })[0];
            const upstream = w.states.filter(s => { var _a, _b; return ((_a = dep[s.id]) !== null && _a !== void 0 ? _a : 0) < ((_b = dep[late.id]) !== null && _b !== void 0 ? _b : 0) && s.role !== "terminal"; });
            const saveC = Math.round(upstream.reduce((a, s) => a + (d.cost[s.id] || 0), 0) * 0.15);
            const saveT = Math.round(upstream.reduce((a, s) => a + (d.time[s.id] || 0), 0) * 0.15);
            add({ title: "Decide earlier at “" + late.label + "”", found: "The go/no-go at “" + late.label + "” can move ahead of the costly work upstream, scrapping cheap instead of finished.",
                time: saveT, cost: saveC,
                apply: (o, dd) => { const p = dd.pos[late.id]; if (p) {
                    dd.pos[late.id] = { x: Math.max(ws_1.PAD, p.x - ws_1.COLW), y: p.y };
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
        const be = ws_1.backEdges(w);
        if (be.length) {
            be.forEach((e) => {
                const body = ws_1.pathBetween(w, e.to, e.from);
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

/* main.ts:515-515 */
const EDITOR_CANVAS_SIZE = 12000;

/* main.ts:516-516 */
const EDITOR_OFFSET = { x: Math.round(EDITOR_CANVAS_SIZE / 2 - 800), y: Math.round(EDITOR_CANVAS_SIZE / 2 - 340) };

/* main.ts:517-517 */
const EDITOR_NODE_W = 176, EDITOR_NODE_H = 82;

/* main.ts:518-518 */
let lastEditorScrollDoc = "";

/* main.ts:519-519 */
let analysisViewDoc = "", analysisViewSig = "";

/* main.ts:520-520 */
const analysisPan = { x: 0, y: 0, zoom: 1 };

/* main.ts:521-521 */
let analysisShowAllLines = false;

/* main.ts:522-522 */
let analysisIncreasedSpacing = false;

/* main.ts:523-523 */
let currentAnalysisModel = null;

/* main.ts:524-524 */
function analysisEditorPanActive() { return ws_1.getActive() >= 0 && !!ws_1.getDocs()[ws_1.getActive()] && ws_1.hasEditorCanvas(ws_1.getDocs()[ws_1.getActive()]) && dom_1.$("cv").classList.contains("analysisEditorCanvas"); }

/* main.ts:525-525 */
function clampNum(n, min, max) { return Math.max(min, Math.min(max, n)); }

/* main.ts:526-533 */
function editorContentBounds(model) { var _a, _b, _c, _d; let x0 = Number.POSITIVE_INFINITY, y0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY, y1 = Number.NEGATIVE_INFINITY; const add = (p) => { if (!p)
    return; const x = Number(p.x), y = Number(p.y), w = Number(p.w || 0), h = Number(p.h || 0); if (!Number.isFinite(x) || !Number.isFinite(y))
    return; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); }; (_a = model.stagePositions) === null || _a === void 0 ? void 0 : _a.forEach((p) => add(p)); (_b = model.positions) === null || _b === void 0 ? void 0 : _b.forEach((p) => add(p)); if (!Number.isFinite(x0)) {
    x0 = 0;
    y0 = 0;
    x1 = 900;
    y1 = 520;
} const ox = Number(((_c = model.contentOffset) === null || _c === void 0 ? void 0 : _c.x) || 0), oy = Number(((_d = model.contentOffset) === null || _d === void 0 ? void 0 : _d.y) || 0), pad = 64; return { x: x0 + ox - pad, y: y0 + oy - pad, w: Math.max(1, x1 - x0 + pad * 2), h: Math.max(1, y1 - y0 + pad * 2) }; }

/* main.ts:534-543 */
function updateAnalysisZoomUi() {
    const scroll = dom_1.$("cvscroll");
    const z = analysisPan.zoom;
    scroll.classList.toggle("analysisZoomTiny", z < 0.30);
    scroll.classList.toggle("analysisZoomSmall", z >= 0.30 && z < 0.58);
    scroll.classList.toggle("analysisZoomNormal", z >= 0.58);
    const pct = document.getElementById("analysisZoomPct");
    if (pct)
        pct.textContent = Math.round(z * 100) + "%";
}

/* main.ts:544-544 */
function applyAnalysisPanZoom() { const cv = dom_1.$("cv"); cv.style.transformOrigin = "0 0"; cv.style.transform = `translate(${analysisPan.x}px, ${analysisPan.y}px) scale(${analysisPan.zoom})`; updateAnalysisZoomUi(); }

/* main.ts:545-545 */
function fitEditorAnalysisToView(model) { const scroll = dom_1.$("cvscroll"); const b = editorContentBounds(model); const vw = Math.max(1, scroll.clientWidth || 900), vh = Math.max(1, scroll.clientHeight || 560); const margin = 104; const z = clampNum(Math.min((vw - margin) / b.w, (vh - margin) / b.h), 0.055, 1.15); analysisPan.zoom = z; analysisPan.x = (vw - b.w * z) / 2 - b.x * z; analysisPan.y = (vh - b.h * z) / 2 - b.y * z; applyAnalysisPanZoom(); }

/* main.ts:546-546 */
function zoomAnalysisAt(mx, my, factor) { const beforeX = (mx - analysisPan.x) / analysisPan.zoom, beforeY = (my - analysisPan.y) / analysisPan.zoom; analysisPan.zoom = clampNum(analysisPan.zoom * factor, 0.055, 2.75); analysisPan.x = mx - beforeX * analysisPan.zoom; analysisPan.y = my - beforeY * analysisPan.zoom; applyAnalysisPanZoom(); }

/* main.ts:547-547 */
function zoomAnalysisCenter(factor) { const scroll = dom_1.$("cvscroll"); zoomAnalysisAt((scroll.clientWidth || 900) / 2, (scroll.clientHeight || 560) / 2, factor); }

/* main.ts:548-573 */
function ensureAnalysisHud() {
    const scroll = dom_1.$("cvscroll");
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
        document.getElementById("analysisOneBtn").onclick = () => { const sc = dom_1.$("cvscroll"); zoomAnalysisAt((sc.clientWidth || 900) / 2, (sc.clientHeight || 560) / 2, 1 / analysisPan.zoom); };
        document.getElementById("analysisMinusBtn").onclick = () => zoomAnalysisCenter(0.82);
        document.getElementById("analysisPlusBtn").onclick = () => zoomAnalysisCenter(1.22);
    }
    updateAnalysisZoomUi();
}

/* main.ts:574-584 */
function setAnalysisPanMode(on) { var _a; const scroll = dom_1.$("cvscroll"); scroll.classList.toggle("analysisPanView", on); scroll.classList.remove("panning"); document.body.classList.remove("analysisPanning"); if (on) {
    ensureAnalysisHud();
}
else {
    const cv = dom_1.$("cv");
    cv.style.transform = "";
    cv.style.transformOrigin = "";
    scroll.classList.remove("analysisZoomTiny", "analysisZoomSmall", "analysisZoomNormal");
    (_a = document.getElementById("analysisNavHud")) === null || _a === void 0 ? void 0 : _a.remove();
    currentAnalysisModel = null;
} }

/* main.ts:585-599 */
function setupAnalysisPanZoom() { const scroll = dom_1.$("cvscroll"); let dragging = false, sx = 0, sy = 0, px = 0, py = 0; const interactive = (target) => { const el = target; return !!(el && typeof el.closest === "function" && el.closest(".analysisEditorNode,.analysisEditorEdge,.analysisEditorEdgeHit,.analysisEditorLabel,.analysisEditorLabelBg,.analysisExitText,.analysisNodeKey,.analysisNodeName,.analysisNodeMeta,.analysisNodeBadge,#analysisNavHud,#analysisNavHud *")); }; scroll.addEventListener("pointerdown", (ev) => { if (!analysisEditorPanActive() || ev.button !== 0 || interactive(ev.target))
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

/* main.ts:602-602 */
function editorVisualKey(v) { return String(v || "NORMAL").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "NORMAL"; }

/* main.ts:603-604 */
function editorTypeDef(data, type) { const key = editorVisualKey(type); const built = { START: { fill: "#dbeafe", stroke: "#2563eb" }, NORMAL: { fill: "#f8fafc", stroke: "#94a3b8" }, WARNING: { fill: "#fef3c7", stroke: "#b45309" }, ERROR: { fill: "#fee2e2", stroke: "#b91c1c" }, FINAL: { fill: "#dcfce7", stroke: "#047857" } }; if (built[key])
    return built[key]; const custom = (Array.isArray(data === null || data === void 0 ? void 0 : data.custom_state_types) ? data.custom_state_types : []).find((x) => editorVisualKey(x.type_key || x.key || x.name || x.label) === key); return { fill: (custom === null || custom === void 0 ? void 0 : custom.fill_color) || (custom === null || custom === void 0 ? void 0 : custom.fillColor) || "#eef2ff", stroke: (custom === null || custom === void 0 ? void 0 : custom.stroke_color) || (custom === null || custom === void 0 ? void 0 : custom.strokeColor) || "#4f46e5" }; }

/* main.ts:610-611 */
function editorBuildBuckets(data) { const stages = [...(Array.isArray(data === null || data === void 0 ? void 0 : data.stages) ? data.stages : [])].sort((a, b) => ws_1.editorNum(a.stage_order) - ws_1.editorNum(b.stage_order)); const byStage = new Map(); stages.forEach((stage) => byStage.set(String(stage.stage_key || ""), [])); (Array.isArray(data === null || data === void 0 ? void 0 : data.states) ? data.states : []).forEach((state) => { const k = String(state.stage_key || ""); if (!byStage.has(k))
    byStage.set(k, []); byStage.get(k).push(state); }); byStage.forEach(list => list.sort((a, b) => (ws_1.editorNum(a.sort_order) || 100) - (ws_1.editorNum(b.sort_order) || 100))); return { stageOrder: stages, byStage }; }

/* main.ts:612-617 */
function editorCanvasLayout(data) { const { stageOrder, byStage } = editorBuildBuckets(data); const nodeWidth = EDITOR_NODE_W, nodeHeight = EDITOR_NODE_H, rowGap = 50, categoryGap = 110, localColumnGap = 34, singleColumnStagger = 18, left = 58, top = 118; const positions = new Map(), stagePositions = new Map(); let cursorX = left, maxX = 0, maxY = 0; const yOffsets = [0, 84, 34, 112, 58]; stageOrder.forEach((stage, col) => { const nodes = byStage.get(String(stage.stage_key || "")) || []; const dense = nodes.length > 5, localCols = dense ? 2 : 1; const localWidth = localCols * nodeWidth + (localCols - 1) * localColumnGap; const baseX = Number.isFinite(Number(stage.manual_x)) ? Number(stage.manual_x) + 18 : cursorX; const baseY = Number.isFinite(Number(stage.manual_y)) ? Number(stage.manual_y) + 62 : top + yOffsets[col % yOffsets.length]; nodes.forEach((state, index) => { const localCol = localCols === 2 ? index % 2 : 0, localRow = Math.floor(index / localCols); const staggerX = localCols === 1 ? (localRow % 2) * singleColumnStagger : 0; const staggerY = localCols === 2 && localCol ? 24 : 0; const autoX = baseX + localCol * (nodeWidth + localColumnGap) + staggerX; const autoY = baseY + localRow * (nodeHeight + rowGap) + staggerY; const x = Number.isFinite(Number(state.manual_x)) ? Number(state.manual_x) : autoX; const y = Number.isFinite(Number(state.manual_y)) ? Number(state.manual_y) : autoY; positions.set(String(state.state_key || ""), { x, y, w: nodeWidth, h: nodeHeight, stage, row: index, col }); maxX = Math.max(maxX, x + nodeWidth); maxY = Math.max(maxY, y + nodeHeight); }); const ps = nodes.map((state) => positions.get(String(state.state_key || ""))).filter(Boolean); let panel; if (ps.length) {
    const minNodeX = Math.min(...ps.map((pos) => pos.x)), minNodeY = Math.min(...ps.map((pos) => pos.y)), maxNodeX = Math.max(...ps.map((pos) => pos.x + pos.w)), maxNodeY = Math.max(...ps.map((pos) => pos.y + pos.h));
    panel = { x: minNodeX - 28, y: Math.max(18, minNodeY - 62), w: Math.max(localWidth + 56, maxNodeX - minNodeX + 56), h: Math.max(142, maxNodeY - minNodeY + 92), col };
}
else
    panel = { x: baseX - 28, y: Math.max(18, baseY - 62), w: localWidth + 56, h: 142, col }; stagePositions.set(String(stage.stage_key || ""), panel); maxX = Math.max(maxX, panel.x + panel.w); maxY = Math.max(maxY, panel.y + panel.h); cursorX += localWidth + categoryGap; }); return { layoutStyle: "freeform", stageOrder, byStage, positions, stagePositions, width: EDITOR_CANVAS_SIZE, height: EDITOR_CANVAS_SIZE, contentOffset: EDITOR_OFFSET, nodeWidth, nodeHeight }; }

/* main.ts:618-621 */
function editorRouteKind(from, to) { if (from.col === to.col)
    return "same"; if (to.col > from.col + 1)
    return "longForward"; if (to.col > from.col)
    return "adjacentForward"; return "backward"; }

/* main.ts:622-623 */
function editorAssignRouteLanes(data, model) { const counters = new Map(), lanes = new Map(); (Array.isArray(data === null || data === void 0 ? void 0 : data.transitions) ? data.transitions : []).forEach((transition) => { const from = model.positions.get(String(transition.from_state_key || "")), to = model.positions.get(String(transition.to_state_key || "")); if (!from || !to)
    return; const kind = editorRouteKind(from, to), key = `${kind}:${Math.min(from.col, to.col)}:${Math.max(from.col, to.col)}`; const lane = counters.get(key) || 0; counters.set(key, lane + 1); lanes.set(String(transition.transition_key || transition.event_name || ""), lane); }); return lanes; }

/* main.ts:624-630 */
function editorMakeEdgePath(from, to, index, lane = 0) { const fromCx = from.x + from.w / 2, fromCy = from.y + from.h / 2, toCx = to.x + to.w / 2, toCy = to.y + to.h / 2; const dx = toCx - fromCx, dy = toCy - fromCy, spread = ((lane % 7) - 3) * 14 + (index % 3 - 1) * 5; if (from.x === to.x && from.y === to.y) {
    const sx = from.x + from.w, sy = fromCy - 10, tx = from.x + from.w, ty = fromCy + 10, loopX = from.x + from.w + 64 + lane * 8;
    return { d: `M ${sx} ${sy} C ${loopX} ${sy - 58} ${loopX} ${ty + 58} ${tx} ${ty}`, labelX: loopX - 12, labelY: fromCy - 2 };
} if (Math.abs(dx) >= Math.abs(dy)) {
    const forward = dx >= 0, sx = forward ? from.x + from.w : from.x, sy = fromCy, tx = forward ? to.x - 10 : to.x + to.w + 10, ty = toCy, c1x = sx + (forward ? 0.42 : -0.42) * Math.max(120, Math.abs(dx)), c1y = sy + spread, c2x = tx - (forward ? 0.42 : -0.42) * Math.max(120, Math.abs(dx)), c2y = ty - spread;
    return { d: `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${tx} ${ty}`, labelX: (sx + tx + c1x + c2x) / 4, labelY: (sy + ty + c1y + c2y) / 4 - 8 };
} const downward = dy >= 0, sx = fromCx, sy = downward ? from.y + from.h : from.y, tx = toCx, ty = downward ? to.y - 10 : to.y + to.h + 10, c1x = sx + spread, c1y = sy + (downward ? 0.42 : -0.42) * Math.max(120, Math.abs(dy)), c2x = tx - spread, c2y = ty - (downward ? 0.42 : -0.42) * Math.max(120, Math.abs(dy)); return { d: `M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${tx} ${ty}`, labelX: (sx + tx + c1x + c2x) / 4, labelY: (sy + ty + c1y + c2y) / 4 - 8 }; }

/* main.ts:631-637 */
function editorWrapText(text, maxChars) { const words = String(text || "").split(/\s+/).filter(Boolean), lines = []; let current = ""; words.forEach(word => { const next = current ? `${current} ${word}` : word; if (next.length > maxChars && current) {
    lines.push(current);
    current = word;
}
else
    current = next; }); if (current)
    lines.push(current); return lines.slice(0, 2); }

/* main.ts:638-638 */
function editorEllipsize(text, maxChars) { const s = String(text || "").replace(/\s+/g, " ").trim(); const n = Math.max(3, Math.floor(Number(maxChars) || 24)); return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…"; }

/* main.ts:639-639 */
function editorLabelize(text) { return String(text || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "transition"; }

/* main.ts:640-642 */
function editorMoney(min, max) { const a = ws_1.editorNum(min), b = (max === undefined || max === null || max === "") ? a : ws_1.editorNum(max); if (!a && !b)
    return "$0"; if (a === b)
    return "$" + a.toLocaleString(undefined, { maximumFractionDigits: 2 }); return "$" + a.toLocaleString(undefined, { maximumFractionDigits: 2 }) + "-$" + b.toLocaleString(undefined, { maximumFractionDigits: 2 }); }

/* main.ts:643-648 */
function editorIsMainFlowTransition(data, transition, model) { const from = model.positions.get(String(transition.from_state_key || "")), to = model.positions.get(String(transition.to_state_key || "")); const toState = (data.states || []).find((s) => String(s.state_key) === String(transition.to_state_key)), fromState = (data.states || []).find((s) => String(s.state_key) === String(transition.from_state_key)); if (!from || !to || !toState || !fromState)
    return false; if (to.col < from.col)
    return false; if (["ERROR", "WARNING"].includes(editorVisualKey(toState.state_type)))
    return false; if (["ERROR", "WARNING"].includes(editorVisualKey(fromState.state_type)))
    return false; if (/cancel|reject|fail|fraud|chargeback|dispute|jam|locked|timeout|low|no_show|leaves|worsened|sos/i.test(transition.event_name || ""))
    return false; return true; }

/* main.ts:649-662 */
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

/* main.ts:663-672 */
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

/* main.ts:673-673 */
function analysisHasAppliedVisuals(d) { return !!(ws_1.effective(d).length && (d.overlay.bands.length || d.overlay.ghosts.length || Object.keys(d.overlay.flag).length || Object.keys(d.overlay.edge).length || Object.keys(d.overlay.stageTag).length)); }

/* main.ts:674-692 */
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

/* main.ts:693-693 */
function analysisSpreadModel(model) { return analysisScaleModel(model, analysisIncreasedSpacing ? 1.45 : 1); }

/* main.ts:694-700 */
function analysisTransitionRelatedToSelection(transition, key, idFor) { if (!ws_1.getSel())
    return false; if (ws_1.getSel().kind === "trans")
    return ws_1.getSel().key === key; if (ws_1.getSel().kind === "state") {
    const from = idFor.get(String(transition.from_state_key || ""));
    const to = idFor.get(String(transition.to_state_key || ""));
    return ws_1.getSel().key === from || ws_1.getSel().key === to;
} return false; }

/* main.ts:701-703 */
function analysisShouldDrawTransition(data, transition, model, key, idFor, badge) { if (analysisShowAllLines || badge)
    return true; if (analysisTransitionRelatedToSelection(transition, key, idFor))
    return true; return editorIsMainFlowTransition(data, transition, model); }

/* main.ts:704-704 */
function analysisRectOverlap(a, b, pad = 6) { return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y); }

/* main.ts:705-714 */
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

/* main.ts:715-722 */
function analysisCandidateOffsets() {
    const out = [{ x: 0, y: 0 }];
    const radii = [34, 58, 86, 118, 154, 196, 246, 304];
    for (const r of radii) {
        out.push({ x: 0, y: -r }, { x: 0, y: r }, { x: r, y: 0 }, { x: -r, y: 0 }, { x: r, y: -r }, { x: -r, y: -r }, { x: r, y: r }, { x: -r, y: r }, { x: Math.round(r * 1.45), y: 0 }, { x: -Math.round(r * 1.45), y: 0 });
    }
    return out;
}

/* main.ts:723-725 */
function analysisCountOverlaps(box, obstacles, pad = 8) { let n = 0; for (const o of obstacles)
    if (analysisRectOverlap(box, o, pad))
        n++; return n; }

/* main.ts:726-745 */
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

/* main.ts:746-746 */
function analysisApproxLabel(model, x, y, w, h) { return analysisPlaceLabelAwayFromNodes(x, y, w, h, model); }

/* main.ts:747-776 */
function analysisOverlapScore(model, data, d, idFor) {
    model.__analysisLabelBoxes = [];
    model.__analysisLastLabelOverlap = 0;
    const transitions = Array.isArray(data === null || data === void 0 ? void 0 : data.transitions) ? data.transitions : [], lanes = editorAssignRouteLanes(data, model);
    transitions.forEach((transition, index) => {
        const from = model.positions.get(String(transition.from_state_key || "")), to = model.positions.get(String(transition.to_state_key || ""));
        if (!from || !to)
            return;
        const key = ws_1.editorDocTransitionKey(data, transition, index, idFor), badge = d.overlay.edge[key];
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

/* main.ts:778-833 */
function renderEditorAnalysisCanvas(d) {
    const data = d.editorData, idFor = ws_1.editorWorkflowIdMap(data), model = analysisBuildAdaptiveModel(data, d, idFor);
    const posByDocId = new Map();
    (Array.isArray(data.states) ? data.states : []).forEach((state, stateIndex) => { const raw = String(state.state_key || ""), id = idFor.get(raw) || ws_1.editorKey(raw, "state"), p = model.positions.get(raw); if (p)
        posByDocId.set(id, p); });
    currentAnalysisModel = model;
    const cv = dom_1.$("cv");
    cv.classList.remove("connect");
    cv.classList.add("analysisEditorCanvas");
    cv.innerHTML = "";
    cv.style.width = model.width + "px";
    cv.style.height = model.height + "px";
    const root = dom_1.svg("svg", { width: String(model.width), height: String(model.height), viewBox: `0 0 ${model.width} ${model.height}`, class: "analysisEditorSvg", style: "position:absolute;left:0;top:0;overflow:visible" });
    const defs = dom_1.svg("defs");
    const mk = dom_1.svg("marker", { id: "edArr", markerWidth: "12", markerHeight: "12", refX: "11", refY: "6", orient: "auto", markerUnits: "strokeWidth" });
    mk.append(dom_1.svg("path", { d: "M0,0 L12,6 L0,12 z", fill: "#4f5d6d" }));
    defs.append(mk);
    const mkSel = dom_1.svg("marker", { id: "edArrSel", markerWidth: "12", markerHeight: "12", refX: "11", refY: "6", orient: "auto", markerUnits: "strokeWidth" });
    mkSel.append(dom_1.svg("path", { d: "M0,0 L12,6 L0,12 z", fill: "#16243B" }));
    defs.append(mkSel);
    root.append(defs);
    const stageLayer = dom_1.svg("g", { transform: `translate(${model.contentOffset.x} ${model.contentOffset.y})` }), edgeLayer = dom_1.svg("g", { transform: `translate(${model.contentOffset.x} ${model.contentOffset.y})` }), nodeLayer = dom_1.svg("g", { transform: `translate(${model.contentOffset.x} ${model.contentOffset.y})` }), labelLayer = dom_1.svg("g", { transform: `translate(${model.contentOffset.x} ${model.contentOffset.y})` });
    root.append(stageLayer, edgeLayer, nodeLayer, labelLayer);
    model.__analysisLabelBoxes = [];
    model.__analysisLastLabelOverlap = 0;
    model.stageOrder.forEach((stage) => { const p = model.stagePositions.get(String(stage.stage_key || "")); if (!p)
        return; const color = stage.visual_color || "#1F7A6F"; stageLayer.append(dom_1.svg("rect", { x: String(p.x), y: String(p.y), width: String(p.w), height: String(p.h), rx: "18", ry: "18", fill: dom_1.hexToRgba(color, 0.055), stroke: color, "stroke-width": "1.2", "stroke-dasharray": "6 5", class: "analysisStagePanel" })); stageLayer.append(dom_1.svg("line", { x1: String(p.x + 18), x2: String(p.x + p.w - 18), y1: String(p.y + 56), y2: String(p.y + 56), stroke: color, "stroke-width": "2.2", opacity: "0.65" })); const title = dom_1.svg("text", { x: String(p.x + 18), y: String(p.y + 27), class: "analysisStageHeader" }); title.textContent = String(stage.name || stage.stage_key || ""); stageLayer.append(title); const sub = dom_1.svg("text", { x: String(p.x + 18), y: String(p.y + 47), class: "analysisStageSub" }); sub.textContent = String(stage.owner_role || stage.stage_key || ""); stageLayer.append(sub); });
    d.overlay.bands.forEach((band) => { let x0 = Number.POSITIVE_INFINITY, y0 = Number.POSITIVE_INFINITY, x1 = Number.NEGATIVE_INFINITY, y1 = Number.NEGATIVE_INFINITY; band.ids.forEach((id) => { const p = posByDocId.get(id); if (!p)
        return; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }); if (!Number.isFinite(x0))
        return; const isParallel = String(band.label || "").toLowerCase().includes("parallel"); stageLayer.append(dom_1.svg("rect", { x: String(x0 - 16), y: String(y0 - 28), width: String(x1 - x0 + 32), height: String(y1 - y0 + 46), rx: "14", ry: "14", fill: isParallel ? "rgba(184,134,47,0.10)" : "rgba(31,122,111,0.08)", stroke: isParallel ? "#B8862F" : "#1F7A6F", "stroke-width": "2.2", "stroke-dasharray": isParallel ? "0" : "7 5", class: "analysisOverlayBand" })); const label = String(band.label || "improvement"), lw = Math.max(82, Math.min(168, label.length * 7 + 20)); const placed = analysisPlaceLabelAwayFromNodes(x0 - 8, y0 - 47, lw, 22, model); const tx = dom_1.svg("text", { x: String(placed.x), y: String(placed.y + 15), class: "analysisOverlayLabel" }); tx.textContent = label; stageLayer.append(tx); });
    d.overlay.ghosts.forEach((gh) => { const text = String(gh.text || ""), gw = Math.max(144, text.length * 6.2 + 22); const placed = analysisPlaceLabelAwayFromNodes(Number(gh.x) || 0, Number(gh.y) || 0, gw, 24, model); const g = dom_1.svg("g", { class: "analysisGhostMark" }); g.append(dom_1.svg("rect", { x: String(placed.x), y: String(placed.y), width: String(gw), height: "24", rx: "8", ry: "8", fill: "#fff7ed", stroke: "#B2453C", "stroke-width": "1.4", "stroke-dasharray": "5 4" })); const tx = dom_1.svg("text", { x: String(placed.x + 10), y: String(placed.y + 16), class: "analysisGhostText" }); tx.textContent = text; g.append(tx); stageLayer.append(g); });
    const lanes = editorAssignRouteLanes(data, model), transitions = Array.isArray(data.transitions) ? data.transitions : [];
    transitions.forEach((transition, index) => { const from = model.positions.get(String(transition.from_state_key || "")), to = model.positions.get(String(transition.to_state_key || "")); if (!from || !to)
        return; const route = editorMakeEdgePath(from, to, index, lanes.get(String(transition.transition_key || transition.event_name || "")) || 0), key = ws_1.editorDocTransitionKey(data, transition, index, idFor), selected = !!(ws_1.getSel() && ws_1.getSel().kind === "trans" && ws_1.getSel().key === key), main = editorIsMainFlowTransition(data, transition, model), badge = d.overlay.edge[key]; if (!analysisShouldDrawTransition(data, transition, model, key, idFor, badge))
        return; const stroke = selected ? "#16243B" : (badge ? "#C8842A" : "#526173"); const path = dom_1.svg("path", { d: route.d, fill: "none", stroke, "stroke-width": selected ? "4.2" : (main ? "3.2" : "2.1"), "stroke-linecap": "round", "stroke-linejoin": "round", "marker-end": selected ? "url(#edArrSel)" : "url(#edArr)", opacity: selected || main || badge ? "0.86" : "0.56", class: "analysisEditorEdge" }); path.onclick = (ev) => { ev.stopPropagation(); ws_1.setSel({ kind: "trans", key }); renderInspector(); showTab("table"); renderCanvas(); }; edgeLayer.append(path); const hit = dom_1.svg("path", { d: route.d, fill: "none", stroke: "transparent", "stroke-width": "18", class: "analysisEditorEdgeHit" }); hit.onclick = (ev) => { ev.stopPropagation(); ws_1.setSel({ kind: "trans", key }); renderInspector(); showTab("table"); renderCanvas(); }; edgeLayer.append(hit); const labelText = badge || editorLabelize(transition.event_name || transition.transition_key), lines = editorWrapText(labelText, 16), longest = Math.max(...lines.map(x => x.length), 0), lw = Math.max(66, Math.min(168, longest * 6.7 + 20)), lh = lines.length > 1 ? 32 : 20; let lx = Math.max(6, Math.min(EDITOR_CANVAS_SIZE - lw - 6, route.labelX - 6)), ly = Math.max(6, Math.min(EDITOR_CANVAS_SIZE - lh - 6, route.labelY - 14)); const placed = analysisPlaceLabelAwayFromNodes(lx, ly, lw, lh, model); lx = placed.x; ly = placed.y; const bg = dom_1.svg("rect", { x: String(lx), y: String(ly), width: String(lw), height: String(lh), rx: "7", ry: "7", fill: badge ? "#fff7ed" : "rgba(255,255,255,0.96)", stroke: selected ? "#16243B" : (badge ? "#f59e0b" : "#d9e0ea"), "stroke-width": badge ? "1.4" : "1", class: "analysisEditorLabelBg" }); bg.onclick = (ev) => { ev.stopPropagation(); ws_1.setSel({ kind: "trans", key }); renderInspector(); showTab("table"); renderCanvas(); }; labelLayer.append(bg); const tx = dom_1.svg("text", { x: String(lx + 8), y: String(ly + 14), class: "analysisEditorLabel" }); lines.forEach((line, i) => { const tsp = dom_1.svg("tspan", { x: String(lx + 8), dy: i === 0 ? "0" : "12" }); tsp.textContent = line; tx.append(tsp); }); tx.onclick = (ev) => { ev.stopPropagation(); ws_1.setSel({ kind: "trans", key }); renderInspector(); showTab("table"); renderCanvas(); }; labelLayer.append(tx); });
    (Array.isArray(data.states) ? data.states : []).forEach((state, stateIndex) => { const p = model.positions.get(String(state.state_key || "")); if (!p)
        return; const id = idFor.get(String(state.state_key || "")) || ws_1.editorKey(state.state_key, "state"), selected = !!(ws_1.getSel() && ws_1.getSel().kind === "state" && ws_1.getSel().key === id), fl = d.overlay.flag[id] || {}, stageTag = d.overlay.stageTag[id], type = editorTypeDef(data, state.state_type); const g = dom_1.svg("g", { class: "analysisEditorNode" + (selected ? " selected" : "") + (fl.dim ? " dimmed" : "") + (stageTag ? " analysisStageTagged" : ""), "data-id": id }); g.onclick = (ev) => { ev.stopPropagation(); ws_1.setSel({ kind: "state", key: id }); renderInspector(); showTab("table"); renderCanvas(); }; const loopHighlight = fl.color === "#C8842A"; const nodeStroke = fl.color || (stageTag === null || stageTag === void 0 ? void 0 : stageTag.color) || type.stroke; const nodeStrokeWidth = selected ? "2.8" : (loopHighlight ? "4" : (fl.color || stageTag ? "3" : "1.5")); const rect = dom_1.svg("rect", { x: String(p.x), y: String(p.y), width: String(p.w), height: String(p.h), rx: "8", ry: "8", fill: type.fill, stroke: nodeStroke, "stroke-width": nodeStrokeWidth, class: loopHighlight ? "analysisLoopNodeRect" : "" }); g.append(rect); const clipId = "analysisNodeTextClip_" + String(id).replace(/[^a-zA-Z0-9_-]/g, "_"); const clip = dom_1.svg("clipPath", { id: clipId }); clip.append(dom_1.svg("rect", { x: String(p.x + 8), y: String(p.y + 6), width: String(Math.max(1, p.w - 16)), height: String(Math.max(1, p.h - 12)), rx: "6", ry: "6" })); defs.append(clip); const textG = dom_1.svg("g", { "clip-path": "url(#" + clipId + ")" }); const keyText = dom_1.svg("text", { x: String(p.x + 12), y: String(p.y + 19), class: "analysisNodeKey" }); keyText.textContent = editorEllipsize(`${state.state_key} - ${editorVisualKey(state.state_type)}${stageTag ? " · " + stageTag.label : ""}`, Math.max(12, Math.floor((Number(p.w) || EDITOR_NODE_W) / 7.2))); textG.append(keyText); editorWrapText(state.name, Math.max(10, Math.floor((Number(p.w) || EDITOR_NODE_W) / 9.4))).forEach((line, i) => { const nm = dom_1.svg("text", { x: String(p.x + 12), y: String(p.y + 39 + i * 15), class: "analysisNodeName" }); nm.textContent = editorEllipsize(line, Math.max(8, Math.floor((Number(p.w) || EDITOR_NODE_W) / 8.6))); textG.append(nm); }); const meta = dom_1.svg("text", { x: String(p.x + 12), y: String(p.y + p.h - 14), class: "analysisNodeMeta" }); const hasCost = !!(ws_1.editorNum(state.cost_min) || ws_1.editorNum(state.cost_max)); const mins = ws_1.editorNum(state.expected_duration_minutes); meta.textContent = editorEllipsize(hasCost ? `Cost: ${editorMoney(state.cost_min, state.cost_max)}${mins ? " · " + mins + " min" : ""}` : (mins ? `${mins} min · ${state.owner_role || ""}` : String(state.owner_role || "")), Math.max(10, Math.floor((Number(p.w) || EDITOR_NODE_W) / 7.2))); textG.append(meta); if (fl.badge) {
        const badge = dom_1.svg("text", { x: String(p.x + 12), y: String(p.y + p.h - 31), class: "analysisNodeBadge" });
        badge.textContent = editorEllipsize(fl.badge, Math.max(10, Math.floor((Number(p.w) || EDITOR_NODE_W) / 7.2)));
        textG.append(badge);
    } g.append(textG); nodeLayer.append(g); });
    cv.append(root);
    const scroll = dom_1.$("cvscroll");
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

/* main.ts:834-835 */
function edgePoint(cx, cy, tx, ty) { const dx = tx - cx, dy = ty - cy; if (!dx && !dy)
    return { x: cx, y: cy }; const hw = ws_1.NW / 2 + 2, hh = ws_1.NH / 2 + 2; const sx = dx ? hw / Math.abs(dx) : 1e9, sy = dy ? hh / Math.abs(dy) : 1e9; const sc = Math.min(sx, sy); return { x: cx + dx * sc, y: cy + dy * sc }; }

/* main.ts:836-1038 */
function renderCanvas() {
    var _a, _b;
    if (ws_1.getActive() === -1) {
        renderSigma();
        return;
    }
    dom_1.$("sigma").style.display = "none";
    dom_1.$("empty").style.display = "none";
    dom_1.$("cv").style.display = "block";
    dom_1.$("canvastools").style.display = "flex";
    if (ws_1.getActive() < 0 || ws_1.getDocs().length === 0) {
        setAnalysisPanMode(false);
        const c0 = dom_1.$("cv");
        c0.classList.remove("connect", "analysisEditorCanvas");
        c0.style.width = "100%";
        c0.style.height = "100%";
        c0.innerHTML = '<div class="watermark">No workflow loaded. Open the Workflow Editor, then return to Analysis Studio to analyze the current editor graph.</div>';
        return;
    }
    const d = ws_1.D();
    if (ws_1.hasEditorCanvas(d)) {
        renderEditorAnalysisCanvas(d);
        return;
    }
    ws_1.layoutMissing(d);
    dom_1.$("cv").classList.toggle("connect", connectMode);
    setAnalysisPanMode(false);
    const cv = dom_1.$("cv");
    cv.classList.remove("analysisEditorCanvas");
    cv.innerHTML = "";
    let maxX = 600, maxY = 360;
    for (const s of d.wf.states) {
        const p = d.pos[s.id];
        if (p) {
            maxX = Math.max(maxX, p.x + ws_1.NW + ws_1.PAD);
            maxY = Math.max(maxY, p.y + ws_1.NH + ws_1.PAD);
        }
    }
    cv.style.width = maxX + "px";
    cv.style.height = maxY + "px";
    const root = dom_1.svg("svg", { width: String(maxX), height: String(maxY), style: "position:absolute;left:0;top:0;overflow:visible" });
    const defs = dom_1.svg("defs");
    const mk = dom_1.svg("marker", { id: "arr", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    mk.append(dom_1.svg("path", { d: "M0 1 L9 5 L0 9 z", fill: "#7b8694" }));
    defs.append(mk);
    const mkOn = dom_1.svg("marker", { id: "arrOn", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" });
    mkOn.append(dom_1.svg("path", { d: "M0 1 L9 5 L0 9 z", fill: "#16243B" }));
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
                x1 = Math.max(x1, p.x + ws_1.NW);
                y1 = Math.max(y1, p.y + ws_1.NH);
            }
            if (x1 < 0)
                continue;
            root.append(dom_1.svg("rect", { x: String(x0 - 14), y: String(y0 - 28), width: String(x1 - x0 + 28), height: String(y1 - y0 + 42), rx: "12", fill: "#16243B", "fill-opacity": "0.045", stroke: "#16243B", "stroke-opacity": "0.16", "stroke-dasharray": "5 4" }));
            const tx = dom_1.svg("text", { x: String(x0 - 8), y: String(y0 - 32), "font-size": "11", fill: "#16243B", "font-weight": "bold" });
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
            x1 = Math.max(x1, p.x + ws_1.NW);
            y1 = Math.max(y1, p.y + ws_1.NH);
        }
        if (x1 < 0)
            continue;
        root.append(dom_1.svg("rect", { x: String(x0 - 12), y: String(y0 - 22), width: String(x1 - x0 + 24), height: String(y1 - y0 + 34), rx: "10", fill: "#1F7A6F", opacity: "0.07" }));
        const tx = dom_1.svg("text", { x: String(x0 - 6), y: String(y0 - 26), "font-size": "11", fill: "#1F7A6F", "font-weight": "bold" });
        tx.textContent = b.label;
        root.append(tx);
    }
    // edges
    for (const t of d.wf.transitions) {
        const a = d.pos[t.from], b = d.pos[t.to];
        if (!a || !b)
            continue;
        const ax = a.x + ws_1.NW / 2, ay = a.y + ws_1.NH / 2, bx = b.x + ws_1.NW / 2, by = b.y + ws_1.NH / 2;
        const key = t.from + "|" + t.on + "|" + t.to;
        const badge = d.overlay.edge[key];
        const chosen = !!(ws_1.getSel() && ws_1.getSel().kind === "trans" && ws_1.getSel().key === key);
        const stroke = chosen ? "#16243B" : (badge ? "#C8842A" : "#7b8694");
        const marker = chosen ? "url(#arrOn)" : "url(#arr)";
        const eg = dom_1.svg("g", { class: "edgeg" });
        let dpath = "";
        let lx = ax, ly = ay;
        if (t.from === t.to) {
            dpath = `M ${a.x + ws_1.NW * 0.62} ${a.y} C ${a.x + ws_1.NW + 52} ${a.y - 66}, ${a.x - 52} ${a.y - 66}, ${a.x + ws_1.NW * 0.38} ${a.y}`;
            lx = a.x + ws_1.NW / 2;
            ly = a.y - 50;
        }
        else {
            const s0 = edgePoint(ax, ay, bx, by), e0 = edgePoint(bx, by, ax, ay);
            const mx = (s0.x + e0.x) / 2;
            dpath = `M ${s0.x} ${s0.y} C ${mx} ${s0.y}, ${mx} ${e0.y}, ${e0.x} ${e0.y}`;
            lx = mx;
            ly = (s0.y + e0.y) / 2;
        }
        eg.append(dom_1.svg("path", { d: dpath, fill: "none", stroke: "transparent", "stroke-width": "14", "stroke-linecap": "round" }));
        eg.append(dom_1.svg("path", { d: dpath, fill: "none", stroke, "stroke-width": chosen ? "2.8" : (badge ? "2.4" : "2"), "stroke-linecap": "round", "stroke-linejoin": "round", "marker-end": marker, opacity: "0.96" }));
        eg.onclick = () => { ws_1.setSel({ kind: "trans", key }); renderInspector(); showTab("table"); renderCanvas(); };
        root.append(eg);
        const showL = !!badge || !/^event\d+$/.test(t.on) || chosen;
        if (showL) {
            const txt = badge || t.on;
            const w = Math.max(30, txt.length * 6.2 + 14);
            const g = dom_1.svg("g", { class: "edgelabel" });
            g.append(dom_1.svg("rect", { x: String(lx - w / 2), y: String(ly - 10), width: String(w), height: "20", rx: "10", fill: badge ? "#FBEFD9" : "#ffffff", stroke: chosen ? "#16243B" : (badge ? "#C8842A" : "#e2dcca") }));
            const tx = dom_1.svg("text", { x: String(lx), y: String(ly + 3), "text-anchor": "middle", "font-size": "10", fill: badge ? "#8a5a12" : "#3a4250" });
            tx.textContent = txt;
            g.append(tx);
            g.onclick = (ev) => { ev.stopPropagation(); ws_1.setSel({ kind: "trans", key }); renderInspector(); showTab("table"); renderCanvas(); };
            root.append(g);
        }
        else {
            const g = dom_1.svg("g", { class: "edgepick" });
            g.append(dom_1.svg("circle", { cx: String(lx), cy: String(ly), r: "5.5", fill: "#ffffff", stroke: "#dcd7c8" }));
            g.onclick = (ev) => { ev.stopPropagation(); ws_1.setSel({ kind: "trans", key }); renderInspector(); showTab("table"); renderCanvas(); };
            root.append(g);
        }
    }
    cv.append(root);
    // ghosts
    for (const gh of d.overlay.ghosts) {
        const g = dom_1.el("div", { class: "ghostmark" });
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
        const node = dom_1.el("div", { class: "node", "data-id": s.id });
        const stageTag = d.overlay.stageTag[s.id];
        Object.assign(node.style, { left: p.x + "px", top: p.y + "px", width: ws_1.NW + "px", minHeight: ws_1.NH + "px", borderColor: fl.color || (stageTag === null || stageTag === void 0 ? void 0 : stageTag.color) || ws_1.ROLE_COLOR[s.role], borderWidth: stageTag ? "3px" : "", opacity: fl.dim ? "0.4" : "1" });
        if (s.initial)
            node.classList.add("is-initial");
        if (s.accept)
            node.classList.add("is-accept");
        if (s.reject)
            node.classList.add("is-reject");
        if (ws_1.getSel() && ws_1.getSel().kind === "state" && ws_1.getSel().key === s.id)
            node.classList.add("selected");
        if (connectMode && connectFrom === s.id)
            node.classList.add("connsrc");
        node.append(dom_1.el("div", { class: "nlabel" }, s.label || s.id));
        node.append(dom_1.el("div", { class: "nrole" }, stageTag ? `${stageTag.label} · ${fl.badge || s.role}` : (fl.badge || s.role)));
        if ((d.owner[s.id] || "").trim())
            node.append(dom_1.el("div", { class: "nowner" }, "\ud83d\udc65 " + d.owner[s.id]));
        {
            const ct = dom_1.el("div", { class: "nct" });
            const ci = dom_1.el("input", { class: "ctin", type: "number", title: "cost ($)" });
            ci.value = String((_a = d.cost[s.id]) !== null && _a !== void 0 ? _a : 0);
            const ti = dom_1.el("input", { class: "ctin", type: "number", title: "time (min)" });
            ti.value = String((_b = d.time[s.id]) !== null && _b !== void 0 ? _b : 0);
            const stop = (e) => e.stopPropagation();
            [ci, ti].forEach(x => { x.addEventListener("mousedown", stop); x.addEventListener("click", stop); x.addEventListener("dblclick", stop); });
            ci.addEventListener("input", () => { d.cost[s.id] = +ci.value || 0; syncJson(); renderTools(); });
            ti.addEventListener("input", () => { d.time[s.id] = +ti.value || 0; syncJson(); renderTools(); });
            ct.append("$", ci, dom_1.el("span", { class: "ctd" }, " · "), ti, dom_1.el("span", { class: "ctd" }, "m"));
            node.append(ct);
        }
        const del = dom_1.el("div", { class: "ndel", title: "delete state" }, "\u00d7");
        del.addEventListener("mousedown", ev => ev.stopPropagation());
        del.addEventListener("click", ev => { ev.stopPropagation(); ws_1.setSel({ kind: "state", key: s.id }); deleteSel(); });
        node.append(del);
        const nxt = dom_1.el("div", { class: "naddnext", title: "add a connected state after this one" }, "+");
        nxt.addEventListener("mousedown", ev => ev.stopPropagation());
        nxt.addEventListener("click", ev => { ev.stopPropagation(); ws_1.addAfter(s.id); });
        node.append(nxt);
        const h = dom_1.el("div", { class: "handle", title: "drag to connect" });
        node.append(h);
        wireNode(node, s.id, h);
        cv.append(node);
    }
}
/* ---------- Σ strategic value: top-level + sub-level pictures ---------- */

/* main.ts:1039-1056 */
function renderEmpty() {
    dom_1.$("cv").style.display = "none";
    dom_1.$("sigma").style.display = "none";
    dom_1.$("canvastools").style.display = "none";
    connectMode = false;
    connectFrom = null;
    const e = dom_1.$("empty");
    e.style.display = "flex";
    e.innerHTML = "";
    const box = dom_1.el("div", { class: "emptybox" });
    box.append(dom_1.el("h2", {}, "No workflow loaded"));
    box.append(dom_1.el("p", { class: "hint" }, "Nothing is loaded by default. Start a new workflow, add a copy, or drop in one of the example processes."));
    const row = dom_1.el("div", { class: "emptyrow" });
    row.append(dom_1.btn("New workflow", () => dom_1.$("btnNew").click(), "btn primary"));
    row.append(dom_1.btn("Add example…", () => dom_1.$("exampleSel").focus(), "btn ghost"));
    box.append(row);
    e.append(box);
}

/* main.ts:1057-1088 */
function deleteSel() {
    if (ws_1.getActive() < 0 || !ws_1.getSel())
        return;
    const d = ws_1.D();
    if (ws_1.getSel().kind === "state") {
        const id = ws_1.getSel().key;
        d.wf.states = d.wf.states.filter(x => x.id !== id);
        d.wf.transitions = d.wf.transitions.filter(t => t.from !== id && t.to !== id);
        delete d.cost[id];
        delete d.time[id];
        delete d.pos[id];
    }
    else {
        const [f, o, t] = ws_1.getSel().key.split("|");
        d.wf.transitions = d.wf.transitions.filter(x => !(x.from === f && x.on === o && x.to === t));
    }
    ws_1.setSel(null);
    ws_1.resetTools(d);
    ws_1.commit();
}
document.addEventListener("keydown", e => {
    var _a;
    if (ws_1.getActive() < 0 || !ws_1.getSel())
        return;
    const tag = (_a = e.target) === null || _a === void 0 ? void 0 : _a.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return;
    if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSel();
    }
});

/* main.ts:1090-1167 */
function strategicRows() {
    return ws_1.getDocs().map((d, index) => {
        let opportunityCost = 0, opportunityTime = 0, appliedCost = 0, appliedTime = 0;
        let findings = 0, appliedFindings = 0, completedTools = 0;
        const stateCount = d.wf && Array.isArray(d.wf.states) ? d.wf.states.length : 0;
        const transitionCount = d.wf && Array.isArray(d.wf.transitions) ? d.wf.transitions.length : 0;
        for (let i = 0; stateCount > 0 && i < 6; i++) {
            computeTool(d, i);
            const ids = (d.toolIds[i] || []).filter(id => !d.overruled.has(id) && d.sugs[id]);
            const meaningful = ids.filter(id => { const s = d.sugs[id]; return !!s && (s.cost > 0 || s.time > 0 || !s.clarity); });
            meaningful.forEach(id => {
                const s = d.sugs[id];
                opportunityCost += s.cost || 0;
                opportunityTime += s.time || 0;
                findings += 1;
                if (d.applied.has(id)) {
                    appliedCost += s.cost || 0;
                    appliedTime += s.time || 0;
                    appliedFindings += 1;
                }
            });
            if (ws_1.toolActive(d, i))
                completedTools += 1;
        }
        return { d, index, name: d.name || "Untitled workflow", opportunityCost, opportunityTime,
            appliedCost, appliedTime, findings, appliedFindings, completedTools, stateCount, transitionCount,
            coverage: Math.round(completedTools / 6 * 100) };
    });
}

function renderStrategicSidePanel(rows) {
    const host = analysisSavingsHost();
    const pane = dom_1.$("pane_analysis");
    if (pane)
        pane.scrollTop = 0;
    if (host) {
        host.innerHTML = "";
        const totalCost = rows.reduce((sum, r) => sum + r.opportunityCost, 0);
        const totalTime = rows.reduce((sum, r) => sum + r.opportunityTime, 0);
        host.append(dom_1.el("div", { class: "analysisSavingsBox strategicPanelSummary" },
            dom_1.el("div", { class: "analysisSavingsEyebrow" }, "Portfolio lens"),
            dom_1.el("h3", {}, "Across " + rows.length + " open workflow" + (rows.length === 1 ? "" : "s")),
            dom_1.el("div", { class: "strategicPanelValue" }, dom_1.fmt(totalCost) + " · " + dom_1.fmin(totalTime)),
            dom_1.el("p", { class: "hint" }, "Opportunity estimates are illustrative. Structural findings remain certified in each workflow's analysis.")));
        host.append(dom_1.el("div", { class: "analysisSavingsBox strategicPanelGuide" },
            dom_1.el("div", { class: "analysisSavingsEyebrow" }, "How to use this view"),
            dom_1.el("h3", {}, "Compare, prioritize, then inspect"),
            dom_1.el("p", {}, "Compare opportunity and coverage here, then use Open analysis on a workflow to inspect its certified and refuted findings.")));
    }
    const results = dom_1.$("results");
    if (results) {
        results.style.display = "none";
        results.srcdoc = '<div style="font:14px/1.55 Arial,sans-serif;color:#16243B;background:#fffdf7;padding:20px"><b>Portfolio analysis</b><p>Use the Strategic Value cards to compare opportunity, analysis coverage, and findings across the workflows that are open now.</p><p>Select <b>Open analysis</b> to inspect the certified and refuted findings for one workflow.</p></div>';
    }
}

function openStrategicWorkflow(index) {
    ws_1.setActive(index);
    ws_1.setSel(null);
    ws_1.setLastTool(-2);
    full();
    showTab("analysis");
}

function strategicModeTabs() {
    const tabs = dom_1.el("div", { class: "strategicModeTabs", role: "tablist", "aria-label": "Strategic analysis type" });
    [["math", "Mathematical analysis"], ["ai", "AI analysis"]].forEach(pair => {
        const button = dom_1.el("button", { class: "strategicModeTab" + (strategicView === pair[0] ? " on" : ""),
            role: "tab", "aria-selected": String(strategicView === pair[0]), type: "button" }, pair[1]);
        button.addEventListener("click", () => {
            if (strategicView === pair[0])
                return;
            strategicView = pair[0];
            renderSigma();
            syncStudioControls();
        });
        tabs.append(button);
    });
    return tabs;
}

function strategicAiPayload(rows) {
    const workflows = rows.slice(0, 25).map(r => ({
        name: r.name,
        state_count: r.stateCount,
        transition_count: r.transitionCount,
        cost_opportunity_illustrative: r.opportunityCost,
        time_opportunity_minutes_illustrative: r.opportunityTime,
        applied_cost_illustrative: r.appliedCost,
        applied_time_minutes_illustrative: r.appliedTime,
        finding_count: r.findings,
        applied_finding_count: r.appliedFindings,
        analysis_coverage_percent: r.coverage,
        states: (r.d.wf.states || []).slice(0, 120).map(s => ({
            id: s.id, label: s.label || s.name || s.id, role: s.role || "normal",
            initial: !!s.initial, accept: !!s.accept, reject: !!s.reject
        })),
        transitions: (r.d.wf.transitions || []).slice(0, 300).map(t => ({ from: t.from, event: t.on, to: t.to }))
    }));
    return {
        portfolio: {
            workflow_count: rows.length,
            state_count: rows.reduce((sum, r) => sum + r.stateCount, 0),
            transition_count: rows.reduce((sum, r) => sum + r.transitionCount, 0),
            cost_opportunity_illustrative: rows.reduce((sum, r) => sum + r.opportunityCost, 0),
            time_opportunity_minutes_illustrative: rows.reduce((sum, r) => sum + r.opportunityTime, 0),
            applied_cost_illustrative: rows.reduce((sum, r) => sum + r.appliedCost, 0),
            applied_time_minutes_illustrative: rows.reduce((sum, r) => sum + r.appliedTime, 0),
            finding_count: rows.reduce((sum, r) => sum + r.findings, 0),
            average_analysis_coverage_percent: Math.round(rows.reduce((sum, r) => sum + r.coverage, 0) / Math.max(1, rows.length))
        },
        workflows: workflows
    };
}

function strategicAiSignature(payload) {
    return JSON.stringify(payload);
}

async function runStrategicAi(rows) {
    if (strategicAiState.status === "running" || !rows.length)
        return;
    const payload = strategicAiPayload(rows);
    const signature = strategicAiSignature(payload);
    strategicAiSaveMessage = "";
    strategicAiState = Object.assign({}, strategicAiState, { status: "running", error: "" });
    renderSigma();
    try {
        if (!CTX || !CTX.llm || !CTX.llm.analyzeStrategicPortfolio)
            throw new Error("AI analysis is unavailable on this server.");
        const result = await CTX.llm.analyzeStrategicPortfolio(payload);
        strategicAiState = { status: "success", result: result, signature: signature, error: "",
            source: "live", reportId: null, createdAt: null, aiGeneratedAt: new Date().toISOString(),
            mathematicalSnapshot: payload.portfolio, workflowSnapshots: [] };
        auth_1.logHistory("ai", "Ran AI strategic analysis across " + rows.length + " workflows");
    }
    catch (error) {
        strategicAiState = Object.assign({}, strategicAiState, { status: "error",
            error: (error && error.message) || "AI analysis could not be completed." });
    }
    renderSigma();
}

function downloadStrategicAiReport(rows) {
    if (!strategicAiState.result)
        return;
    const report = {
        generated_at: new Date().toISOString(),
        advisory_notice: "AI-generated optimization guidance. Mathematical values remain illustrative and are not recalculated by AI.",
        mathematical_snapshot: strategicAiState.mathematicalSnapshot || strategicAiPayload(rows).portfolio,
        report: strategicAiState.result
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = dom_1.el("a", { href: url, download: "plumbline-ai-optimization-report.json" });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    auth_1.logHistory("download", "Downloaded AI optimization report");
}

function reportDate(value, fallback) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : (fallback || "Unknown date");
}

function strategicWorkflowSnapshots(rows) {
    return rows.map((row, index) => ({
        sourceWorkflowKey: String(row.d.sourceWorkflowId || (row.d.wf && row.d.wf.id) || row.d.id || ("workflow-" + index)),
        sourceWorkflowId: row.d.sourceWorkflowId || null,
        sourceVersionId: row.d.sourceWorkflowVersionId || null,
        name: row.name,
        workflowCreatedAt: row.d.sourceWorkflowCreatedAt || null,
        snapshot: ws_1.unified(row.d)
    }));
}

async function saveStrategicAiAnalysis(rows) {
    if (!strategicAiState.result || strategicAiSaving || strategicAiState.reportId)
        return;
    if (!CTX || !CTX.auth || !CTX.auth.currentUser || !CTX.auth.currentUser()) {
        strategicAiSaveMessage = "Sign in to save this analysis to your account.";
        if (CTX && CTX.auth && CTX.auth.showAuth) CTX.auth.showAuth(true, "login");
        renderSigma();
        return;
    }
    if (!rows.length) {
        strategicAiSaveMessage = "This historical report is already saved.";
        renderSigma();
        return;
    }
    strategicAiSaving = true;
    strategicAiSaveMessage = "Saving report…";
    renderSigma();
    try {
        const names = rows.map(r => r.name);
        const saved = await CTX.data.saveAiAnalysisReport({
            title: names.length === 1 ? names[0] + " optimization report" :
                "Portfolio optimization · " + names.length + " workflows",
            report: strategicAiState.result,
            mathematicalSnapshot: strategicAiState.mathematicalSnapshot || strategicAiPayload(rows).portfolio,
            inputSignature: strategicAiState.signature,
            aiGeneratedAt: strategicAiState.aiGeneratedAt,
            workflows: strategicWorkflowSnapshots(rows)
        });
        strategicAiState.reportId = saved.reportId;
        strategicAiState.createdAt = saved.createdAt;
        strategicAiState.workflowSnapshots = strategicWorkflowSnapshots(rows);
        strategicAiSaveMessage = "Saved to Previous AI analyses at " + reportDate(saved.createdAt) + ".";
        auth_1.logHistory("ai", "Saved AI optimization report for " + rows.length + " workflows");
    }
    catch (error) {
        strategicAiSaveMessage = "Could not save report: " + ((error && error.message) || error);
    }
    finally {
        strategicAiSaving = false;
        renderSigma();
    }
}

function aiReportOverlay(open) {
    const overlay = dom_1.$("aiReportOverlay");
    if (overlay) overlay.style.display = open ? "flex" : "none";
}

function aiReportWorkflowLocations() {
    const map = new Map();
    aiReportExplorerState.reports.forEach(report => (report.workflows || []).forEach(workflow => {
        const key = String(workflow.workflowKey || workflow.workflowId || workflow.name || "workflow");
        if (!map.has(key)) map.set(key, { key, name: workflow.name || "Untitled workflow", count: 0,
            workflowCreatedAt: workflow.workflowCreatedAt || null });
        map.get(key).count += 1;
    }));
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function aiReportMatchesLocation(report) {
    if (aiReportExplorerState.workflowKey === "all") return true;
    return (report.workflows || []).some(workflow =>
        String(workflow.workflowKey || workflow.workflowId || workflow.name || "workflow") === aiReportExplorerState.workflowKey);
}

function renderAiReportExplorer() {
    const tree = dom_1.$("aiReportTree");
    const places = dom_1.$("aiReportWorkflowPlaces");
    const openButton = dom_1.$("aiReportOpen");
    if (!tree || !places) return;
    places.innerHTML = "";
    aiReportWorkflowLocations().forEach(location => {
        const button = dom_1.el("button", { class: "libPlace" + (aiReportExplorerState.workflowKey === location.key ? " on" : ""), type: "button" });
        button.append(dom_1.el("span", { class: "aiReportFolderIcon", "aria-hidden": "true" }, "▱"),
            dom_1.el("span", {}, location.name), dom_1.el("small", {}, String(location.count)));
        button.title = location.workflowCreatedAt ? "Workflow created " + reportDate(location.workflowCreatedAt) : "Saved workflow snapshot";
        button.addEventListener("click", () => {
            aiReportExplorerState.workflowKey = location.key;
            aiReportExplorerState.selectedId = null;
            renderAiReportExplorer();
        });
        places.append(button);
    });
    const all = dom_1.$("aiReportAll");
    if (all) all.classList.toggle("on", aiReportExplorerState.workflowKey === "all");
    if (dom_1.$("aiReportCount")) dom_1.$("aiReportCount").textContent = String(aiReportExplorerState.reports.length);
    const location = aiReportExplorerState.workflowKey === "all" ? null :
        aiReportWorkflowLocations().find(row => row.key === aiReportExplorerState.workflowKey);
    if (dom_1.$("aiReportLocation")) dom_1.$("aiReportLocation").textContent = location ? location.name : "All analyses";

    const query = aiReportExplorerState.filter.trim().toLowerCase();
    const visible = aiReportExplorerState.reports.filter(report => aiReportMatchesLocation(report) && (!query ||
        String(report.title || "").toLowerCase().includes(query) ||
        (report.workflows || []).some(workflow => String(workflow.name || "").toLowerCase().includes(query))));
    tree.innerHTML = "";
    if (!visible.length) {
        tree.append(dom_1.el("div", { class: "aiReportEmpty" },
            dom_1.el("strong", {}, aiReportExplorerState.busy ? "Loading analyses…" : "No saved analyses here"),
            dom_1.el("p", {}, aiReportExplorerState.busy ? "Reading your account history." : "Run an AI analysis, then choose Save AI analysis.")));
    }
    visible.forEach(report => {
        const selected = aiReportExplorerState.selectedId === report.reportId;
        const row = dom_1.el("div", { class: "aiReportRow" + (selected ? " selected" : ""), role: "option",
            tabindex: "0", "aria-selected": String(selected) });
        const identity = dom_1.el("div", { class: "aiReportIdentity" },
            dom_1.el("span", { class: "aiReportFileIcon", "aria-hidden": "true" }, "✦"),
            dom_1.el("div", {}, dom_1.el("strong", {}, report.title || "AI optimization report")));
        const workflowMeta = dom_1.el("div", { class: "aiReportWorkflowMeta" });
        (report.workflows || []).forEach(workflow => workflowMeta.append(dom_1.el("span", {},
            (workflow.name || "Workflow") + " · created " + reportDate(workflow.workflowCreatedAt, "date unavailable"))));
        identity.lastChild.append(workflowMeta);
        const created = dom_1.el("div", { class: "aiReportCreated" },
            dom_1.el("strong", {}, reportDate(report.createdAt)),
            dom_1.el("small", {}, (report.workflowCount || (report.workflows || []).length) + " workflow" +
                ((report.workflowCount || (report.workflows || []).length) === 1 ? "" : "s")));
        const action = dom_1.btn("Open", () => loadAiAnalysisReport(report.reportId), "btn ghost tiny");
        function select() {
            aiReportExplorerState.selectedId = report.reportId;
            renderAiReportExplorer();
        }
        row.addEventListener("click", select);
        row.addEventListener("dblclick", () => loadAiAnalysisReport(report.reportId));
        row.addEventListener("keydown", event => {
            if (event.key === "Enter") loadAiAnalysisReport(report.reportId);
            else if (event.key === " ") { event.preventDefault(); select(); }
        });
        action.addEventListener("click", event => event.stopPropagation());
        row.append(identity, created, action);
        tree.append(row);
    });
    if (openButton) openButton.disabled = !aiReportExplorerState.selectedId || aiReportExplorerState.busy;
}

async function openAiReportExplorer() {
    if (!CTX || !CTX.auth || !CTX.auth.currentUser || !CTX.auth.currentUser()) {
        if (CTX && CTX.auth && CTX.auth.showAuth) CTX.auth.showAuth(true, "login");
        return;
    }
    aiReportExplorerState.busy = true;
    aiReportExplorerState.selectedId = null;
    aiReportExplorerState.filter = "";
    aiReportExplorerState.workflowKey = "all";
    if (dom_1.$("aiReportSearch")) dom_1.$("aiReportSearch").value = "";
    aiReportOverlay(true);
    renderAiReportExplorer();
    try {
        aiReportExplorerState.reports = await CTX.data.listAiAnalysisReports(250);
        if (dom_1.$("aiReportStatus")) dom_1.$("aiReportStatus").textContent =
            aiReportExplorerState.reports.length + " saved analysis" + (aiReportExplorerState.reports.length === 1 ? "" : "es");
    }
    catch (error) {
        aiReportExplorerState.reports = [];
        if (dom_1.$("aiReportStatus")) dom_1.$("aiReportStatus").textContent =
            "Could not load analyses: " + ((error && error.message) || error);
    }
    finally {
        aiReportExplorerState.busy = false;
        renderAiReportExplorer();
    }
}

async function loadAiAnalysisReport(reportId) {
    if (!reportId || aiReportExplorerState.busy) return;
    aiReportExplorerState.busy = true;
    if (dom_1.$("aiReportStatus")) dom_1.$("aiReportStatus").textContent = "Opening saved analysis…";
    renderAiReportExplorer();
    try {
        const saved = await CTX.data.loadAiAnalysisReport(reportId);
        strategicAiState = { status: "success", result: saved.report, signature: saved.inputSignature || "", error: "",
            source: "saved", reportId: saved.reportId, createdAt: saved.createdAt,
            aiGeneratedAt: saved.aiGeneratedAt, mathematicalSnapshot: saved.mathematicalSnapshot,
            workflowSnapshots: saved.workflows || [] };
        strategicAiSaveMessage = "Loaded saved analysis from " + reportDate(saved.createdAt) + ".";
        strategicView = "ai";
        ws_1.setActive(-1);
        aiReportOverlay(false);
        full();
    }
    catch (error) {
        if (dom_1.$("aiReportStatus")) dom_1.$("aiReportStatus").textContent =
            "Could not open analysis: " + ((error && error.message) || error);
    }
    finally {
        aiReportExplorerState.busy = false;
        renderAiReportExplorer();
    }
}

function strategicOptimizationActions(actions, portfolio) {
    const host = dom_1.el("div", { class: "strategicOptimizationActions" });
    (actions || []).slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).forEach((action, index) => {
        const card = dom_1.el("article", { class: "strategicOptimizationAction" });
        const heading = dom_1.el("div", { class: "strategicOptimizationActionHead" },
            dom_1.el("span", {}, String(action.sequence || index + 1)),
            dom_1.el("h5", {}, action.change || "Optimization action"));
        card.append(heading);
        if (portfolio && Array.isArray(action.workflows) && action.workflows.length) {
            const workflows = dom_1.el("div", { class: "strategicOptimizationWorkflows" });
            action.workflows.forEach(name => workflows.append(dom_1.el("span", {}, name)));
            card.append(workflows);
        }
        const details = portfolio
            ? [["Leverage", action.leverage], ["How", action.how], ["Why", action.reason], ["Measure", action.success_measure]]
            : [["How", action.how], ["Why", action.reason], ["Measure", action.success_measure]];
        details.forEach(pair => {
            // Reports saved before cross-workflow leverage was introduced do
            // not have this field. Keep those historical reports clean while
            // requiring it for every newly generated portfolio analysis.
            if (pair[0] === "Leverage" && !pair[1])
                return;
            card.append(dom_1.el("div", { class: "strategicOptimizationDetail" },
                dom_1.el("strong", {}, pair[0]), dom_1.el("p", {}, pair[1] || "Not specified.")));
        });
        host.append(card);
    });
    if (!host.childNodes.length)
        host.append(dom_1.el("p", { class: "hint" }, "No actionable optimization steps were returned. Run the report again."));
    return host;
}

function renderStrategicAi(dashboard, rows) {
    const payload = strategicAiPayload(rows);
    const signature = strategicAiSignature(payload);
    const stale = strategicAiState.source === "live" && !!strategicAiState.result && strategicAiState.signature !== signature;
    const hero = dom_1.el("section", { class: "strategicAiHero" },
        dom_1.el("div", { class: "strategicHeroCopy" },
            dom_1.el("div", { class: "strategicEyebrow" }, "Claude advisory review"),
            dom_1.el("h2", {}, "Interpret the portfolio with AI"),
            dom_1.el("p", {}, "Claude identifies how the open workflows can reinforce each other through shared capabilities, handoffs, standards, and sequencing. It runs only when you choose Run AI analysis.")));
    const actionBox = dom_1.el("div", { class: "strategicAiRun" });
    const run = dom_1.btn(strategicAiState.status === "running" ? "Analyzing…" :
        (strategicAiState.result ? "Run again" : "Run AI analysis"), () => runStrategicAi(rows), "btn primary");
    run.disabled = strategicAiState.status === "running" || !rows.length;
    const actionButtons = dom_1.el("div", { class: "strategicAiRunButtons" }, run);
    if (strategicAiState.result) {
        const save = dom_1.btn(strategicAiSaving ? "Saving…" : (strategicAiState.reportId ? "Analysis saved" : "Save AI analysis"),
            () => saveStrategicAiAnalysis(rows), "btn ghost");
        save.disabled = strategicAiSaving || strategicAiState.status === "running" || !!strategicAiState.reportId;
        actionButtons.append(save);
    }
    actionButtons.append(dom_1.btn("Previous analyses", openAiReportExplorer, "btn ghost"));
    actionBox.append(actionButtons,
        dom_1.el("small", {}, rows.length ? "Manual only · sends the current mathematical summary and workflow structure" :
            "Open workflows to run a new analysis, or browse account history."));
    if (strategicAiSaveMessage)
        actionBox.append(dom_1.el("small", { class: "strategicAiSaveStatus" }, strategicAiSaveMessage));
    hero.append(actionBox);
    dashboard.append(hero);

    if (strategicAiState.status === "running")
        dashboard.append(dom_1.el("section", { class: "strategicAiStatus", role: "status" },
            dom_1.el("span", { class: "strategicAiSpinner", "aria-hidden": "true" }),
            dom_1.el("div", {}, dom_1.el("strong", {}, "Claude is reviewing the open workflows"),
                dom_1.el("p", {}, "You can leave this view; the result will appear when it is ready."))));
    if (strategicAiState.status === "error")
        dashboard.append(dom_1.el("section", { class: "strategicAiError", role: "alert" },
            dom_1.el("strong", {}, "AI analysis did not run"), dom_1.el("p", {}, strategicAiState.error)));

    const result = strategicAiState.result;
    if (!result && strategicAiState.status !== "running" && strategicAiState.status !== "error")
        dashboard.append(dom_1.el("section", { class: "strategicAiEmpty" },
            dom_1.el("div", { class: "strategicAiIcon", "aria-hidden": "true" }, "✦"),
            dom_1.el("h3", {}, "No AI analysis has been run"),
            dom_1.el("p", {}, "Your workflows remain in the normal app flow until you press Run AI analysis.")));
    if (result) {
        const resultBox = dom_1.el("section", { class: "strategicAiResult" });
        if (strategicAiState.source === "saved") {
            const context = dom_1.el("div", { class: "strategicAiSavedContext", role: "status" },
                dom_1.el("strong", {}, "Historical report · saved " + reportDate(strategicAiState.createdAt)));
            const workflows = dom_1.el("div", { class: "strategicAiSavedWorkflows" });
            (strategicAiState.workflowSnapshots || []).forEach(workflow => workflows.append(dom_1.el("span", {},
                (workflow.name || "Workflow") + " · created " + reportDate(workflow.workflowCreatedAt, "date unavailable"))));
            context.append(workflows, dom_1.el("small", {}, "This report uses preserved workflow snapshots and remains available if the live workflows change or are deleted."));
            resultBox.append(context);
        }
        if (stale)
            resultBox.append(dom_1.el("div", { class: "strategicAiStale", role: "status" },
                "Workflows have changed since this review. Run again to refresh it."));
        const reportHead = dom_1.el("div", { class: "strategicAiReportHead" },
            dom_1.el("div", {}, dom_1.el("div", { class: "strategicEyebrow" }, "AI optimization report"),
                dom_1.el("h3", {}, "How the workflows can improve each other")));
        reportHead.append(dom_1.btn("Download report", () => downloadStrategicAiReport(rows), "btn ghost"));
        resultBox.append(reportHead, dom_1.el("div", { class: "strategicEyebrow" }, "Executive summary"),
            dom_1.el("p", { class: "strategicAiSummary" }, result.executive_summary || "No summary was returned."));

        const together = result.portfolio_optimization || {};
        const portfolioPlan = dom_1.el("section", { class: "strategicOptimizationPlan strategicPortfolioPlan" },
            dom_1.el("div", { class: "strategicOptimizationPlanHead" },
                dom_1.el("div", {}, dom_1.el("div", { class: "strategicEyebrow" }, "Cross-workflow leverage plan"),
                    dom_1.el("h4", {}, "Optimize the workflows as one portfolio")),
                dom_1.el("p", {}, together.objective || "Coordinate shared capabilities and improvements across the portfolio.")));
        portfolioPlan.append(strategicOptimizationActions(together.actions, true));
        resultBox.append(portfolioPlan);

        const priorities = dom_1.el("div", { class: "strategicAiPriorities" });
        (result.priorities || []).forEach((item, index) => priorities.append(dom_1.el("article", {},
            dom_1.el("span", {}, String(index + 1)),
            dom_1.el("div", {}, dom_1.el("h4", {}, item.title || "Priority"),
                dom_1.el("small", {}, item.workflow || "Portfolio-wide"),
                dom_1.el("p", {}, item.rationale || "")))));
        if (priorities.childNodes.length)
            resultBox.append(dom_1.el("div", { class: "strategicSectionHead strategicAiSectionHead" },
                dom_1.el("div", {}, dom_1.el("div", { class: "strategicEyebrow" }, "Cross-workflow priorities"), dom_1.el("h3", {}, "Where coordination creates value"))), priorities);
        const lists = dom_1.el("div", { class: "strategicAiLists" });
        [["Patterns", result.patterns], ["Risks and questions", result.risks]].forEach(pair => {
            const article = dom_1.el("article", {}, dom_1.el("h3", {}, pair[0]));
            const list = dom_1.el("ul", {});
            (pair[1] || []).forEach(item => list.append(dom_1.el("li", {}, item)));
            if (!list.childNodes.length)
                list.append(dom_1.el("li", {}, "None identified from the supplied data."));
            article.append(list);
            lists.append(article);
        });
        resultBox.append(lists);
        dashboard.append(resultBox);
    }
    dashboard.append(dom_1.el("p", { class: "strategicDisclaimer" },
        "AI analysis is advisory. Claude interprets the supplied mathematical results; it does not recalculate them, certify findings, or make changes to workflows."));
}

function renderSigma() {
    setAnalysisPanMode(false);
    const scroll = dom_1.$("cvscroll");
    if (scroll) {
        scroll.scrollLeft = 0;
        scroll.scrollTop = 0;
    }
    dom_1.$("cv").style.display = "none";
    dom_1.$("empty").style.display = "none";
    dom_1.$("canvastools").style.display = "none";
    connectMode = false;
    connectFrom = null;
    const box = dom_1.$("sigma");
    box.style.display = "block";
    box.innerHTML = "";
    const docs = ws_1.getDocs();
    const dashboard = dom_1.el("div", { class: "strategicDashboard" });
    dashboard.append(strategicModeTabs());
    if (!docs.length) {
        if (strategicView === "ai") {
            renderStrategicAi(dashboard, []);
            box.append(dashboard);
            renderStrategicSidePanel([]);
            return;
        }
        dashboard.append(dom_1.el("div", { class: "strategicEmpty" },
            dom_1.el("div", { class: "strategicMark" }, "Σ"),
            dom_1.el("h2", {}, "Strategic value starts with a workflow"),
            dom_1.el("p", {}, "Create, open, or add an example workflow to compare opportunities across your portfolio.")));
        box.append(dashboard);
        renderStrategicSidePanel([]);
        return;
    }
    const rows = strategicRows();
    renderStrategicSidePanel(rows);
    const totalCost = rows.reduce((sum, r) => sum + r.opportunityCost, 0);
    const totalTime = rows.reduce((sum, r) => sum + r.opportunityTime, 0);
    const totalFindings = rows.reduce((sum, r) => sum + r.findings, 0);
    const appliedCost = rows.reduce((sum, r) => sum + r.appliedCost, 0);
    const appliedTime = rows.reduce((sum, r) => sum + r.appliedTime, 0);
    const averageCoverage = Math.round(rows.reduce((sum, r) => sum + r.coverage, 0) / rows.length);

    if (strategicView === "ai") {
        renderStrategicAi(dashboard, rows);
        box.append(dashboard);
        return;
    }
    const hero = dom_1.el("section", { class: "strategicHero" });
    const heroCopy = dom_1.el("div", { class: "strategicHeroCopy" },
        dom_1.el("div", { class: "strategicEyebrow" }, "Deterministic portfolio calculation"),
        dom_1.el("h2", {}, "Mathematical analysis across open workflows"),
        dom_1.el("p", {}, "Compare locally calculated cost, time, findings, and coverage. This view uses workflow data and fixed Plumbline rules—no AI is called."));
    const heroActions = dom_1.el("div", { class: "strategicHeroActions" });
    heroActions.append(dom_1.btn("Apply across workflows", applyAll, "btn primary"));
    heroActions.append(dom_1.btn("Export summary", downloadCurrent, "btn ghost"));
    hero.append(heroCopy, heroActions);
    dashboard.append(hero);

    const metrics = dom_1.el("section", { class: "strategicMetrics", "aria-label": "Portfolio totals" });
    [["Open workflows", String(rows.length), rows.reduce((sum, r) => sum + r.stateCount, 0) + " total states"],
        ["Cost opportunity", dom_1.fmt(totalCost), dom_1.fmt(appliedCost) + " applied"],
        ["Time opportunity", dom_1.fmin(totalTime), dom_1.fmin(appliedTime) + " applied"],
        ["Analysis coverage", averageCoverage + "%", totalFindings + " finding" + (totalFindings === 1 ? "" : "s")]
    ].forEach((m, i) => metrics.append(dom_1.el("article", { class: "strategicMetric metric" + (i + 1) },
        dom_1.el("span", {}, m[0]), dom_1.el("strong", {}, m[1]), dom_1.el("small", {}, m[2]))));
    dashboard.append(metrics);

    const sectionHead = dom_1.el("div", { class: "strategicSectionHead" },
        dom_1.el("div", {}, dom_1.el("div", { class: "strategicEyebrow" }, "Workflow comparison"), dom_1.el("h3", {}, "Where to focus next")));
    const sortLabel = dom_1.el("label", { class: "strategicSort" }, dom_1.el("span", {}, "Sort by"));
    const sort = dom_1.el("select", { "aria-label": "Sort strategic workflows" });
    [["opportunity", "Largest opportunity"], ["cost", "Cost opportunity"], ["time", "Time opportunity"],
        ["findings", "Most findings"], ["coverage", "Lowest coverage"], ["name", "Workflow name"]].forEach(pair => {
        const option = dom_1.el("option", { value: pair[0] }, pair[1]);
        if (strategicSort === pair[0])
            option.selected = true;
        sort.append(option);
    });
    sort.addEventListener("change", () => { strategicSort = sort.value; renderSigma(); });
    sortLabel.append(sort);
    sectionHead.append(sortLabel);
    dashboard.append(sectionHead);

    const ordered = rows.slice().sort((a, b) => {
        if (strategicSort === "name")
            return a.name.localeCompare(b.name);
        if (strategicSort === "cost")
            return b.opportunityCost - a.opportunityCost;
        if (strategicSort === "time")
            return b.opportunityTime - a.opportunityTime;
        if (strategicSort === "findings")
            return b.findings - a.findings;
        if (strategicSort === "coverage")
            return a.coverage - b.coverage;
        return (b.opportunityCost - a.opportunityCost) || (b.opportunityTime - a.opportunityTime) || (b.findings - a.findings);
    });
    const list = dom_1.el("section", { class: "strategicList" });
    ordered.forEach((r, rank) => {
        const card = dom_1.el("article", { class: "strategicWorkflowCard" });
        const identity = dom_1.el("div", { class: "strategicWorkflowIdentity" },
            dom_1.el("span", { class: "strategicRank" }, String(rank + 1)),
            dom_1.el("div", {}, dom_1.el("h4", {}, r.name), dom_1.el("p", {}, r.stateCount + " states · " + r.transitionCount + " transitions · " + r.findings + " findings")));
        const value = dom_1.el("div", { class: "strategicWorkflowValue" },
            dom_1.el("div", {}, dom_1.el("span", {}, "Opportunity"), dom_1.el("strong", {}, dom_1.fmt(r.opportunityCost) + " · " + dom_1.fmin(r.opportunityTime))),
            dom_1.el("div", {}, dom_1.el("span", {}, "Applied"), dom_1.el("strong", {}, dom_1.fmt(r.appliedCost) + " · " + dom_1.fmin(r.appliedTime))));
        const progressFill = dom_1.el("i", {});
        progressFill.style.width = r.coverage + "%";
        const coverage = dom_1.el("div", { class: "strategicCoverage" },
            dom_1.el("div", {}, dom_1.el("span", {}, "Analysis coverage"), dom_1.el("b", {}, r.coverage + "%")),
            dom_1.el("div", { class: "strategicProgress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(r.coverage) }, progressFill));
        const action = dom_1.btn("Open analysis", () => openStrategicWorkflow(r.index), "btn ghost strategicOpen");
        card.append(identity, value, coverage, action);
        list.append(card);
    });
    dashboard.append(list);

    const costLeader = rows.slice().sort((a, b) => b.opportunityCost - a.opportunityCost)[0];
    const timeLeader = rows.slice().sort((a, b) => b.opportunityTime - a.opportunityTime)[0];
    const coverageLeader = rows.slice().sort((a, b) => a.coverage - b.coverage)[0];
    const insights = dom_1.el("section", { class: "strategicInsights" },
        dom_1.el("div", { class: "strategicEyebrow" }, "Portfolio signals"),
        dom_1.el("div", { class: "strategicInsightGrid" },
            dom_1.el("article", {}, dom_1.el("span", {}, "Largest cost opportunity"), dom_1.el("strong", {}, costLeader.name), dom_1.el("small", {}, dom_1.fmt(costLeader.opportunityCost) + " illustrative")),
            dom_1.el("article", {}, dom_1.el("span", {}, "Largest time opportunity"), dom_1.el("strong", {}, timeLeader.name), dom_1.el("small", {}, dom_1.fmin(timeLeader.opportunityTime) + " illustrative")),
            dom_1.el("article", {}, dom_1.el("span", {}, "Needs the most analysis"), dom_1.el("strong", {}, coverageLeader.name), dom_1.el("small", {}, coverageLeader.completedTools + " of 6 checks applied"))));
    dashboard.append(insights, dom_1.el("p", { class: "strategicDisclaimer" }, "This view is purely mathematical and does not call AI. Savings are assumption-based estimates; open a workflow to inspect its formally certified or refuted structural findings."));
    box.append(dashboard);
}
/* ---------- right panel: Tools / Table / JSON / Analysis ---------- */

/* main.ts:1168-1216 */
function renderTools() {
    const box = dom_1.$("tools");
    box.innerHTML = "";
    box.append(dom_1.el("div", { class: "eyebrow2" }, "Build — drag a chip onto the canvas"));
    const pal = dom_1.el("div", { class: "palette" });
    ws_1.CHIPS.forEach(spec => { pal.append(makeChip(spec)); });
    box.append(pal);
    const brow = dom_1.el("div", { class: "buildrow" });
    brow.append(dom_1.btn(connectMode ? "\u2192 Connect: ON (Esc to stop)" : "\u2192 Connect mode", toggleConnectMode, "btn tiny" + (connectMode ? " on" : "")));
    brow.append(dom_1.btn("\u00d7 Delete selected", () => deleteSel(), "btn tiny"));
    box.append(brow);
    box.append(dom_1.el("p", { class: "hint" }, "Drag a chip onto the canvas to add a state. Connect mode: click a source state then the target (or drag the teal dot). Drag a node to move it; select one and press Delete to remove it."));
    box.append(dom_1.el("hr", { class: "sep2" }));
    if (ws_1.getActive() < 0) {
        box.append(dom_1.el("p", { class: "hint" }, "Once you have a few states, run a tool from the buttons along the bottom \u2014 findings and savings show here."));
        return;
    }
    const d = ws_1.D();
    const { c, t } = ws_1.totals(d);
    box.append(dom_1.el("div", { class: "savebar" }, "Applied savings: ", dom_1.el("b", {}, dom_1.fmt(c)), "  ·  ", dom_1.el("b", {}, dom_1.fmin(t)), dom_1.el("span", { class: "ill" }, " illustrative")));
    const list = [0, 1, 2, 3, 4, 5].filter(i => ws_1.toolActive(d, i));
    if (!list.length) {
        box.append(dom_1.el("p", { class: "hint" }, "Run a tool below, or “Apply all improvements”. Each finding can be overruled."));
        return;
    }
    for (const i of list) {
        const meta = presets_1.TOOL_META[i];
        const card = dom_1.el("div", { class: "toolcard" });
        card.append(dom_1.el("div", { class: "eyebrow" }, "Tool " + (i + 1) + " · " + meta.name));
        card.append(dom_1.el("p", { class: "what" }, meta.what));
        for (const id of d.toolIds[i]) {
            const s = d.sugs[id];
            const overr = d.overruled.has(id);
            const row = dom_1.el("div", { class: "sug" + (overr ? " overr" : "") });
            row.append(dom_1.el("div", { class: "sugtitle" }, s.title));
            row.append(dom_1.el("p", { class: "sugfound" }, s.found));
            const gain = s.clarity ? "clarity — the map itself" : ((s.cost ? "+ " + dom_1.fmt(s.cost) : "") + (s.cost && s.time ? "  ·  " : "") + (s.time ? dom_1.fmin(s.time) + " saved" : ""));
            row.append(dom_1.el("div", { class: "suggain" }, gain || "—", dom_1.el("span", { class: "money" }, meta.money)));
            const t2 = dom_1.el("button", { class: "btn tiny " + (overr ? "" : "on") }, overr ? "Overruled — restore" : "Accept ✓ (overrule)");
            t2.addEventListener("click", () => { if (overr)
                d.overruled.delete(id);
            else
                d.overruled.add(id); ws_1.rebuild(d); renderCanvas(); renderTools(); });
            row.append(t2);
            card.append(row);
        }
        box.append(card);
    }
}

/* main.ts:1217-1267 */
function renderTable() {
    const root = dom_1.$("editor");
    root.innerHTML = "";
    if (ws_1.getActive() < 0) {
        root.append(dom_1.el("p", { class: "hint" }, "Empty table \u2014 add a state to start a workflow, then fill in the rows."));
        root.append(dom_1.el("h3", {}, "States"));
        const st0 = dom_1.el("table", { class: "grid" });
        st0.append(dom_1.head(["id", "label", "role", "owner", "stage", "start", "acc", "rej", "cost", "time", ""]));
        root.append(st0);
        root.append(dom_1.btn("+ state", () => { const d = ws_1.ensureDoc(); const id = ws_1.uid(d, "S"); const first = !d.wf.states.some(x => x.initial); d.wf.states.push(first ? { id, label: "New", role: "step", initial: true } : { id, label: "New", role: "step" }); d.cost[id] = 50; d.time[id] = 30; ws_1.commit(); }));
        root.append(dom_1.el("h3", {}, "Transitions"));
        const tt0 = dom_1.el("table", { class: "grid" });
        tt0.append(dom_1.head(["from", "on", "to", ""]));
        root.append(tt0);
        root.append(dom_1.btn("+ transition", () => { const d = ws_1.ensureDoc(); if (!d.wf.states.length) {
            flashTools("Add a state first.");
            return;
        } const id = d.wf.states[0].id; d.wf.transitions.push({ from: id, on: "event" + d.wf.transitions.length, to: id }); ws_1.commit(); }));
        const e = dom_1.$("status");
        e.className = "status";
        e.textContent = "Empty \u2014 add states/transitions here, or drag chips on the canvas.";
        return;
    }
    const d = ws_1.D();
    root.append(fieldRow("Name", d.name, v => { d.name = v; d.wf.name = v; renderWfBar(); }));
    root.append(dom_1.el("h3", {}, "States"));
    const st = dom_1.el("table", { class: "grid" });
    st.append(dom_1.head(["id", "label", "role", "owner", "stage", "start", "acc", "rej", "cost", "time", ""]));
    d.wf.states.forEach((s, i) => st.append(stateRow(d, s, i)));
    root.append(st);
    root.append(dom_1.btn("+ state", () => { const id = ws_1.uid(d, "S"); const first = !d.wf.states.some(x => x.initial); d.wf.states.push(first ? { id, label: "New", role: "step", initial: true } : { id, label: "New", role: "step" }); d.cost[id] = 50; d.time[id] = 30; ws_1.commit(); }));
    root.append(dom_1.el("h3", {}, "Transitions"));
    const tt = dom_1.el("table", { class: "grid" });
    tt.append(dom_1.head(["from", "on", "to", ""]));
    d.wf.transitions.forEach((_, i) => tt.append(transRow(d, i)));
    root.append(tt);
    root.append(dom_1.btn("+ transition", () => { var _a, _b; const id = (_b = (_a = d.wf.states[0]) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : ""; if (!id) {
        flashTools("Add a state first.");
        return;
    } d.wf.transitions.push({ from: id, on: "event" + d.wf.transitions.length, to: id }); ws_1.commit(); }));
    if (!d.wf.states.length) {
        const e = dom_1.$("status");
        e.className = "status";
        e.textContent = "Empty \u2014 add states above, or drag chips on the canvas.";
        return;
    }
    const r = (0, io_1.parseWorkflow)(ws_1.normalise(d.wf));
    const st2 = dom_1.$("status");
    st2.className = "status " + (r.ok ? "ok" : "bad");
    st2.textContent = (r.ok ? "✓ valid — " : "✕ ") + (r.ok ? (d.wf.states.length + " states, " + d.wf.transitions.length + " transitions") : r.errors.join(" • "));
}

/* main.ts:1268-1268 */
function fieldRow(l, v, on) { const i = dom_1.el("input", { value: v }); i.addEventListener("input", () => { on(i.value); syncJson(); }); return dom_1.el("label", { class: "fld" }, dom_1.el("span", {}, l), i); }

/* main.ts:1271-1290 */
function stateRow(d, s, i) {
    var _a, _b;
    const tr = dom_1.el("tr");
    tr.append(dom_1.td(dom_1.inp(s.id, v => { ws_1.rename(d, i, v); ws_1.commit(); })));
    tr.append(dom_1.td(dom_1.inp(s.label, v => { d.wf.states[i].label = v; syncJson(); renderCanvas(); })));
    const sl = dom_1.el("select");
    ws_1.ROLES.forEach(r => { const o = dom_1.el("option", { value: r }, r); if (r === s.role)
        o.selected = true; sl.append(o); });
    sl.addEventListener("change", () => { d.wf.states[i].role = sl.value; ws_1.commit(); });
    tr.append(dom_1.td(sl));
    tr.append(dom_1.td(dom_1.inp(d.owner[s.id] || "", v => { d.owner[s.id] = v; syncJson(); renderCanvas(); })));
    tr.append(dom_1.td(dom_1.inp(d.stage[s.id] || "", v => { d.stage[s.id] = v; renderCanvas(); syncJson(); })));
    tr.append(dom_1.td(dom_1.rad(!!s.initial, () => { d.wf.states.forEach(x => x.initial = false); d.wf.states[i].initial = true; ws_1.commit(); })));
    tr.append(dom_1.td(dom_1.chk(!!s.accept, v => { d.wf.states[i].accept = v; ws_1.commit(); })));
    tr.append(dom_1.td(dom_1.chk(!!s.reject, v => { d.wf.states[i].reject = v; ws_1.commit(); })));
    tr.append(dom_1.td(dom_1.num((_a = d.cost[s.id]) !== null && _a !== void 0 ? _a : 0, v => { d.cost[s.id] = v; syncJson(); })));
    tr.append(dom_1.td(dom_1.num((_b = d.time[s.id]) !== null && _b !== void 0 ? _b : 0, v => { d.time[s.id] = v; syncJson(); })));
    tr.append(dom_1.td(dom_1.btn("✕", () => { const id = d.wf.states[i].id; d.wf.states.splice(i, 1); d.wf.transitions = d.wf.transitions.filter(t => t.from !== id && t.to !== id); ws_1.commit(); }, "btn tiny")));
    return tr;
}

/* main.ts:1291-1299 */
function transRow(d, i) {
    const t = d.wf.transitions[i];
    const tr = dom_1.el("tr");
    tr.append(dom_1.td(ssel(d, t.from, v => { d.wf.transitions[i].from = v; ws_1.commit(); })));
    tr.append(dom_1.td(dom_1.inp(t.on, v => { d.wf.transitions[i].on = v; ws_1.commit(); })));
    tr.append(dom_1.td(ssel(d, t.to, v => { d.wf.transitions[i].to = v; ws_1.commit(); })));
    tr.append(dom_1.td(dom_1.btn("✕", () => { d.wf.transitions.splice(i, 1); ws_1.commit(); }, "btn tiny")));
    return tr;
}

/* main.ts:1305-1306 */
function ssel(d, val, on) { const s = dom_1.el("select"); d.wf.states.forEach(x => { const o = dom_1.el("option", { value: x.id }, x.id); if (x.id === val)
    o.selected = true; s.append(o); }); s.addEventListener("change", () => on(s.value)); return s; }

/* main.ts:1334-1338 */
function syncJson() { const ta = dom_1.$("json"); if (ws_1.getActive() < 0) {
    if (!ta.value.trim())
        ta.value = ws_1.SCAFFOLD;
    return;
} ta.value = JSON.stringify(ws_1.unified(ws_1.D()), null, 2); ws_1.persist(); }

/* main.ts:1339-1339 */
function loadJson() { const raw = ws_1.safe(dom_1.$("json").value); ws_1.ingest(raw, "JSON"); }

/* main.ts:1426-1431 */
function analysisEditorViewSignature(data, d) { try {
    return JSON.stringify({ data, applied: [...d.applied].sort(), overruled: [...d.overruled].sort(), showAll: analysisShowAllLines, roomy: analysisIncreasedSpacing, edge: Object.keys(d.overlay.edge).sort(), flag: Object.keys(d.overlay.flag).sort(), stageTag: d.overlay.stageTag, bands: d.overlay.bands.map((b) => ({ label: b.label, ids: b.ids })), ghosts: d.overlay.ghosts.length });
}
catch (e) {
    return String(Date.now());
} }

/* main.ts:1853-1865 */
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

/* main.ts:1866-1892 */
function stepSavingsRows(d) {
    var _a;
    const rows = [];
    if (!d || !d.wf || !Array.isArray(d.wf.states) || !d.wf.states.length) {
        for (let i = 0; i < 6; i++)
            rows.push({ index: i, step: i + 1, name: (presets_1.TOOL_META[i] && presets_1.TOOL_META[i].name) || ("Tool " + (i + 1)), cost: 0, time: 0, count: 0, status: "not run", result: "Add workflow steps", applied: false });
        return rows;
    }
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

/* main.ts:1893-1921 */
function renderAnalysisSavings(d) {
    const host = analysisSavingsHost();
    const results = dom_1.$("results");
    if (results)
        results.style.display = "block";
    if (!host)
        return;
    host.innerHTML = "";
    if (!d) {
        host.append(dom_1.el("div", { class: "analysisSavingsBox mutedBox" }, "Open a workflow to see savings by each of the six Plumbline steps."));
        return;
    }
    const rows = stepSavingsRows(d);
    const totalCost = rows.reduce((a, r) => a + r.cost, 0), totalTime = rows.reduce((a, r) => a + r.time, 0);
    const box = dom_1.el("div", { class: "analysisSavingsBox" });
    box.append(dom_1.el("div", { class: "analysisSavingsTop" }, dom_1.el("div", {}, dom_1.el("div", { class: "analysisSavingsEyebrow" }, "Six-step savings"), dom_1.el("h3", {}, "Savings result by Plumbline step")), dom_1.el("div", { class: "analysisSavingsTotal" }, dom_1.el("b", {}, dom_1.fmt(totalCost)), dom_1.el("span", {}, " · " + dom_1.fmin(totalTime) + " illustrative"))));
    const grid = dom_1.el("div", { class: "analysisStepGrid" });
    rows.forEach(r => {
        const card = dom_1.el("div", { class: "analysisStepCard" + (r.cost || r.time ? " hasSaving" : "") });
        card.append(dom_1.el("div", { class: "analysisStepHead" }, dom_1.el("span", {}, "Step " + r.step), dom_1.el("em", {}, r.status)));
        card.append(dom_1.el("strong", {}, r.name));
        card.append(dom_1.el("div", { class: "analysisStepResult" }, r.result));
        card.append(dom_1.el("div", { class: "analysisStepGain" }, (r.cost ? dom_1.fmt(r.cost) : "$0"), " · ", (r.time ? dom_1.fmin(r.time) : "0 min")));
        card.append(dom_1.el("div", { class: "analysisStepMeta" }, r.count + " finding" + (r.count === 1 ? "" : "s")));
        const action = dom_1.el("button", { class: "analysisStepApply" + (r.applied ? " on" : "") }, r.applied ? "Remove from graph" : "Apply to graph");
        action.addEventListener("click", (ev) => { ev.stopPropagation(); runTool(r.index); });
        card.append(action);
        grid.append(card);
    });
    box.append(grid);
    host.append(box);
}

function resizeResultsFrame() {
    const frame = dom_1.$("results");
    if (!frame || frame.style.display === "none")
        return;
    try {
        const doc = frame.contentDocument;
        if (!doc)
            return;
        if (doc.documentElement)
            doc.documentElement.style.overflow = "hidden";
        if (doc.body)
            doc.body.style.overflow = "hidden";
        const bodyHeight = doc.body ? Math.max(doc.body.scrollHeight, doc.body.offsetHeight) : 0;
        const rootHeight = doc.documentElement ? Math.max(doc.documentElement.scrollHeight, doc.documentElement.offsetHeight) : 0;
        frame.style.height = Math.max(220, bodyHeight, rootHeight) + 8 + "px";
        const pane = dom_1.$("pane_analysis");
        if (pane) {
            pane.scrollTop = 0;
            requestAnimationFrame(() => requestAnimationFrame(() => { pane.scrollTop = 0; }));
            setTimeout(() => { pane.scrollTop = 0; }, 240);
        }
    }
    catch (_err) { }
}

/* main.ts:1922-1949 */  /* PHASE2: becomes await ctx.engine.analyze(...) */
function runAnalysis() {
    ed_1.requestEditorSync({ silent: true });
    const pane = dom_1.$("pane_analysis");
    if (pane)
        pane.scrollTop = 0;
    if (ws_1.getActive() < 0) {
        if (ws_1.getActive() === -1)
            renderStrategicSidePanel(strategicRows());
        else
            renderAnalysisSavings();
        return;
    }
    const d = ws_1.D();
    renderAnalysisSavings(d);
    if (!d.wf.states.length || !d.wf.states.some(s => s.initial)) {
        dom_1.$("results").srcdoc = "<p style=\"font:14px Arial;color:#8a93a0;padding:16px\">Add states (with one start) to run the certifying engine.</p>";
        return;
    }
    const r = (0, io_1.parseWorkflow)(ws_1.normalise(d.wf));
    if (!r.ok) {
        dom_1.$("results").removeAttribute("srcdoc");
        return;
    }
    const w = r.value;
    const report = (0, io_1.runPipeline)(w, { stepCost: d.cost, branchProb: d.branch }, lemma_1.check);
    dom_1.$("results").srcdoc = (0, app_1.appToHtml)((0, app_1.buildView)(w, report));
}
/* ---------- database-backed accounts + saved workflows (PlumblineData) ----------
 * Persistent state lives in the Plumbline PostgreSQL database (Supabase),
 * reached through window.PlumblineData → the Plumbline API (server/).
 * The browser keeps NO account data: passwords are bcrypt-hashed in the
 * users table, the session is an httpOnly cookie, saved workflows are
 * immutable workflow_version rows (also decomposed into normalized FSM
 * tables server-side), and history is the activity_log table. */

/* main.ts:2190-2198 */
function renderWfBar() {
    const bar = dom_1.$("wfbar");
    bar.innerHTML = "";
    bar.setAttribute("role", "tablist");
    bar.setAttribute("aria-label", "Open workflows");
    ws_1.getDocs().forEach((d, i) => {
        const tab = dom_1.el("div", { class: "wfTab" + (i === ws_1.getActive() ? " on" : "") });
        const main = dom_1.el("button", { class: "wfTabMain", role: "tab", title: d.name,
            "aria-selected": String(i === ws_1.getActive()) });
        main.append(dom_1.el("span", { class: "wfTabIndex" }, String(i + 1)));
        main.append(dom_1.el("span", { class: "wfTabName" }, d.name || "Workflow"));
        main.addEventListener("click", () => { ws_1.setActive(i); ws_1.setSel(null); ws_1.setLastTool(-2); full(); showTab("analysis"); });
        const close = dom_1.el("button", { class: "wfTabClose", title: "Close " + (d.name || "workflow"),
            "aria-label": "Close " + (d.name || "workflow") }, "×");
        close.disabled = ws_1.getDocs().length <= 1;
        close.addEventListener("click", (e) => {
            e.stopPropagation();
            if (ws_1.closeDoc(i)) { full(); ws_1.persist(); }
        });
        tab.append(main, close);
        bar.append(tab);
    });
    const sg = dom_1.el("button", { class: "wfTab sigma" + (ws_1.getActive() === -1 ? " on" : ""), role: "tab",
        "aria-selected": String(ws_1.getActive() === -1) }, "Σ Strategic value");
    sg.addEventListener("click", () => { ws_1.setActive(-1); full(); });
    bar.append(sg);
    syncStudioControls();
}
/* ---------- node drag/connect ---------- */

/* main.ts:2199-2199 */
let drag = null;

/* main.ts:2200-2200 */
let conn = null;

/* main.ts:2201-2201 */
let connectMode = false, connectFrom = null;

/* main.ts:2202-2204 */
function updateCtUi() { const b = document.getElementById("ctAddTrans"); if (b)
    b.classList.toggle("on", connectMode); const h = document.getElementById("cthint"); if (h)
    h.textContent = connectMode ? (connectFrom ? "Now click the TARGET node  (Esc to cancel)" : "Click the SOURCE node, then the target  (Esc to cancel)") : "Double-click the canvas to add a state \u00b7 drag a node to move \u00b7 use \u201cAdd transition\u201d (or drag the teal dot) to connect"; }

/* main.ts:2205-2206 */
function toggleConnectMode() { if (ws_1.getActive() < 0)
    return; connectMode = !connectMode; connectFrom = null; updateCtUi(); renderCanvas(); }

/* main.ts:2207-2280 */
function wireNode(node, id, handle) {
    node.addEventListener("mousedown", e => { if (e.target === handle || ws_1.getActive() < 0)
        return; const r = dom_1.$("cv").getBoundingClientRect(); drag = { id, ox: e.clientX - r.left - ws_1.D().pos[id].x, oy: e.clientY - r.top - ws_1.D().pos[id].y, moved: false }; e.preventDefault(); });
    node.addEventListener("click", () => {
        if (connectMode) {
            if (!connectFrom) {
                connectFrom = id;
                updateCtUi();
                renderCanvas();
            }
            else {
                const d = ws_1.D();
                const on = "event" + d.wf.transitions.length;
                d.wf.transitions.push({ from: connectFrom, on, to: id });
                connectFrom = null;
                ws_1.resetTools(d);
                updateCtUi();
                ws_1.commit();
            }
            return;
        }
        if (drag && drag.moved)
            return;
        ws_1.setSel({ kind: "state", key: id });
        renderInspector();
    });
    handle.addEventListener("mousedown", e => { const line = dom_1.svg("path", { fill: "none", stroke: "#1F7A6F", "stroke-width": "2", "stroke-dasharray": "4 3" }); dom_1.$("cv").querySelector("svg").append(line); conn = { from: id, line }; e.preventDefault(); e.stopPropagation(); });
}
document.addEventListener("mousemove", e => {
    if (ws_1.getActive() < 0)
        return;
    const r = dom_1.$("cv").getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (drag) {
        let nx = Math.max(0, mx - drag.ox), ny = Math.max(0, my - drag.oy);
        nx = Math.round(nx / ws_1.GRID) * ws_1.GRID;
        ny = Math.round(ny / ws_1.GRID) * ws_1.GRID;
        const cur = ws_1.D().pos[drag.id];
        drag.moved = true;
        if (!cur || cur.x !== nx || cur.y !== ny) {
            ws_1.D().pos[drag.id] = { x: nx, y: ny };
            renderCanvas();
        }
    }
    else if (conn) {
        const a = ws_1.D().pos[conn.from];
        conn.line.setAttribute("d", `M ${a.x + ws_1.NW / 2} ${a.y + ws_1.NH / 2} L ${mx} ${my}`);
    }
});
document.addEventListener("mouseup", e => {
    if (ws_1.getActive() < 0) {
        drag = null;
        conn = null;
        return;
    }
    const r = dom_1.$("cv").getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (conn) {
        conn.line.remove();
        const tgt = hit(mx, my);
        if (tgt) {
            const on = "event" + ws_1.D().wf.transitions.length;
            ws_1.D().wf.transitions.push({ from: conn.from, on, to: tgt });
            ws_1.resetTools(ws_1.D());
            ws_1.commit();
        }
        conn = null;
    }
    if (drag) {
        syncJson();
        ws_1.persist();
        drag = null;
    }
});

/* main.ts:2281-2286 */
function hit(x, y) { for (const s of ws_1.D().wf.states) {
    const p = ws_1.D().pos[s.id];
    if (p && x >= p.x && x <= p.x + ws_1.NW && y >= p.y && y <= p.y + ws_1.NH)
        return s.id;
} return null; }
/* ---------- inspector ---------- */

/* main.ts:2287-2331 */
function renderInspector() {
    var _a, _b;
    const box = dom_1.$("inspector");
    box.innerHTML = "";
    if (ws_1.getActive() < 0 || !ws_1.getSel()) {
        box.append(dom_1.el("p", { class: "hint" }, "Click a node or edge to edit; drag a node to move; drag the teal dot to connect."));
        return;
    }
    const d = ws_1.D();
    if (ws_1.getSel().kind === "state") {
        const i = d.wf.states.findIndex(s => s.id === ws_1.getSel().key);
        if (i < 0) {
            ws_1.setSel(null);
            return;
        }
        const s = d.wf.states[i];
        box.append(dom_1.el("h3", {}, "State"));
        box.append(fieldRow("id", s.id, v => { ws_1.rename(d, i, v); ws_1.setSel({ kind: "state", key: d.wf.states[i].id }); ws_1.commit(); }));
        box.append(fieldRow("label", s.label, v => { d.wf.states[i].label = v; syncJson(); renderCanvas(); }));
        const sl = dom_1.el("select");
        ws_1.ROLES.forEach(r => { const o = dom_1.el("option", { value: r }, r); if (r === s.role)
            o.selected = true; sl.append(o); });
        sl.addEventListener("change", () => { d.wf.states[i].role = sl.value; ws_1.commit(); });
        box.append(dom_1.el("label", { class: "fld" }, dom_1.el("span", {}, "role"), sl));
        box.append(fieldRow("owner / team", d.owner[s.id] || "", v => { d.owner[s.id] = v; syncJson(); renderCanvas(); }));
        box.append(fieldRow("stage", d.stage[s.id] || "", v => { d.stage[s.id] = v; renderCanvas(); ws_1.persist(); }));
        box.append(dom_1.fieldNum("cost", (_a = d.cost[s.id]) !== null && _a !== void 0 ? _a : 0, v => { d.cost[s.id] = v; syncJson(); renderCanvas(); renderTools(); }));
        box.append(dom_1.fieldNum("time (min)", (_b = d.time[s.id]) !== null && _b !== void 0 ? _b : 0, v => { d.time[s.id] = v; syncJson(); renderCanvas(); renderTools(); }));
        box.append(dom_1.btn("Delete", () => { const id = s.id; d.wf.states.splice(i, 1); d.wf.transitions = d.wf.transitions.filter(t => t.from !== id && t.to !== id); ws_1.setSel(null); ws_1.commit(); }, "btn tiny"));
    }
    else {
        const [f, o, t2] = ws_1.getSel().key.split("|");
        const i = d.wf.transitions.findIndex(x => x.from === f && x.on === o && x.to === t2);
        if (i < 0) {
            ws_1.setSel(null);
            return;
        }
        box.append(dom_1.el("h3", {}, "Transition"));
        box.append(dom_1.el("label", { class: "fld" }, dom_1.el("span", {}, "from"), ssel(d, f, v => { d.wf.transitions[i].from = v; ws_1.commit(); })));
        box.append(fieldRow("on", d.wf.transitions[i].on, v => { d.wf.transitions[i].on = v; ws_1.commit(); }));
        box.append(dom_1.el("label", { class: "fld" }, dom_1.el("span", {}, "to"), ssel(d, t2, v => { d.wf.transitions[i].to = v; ws_1.commit(); })));
        box.append(dom_1.btn("Delete", () => { d.wf.transitions.splice(i, 1); ws_1.setSel(null); ws_1.commit(); }, "btn tiny"));
    }
}
/* ---------- tabs + panel toggle ---------- */

/* main.ts:2332-2345 */
function showTab(t) {
    if (t === "tools")
        t = "analysis";
    document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.getAttribute("data-tab") === t));
    ["tools", "table", "json", "analysis"].forEach(p => dom_1.$("pane_" + p).style.display = (t === p ? "" : "none"));
    if (t === "table") {
        renderTable();
        renderInspector();
    }
    else if (t === "json")
        syncJson();
    else if (t === "analysis")
        runAnalysis();
}

/* main.ts:2346-2353 */
function flashTools(msg) {
    if (ws_1.isPanelHidden())
        togglePanel();
    showTab("analysis");
    const safe = String(msg).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const r = dom_1.$("results");
    r.srcdoc = `<div style="font:14px Arial,sans-serif;color:#16243B;background:#fffdf7;padding:18px"><b>Analysis notice</b><p>${safe}</p></div>`;
}

/* main.ts:2354-2370 */
function applyPanel() {
    const right = dom_1.$("right");
    const app = dom_1.$("app");
    if (app)
        app.classList.toggle("panelCollapsed", ws_1.isPanelHidden());
    if (right) {
        right.setAttribute("aria-hidden", String(ws_1.isPanelHidden()));
        right.inert = ws_1.isPanelHidden();
    }
    const hideBtn = dom_1.$("btnHide");
    if (hideBtn)
        hideBtn.textContent = ws_1.isPanelHidden() ? "Show panel" : "Remove right panel";
    const caret = dom_1.$("rightToggle");
    if (caret) {
        caret.textContent = ws_1.isPanelHidden() ? "<" : ">";
        caret.setAttribute("aria-expanded", String(!ws_1.isPanelHidden()));
        caret.title = ws_1.isPanelHidden() ? "Show the analysis panel" : "Hide the analysis panel";
    }
}

/* main.ts:2371-2375 */
function togglePanel() { ws_1.setPanelHidden(!ws_1.isPanelHidden()); applyPanel(); if (ws_1.getActive() >= 0 && ws_1.getDocs()[ws_1.getActive()] && ws_1.hasEditorCanvas(ws_1.getDocs()[ws_1.getActive()])) {
    analysisViewDoc = "";
    setTimeout(() => renderCanvas(), 340);
} ws_1.persist(); }
/* ---------- tool running ---------- */

/* main.ts:2378-2378 */
function syncToolButtons() { const d = ws_1.getActive() >= 0 ? ws_1.D() : null; document.querySelectorAll("[data-tool]").forEach(b => { const i = +b.getAttribute("data-tool"); const on = !!d && ws_1.toolActive(d, i); b.classList.toggle("on", on); b.classList.toggle("off", !on); b.title = on ? "Applied — click to remove this improvement" : "Available — click to apply this improvement"; }); }

function syncStudioControls() {
    const strategic = ws_1.getActive() === -1;
    const all = dom_1.$("btnAll");
    const download = dom_1.$("btnDownload");
    const toolbar = document.querySelector(".analysisToolbar");
    if (all) {
        all.textContent = strategic ? "Apply across workflows" : "Apply all improvements";
        all.title = strategic ? "Apply all six checks to every open workflow" : "Apply all six checks to this workflow";
        all.hidden = strategic && strategicView === "ai";
    }
    if (download) {
        download.textContent = strategic ? "Export summary" : "Download";
        download.hidden = strategic && strategicView === "ai";
    }
    ["btnAdd", "btnFill", "btnEstimate", "btnSaveStudio"].forEach(id => {
        const control = dom_1.$(id);
        if (control)
            control.hidden = strategic;
    });
    if (toolbar)
        toolbar.classList.toggle("strategicMode", strategic);
}

/* main.ts:2380-2411 */
function runTool(i) {
    var _a;
    if (ws_1.getActive() < 0) {
        flashTools("Open or create a workflow first — click New, or add an example.");
        return;
    }
    const d = ws_1.D();
    if (d.wf.states.length < 2) {
        flashTools("Add a few states first — drag chips onto the canvas, then run a tool.");
        return;
    }
    if (ws_1.toolActive(d, i)) {
        for (const id of d.toolIds[i])
            d.applied.delete(id);
        d.toolIds[i] = [];
    }
    else {
        computeTool(d, i);
        for (const id of d.toolIds[i])
            d.applied.add(id);
    }
    ws_1.setLastTool(i);
    ws_1.rebuild(d);
    renderCanvas();
    renderTools();
    syncToolButtons();
    if (ws_1.isPanelHidden() && [0, 1, 2, 3, 4, 5].some(j => ws_1.toolActive(d, j)))
        togglePanel();
    showTab("analysis");
    ws_1.persist();
    auth_1.logHistory("tool", (ws_1.toolActive(d, i) ? "Ran " : "Turned off ") + (((_a = presets_1.TOOL_META[i]) === null || _a === void 0 ? void 0 : _a.name) || ("Tool " + (i + 1))));
}

/* main.ts:2412-2424 */
function applyAll() {
    if (ws_1.getActive() === -1) {
        let changed = 0;
        ws_1.getDocs().forEach(d => {
            if (!d.wf || d.wf.states.length < 2)
                return;
            for (let i = 0; i < 6; i++) {
                computeTool(d, i);
                for (const id of d.toolIds[i])
                    d.applied.add(id);
            }
            ws_1.rebuild(d);
            changed += 1;
        });
        if (!changed) {
            flashTools("Add at least two states to a workflow before running portfolio analysis.");
            return;
        }
        ws_1.setLastTool(-1);
        ws_1.persist();
        renderSigma();
        syncToolButtons();
        auth_1.logHistory("tool", "Applied all six tools across " + changed + " workflows");
        return;
    }
    if (ws_1.getActive() < 0) {
        flashTools("Open or create a workflow first.");
        return;
    }
    const d = ws_1.D();
    if (d.wf.states.length < 2) {
        flashTools("Add a few states first — drag chips onto the canvas, then run the tools.");
        return;
    }
    for (let i = 0; i < 6; i++) {
        computeTool(d, i);
        for (const id of d.toolIds[i])
            d.applied.add(id);
    }
    ws_1.setLastTool(-1);
    ws_1.rebuild(d);
    renderCanvas();
    renderTools();
    syncToolButtons();
    if (ws_1.isPanelHidden())
        togglePanel();
    showTab("analysis");
    ws_1.persist();
    auth_1.logHistory("tool", "Ran all six tools");
}

function downloadCurrent() {
    let payload, filename, historyLabel;
    if (ws_1.getActive() === -1) {
        const rows = strategicRows().map(r => ({
            workflow: r.name,
            states: r.stateCount,
            transitions: r.transitionCount,
            findings: r.findings,
            analysis_coverage_percent: r.coverage,
            opportunity_cost_illustrative: r.opportunityCost,
            opportunity_minutes_illustrative: r.opportunityTime,
            applied_cost_illustrative: r.appliedCost,
            applied_minutes_illustrative: r.appliedTime
        }));
        payload = { generated_at: new Date().toISOString(), methodology: "Savings are assumption-based; structural findings are certified per workflow.", workflows: rows };
        filename = "plumbline-strategic-value.json";
        historyLabel = "Exported Strategic Value summary";
    }
    else {
        if (ws_1.getActive() < 0)
            return;
        payload = ws_1.unified(ws_1.D());
        filename = (ws_1.D().wf.id || "workflow") + ".json";
        historyLabel = "Downloaded ‘" + ws_1.D().name + "’ JSON with layout/meta";
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = dom_1.el("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    auth_1.logHistory("download", historyLabel);
}
/* ---------- commit + full render ---------- */

/* main.ts:2425-2425 */
function remembering() { return false; }

/* main.ts:2460-2465 */
function full() { renderWfBar(); if (ws_1.getActive() === -1) {
    renderSigma();
    syncToolButtons();
    return;
} renderCanvas(); renderTable(); renderInspector(); syncJson(); renderTools(); syncToolButtons(); ws_1.persist(); }
/* ---------- init ---------- */

/* main.ts:2466-2556 */  /* HOOK: see PHASE1_ASSIGNMENT.md */
function init() {
    /* Editor and Analysis share workspace.docs[]. Do not erase workflows that
       were opened in the Editor before Analysis is mounted for the first time.
       Only put a genuinely empty workspace into its blank sentinel state. */
    if (!ws_1.getDocs().length)
        ws_1.setActive(-2);
    /* setupEditorSync() moved to editor.ts init(), called from ui-boot:
       the listener must exist from boot, not from a screen mount. */
    setupAnalysisPanZoom();
    dom_1.$("results").addEventListener("load", resizeResultsFrame);
    window.addEventListener("resize", () => { if (ws_1.getActive() >= 0 && ws_1.getDocs()[ws_1.getActive()] && ws_1.hasEditorCanvas(ws_1.getDocs()[ws_1.getActive()])) {
        analysisViewDoc = "";
        renderCanvas();
    } });
    const exSel = dom_1.$("exampleSel");
    exSel.addEventListener("change", () => { const k = exSel.value; if (!k)
        return; ws_1.getDocs().push(ws_1.mkDoc(presets_1.PRESETS[k])); ws_1.setActive(ws_1.getDocs().length - 1); ws_1.setSel(null); ws_1.setLastTool(-2); exSel.value = ""; full(); });
    dom_1.$("btnAddState").addEventListener("click", () => { if (ws_1.getActive() === -1)
        return; const d = ws_1.ensureDoc(); const id = ws_1.uid(d, "S"); d.wf.states.push({ id, label: "New", role: "step" }); d.cost[id] = 50; d.time[id] = 30; d.pos[id] = ws_1.placeNew(d); ws_1.resetTools(d); ws_1.setSel({ kind: "state", key: id }); ws_1.commit(); });
    dom_1.$("ctAddTrans").addEventListener("click", toggleConnectMode);
    dom_1.$("ctDelete").addEventListener("click", () => deleteSel());
    document.addEventListener("keydown", e => { if (e.key === "Escape" && connectMode) {
        connectMode = false;
        connectFrom = null;
        updateCtUi();
        renderCanvas();
    } });
    dom_1.$("btnNew").addEventListener("click", () => { ws_1.getDocs().push(ws_1.mkDoc(ws_1.startWf("New workflow"))); ws_1.setActive(ws_1.getDocs().length - 1); ws_1.setSel(null); ws_1.setLastTool(-2); full(); });
    dom_1.$("btnAdd").addEventListener("click", () => { const src = ws_1.getActive() >= 0 ? ws_1.D() : null; const w = src ? dom_1.clone(src.wf) : ws_1.blankWf("Workflow " + (ws_1.getDocs().length + 1)); w.name = (src ? src.name + " (copy)" : w.name); w.id = w.id + "_c"; ws_1.getDocs().push(ws_1.mkDoc(w)); ws_1.setActive(ws_1.getDocs().length - 1); ws_1.setSel(null); ws_1.setLastTool(-2); full(); });
    { const hb = dom_1.$("btnHide"); if (hb) hb.addEventListener("click", togglePanel); }
    { const rt = dom_1.$("rightToggle"); if (rt) rt.addEventListener("click", togglePanel); }
    dom_1.$("btnTidy").addEventListener("click", () => { if (ws_1.getActive() < 0)
        return; const d = ws_1.D(); d.pos = ws_1.tidyLayout(d); renderCanvas(); syncJson(); ws_1.persist(); auth_1.logHistory("layout", "Re-arranged tiles neatly"); });
    {
        const rem = document.getElementById("remember");
        if (rem)
            rem.addEventListener("change", () => { /* workspace state is not persisted in the browser; workflows are saved to the database */ });
    }
    dom_1.$("btnEstimate").addEventListener("click", () => { if (ws_1.getActive() < 0)
        return; ws_1.estimate(ws_1.D()); renderTools(); renderTable(); syncJson(); auth_1.logHistory("estimate", "Added reasonable fictitious cost/time values"); });
    dom_1.$("btnFill").addEventListener("click", () => { if (ws_1.getActive() < 0)
        return; const d = ws_1.D(); if (d.wf.states.length <= 2) {
        d.wf = dom_1.clone(presets_1.PRESETS.aml);
        d.wf.name = d.name;
    } ws_1.estimate(d); ws_1.resetTools(d); full(); });
    dom_1.$("btnAll").addEventListener("click", applyAll);
    dom_1.$("btnLoadJson").addEventListener("click", loadJson);
    dom_1.$("btnDownload").addEventListener("click", downloadCurrent);
    if (dom_1.$("aiReportClose")) dom_1.$("aiReportClose").addEventListener("click", () => aiReportOverlay(false));
    if (dom_1.$("aiReportAll")) dom_1.$("aiReportAll").addEventListener("click", () => {
        aiReportExplorerState.workflowKey = "all";
        aiReportExplorerState.selectedId = null;
        renderAiReportExplorer();
    });
    if (dom_1.$("aiReportSearch")) dom_1.$("aiReportSearch").addEventListener("input", event => {
        aiReportExplorerState.filter = event.target.value || "";
        aiReportExplorerState.selectedId = null;
        renderAiReportExplorer();
    });
    if (dom_1.$("aiReportOpen")) dom_1.$("aiReportOpen").addEventListener("click", () =>
        loadAiAnalysisReport(aiReportExplorerState.selectedId));
    if (dom_1.$("aiReportOverlay")) dom_1.$("aiReportOverlay").addEventListener("click", event => {
        if (event.target === dom_1.$("aiReportOverlay")) aiReportOverlay(false);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && dom_1.$("aiReportOverlay") && dom_1.$("aiReportOverlay").style.display !== "none")
            aiReportOverlay(false);
    });
    dom_1.$("fileWf").addEventListener("change", e => { var _a; const f = (_a = e.target.files) === null || _a === void 0 ? void 0 : _a[0]; if (f)
        f.text().then(txt => ws_1.ingest(ws_1.safe(txt), "Upload")); });
    document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => runTool(+b.getAttribute("data-tool"))));
    document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.getAttribute("data-tab"))));
    dom_1.$("cv").addEventListener("dblclick", e => { if (ws_1.getActive() === -1 || (ws_1.getActive() >= 0 && ws_1.getDocs()[ws_1.getActive()] && ws_1.hasEditorCanvas(ws_1.getDocs()[ws_1.getActive()])))
        return; const r = dom_1.$("cv").getBoundingClientRect(); const d = ws_1.ensureDoc(); const id = ws_1.uid(d, "S"); d.wf.states.push({ id, label: "New", role: "step" }); d.pos[id] = { x: Math.max(0, e.clientX - r.left - ws_1.NW / 2), y: Math.max(0, e.clientY - r.top - ws_1.NH / 2) }; d.cost[id] = 50; d.time[id] = 30; ws_1.resetTools(d); ws_1.setSel({ kind: "state", key: id }); ws_1.commit(); });
    // ---- drag-and-drop palette ----
    const pal = dom_1.$("palette");
    ws_1.CHIPS.forEach(spec => { pal.append(makeChip(spec)); });
    const scroll = dom_1.$("cvscroll"), cvEl = dom_1.$("cv");
    scroll.addEventListener("dragover", ev => { if (ws_1.getActive() === -1)
        return; ev.preventDefault(); const dt = ev.dataTransfer; if (dt)
        dt.dropEffect = "copy"; cvEl.classList.add("dropok"); });
    scroll.addEventListener("dragleave", () => cvEl.classList.remove("dropok"));
    scroll.addEventListener("drop", ev => {
        cvEl.classList.remove("dropok");
        if (ws_1.getActive() === -1)
            return;
        ev.preventDefault();
        const dt = ev.dataTransfer;
        const k = (dt && dt.getData("text/plain")) || dragSpec;
        dragSpec = null;
        const spec = ws_1.CHIPS.find(c => c.k === k);
        if (!spec)
            return;
        const r = cvEl.getBoundingClientRect();
        addChip(spec, ev.clientX - r.left, ev.clientY - r.top);
    });
    ws_1.restoreState();
    applyPanel();
    full();
    auth_1.renderUserBadge();
}

/* ---------------------------------------------------------------------------
 * Module contract
 *
 * WHY THIS SCREEN BINDS ONCE RATHER THAN PER MOUNT
 * The Phase 1 document specified symmetric bind()/unbind() so repeated visits
 * could not accumulate duplicate handlers. That is the correct rule for a
 * module that CREATES its own DOM. This screen does not: its markup lives in
 * shell.html and is only shown and hidden, so every node init() binds to
 * outlives every mount. Binding once against permanent nodes cannot
 * accumulate, and unbinding would mean re-binding ~30 listeners on every
 * navigation for no benefit. init() is therefore guarded and runs on first
 * mount only.
 * If a future change has this module build its own DOM, that reasoning stops
 * holding and symmetric binding becomes necessary again.
 *
 * What DOES have to be symmetric is anything registered OUTSIDE this module -
 * the workspace hooks. Those are deregistered on unmount.
 * -------------------------------------------------------------------------*/
function page() { return document.getElementById("studioPage"); }

function adminWorkflowAccess(documentModel) {
  return documentModel && (documentModel.adminWorkflowAccess ||
    documentModel.adminWorkflowEdit || documentModel.adminWorkflowView);
}

function renderMaintenanceEditMode() {
  var banner = document.getElementById("maintenanceEditBanner");
  if (!banner) return;
  var documentModel = ws_1.getActive() >= 0 ? ws_1.D() : null;
  var access = adminWorkflowAccess(documentModel);
  var readOnly = !!(access && access.mode === "view");
  banner.hidden = !access;
  banner.classList.toggle("readOnly", readOnly);
  banner.textContent = access
    ? (readOnly
      ? "Viewing @" + access.ownerUsername + " · Read-only database version " +
        (access.versionNumber || "—")
      : "Editing @" + access.ownerUsername + " · Save creates database version " +
        ((Number(access.versionNumber) || 0) + 1))
    : "";
}

function applyMaintenanceAccessMode() {
  var studio = page();
  if (!studio) return;
  var documentModel = ws_1.getActive() >= 0 ? ws_1.D() : null;
  var access = adminWorkflowAccess(documentModel);
  var readOnly = !!(access && access.mode === "view");
  studio.classList.toggle("maintenanceReadOnly", readOnly);
  [
    "btnSaveStudio", "btnAll", "btnNew", "btnAdd", "exampleSel", "btnFill",
    "btnEstimate", "fileWf", "btnAddState", "ctAddTrans", "ctDelete",
    "btnTidy", "btnLoadJson"
  ].forEach(function (id) {
    var control = document.getElementById(id);
    if (control) control.disabled = readOnly;
  });
  var save = document.getElementById("btnSaveStudio");
  if (save) {
    save.textContent = readOnly ? "Read-only" : "Save";
    save.title = readOnly ? "View mode cannot save changes." : "";
  }
  studio.querySelectorAll("#editor input,#editor select,#editor textarea,#editor button," +
    "#inspector input,#inspector select,#inspector textarea,#inspector button," +
    ".analysisStepApply,[data-tool]").forEach(function (control) {
      control.disabled = readOnly;
    });
}

/* The change hook. This is full() WITHOUT its trailing persist(): workspace
 * owns persistence now and calls persist() itself inside commit(). Leaving the
 * call here would persist twice per commit. */
function renderAll() {
  renderMaintenanceEditMode();
  renderWfBar();
  if (ws_1.getActive() === -1) {
    renderSigma(); syncToolButtons(); applyMaintenanceAccessMode(); return;
  }
  renderCanvas(); renderTable(); renderInspector();
  syncJson(); renderTools(); syncToolButtons();
  applyMaintenanceAccessMode();
}

exports["default"] = {
  mount: function (outlet, params, ctx) {
    this.ctx = ctx;
    CTX = ctx;
    /* Maintenance can load a user's workflow before Analysis has ever been
     * mounted. init() normally resets the workspace on its first run, so hold
     * that explicit document across initialization. */
    var pendingCandidate = ws_1.getActive() >= 0 ? ws_1.D() : null;
    var pendingAdminDocument = adminWorkflowAccess(pendingCandidate)
      ? pendingCandidate : null;

    /* Let editor.ts reach this screen without requiring it (avoids a cycle). */
    if (ed_1.setAnalysisHooks) ed_1.setAnalysisHooks({
      renderCanvas: renderCanvas,
      renderAll: renderAll,
      showTab: showTab,
      flashTools: flashTools,
      computeTool: computeTool,
      analysisViewDoc: analysisViewDoc
    });

    var el = page();
    if (el) el.classList.add("active");

    if (!initialised) {
      initialised = true;
      init();
      if (pendingAdminDocument) {
        ws_1.setDocs([pendingAdminDocument]);
        ws_1.setActive(0);
        ws_1.setSel(null);
        ws_1.setLastTool(-2);
      }
      /* Saving and exploring use the same focused dialogs as the Editor. */
      var save = dom_1.$("btnSaveStudio");
      if (save) save.addEventListener("click", function () {
        if (CTX && CTX.library) CTX.library.openSave({ mode: "analysis" });
      });
      var explore = dom_1.$("btnExploreSavedStudio");
      if (explore) explore.addEventListener("click", function () {
        if (CTX && CTX.library) CTX.library.open({ mode: "analysis" });
      });
    }

    this.offChange = ws_1.onChange(function () { renderAll(); });
    this.offTools  = ws_1.onRecomputeTools(function (a) { computeTool(a.doc, a.tool); });

    /* ---------------------------------------------------------------------
     * PULL THE EDITOR'S CURRENT GRAPH IN
     * Pre-split, loader.js's showPage() did this whenever the Studio was
     * shown:
     *     if (name === 'studio' && window.plumblineRequestEditorSync)
     *         window.plumblineRequestEditorSync({ openAnalysis: true });
     * It is what makes "edit in the Editor, switch to Analysis" work at all.
     * Without it the Studio only ever sees a workflow that was already loaded
     * some other way, and otherwise shows "No workflow loaded".
     *
     * It belongs here rather than in editor.ts's unmount: the user can arrive
     * at Analysis from Home, or by deep link, having never opened the Editor
     * this session - and the editor is pre-loaded, so it always has a graph to
     * give. openAnalysis (not silent) is deliberate: it selects the matching
     * document as active and switches to the analysis tab, which is exactly
     * what the old behaviour did.
     *
     * Ordering matters. It runs AFTER classList.add("active") - setupEditorSync
     * ignores incoming editor data unless #studioPage is visible - and AFTER
     * setAnalysisHooks, because importEditorData renders through those hooks.
     * ------------------------------------------------------------------- */
    /* A superuser workflow opened from Maintenance is already the explicit
     * source of truth. Pulling the iframe here would replace it with whatever
     * the editor happened to show previously. */
    var activeDocument = ws_1.getActive() >= 0 ? ws_1.D() : null;
    if (!adminWorkflowAccess(activeDocument)) {
      try { ed_1.requestEditorSync({ openAnalysis: true }); } catch (e) { }
    }

    renderAll();
  },

  unmount: function () {
    if (this.offChange) { this.offChange(); this.offChange = null; }
    if (this.offTools)  { this.offTools();  this.offTools  = null; }
    var el = page();
    if (el) el.classList.remove("active");
  }
};

/* ---- exports (editor.ts and tests reach these) ---- */
exports.renderAll    = renderAll;
exports.renderCanvas = renderCanvas;
exports.showTab      = showTab;
exports.flashTools   = flashTools;
exports.computeTool  = computeTool;
exports.runAnalysis  = runAnalysis;
exports.runTool      = runTool;

}, {"@plumbline/io":"packages/io/src/index.ts",
   "@plumbline/app":"packages/app/src/index.ts",
   "@plumbline/lemma":"packages/lemma/src/index.ts",
   "@plumbline/core":"packages/core/src/index.ts",
   "./presets":"studio/presets.ts"});

