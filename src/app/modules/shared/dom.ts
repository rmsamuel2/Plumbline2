/* ============================================================================
 * studio/shared/dom.ts — DOM and formatting helpers
 * ----------------------------------------------------------------------------
 * Phase 1, step 1. Every declaration below was MOVED VERBATIM from
 * studio/main.ts (ui-modules.gen.js at commit 462ebb7). The original line
 * range is noted above each one. No logic was changed.
 *
 * This module requires no other studio module: it is the bottom of the
 * dependency graph. Do not add a require() here.
 * ==========================================================================*/
__PL.define("studio/shared/dom.ts", function (require, exports, module) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });


/* main.ts:18-18 */
const fmt = (n) => "$" + Math.round(n).toLocaleString();

/* main.ts:19-19 */
const fmin = (n) => Math.round(n) + " min";

/* main.ts:30-30 */
function $(id) { return document.getElementById(id); }

/* main.ts:31-41 */
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

/* main.ts:42-44 */
function el(t, a = {}, ...k) { const n = document.createElement(t); for (const x in a)
    n.setAttribute(x, a[x]); for (const c of k)
    n.append(typeof c === "string" ? document.createTextNode(c) : c); return n; }

/* main.ts:45-46 */
function svg(t, a = {}) { const n = document.createElementNS("http://www.w3.org/2000/svg", t); for (const x in a)
    n.setAttribute(x, a[x]); return n; }

/* main.ts:47-47 */
function clone(x) { return JSON.parse(JSON.stringify(x)); }

/* main.ts:51-52 */
function labelHash(s) { let h = 0; for (let i = 0; i < s.length; i++)
    h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

/* main.ts:600-601 */
function hexToRgba(hex, alpha) { const raw = String(hex || "").replace("#", ""); const full = raw.length === 3 ? raw.split("").map(x => x + x).join("") : raw; const n = parseInt(full, 16); if (!Number.isFinite(n))
    return `rgba(31,122,111,${alpha})`; return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`; }

/* main.ts:1270-1270 */
function btn(t, on, cls = "btn ghost") { const b = el("button", { class: cls }, t); b.addEventListener("click", on); return b; }

/* main.ts:1269-1269 */
function head(c) { const tr = el("tr"); c.forEach(x => tr.append(el("th", {}, x))); return tr; }

/* main.ts:1300-1300 */
function td(c) { return el("td", {}, c); }

/* main.ts:1301-1301 */
function inp(v, on) { const i = el("input", { value: v }); i.addEventListener("input", () => on(i.value)); return i; }

/* main.ts:1302-1302 */
function num(v, on) { const i = el("input", { type: "number", value: String(v) }); i.addEventListener("input", () => on(+i.value || 0)); return i; }

/* main.ts:1303-1303 */
function rad(on, cb) { const i = el("input", { type: "radio", name: "start" }); i.checked = on; i.addEventListener("change", cb); return i; }

/* main.ts:1304-1304 */
function chk(on, cb) { const i = el("input", { type: "checkbox" }); i.checked = on; i.addEventListener("change", () => cb(i.checked)); return i; }

/* main.ts:1089-1089 */
function fieldNum(l, v, on) { const i = el("input", { type: "number", value: String(v) }); i.addEventListener("input", () => on(+i.value || 0)); return el("label", { class: "fld" }, el("span", {}, l), i); }


/* ---- exports ---- */
exports["fmt"] = fmt;
exports["fmin"] = fmin;
exports["$"] = $;
exports["flash"] = flash;
exports["el"] = el;
exports["svg"] = svg;
exports["clone"] = clone;
exports["labelHash"] = labelHash;
exports["hexToRgba"] = hexToRgba;
exports["btn"] = btn;
exports["head"] = head;
exports["td"] = td;
exports["inp"] = inp;
exports["num"] = num;
exports["rad"] = rad;
exports["chk"] = chk;
exports["fieldNum"] = fieldNum;

});
