__PL.define("packages/io/src/index.ts", function(require,exports,module){
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
exports.runPipeline = exports.fromFsmTable = exports.parseCostModel = exports.parseWorkflow = void 0;
__exportStar(require("./schema"), exports);
var parseWorkflow_1 = require("./parseWorkflow");
Object.defineProperty(exports, "parseWorkflow", { enumerable: true, get: function () { return parseWorkflow_1.parseWorkflow; } });
var parseCostModel_1 = require("./parseCostModel");
Object.defineProperty(exports, "parseCostModel", { enumerable: true, get: function () { return parseCostModel_1.parseCostModel; } });
var fromFsmTable_1 = require("./fromFsmTable");
Object.defineProperty(exports, "fromFsmTable", { enumerable: true, get: function () { return fromFsmTable_1.fromFsmTable; } });
var pipeline_1 = require("./pipeline");
Object.defineProperty(exports, "runPipeline", { enumerable: true, get: function () { return pipeline_1.runPipeline; } });

}, {"./schema":"packages/io/src/schema.ts","./parseWorkflow":"packages/io/src/parseWorkflow.ts","./parseCostModel":"packages/io/src/parseCostModel.ts","./fromFsmTable":"packages/io/src/fromFsmTable.ts","./pipeline":"packages/io/src/pipeline.ts"});
__PL.define("packages/io/src/schema.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isArr = exports.isBool = exports.isNum = exports.isStr = exports.isObj = void 0;
exports.strArray = strArray;
// Tiny, dependency-free runtime type guards for untrusted JSON.
const isObj = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
exports.isObj = isObj;
const isStr = (x) => typeof x === "string";
exports.isStr = isStr;
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
exports.isNum = isNum;
const isBool = (x) => typeof x === "boolean";
exports.isBool = isBool;
const isArr = (x) => Array.isArray(x);
exports.isArr = isArr;
function strArray(x) {
    return Array.isArray(x) ? x.filter((s) => typeof s === "string") : [];
}

}, {});
__PL.define("packages/io/src/parseWorkflow.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWorkflow = parseWorkflow;
const core_1 = require("@plumbline/core");
const schema_1 = require("./schema");
const ROLES = ["step", "quality", "hold", "decision", "rework", "terminal"];
// Parse untrusted JSON into a Workflow. Structural problems come back as a
// list of clear, line-referenced messages; a clean parse also passes the
// Phase 0 validator (errors fold in, warnings are allowed through).
function parseWorkflow(json) {
    const e = [];
    if (!(0, schema_1.isObj)(json))
        return { ok: false, errors: ["top level must be a JSON object"] };
    const id = json["id"];
    const name = json["name"];
    const initial = json["initial"];
    if (!(0, schema_1.isStr)(id))
        e.push("'id' must be a string");
    if (!(0, schema_1.isStr)(name))
        e.push("'name' must be a string");
    if (!(0, schema_1.isStr)(initial))
        e.push("'initial' must be a string");
    const alphaRaw = (0, schema_1.isArr)(json["alphabet"]) ? json["alphabet"] : null;
    if (!alphaRaw)
        e.push("'alphabet' must be an array of strings");
    else
        alphaRaw.forEach((s, i) => { if (!(0, schema_1.isStr)(s))
            e.push("alphabet[" + i + "] must be a string"); });
    const statesRaw = (0, schema_1.isArr)(json["states"]) ? json["states"] : null;
    if (!statesRaw)
        e.push("'states' must be an array");
    const states = [];
    if (statesRaw)
        statesRaw.forEach((s, i) => {
            if (!(0, schema_1.isObj)(s)) {
                e.push("states[" + i + "] must be an object");
                return;
            }
            const sid = s["id"], label = s["label"], role = s["role"];
            if (!(0, schema_1.isStr)(sid))
                e.push("states[" + i + "].id must be a string");
            if (!(0, schema_1.isStr)(label))
                e.push("states[" + i + "].label must be a string");
            const roleOk = (0, schema_1.isStr)(role) && ROLES.includes(role);
            if (!roleOk)
                e.push("states[" + i + "].role must be one of: " + ROLES.join(", "));
            if ((0, schema_1.isStr)(sid) && (0, schema_1.isStr)(label) && roleOk) {
                const st = { id: sid, label, role: role };
                const initF = s["initial"];
                if ((0, schema_1.isBool)(initF))
                    st.initial = initF;
                const accF = s["accept"];
                if ((0, schema_1.isBool)(accF))
                    st.accept = accF;
                const rejF = s["reject"];
                if ((0, schema_1.isBool)(rejF))
                    st.reject = rejF;
                states.push(st);
            }
        });
    const transRaw = (0, schema_1.isArr)(json["transitions"]) ? json["transitions"] : null;
    if (!transRaw)
        e.push("'transitions' must be an array");
    const transitions = [];
    if (transRaw)
        transRaw.forEach((tr, i) => {
            var _a;
            if (!(0, schema_1.isObj)(tr)) {
                e.push("transitions[" + i + "] must be an object");
                return;
            }
            const from = tr["from"];
            const on = (_a = tr["on"]) !== null && _a !== void 0 ? _a : tr["action"];
            const to = tr["to"];
            if (!(0, schema_1.isStr)(from))
                e.push("transitions[" + i + "].from must be a string");
            if (!(0, schema_1.isStr)(on))
                e.push("transitions[" + i + "].on (or action) must be a string");
            if (!(0, schema_1.isStr)(to))
                e.push("transitions[" + i + "].to must be a string");
            if ((0, schema_1.isStr)(from) && (0, schema_1.isStr)(on) && (0, schema_1.isStr)(to)) {
                const t = { from, on, to };
                const g = tr["guard"];
                if ((0, schema_1.isStr)(g))
                    t.guard = g;
                transitions.push(t);
            }
        });
    if (e.length)
        return { ok: false, errors: e };
    const wf = {
        id: id,
        name: name,
        alphabet: alphaRaw,
        states,
        transitions,
        initial: initial,
        accepts: (0, schema_1.strArray)(json["accepts"]),
        rejects: (0, schema_1.strArray)(json["rejects"]),
    };
    const structural = (0, core_1.validate)(wf).filter((x) => x.level === "error");
    if (structural.length)
        return { ok: false, errors: structural.map((x) => x.msg) };
    return { ok: true, value: wf };
}

}, {"@plumbline/core":"packages/core/src/index.ts","./schema":"packages/io/src/schema.ts"});
__PL.define("packages/core/src/index.ts", function(require,exports,module){
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
exports.parallel = exports.golden = exports.loan = exports.analyseRedesign = exports.analyse = exports.runInParallel = exports.findLoops = exports.zoomOut = exports.spotDuplicates = void 0;
__exportStar(require("./ir"), exports);
__exportStar(require("./validate"), exports);
__exportStar(require("./util"), exports);
__exportStar(require("./contract"), exports);
__exportStar(require("./bisim"), exports);
__exportStar(require("./tools/types"), exports);
var spotDuplicates_1 = require("./tools/spotDuplicates");
Object.defineProperty(exports, "spotDuplicates", { enumerable: true, get: function () { return spotDuplicates_1.spotDuplicates; } });
var zoomOut_1 = require("./tools/zoomOut");
Object.defineProperty(exports, "zoomOut", { enumerable: true, get: function () { return zoomOut_1.zoomOut; } });
var findLoops_1 = require("./tools/findLoops");
Object.defineProperty(exports, "findLoops", { enumerable: true, get: function () { return findLoops_1.findLoops; } });
var runInParallel_1 = require("./tools/runInParallel");
Object.defineProperty(exports, "runInParallel", { enumerable: true, get: function () { return runInParallel_1.runInParallel; } });
var analyse_1 = require("./analyse");
Object.defineProperty(exports, "analyse", { enumerable: true, get: function () { return analyse_1.analyse; } });
var redesign_1 = require("./redesign");
Object.defineProperty(exports, "analyseRedesign", { enumerable: true, get: function () { return redesign_1.analyseRedesign; } });
var loan_1 = require("./fixtures/loan");
Object.defineProperty(exports, "loan", { enumerable: true, get: function () { return loan_1.loan; } });
var golden_1 = require("./fixtures/golden");
Object.defineProperty(exports, "golden", { enumerable: true, get: function () { return golden_1.golden; } });
var parallel_1 = require("./fixtures/parallel");
Object.defineProperty(exports, "parallel", { enumerable: true, get: function () { return parallel_1.parallel; } });

}, {"./ir":"packages/core/src/ir.ts","./validate":"packages/core/src/validate.ts","./util":"packages/core/src/util.ts","./contract":"packages/core/src/contract.ts","./bisim":"packages/core/src/bisim.ts","./tools/types":"packages/core/src/tools/types.ts","./tools/spotDuplicates":"packages/core/src/tools/spotDuplicates.ts","./tools/zoomOut":"packages/core/src/tools/zoomOut.ts","./tools/findLoops":"packages/core/src/tools/findLoops.ts","./tools/runInParallel":"packages/core/src/tools/runInParallel.ts","./analyse":"packages/core/src/analyse.ts","./redesign":"packages/core/src/redesign.ts","./fixtures/loan":"packages/core/src/fixtures/loan.ts","./fixtures/golden":"packages/core/src/fixtures/golden.ts","./fixtures/parallel":"packages/core/src/fixtures/parallel.ts"});
__PL.define("packages/core/src/ir.ts", function(require,exports,module){
"use strict";
// The canonical intermediate representation (IR).
// Presentation-free: no coordinates, colours, or layout here.
Object.defineProperty(exports, "__esModule", { value: true });

}, {});
__PL.define("packages/core/src/validate.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
const err = (msg) => ({ level: "error", msg });
const warn = (msg) => ({ level: "warn", msg });
function validate(wf) {
    var _a;
    const issues = [];
    const ids = new Set(wf.states.map((s) => s.id));
    const alpha = new Set(wf.alphabet);
    // 1. referential integrity
    if (!ids.has(wf.initial))
        issues.push(err("initial state not found: " + wf.initial));
    for (const t of wf.transitions) {
        if (!ids.has(t.from))
            issues.push(err("transition from unknown state: " + t.from));
        if (!ids.has(t.to))
            issues.push(err("transition to unknown state: " + t.to));
        if (!alpha.has(t.on))
            issues.push(err("symbol not in alphabet: " + t.on));
    }
    // 2. determinism: at most one target per (from, on)
    const seen = new Set();
    for (const t of wf.transitions) {
        const key = t.from + " --" + t.on + "-->";
        if (seen.has(key))
            issues.push(err("nondeterministic transition: " + key));
        seen.add(key);
    }
    // 3. reachability from the initial state (BFS)
    const adj = new Map();
    for (const t of wf.transitions) {
        const list = adj.get(t.from);
        if (list)
            list.push(t.to);
        else
            adj.set(t.from, [t.to]);
    }
    const reached = new Set([wf.initial]);
    const queue = [wf.initial];
    while (queue.length) {
        const cur = queue.shift();
        for (const n of (_a = adj.get(cur)) !== null && _a !== void 0 ? _a : []) {
            if (!reached.has(n)) {
                reached.add(n);
                queue.push(n);
            }
        }
    }
    for (const s of wf.states) {
        if (!reached.has(s.id))
            issues.push(warn("unreachable state: " + s.id));
    }
    // 4. terminal sanity
    for (const s of wf.states) {
        const hasOut = wf.transitions.some((t) => t.from === s.id);
        if ((s.accept || s.reject) && hasOut)
            issues.push(err("terminal has outgoing edge: " + s.id));
        if (!s.accept && !s.reject && !hasOut)
            issues.push(warn("dead-end (non-terminal, no exit): " + s.id));
    }
    return issues;
}

}, {"./ir":"packages/core/src/ir.ts"});
__PL.define("packages/core/src/util.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tkey = void 0;
exports.deltaMap = deltaMap;
exports.termSig = termSig;
exports.reachable = reachable;
const tkey = (from, on) => from + "::" + on;
exports.tkey = tkey;
// (from::on) -> to, for a deterministic workflow.
function deltaMap(wf) {
    const m = new Map();
    for (const t of wf.transitions)
        m.set(t.from + "::" + t.on, t.to);
    return m;
}
// A state's terminal signature: Accept, Reject, or Normal.
function termSig(wf, id) {
    const s = wf.states.find((x) => x.id === id);
    return (s === null || s === void 0 ? void 0 : s.accept) ? "A" : (s === null || s === void 0 ? void 0 : s.reject) ? "R" : "N";
}
// The set of states reachable from the initial state (BFS).
function reachable(wf) {
    var _a;
    const adj = new Map();
    for (const t of wf.transitions) {
        const l = adj.get(t.from);
        if (l)
            l.push(t.to);
        else
            adj.set(t.from, [t.to]);
    }
    const seen = new Set([wf.initial]);
    const queue = [wf.initial];
    while (queue.length) {
        const cur = queue.shift();
        for (const n of (_a = adj.get(cur)) !== null && _a !== void 0 ? _a : []) {
            if (!seen.has(n)) {
                seen.add(n);
                queue.push(n);
            }
        }
    }
    return seen;
}

}, {"./ir":"packages/core/src/ir.ts"});
__PL.define("packages/core/src/contract.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

}, {"./ir":"packages/core/src/ir.ts"});
__PL.define("packages/core/src/bisim.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classesOf = classesOf;
exports.cliquePairs = cliquePairs;
const util_1 = require("./util");
function relabel(m) {
    const id = new Map();
    let n = 0;
    const out = new Map();
    for (const [k, v] of m) {
        if (!id.has(v))
            id.set(v, "c" + n++);
        out.set(k, id.get(v));
    }
    return out;
}
function canonical(m) {
    return [...m.entries()].sort().map(([k, v]) => k + "=" + v).join(";");
}
// Coarsest bisimulation by partition refinement: two states share a label
// iff they have identical futures.
function classesOf(wf) {
    const d = (0, util_1.deltaMap)(wf);
    let cls = new Map(wf.states.map((s) => [s.id, (0, util_1.termSig)(wf, s.id)]));
    for (;;) {
        const raw = new Map(wf.states.map((s) => {
            var _a;
            const succ = wf.alphabet
                .map((a) => {
                var _a;
                const to = d.get(s.id + "::" + a);
                return a + ":" + (to === undefined ? "_" : (_a = cls.get(to)) !== null && _a !== void 0 ? _a : "?");
            })
                .join(",");
            return [s.id, ((_a = cls.get(s.id)) !== null && _a !== void 0 ? _a : "N") + "||" + succ];
        }));
        const next = relabel(raw);
        if (canonical(next) === canonical(cls))
            return cls;
        cls = next;
    }
}
// All unordered pairs within a group (a full clique), so the relation a
// checker receives is closed under "successors are related".
function cliquePairs(ids) {
    const pairs = [];
    for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
            pairs.push([ids[i], ids[j]]);
    return pairs;
}

}, {"./ir":"packages/core/src/ir.ts","./util":"packages/core/src/util.ts"});
__PL.define("packages/core/src/tools/types.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

}, {"../ir":"packages/core/src/ir.ts","../contract":"packages/core/src/contract.ts"});
__PL.define("packages/core/src/tools/spotDuplicates.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spotDuplicates = void 0;
const util_1 = require("../util");
const bisim_1 = require("../bisim");
const spotDuplicates = (wf) => {
    const out = [];
    const cls = (0, bisim_1.classesOf)(wf);
    const byClass = new Map();
    for (const [id, c] of cls) {
        const arr = byClass.get(c);
        if (arr)
            arr.push(id);
        else
            byClass.set(c, [id]);
    }
    for (const group of byClass.values()) {
        if (group.length < 2)
            continue;
        out.push({
            tool: "spot_duplicates",
            title: "Merge " + group.length + " identical statuses",
            detail: group.join(", ") + " have identical futures.",
            obligation: { kind: "states_equivalent", a: group[0], b: group[1] },
            witness: { kind: "bisimulation", pairs: (0, bisim_1.cliquePairs)(group) },
        });
    }
    const reach = (0, util_1.reachable)(wf);
    for (const s of wf.states) {
        if (!reach.has(s.id))
            out.push({
                tool: "spot_duplicates",
                title: "Delete dead branch: " + s.label,
                detail: s.id + " cannot be reached from the initial state.",
                obligation: { kind: "unreachable", state: s.id },
                witness: { kind: "reach_set", reachable: [...reach] },
            });
    }
    return out;
};
exports.spotDuplicates = spotDuplicates;

}, {"../ir":"packages/core/src/ir.ts","../util":"packages/core/src/util.ts","../bisim":"packages/core/src/bisim.ts","./types":"packages/core/src/tools/types.ts"});
__PL.define("packages/core/src/tools/zoomOut.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zoomOut = void 0;
const ORDER = ["step", "quality", "hold", "decision", "rework", "terminal"];
const zoomOut = (wf) => {
    const blockOf = {};
    for (const s of wf.states)
        blockOf[s.id] = ORDER.indexOf(s.role);
    const blocks = ORDER.map((_, i) => wf.states.filter((s) => blockOf[s.id] === i).map((s) => s.id));
    return [
        {
            tool: "zoom_out",
            title: "Roll up into " + blocks.filter((b) => b.length > 0).length + " stages",
            detail: "Group states by role; valid only if no step escapes its stage.",
            obligation: { kind: "partition_has_sp", blocks },
            witness: { kind: "sp_blocks", blockOf },
        },
    ];
};
exports.zoomOut = zoomOut;

}, {"../ir":"packages/core/src/ir.ts","./types":"packages/core/src/tools/types.ts"});
__PL.define("packages/core/src/tools/findLoops.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findLoops = void 0;
function sccs(wf) {
    const adj = new Map();
    for (const t of wf.transitions) {
        const l = adj.get(t.from);
        if (l)
            l.push(t.to);
        else
            adj.set(t.from, [t.to]);
    }
    let idx = 0;
    const index = new Map();
    const low = new Map();
    const onStk = new Set();
    const stk = [];
    const out = [];
    const strong = (v) => {
        var _a, _b, _c, _d, _e, _f, _g;
        index.set(v, idx);
        low.set(v, idx);
        idx++;
        stk.push(v);
        onStk.add(v);
        for (const w of (_a = adj.get(v)) !== null && _a !== void 0 ? _a : []) {
            if (!index.has(w)) {
                strong(w);
                low.set(v, Math.min((_b = low.get(v)) !== null && _b !== void 0 ? _b : 0, (_c = low.get(w)) !== null && _c !== void 0 ? _c : 0));
            }
            else if (onStk.has(w)) {
                low.set(v, Math.min((_d = low.get(v)) !== null && _d !== void 0 ? _d : 0, (_e = index.get(w)) !== null && _e !== void 0 ? _e : 0));
            }
        }
        if (((_f = low.get(v)) !== null && _f !== void 0 ? _f : 0) === ((_g = index.get(v)) !== null && _g !== void 0 ? _g : 0)) {
            const comp = [];
            for (;;) {
                const w = stk.pop();
                onStk.delete(w);
                comp.push(w);
                if (w === v)
                    break;
            }
            out.push(comp);
        }
    };
    for (const s of wf.states)
        if (!index.has(s.id))
            strong(s.id);
    return out;
}
const findLoops = (wf) => {
    var _a;
    const meta = wf.meta;
    const caps = (_a = meta === null || meta === void 0 ? void 0 : meta.caps) !== null && _a !== void 0 ? _a : {};
    const out = [];
    for (const comp of sccs(wf)) {
        const head = comp[0];
        if (head === undefined)
            continue;
        const selfLoop = wf.transitions.some((t) => t.from === head && t.to === head);
        if (comp.length < 2 && !selfLoop)
            continue;
        const cap = caps[head];
        if (cap !== undefined) {
            const rank = {};
            comp.forEach((id, i) => {
                rank[id] = comp.length - i;
            });
            out.push({
                tool: "find_loops",
                title: "Rework loop capped at " + cap + " passes",
                detail: "States " + comp.join(", ") + " form a bounded loop.",
                obligation: { kind: "loop_terminates", scc: comp, cap },
                witness: { kind: "ranking", rank },
            });
        }
        else {
            out.push({
                tool: "find_loops",
                title: "Unbounded rework loop",
                detail: "States " + comp.join(", ") + " can cycle with no progress measure.",
                obligation: { kind: "loop_terminates", scc: comp, cap: Infinity },
                witness: { kind: "ranking", rank: {} },
            });
        }
    }
    return out;
};
exports.findLoops = findLoops;

}, {"../ir":"packages/core/src/ir.ts","./types":"packages/core/src/tools/types.ts"});
__PL.define("packages/core/src/tools/runInParallel.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInParallel = void 0;
// Conservative: two quality states with no edge between them and a common
// successor are proposed as independent streams. Lemma checks independence.
const runInParallel = (wf) => {
    const q = wf.states.filter((s) => s.role === "quality").map((s) => s.id);
    const succ = (id) => wf.transitions.filter((t) => t.from === id).map((t) => t.to);
    const between = (x, y) => wf.transitions.some((t) => (t.from === x && t.to === y) || (t.from === y && t.to === x));
    for (let i = 0; i < q.length; i++) {
        for (let j = i + 1; j < q.length; j++) {
            const x = q[i];
            const y = q[j];
            if (between(x, y))
                continue;
            const join = succ(x).find((s) => succ(y).includes(s));
            if (join === undefined)
                continue;
            return [
                {
                    tool: "run_in_parallel",
                    title: "Run " + x + " and " + y + " in parallel",
                    detail: x + " and " + y + " are independent and both reach " + join + ".",
                    obligation: { kind: "independent_streams", p: [x], q: [y], join },
                    witness: { kind: "streams", p: [x], q: [y], join },
                },
            ];
        }
    }
    return [];
};
exports.runInParallel = runInParallel;

}, {"../ir":"packages/core/src/ir.ts","./types":"packages/core/src/tools/types.ts"});
__PL.define("packages/core/src/analyse.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyse = analyse;
const spotDuplicates_1 = require("./tools/spotDuplicates");
const zoomOut_1 = require("./tools/zoomOut");
const findLoops_1 = require("./tools/findLoops");
const runInParallel_1 = require("./tools/runInParallel");
const ANALYSERS = [spotDuplicates_1.spotDuplicates, zoomOut_1.zoomOut, findLoops_1.findLoops, runInParallel_1.runInParallel];
function analyse(wf, check) {
    const findings = [];
    for (const run of ANALYSERS) {
        for (const p of run(wf)) {
            const verdict = check(wf, p.obligation, p.witness); // Lemma disposes
            findings.push({
                tool: p.tool,
                title: p.title,
                detail: p.detail,
                verdict,
                provenance: verdict.ok ? "certified" : "refuted",
            });
        }
    }
    return findings;
}

}, {"./ir":"packages/core/src/ir.ts","./contract":"packages/core/src/contract.ts","./tools/spotDuplicates":"packages/core/src/tools/spotDuplicates.ts","./tools/zoomOut":"packages/core/src/tools/zoomOut.ts","./tools/findLoops":"packages/core/src/tools/findLoops.ts","./tools/runInParallel":"packages/core/src/tools/runInParallel.ts"});
__PL.define("packages/core/src/redesign.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyseRedesign = analyseRedesign;
const bisim_1 = require("./bisim");
function prefixed(wf, p) {
    const pid = (id) => p + id;
    return {
        id: p + wf.id,
        name: wf.name,
        alphabet: wf.alphabet.slice(),
        states: wf.states.map((s) => ({ ...s, id: pid(s.id), initial: false })),
        transitions: wf.transitions.map((t) => ({ from: pid(t.from), on: t.on, to: pid(t.to), guard: t.guard })),
        initial: pid(wf.initial),
        accepts: wf.accepts.map(pid),
        rejects: wf.rejects.map(pid),
    };
}
function union(a, b) {
    const A = prefixed(a, "A::");
    const B = prefixed(b, "B::");
    return {
        id: "union",
        name: "union",
        alphabet: [...new Set([...A.alphabet, ...B.alphabet])],
        states: [...A.states, ...B.states],
        transitions: [...A.transitions, ...B.transitions],
        initial: A.initial,
        accepts: [...A.accepts, ...B.accepts],
        rejects: [...A.rejects, ...B.rejects],
    };
}
// Compare two workflows for behavioural equivalence, including decision points.
function analyseRedesign(a, b, check) {
    const u = union(a, b);
    const cls = (0, bisim_1.classesOf)(u);
    const groups = new Map();
    for (const [id, c] of cls) {
        const g = groups.get(c);
        if (g)
            g.push(id);
        else
            groups.set(c, [id]);
    }
    let pairs = [];
    for (const g of groups.values())
        pairs = pairs.concat((0, bisim_1.cliquePairs)(g));
    const ai = "A::" + a.initial;
    const bi = "B::" + b.initial;
    if (!pairs.some(([x, y]) => (x === ai && y === bi) || (x === bi && y === ai)))
        pairs.push([ai, bi]);
    const ob = { kind: "states_equivalent", a: ai, b: bi };
    const verdict = check(u, ob, { kind: "bisimulation", pairs });
    return {
        tool: "check_redesign",
        title: verdict.ok ? "Redesign preserves behaviour" : "Redesign moved a decision",
        detail: "Compare " + a.id + " against " + b.id + " including decision points.",
        verdict,
        provenance: verdict.ok ? "certified" : "refuted",
    };
}

}, {"./ir":"packages/core/src/ir.ts","./contract":"packages/core/src/contract.ts","./bisim":"packages/core/src/bisim.ts"});
__PL.define("packages/core/src/fixtures/loan.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loan = void 0;
// The loan-approval workflow, taken verbatim from the formal FSM definitions
// (M1). It is clean by construction, so validate(loan) returns no issues.
exports.loan = {
    id: "loan",
    name: "Loan approval",
    alphabet: [
        "submit_app", "docs_valid", "docs_invalid", "resubmit_docs",
        "credit_ok", "credit_fail", "risk_pass", "risk_fail",
    ],
    states: [
        { id: "Initial", label: "Apply", role: "step", initial: true },
        { id: "DocCheck", label: "Doc check", role: "step" },
        { id: "Pending", label: "Pending", role: "rework" },
        { id: "CreditReview", label: "Credit", role: "step" },
        { id: "RiskAssess", label: "Risk", role: "decision" },
        { id: "Approved", label: "Approved", role: "terminal", accept: true },
        { id: "Rejected", label: "Rejected", role: "terminal", reject: true },
    ],
    transitions: [
        { from: "Initial", on: "submit_app", to: "DocCheck" },
        { from: "DocCheck", on: "docs_valid", to: "CreditReview" },
        { from: "DocCheck", on: "docs_invalid", to: "Pending", guard: "missing_docs OR incomplete_info" },
        { from: "Pending", on: "resubmit_docs", to: "DocCheck" },
        { from: "CreditReview", on: "credit_ok", to: "RiskAssess", guard: "credit_score >= 650" },
        { from: "CreditReview", on: "credit_fail", to: "Rejected", guard: "credit_score < 650" },
        { from: "RiskAssess", on: "risk_pass", to: "Approved", guard: "ltv <= 0.80 AND dti <= 0.43" },
        { from: "RiskAssess", on: "risk_fail", to: "Rejected", guard: "ltv > 0.80 OR dti > 0.43" },
    ],
    initial: "Initial",
    accepts: ["Approved"],
    rejects: ["Rejected"],
};

}, {"../ir":"packages/core/src/ir.ts"});
__PL.define("packages/core/src/fixtures/golden.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.golden = void 0;
// A workflow built to exhibit findings: a dead FaxIntake, three behaviourally
// identical Review holds, and an uncapped Doc<->Pending loop.
exports.golden = {
    id: "golden",
    name: "Golden test workflow",
    alphabet: [
        "submit", "docs_valid", "docs_invalid", "resubmit", "credit_ok", "credit_fail",
        "route_a", "route_b", "route_c", "proceed", "approve", "reject", "fax",
    ],
    states: [
        { id: "Apply", label: "Apply", role: "step", initial: true },
        { id: "Doc", label: "Doc check", role: "step" },
        { id: "Pending", label: "Pending", role: "rework" },
        { id: "Credit", label: "Credit", role: "step" },
        { id: "Risk", label: "Risk", role: "decision" },
        { id: "ReviewA", label: "Review A", role: "hold" },
        { id: "ReviewB", label: "Review B", role: "hold" },
        { id: "ReviewC", label: "Review C", role: "hold" },
        { id: "Final", label: "Final", role: "decision" },
        { id: "Approved", label: "Approved", role: "terminal", accept: true },
        { id: "Rejected", label: "Rejected", role: "terminal", reject: true },
        { id: "FaxIntake", label: "Fax intake", role: "step" },
    ],
    transitions: [
        { from: "Apply", on: "submit", to: "Doc" },
        { from: "Doc", on: "docs_valid", to: "Credit" },
        { from: "Doc", on: "docs_invalid", to: "Pending" },
        { from: "Pending", on: "resubmit", to: "Doc" },
        { from: "Credit", on: "credit_ok", to: "Risk" },
        { from: "Credit", on: "credit_fail", to: "Rejected" },
        { from: "Risk", on: "route_a", to: "ReviewA" },
        { from: "Risk", on: "route_b", to: "ReviewB" },
        { from: "Risk", on: "route_c", to: "ReviewC" },
        { from: "ReviewA", on: "proceed", to: "Final" },
        { from: "ReviewB", on: "proceed", to: "Final" },
        { from: "ReviewC", on: "proceed", to: "Final" },
        { from: "Final", on: "approve", to: "Approved" },
        { from: "Final", on: "reject", to: "Rejected" },
        { from: "FaxIntake", on: "fax", to: "Doc" },
    ],
    initial: "Apply",
    accepts: ["Approved"],
    rejects: ["Rejected"],
};

}, {"../ir":"packages/core/src/ir.ts"});
__PL.define("packages/core/src/fixtures/parallel.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parallel = void 0;
// Two independent quality checks that fan out and rejoin.
exports.parallel = {
    id: "parallel",
    name: "Two independent checks",
    alphabet: ["begin", "v1", "v2", "d1", "d2", "ok"],
    states: [
        { id: "Start", label: "Start", role: "step", initial: true },
        { id: "Fork", label: "Fork", role: "step" },
        { id: "V1", label: "Check 1", role: "quality" },
        { id: "V2", label: "Check 2", role: "quality" },
        { id: "Join", label: "Join", role: "decision" },
        { id: "Done", label: "Done", role: "terminal", accept: true },
    ],
    transitions: [
        { from: "Start", on: "begin", to: "Fork" },
        { from: "Fork", on: "v1", to: "V1" },
        { from: "Fork", on: "v2", to: "V2" },
        { from: "V1", on: "d1", to: "Join" },
        { from: "V2", on: "d2", to: "Join" },
        { from: "Join", on: "ok", to: "Done" },
    ],
    initial: "Start",
    accepts: ["Done"],
    rejects: [],
};

}, {"../ir":"packages/core/src/ir.ts"});
__PL.define("packages/io/src/parseCostModel.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCostModel = parseCostModel;
const schema_1 = require("./schema");
// Parse untrusted JSON into a CostModel: per-step costs (numbers) and
// per-branch probabilities (numbers in [0,1]).
function parseCostModel(json) {
    const e = [];
    if (!(0, schema_1.isObj)(json))
        return { ok: false, errors: ["cost model must be a JSON object"] };
    const stepCost = {};
    const sc = json["stepCost"];
    if (!(0, schema_1.isObj)(sc))
        e.push("'stepCost' must be an object");
    else
        for (const k of Object.keys(sc)) {
            const v = sc[k];
            if (!(0, schema_1.isNum)(v))
                e.push("stepCost['" + k + "'] must be a number");
            else
                stepCost[k] = v;
        }
    const branchProb = {};
    const bp = json["branchProb"];
    if (!(0, schema_1.isObj)(bp))
        e.push("'branchProb' must be an object");
    else
        for (const k of Object.keys(bp)) {
            const v = bp[k];
            if (!(0, schema_1.isNum)(v) || v < 0 || v > 1)
                e.push("branchProb['" + k + "'] must be a number in [0,1]");
            else
                branchProb[k] = v;
        }
    if (e.length)
        return { ok: false, errors: e };
    return { ok: true, value: { stepCost, branchProb } };
}

}, {"@plumbline/cost":"packages/cost/src/index.ts","./schema":"packages/io/src/schema.ts"});
__PL.define("packages/cost/src/index.ts", function(require,exports,module){
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
exports.goldenCost = exports.renderLedger = exports.whatIf = exports.expectedCost = exports.expectedVisits = exports.solveLinear = void 0;
__exportStar(require("./types"), exports);
var solve_1 = require("./solve");
Object.defineProperty(exports, "solveLinear", { enumerable: true, get: function () { return solve_1.solveLinear; } });
var chain_1 = require("./chain");
Object.defineProperty(exports, "expectedVisits", { enumerable: true, get: function () { return chain_1.expectedVisits; } });
var expectedCost_1 = require("./expectedCost");
Object.defineProperty(exports, "expectedCost", { enumerable: true, get: function () { return expectedCost_1.expectedCost; } });
Object.defineProperty(exports, "whatIf", { enumerable: true, get: function () { return expectedCost_1.whatIf; } });
var report_1 = require("./report");
Object.defineProperty(exports, "renderLedger", { enumerable: true, get: function () { return report_1.renderLedger; } });
var goldenCost_1 = require("./fixtures/goldenCost");
Object.defineProperty(exports, "goldenCost", { enumerable: true, get: function () { return goldenCost_1.goldenCost; } });

}, {"./types":"packages/cost/src/types.ts","./solve":"packages/cost/src/solve.ts","./chain":"packages/cost/src/chain.ts","./expectedCost":"packages/cost/src/expectedCost.ts","./report":"packages/cost/src/report.ts","./fixtures/goldenCost":"packages/cost/src/fixtures/goldenCost.ts"});
__PL.define("packages/cost/src/types.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

}, {"@plumbline/core":"packages/core/src/index.ts"});
__PL.define("packages/cost/src/solve.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.solveLinear = solveLinear;
// Solve A x = b by Gaussian elimination with partial pivoting.
// Returns null if the system is singular (e.g. an uncapped loop).
function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(M[r][col]) > Math.abs(M[piv][col]))
                piv = r;
        }
        const pivRow = M[piv];
        if (Math.abs(pivRow[col]) < 1e-12)
            return null;
        M[piv] = M[col];
        M[col] = pivRow;
        const cur = M[col];
        const pv = cur[col];
        for (let j = col; j <= n; j++)
            cur[j] = cur[j] / pv;
        for (let r = 0; r < n; r++) {
            if (r === col)
                continue;
            const row = M[r];
            const f = row[col];
            if (f === 0)
                continue;
            for (let j = col; j <= n; j++)
                row[j] = row[j] - f * cur[j];
        }
    }
    return M.map((row) => row[n]);
}

}, {});
__PL.define("packages/cost/src/chain.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectedVisits = expectedVisits;
const solve_1 = require("./solve");
// Treat the workflow as an absorbing Markov chain (terminals absorb). The
// expected-visit vector v solves v = e0 + vQ, i.e. (I - Q)^T v = e0. Solving
// it (rather than summing paths) is what makes rework loops come out right.
function expectedVisits(wf, model) {
    var _a;
    const isTerminal = (id) => wf.states.some((s) => s.id === id && (s.accept || s.reject));
    const transient = wf.states.filter((s) => !isTerminal(s.id)).map((s) => s.id);
    const idx = new Map(transient.map((id, i) => [id, i]));
    const n = transient.length;
    const Q = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const t of wf.transitions) {
        const i = idx.get(t.from);
        const j = idx.get(t.to);
        if (i === undefined || j === undefined)
            continue; // edges to terminals leak out of Q
        const p = (_a = model.branchProb[t.from + "::" + t.on]) !== null && _a !== void 0 ? _a : 0;
        Q[i][j] = Q[i][j] + p;
    }
    // A = (I - Q)^T  so that A v = e0
    const A = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r === c ? 1 : 0) - Q[c][r]));
    const b = new Array(n).fill(0);
    const start = idx.get(wf.initial);
    if (start !== undefined)
        b[start] = 1;
    const sol = (0, solve_1.solveLinear)(A, b);
    if (!sol)
        return { converged: false, visits: {} };
    const visits = {};
    transient.forEach((id, i) => {
        visits[id] = sol[i];
    });
    return { converged: true, visits };
}

}, {"@plumbline/core":"packages/core/src/index.ts","./types":"packages/cost/src/types.ts","./solve":"packages/cost/src/solve.ts"});
__PL.define("packages/cost/src/expectedCost.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectedCost = expectedCost;
exports.whatIf = whatIf;
const chain_1 = require("./chain");
const round = (x) => Math.round(x * 100) / 100;
const ASSUMPTIONS = [
    "Branch probabilities and per-step costs are illustrative inputs, not measured from a client system.",
    "Only the cost of moving between steps is modelled; savings inside a step are out of scope.",
];
function expectedCost(wf, model) {
    const { converged, visits } = (0, chain_1.expectedVisits)(wf, model);
    if (!converged) {
        return {
            provenance: "illustrative",
            converged: false,
            perState: [],
            total: 0,
            assumptions: ASSUMPTIONS,
            notes: ["An uncapped loop makes the expected cost diverge — cap it (see find_loops) before costing."],
        };
    }
    const perState = wf.states
        .map((s) => {
        var _a, _b;
        const v = (_a = visits[s.id]) !== null && _a !== void 0 ? _a : 0;
        const c = (_b = model.stepCost[s.id]) !== null && _b !== void 0 ? _b : 0;
        return { id: s.id, expectedVisits: round(v), expectedCost: round(v * c) };
    })
        .filter((x) => x.expectedCost !== 0)
        .sort((a, b) => b.expectedCost - a.expectedCost);
    const total = round(perState.reduce((sum, x) => sum + x.expectedCost, 0));
    return { provenance: "illustrative", converged: true, perState, total, assumptions: ASSUMPTIONS, notes: [] };
}
// Recost under an override (e.g. a lower deviation rate) and report the delta.
function whatIf(wf, base, override) {
    var _a, _b;
    const merged = {
        stepCost: { ...base.stepCost, ...((_a = override.stepCost) !== null && _a !== void 0 ? _a : {}) },
        branchProb: { ...base.branchProb, ...((_b = override.branchProb) !== null && _b !== void 0 ? _b : {}) },
    };
    const before = expectedCost(wf, base);
    const after = expectedCost(wf, merged);
    return { before, after, deltaTotal: round(before.total - after.total) };
}

}, {"@plumbline/core":"packages/core/src/index.ts","./types":"packages/cost/src/types.ts","./chain":"packages/cost/src/chain.ts"});
__PL.define("packages/cost/src/report.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderLedger = renderLedger;
// The "Where it saves" ledger, in Markdown, always carrying its label.
function renderLedger(r) {
    const lines = [];
    lines.push("## Where it saves — illustrative (not certified)");
    if (!r.converged) {
        lines.push("", "Expected cost diverges: " + r.notes.join(" "));
        return lines.join("\n");
    }
    lines.push("", "| Step | Expected visits | Expected cost |", "| --- | ---: | ---: |");
    for (const s of r.perState)
        lines.push("| " + s.id + " | " + s.expectedVisits + " | $" + s.expectedCost + " |");
    lines.push("| **Total** | | **$" + r.total + "** |");
    lines.push("", "_Assumptions:_ " + r.assumptions.join(" "));
    return lines.join("\n");
}

}, {"./types":"packages/cost/src/types.ts"});
__PL.define("packages/cost/src/fixtures/goldenCost.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goldenCost = void 0;
// An illustrative cost overlay for the golden workflow. The Doc<->Pending loop
// leaks 0.8 each pass, so it converges; set docs_valid to 0 to see it diverge.
exports.goldenCost = {
    stepCost: {
        Apply: 5, Doc: 50, Pending: 200, Credit: 80, Risk: 30,
        ReviewA: 40, ReviewB: 40, ReviewC: 40, Final: 20,
    },
    branchProb: {
        "Apply::submit": 1,
        "Doc::docs_valid": 0.8,
        "Doc::docs_invalid": 0.2,
        "Pending::resubmit": 1,
        "Credit::credit_ok": 0.9,
        "Credit::credit_fail": 0.1,
        "Risk::route_a": 0.34,
        "Risk::route_b": 0.33,
        "Risk::route_c": 0.33,
        "ReviewA::proceed": 1,
        "ReviewB::proceed": 1,
        "ReviewC::proceed": 1,
        "Final::approve": 0.7,
        "Final::reject": 0.3,
    },
};

}, {"../types":"packages/cost/src/types.ts"});
__PL.define("packages/io/src/fromFsmTable.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromFsmTable = fromFsmTable;
const schema_1 = require("./schema");
const parseWorkflow_1 = require("./parseWorkflow");
// Accept the formal FSM-table shape — states as a list, a delta table using
// "action" (or "on"), and accept/reject sets — and convert it to the IR
// before parsing. This lets the engine ingest the project's formal definitions.
function fromFsmTable(json) {
    if (!(0, schema_1.isObj)(json))
        return { ok: false, errors: ["FSM table must be a JSON object"] };
    const accept = (0, schema_1.strArray)(json["accept"]);
    const reject = (0, schema_1.strArray)(json["reject"]);
    const term = new Set([...accept, ...reject]);
    const initial = (0, schema_1.isStr)(json["initial"]) ? json["initial"] : "";
    const statesRaw = (0, schema_1.isArr)(json["states"]) ? json["states"] : [];
    const states = statesRaw.map((s) => {
        const idVal = (0, schema_1.isObj)(s) ? s["id"] : s;
        const sid = (0, schema_1.isStr)(idVal) ? idVal : String(idVal);
        const labelVal = (0, schema_1.isObj)(s) ? s["label"] : undefined;
        const label = (0, schema_1.isStr)(labelVal) ? labelVal : sid;
        const st = { id: sid, label, role: term.has(sid) ? "terminal" : "step" };
        if (sid === initial)
            st["initial"] = true;
        if (accept.includes(sid))
            st["accept"] = true;
        if (reject.includes(sid))
            st["reject"] = true;
        return st;
    });
    const deltaRaw = (0, schema_1.isArr)(json["delta"]) ? json["delta"]
        : (0, schema_1.isArr)(json["transitions"]) ? json["transitions"] : [];
    const transitions = deltaRaw.map((d) => {
        var _a;
        if (!(0, schema_1.isObj)(d))
            return {};
        return { from: d["from"], on: (_a = d["on"]) !== null && _a !== void 0 ? _a : d["action"], to: d["to"] };
    });
    const ir = {
        id: (0, schema_1.isStr)(json["id"]) ? json["id"] : "fsm",
        name: (0, schema_1.isStr)(json["name"]) ? json["name"] : "FSM",
        alphabet: (0, schema_1.isArr)(json["alphabet"]) ? json["alphabet"] : [],
        states,
        transitions,
        initial,
        accepts: accept,
        rejects: reject,
    };
    return (0, parseWorkflow_1.parseWorkflow)(ir);
}

}, {"@plumbline/core":"packages/core/src/index.ts","./schema":"packages/io/src/schema.ts","./parseWorkflow":"packages/io/src/parseWorkflow.ts"});
__PL.define("packages/io/src/pipeline.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPipeline = runPipeline;
const core_1 = require("@plumbline/core");
const cost_1 = require("@plumbline/cost");
// The whole engine on a supplied workflow: validate (Phase 0), analyse and
// certify (Phase 1), then cost (Phase 2). The checker is injected, so io never
// depends on the trusted kernel.
function runPipeline(wf, model, check) {
    return {
        workflow: wf.name,
        validation: (0, core_1.validate)(wf),
        findings: (0, core_1.analyse)(wf, check),
        cost: (0, cost_1.expectedCost)(wf, model),
    };
}

}, {"@plumbline/core":"packages/core/src/index.ts","@plumbline/cost":"packages/cost/src/index.ts"});
__PL.define("packages/lemma/src/index.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = exports.check = void 0;
var check_1 = require("./check");
Object.defineProperty(exports, "check", { enumerable: true, get: function () { return check_1.check; } });
Object.defineProperty(exports, "VERSION", { enumerable: true, get: function () { return check_1.VERSION; } });

}, {"./check":"packages/lemma/src/check.ts"});
__PL.define("packages/lemma/src/check.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERSION = void 0;
exports.check = check;
const core_1 = require("@plumbline/core");
const hash_1 = require("./hash");
exports.VERSION = "lemma-ref@0.1.0";
const pk = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
function certify(ob, w) {
    return { ok: true, certificate: { obligation: ob, checkedBy: exports.VERSION, witnessHash: (0, hash_1.hash)(w) } };
}
function refute(ob, trace, detail) {
    return { ok: false, counterexample: { obligation: ob, trace, detail } };
}
// Lemma re-verifies a supplied witness. Checking is cheap and conservative;
// finding the witness was the analyser's (untrusted) job.
function check(wf, ob, w) {
    switch (ob.kind) {
        case "states_equivalent": return checkBisim(wf, w, ob, ob.a, ob.b);
        case "unreachable": return checkReach(wf, w, ob);
        case "partition_has_sp": return checkSP(wf, w, ob);
        case "independent_streams": return checkIndependent(wf, w, ob);
        case "loop_terminates": return checkRanking(wf, w, ob);
        default: {
            const _exhaustive = ob;
            return refute(_exhaustive, [], "unknown obligation");
        }
    }
}
function checkBisim(wf, w, ob, a, b) {
    if (w.kind !== "bisimulation")
        return refute(ob, [], "expected a bisimulation witness");
    const rel = new Set(w.pairs.map(([x, y]) => pk(x, y)));
    const related = (x, y) => x === y || rel.has(pk(x, y));
    if (!related(a, b))
        return refute(ob, [], "witness omits the claimed pair " + a + ", " + b);
    const d = (0, core_1.deltaMap)(wf);
    for (const [x, y] of w.pairs) {
        if ((0, core_1.termSig)(wf, x) !== (0, core_1.termSig)(wf, y))
            return refute(ob, [], "terminal status differs: " + x + " vs " + y);
        for (const s of wf.alphabet) {
            const tx = d.get(x + "::" + s);
            const ty = d.get(y + "::" + s);
            if ((tx === undefined) !== (ty === undefined))
                return refute(ob, [s], "only one of " + x + ", " + y + " moves on " + s);
            if (tx !== undefined && ty !== undefined && !related(tx, ty))
                return refute(ob, [s], "successors unrelated after " + s);
        }
    }
    return certify(ob, w);
}
function checkReach(wf, w, ob) {
    if (w.kind !== "reach_set")
        return refute(ob, [], "expected a reach_set witness");
    if (ob.kind !== "unreachable")
        return refute(ob, [], "wrong obligation");
    const truth = (0, core_1.reachable)(wf);
    const claimed = new Set(w.reachable);
    for (const s of truth)
        if (!claimed.has(s))
            return refute(ob, [], "witness misses reachable " + s);
    if (claimed.has(ob.state))
        return refute(ob, [], ob.state + " is actually reachable");
    return certify(ob, w);
}
function checkSP(wf, w, ob) {
    if (w.kind !== "sp_blocks")
        return refute(ob, [], "expected an sp_blocks witness");
    const blk = w.blockOf;
    const d = (0, core_1.deltaMap)(wf);
    for (const t of wf.transitions) {
        const fromBlk = blk[t.from];
        for (const u of wf.states) {
            if (blk[u.id] !== fromBlk)
                continue;
            const tu = d.get(u.id + "::" + t.on);
            if (tu === undefined)
                continue;
            if (blk[tu] !== blk[t.to])
                return refute(ob, [t.on], "stage escapes on " + t.on);
        }
    }
    return certify(ob, w);
}
function checkIndependent(wf, w, ob) {
    if (w.kind !== "streams")
        return refute(ob, [], "expected a streams witness");
    if (ob.kind !== "independent_streams")
        return refute(ob, [], "wrong obligation");
    const P = new Set(w.p);
    const Q = new Set(w.q);
    for (const x of w.p)
        if (Q.has(x))
            return refute(ob, [], "streams overlap at " + x);
    for (const t of wf.transitions) {
        if (P.has(t.from) && Q.has(t.to))
            return refute(ob, [t.on], "dependency " + t.from + " -> " + t.to);
        if (Q.has(t.from) && P.has(t.to))
            return refute(ob, [t.on], "dependency " + t.from + " -> " + t.to);
    }
    const into = (set) => [...set].every((s) => wf.transitions.some((t) => t.from === s && t.to === ob.join));
    if (!into(P) || !into(Q))
        return refute(ob, [], "a stream does not reach the join " + ob.join);
    return certify(ob, w);
}
function checkRanking(wf, w, ob) {
    if (w.kind !== "ranking")
        return refute(ob, [], "expected a ranking witness");
    if (ob.kind !== "loop_terminates")
        return refute(ob, [], "wrong obligation");
    const r = w.rank;
    const inScc = new Set(ob.scc);
    for (const t of wf.transitions) {
        if (!inScc.has(t.from) || !inScc.has(t.to))
            continue;
        const rf = r[t.from];
        const rt = r[t.to];
        if (rf === undefined || rt === undefined || !(rt < rf))
            return refute(ob, [t.on], "rank does not decrease on " + t.on);
    }
    return certify(ob, w);
}

}, {"@plumbline/core":"packages/core/src/index.ts","./hash":"packages/lemma/src/hash.ts"});
__PL.define("packages/lemma/src/hash.ts", function(require,exports,module){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hash = hash;
// A small, deterministic hash so a certificate can be re-verified independently.
function hash(x) {
    const s = JSON.stringify(x);
    let h = 5381;
    for (let i = 0; i < s.length; i++)
        h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16);
}

}, {});