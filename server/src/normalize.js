// Snapshot → normalized FSM content (migration 002 tables).
//
// Every workflow_version keeps the byte-exact snapshot in its jsonb column —
// that is the round-trip source of truth for the UI. THIS module additionally
// decomposes the snapshot into the relational FSM tables so the database can
// query, join, constrain, and roll up the content:
//
//     process · stage · custom_state_type · state · transition ·
//     state_dependency · cost_item
//
// Two snapshot dialects are understood:
//   1. The Workflow Editor model (snapshot.meta.editorData) — already shaped
//      like the schema: { process, stages, custom_state_types, states
//      (with depends_on), transitions, costs }.
//   2. The bare Analysis Studio graph (snapshot.workflow) — { states:[{id,
//      label, role, initial, accept, reject}], transitions:[{from,to,on}] }
//      plus snapshot.cost.stepCost and snapshot.time.stepMinutes. It becomes
//      a single-stage process.
//
// The 002 triggers stay in charge: stage/process consistency, state_type
// validity, dependency cycles, cost target shape. This module pre-sanitises
// (key charset, min/max ordering, unknown references) so a well-formed editor
// snapshot never trips a trigger; dependency edges are inserted under a
// savepoint each, so one bad edge cannot sink the version.
"use strict";

const KEY_RE = /[^A-Za-z0-9_-]+/g;
const BUILT_IN = new Set(["START", "NORMAL", "WARNING", "ERROR", "FINAL"]);

function safeKey(raw, fallback) {
  const k = String(raw == null ? "" : raw).replace(KEY_RE, "_").replace(/^_+|_+$/g, "");
  return k || fallback;
}
function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function nonneg(v, def) {
  const n = num(v, def);
  return n == null ? null : Math.max(0, n);
}
function txt(v) { return v == null ? null : String(v); }

/** Extract a canonical intermediate model from either snapshot dialect. */
function extract(snapshot) {
  const snap = snapshot || {};
  const ed = snap.meta && snap.meta.editorData;

  if (ed && Array.isArray(ed.states) && ed.process) {
    // ---- dialect 1: the editor's own model --------------------------------
    const p = ed.process || {};
    return {
      process: {
        process_key: safeKey(p.process_key, "process"),
        name: txt(p.name) || "Process",
        description: txt(p.description),
        process_domain: txt(p.process_domain),
        owner_team: txt(p.owner_team),
        naming_convention: txt(p.naming_convention),
        default_currency: txt(p.default_currency) || "USD",
        is_custom_process: !!p.is_custom_process,
        infinite_canvas: !!p.infinite_canvas,
        ext: {}
      },
      stages: (Array.isArray(ed.stages) ? ed.stages : []).map((s, i) => ({
        stage_key: safeKey(s.stage_key, "stage_" + (i + 1)),
        name: txt(s.name) || "Stage " + (i + 1),
        stage_order: Math.max(1, Math.round(num(s.stage_order, i + 1))),
        owner_role: txt(s.owner_role),
        description: txt(s.description),
        visual_color: txt(s.visual_color),
        manual_x: num(s.manual_x, null),
        manual_y: num(s.manual_y, null)
      })),
      customTypes: (Array.isArray(ed.custom_state_types) ? ed.custom_state_types : [])
        .map((t, i) => ({
          type_key: safeKey(t.type_key, "custom_" + (i + 1)),
          label: txt(t.label) || "Custom " + (i + 1),
          fill_color: txt(t.fill_color) || "#eef2ff",
          stroke_color: txt(t.stroke_color) || "#4f46e5",
          description: txt(t.description)
        })),
      states: (Array.isArray(ed.states) ? ed.states : []).map((s, i) => ({
        state_key: safeKey(s.state_key, "S" + (i + 1)),
        stage_key: safeKey(s.stage_key, ""),
        name: txt(s.name) || safeKey(s.state_key, "S" + (i + 1)),
        sort_order: Math.max(1, Math.round(num(s.sort_order, (i + 1) * 10))),
        state_type: txt(s.state_type) || "NORMAL",
        entry_action: txt(s.entry_action),
        exit_action: txt(s.exit_action),
        description: txt(s.description),
        owner_role: txt(s.owner_role),
        expected_duration_minutes: nonneg(s.expected_duration_minutes, null),
        sla_minutes: nonneg(s.sla_minutes, null),
        manual_x: num(s.manual_x, null),
        manual_y: num(s.manual_y, null),
        depends_on: Array.isArray(s.depends_on) ? s.depends_on.map(k => safeKey(k, "")) : [],
        ext: {}
      })),
      transitions: (Array.isArray(ed.transitions) ? ed.transitions : []).map((t, i) => ({
        transition_key: safeKey(t.transition_key, "T" + (i + 1)),
        event_name: txt(t.event_name) || "event",
        from_state_key: safeKey(t.from_state_key, ""),
        to_state_key: safeKey(t.to_state_key, ""),
        guard_condition: txt(t.guard_condition),
        action: txt(t.action),
        description: txt(t.description),
        sort_order: Math.max(1, Math.round(num(t.sort_order, (i + 1) * 10))),
        ext: {}
      })),
      costs: (Array.isArray(ed.costs) ? ed.costs : []).map(c => ({
        applies_to: c.applies_to === "TRANSITION" ? "TRANSITION" : "STATE",
        state_key: c.state_key ? safeKey(c.state_key, "") : null,
        transition_key: c.transition_key ? safeKey(c.transition_key, "") : null,
        cost_category: txt(c.cost_category) || "Cost",
        unit_name: txt(c.unit_name) || "occurrence",
        unit_cost_min: nonneg(c.unit_cost_min, 0),
        unit_cost_max: nonneg(c.unit_cost_max, 0),
        source_name: txt(c.source_name),
        cost_kind: txt(c.cost_kind) || "COST"
      }))
    };
  }

  // ---- dialect 2: bare studio graph ---------------------------------------
  const wf = snap.workflow || {};
  const states = Array.isArray(wf.states) ? wf.states : [];
  const transitions = Array.isArray(wf.transitions) ? wf.transitions : [];
  const stepCost = (snap.cost && snap.cost.stepCost) || {};
  const stepMin = (snap.time && snap.time.stepMinutes) || {};
  const pkey = safeKey(wf.id || wf.name, "process");
  return {
    process: {
      process_key: pkey, name: txt(wf.name) || "Workflow",
      description: null, process_domain: null, owner_team: null,
      naming_convention: null, default_currency: "USD",
      is_custom_process: true, infinite_canvas: false, ext: {}
    },
    stages: [{ stage_key: "flow", name: "Flow", stage_order: 1,
               owner_role: null, description: null, visual_color: null,
               manual_x: null, manual_y: null }],
    customTypes: [],
    states: states.map((s, i) => ({
      state_key: safeKey(s.id, "S" + (i + 1)),
      stage_key: "flow",
      name: txt(s.label) || safeKey(s.id, "S" + (i + 1)),
      sort_order: (i + 1) * 10,
      state_type: s.initial ? "START" : (s.accept || s.reject ? "FINAL" : "NORMAL"),
      entry_action: null, exit_action: null,
      description: txt(s.role), owner_role: null,
      expected_duration_minutes: nonneg(stepMin[s.id], null),
      sla_minutes: null, manual_x: null, manual_y: null,
      depends_on: [], ext: {}
    })),
    transitions: transitions.map((t, i) => ({
      transition_key: "T" + (i + 1),
      event_name: txt(t.on) || "event",
      from_state_key: safeKey(t.from, ""),
      to_state_key: safeKey(t.to, ""),
      guard_condition: null, action: null, description: null,
      sort_order: (i + 1) * 10, ext: {}
    })),
    costs: states
      .filter(s => Number.isFinite(Number(stepCost[s.id])))
      .map(s => ({
        applies_to: "STATE", state_key: safeKey(s.id, ""),
        transition_key: null, cost_category: "Step cost",
        unit_name: "occurrence",
        unit_cost_min: nonneg(stepCost[s.id], 0),
        unit_cost_max: nonneg(stepCost[s.id], 0),
        source_name: "Analysis Studio estimate", cost_kind: "COST"
      }))
  };
}

/**
 * Persist the normalized content of one workflow_version.
 * Runs on a db.tx() client — call inside the same transaction that created
 * the version row. Returns counts for the caller's audit/response.
 */
async function persistVersionContent({ q, o, client }, versionId, snapshot) {
  const m = extract(snapshot);

  // --- process (one per version; version is new, so plain insert) ----------
  const proc = await o(
    "insert into process (version_id, process_key, name, description, " +
    " process_domain, owner_team, naming_convention, default_currency, " +
    " is_custom_process, infinite_canvas, ext) " +
    "values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning process_id",
    [versionId, m.process.process_key, m.process.name, m.process.description,
     m.process.process_domain, m.process.owner_team, m.process.naming_convention,
     m.process.default_currency, m.process.is_custom_process,
     m.process.infinite_canvas, JSON.stringify(m.process.ext)]);
  const pid = proc.process_id;

  // --- stages ---------------------------------------------------------------
  const stageIds = {};                       // stage_key -> stage_id
  if (!m.stages.length)
    m.stages.push({ stage_key: "flow", name: "Flow", stage_order: 1,
                    owner_role: null, description: null, visual_color: null,
                    manual_x: null, manual_y: null });
  const seenStage = new Set(); let ord = 0;
  for (const s of m.stages) {
    if (seenStage.has(s.stage_key)) continue;
    seenStage.add(s.stage_key);
    ord = Math.max(ord + 1, s.stage_order);
    const row = await o(
      "insert into stage (process_id, stage_key, name, stage_order, owner_role, " +
      " description, visual_color, manual_x, manual_y) " +
      "values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning stage_id",
      [pid, s.stage_key, s.name, ord, s.owner_role, s.description,
       s.visual_color, s.manual_x, s.manual_y]);
    stageIds[s.stage_key] = row.stage_id;
  }
  const defaultStageKey = m.stages[0].stage_key;

  // --- custom state types ----------------------------------------------------
  const customKeys = new Set();
  for (const t of m.customTypes) {
    if (customKeys.has(t.type_key)) continue;
    customKeys.add(t.type_key);
    await q("insert into custom_state_type (process_id, type_key, label, " +
            " fill_color, stroke_color, description) values ($1,$2,$3,$4,$5,$6)",
      [pid, t.type_key, t.label, t.fill_color, t.stroke_color, t.description]);
  }

  // --- states -----------------------------------------------------------------
  const stateIds = {};                       // state_key -> state_id
  const seenState = new Set();
  for (const s of m.states) {
    if (seenState.has(s.state_key)) continue;
    seenState.add(s.state_key);
    let stype = s.state_type;
    if (!BUILT_IN.has(String(stype).toUpperCase()) && !customKeys.has(stype))
      stype = "NORMAL";                       // unknown type → safe built-in
    const sid = stageIds[s.stage_key] || stageIds[defaultStageKey];
    const row = await o(
      "insert into state (process_id, stage_id, state_key, name, sort_order, " +
      " state_type, entry_action, exit_action, description, owner_role, " +
      " expected_duration_minutes, sla_minutes, manual_x, manual_y, ext) " +
      "values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) " +
      "returning state_id",
      [pid, sid, s.state_key, s.name, s.sort_order, stype,
       s.entry_action, s.exit_action, s.description, s.owner_role,
       s.expected_duration_minutes, s.sla_minutes, s.manual_x, s.manual_y,
       JSON.stringify(s.ext)]);
    stateIds[s.state_key] = row.state_id;
  }

  // --- transitions --------------------------------------------------------------
  const seenTrans = new Set();
  let transCount = 0;
  for (const t of m.transitions) {
    if (seenTrans.has(t.transition_key)) t.transition_key += "_" + (transCount + 1);
    seenTrans.add(t.transition_key);
    const fromId = stateIds[t.from_state_key], toId = stateIds[t.to_state_key];
    if (!fromId || !toId) continue;           // endpoint missing → skip edge
    await q(
      "insert into transition (process_id, transition_key, event_name, " +
      " from_state_id, to_state_id, guard_condition, action, description, " +
      " sort_order, ext) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [pid, t.transition_key, t.event_name, fromId, toId,
       t.guard_condition, t.action, t.description, t.sort_order,
       JSON.stringify(t.ext)]);
    transCount++;
  }

  // --- dependencies (savepoint each: the trg_dependency_guard cycle trigger
  //     stays authoritative; a rejected edge must not abort the version) ------
  let depCount = 0;
  for (const s of m.states) {
    for (const depKey of s.depends_on || []) {
      const a = stateIds[s.state_key], b = stateIds[depKey];
      if (!a || !b || a === b) continue;
      await client.query("savepoint dep");
      try {
        await q("insert into state_dependency (state_id, depends_on_state_id) " +
                "values ($1,$2) on conflict do nothing", [a, b]);
        await client.query("release savepoint dep");
        depCount++;
      } catch (e) {
        await client.query("rollback to savepoint dep");   // cycle → skip edge
      }
    }
  }

  // --- costs (the schema stores COST items; other kinds stay in the snapshot) --
  let costCount = 0;
  for (const c of m.costs) {
    if (c.cost_kind !== "COST") continue;
    const lo = Math.min(c.unit_cost_min, c.unit_cost_max);
    const hi = Math.max(c.unit_cost_min, c.unit_cost_max);
    let stateId = null, transId = null;
    if (c.applies_to === "STATE") {
      stateId = stateIds[c.state_key];
      if (!stateId) continue;
    } else {
      const t = await o("select transition_id from transition " +
                        "where process_id = $1 and transition_key = $2",
        [pid, c.transition_key]);
      if (!t) continue;
      transId = t.transition_id;
    }
    await q(
      "insert into cost_item (process_id, applies_to, state_id, transition_id, " +
      " cost_category, unit_name, unit_cost_min, unit_cost_max, source_name) " +
      "values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [pid, c.applies_to, stateId, transId, c.cost_category, c.unit_name,
       lo, hi, c.source_name]);
    costCount++;
  }

  return {
    processId: pid,
    stages: Object.keys(stageIds).length,
    states: Object.keys(stateIds).length,
    transitions: transCount,
    dependencies: depCount,
    costs: costCount
  };
}

module.exports = { extract, persistVersionContent };
