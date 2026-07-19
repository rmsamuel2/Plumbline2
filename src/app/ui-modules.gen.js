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