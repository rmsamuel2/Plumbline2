/* ============================================================================
 * Plumbline — Engine facade (window.PlumblineEngine)
 * ----------------------------------------------------------------------------
 * THE encapsulation boundary for all math. The presentation layer (HTML/UI)
 * MUST NOT do FSM/cost/proof arithmetic itself — it calls this facade. Behind
 * the facade sit the certifying-algorithm packages:
 *
 *     io    — importers: untrusted JSON / FSM tables -> canonical IR
 *     core  — the IR + analysers (spot duplicates, zoom out, find loops,
 *             run in parallel) + redesign bisimulation + validation
 *     cost  — expected-cost arithmetic over the IR (assumption-based)
 *     lemma — the TRUSTED kernel: it disposes each analyser's witness,
 *             returning a certificate (ok) or a counterexample (the finding)
 *
 * Pattern: "propose, then dispose". Analysers propose a result + witness;
 * `lemma.check` certifies or refutes. `analyze()` wires the two together so a
 * finding never reaches the UI without a verdict attached.
 *
 * This file registers NO modules of its own — it only exposes the already
 * registered engine modules (see modules.gen.js) through a clean, stable API.
 * ==========================================================================*/
window.PlumblineEngine = (function () {
  var PL = window.__PL;

  // Lazily resolve the four engine namespaces (memoised by the runtime cache).
  function ns(id) { return function () { return PL.load(id); }; }
  var _io   = ns("packages/io/src/index.ts");
  var _core = ns("packages/core/src/index.ts");
  var _cost = ns("packages/cost/src/index.ts");
  var _lemma= ns("packages/lemma/src/index.ts");

  var engine = {
    /* ---- version / trust metadata -------------------------------------- */
    get version()      { return "plumbline-engine@2.0.0"; },
    get lemmaVersion() { return _lemma().VERSION; },

    /* ---- true monoid math (window.PlumblineMonoid; lazy so load order is
     *      engine-facade then monoid.js) --------------------------------- */
    get monoid() { return window.PlumblineMonoid; },
    // Build the transition monoid M(A) of a workflow.
    transitionMonoid: function (wf) { return window.PlumblineMonoid.transitionMonoid(wf); },
    // The syntactic monoid + syntactic morphism (via the Nerode quotient).
    syntacticMonoid: function (wf) { return window.PlumblineMonoid.syntacticMonoid(wf); },
    // Run the six tools as monoid operations, each monoid-certified or refuted.
    analyzeMonoid: function (wf) { return window.PlumblineMonoid.analyze(wf); },
    // Compare two designs by monoid isomorphism of their syntactic monoids.
    compareRedesignMonoid: function (a, b) { return window.PlumblineMonoid.redesign(a, b); },

    /* ---- raw namespaces (escape hatch; prefer the helpers below) -------- */
    get io()    { return _io(); },
    get core()  { return _core(); },
    get cost()  { return _cost(); },
    get lemma() { return _lemma(); },

    /* ---- importers: untrusted input -> canonical IR -------------------- */
    // Parse a workflow JSON document into the IR. Returns {workflow, issues}.
    parseWorkflow: function (json) { return _io().parseWorkflow(json); },
    // Parse a cost-model JSON document (costs + probabilities).
    parseCostModel: function (json) { return _io().parseCostModel(json); },
    // Build an IR from an FSM transition table.
    fromFsmTable: function (table) { return _io().fromFsmTable(table); },
    // Structural validation of an IR (errors + warnings), no proofs.
    validate: function (wf) { return _core().validate(wf); },

    /* ---- analysis: analysers propose, Lemma disposes ------------------- */
    // Run all five model-only tools; every finding carries a certificate or a
    // counterexample from the Lemma kernel. Returns Finding[].
    analyze: function (wf) { return _core().analyse(wf, _lemma().check); },
    // Compare two designs for behavioural equivalence (incl. decision points).
    compareRedesign: function (a, b) {
      return _core().analyseRedesign(a, b, _lemma().check);
    },
    // Directly discharge a single proof obligation with a supplied witness.
    // Returns { ok, certificate | counterexample }.
    certify: function (wf, obligation, witness) {
      return _lemma().check(wf, obligation, witness);
    },

    /* ---- cost model: quantify certified structure (assumption-based) --- */
    // Expected cost of the workflow under a supplied cost model.
    expectedCost: function (wf, model) { return _cost().expectedCost(wf, model); },
    // Sensitivity: what a proposed fix is worth.
    whatIf: function (wf, model, change) { return _cost().whatIf(wf, model, change); },
    // Human-readable savings ledger from a cost result.
    ledger: function (result) { return _cost().renderLedger(result); },

    /* ---- one-call pipeline: JSON in -> certified findings + cost out --- */
    // Convenience for the UI: import, validate, analyse, and (optionally) cost
    // in a single call. Never throws on bad input — problems come back in
    // `issues`. Keeps ALL math out of the caller.
    run: function (workflowJson, costJson) {
      var out = { workflow: null, issues: [], findings: [], cost: null, provenance: {} };
      var parsed = _io().parseWorkflow(workflowJson);
      out.workflow = parsed.workflow || parsed;      // tolerate either shape
      if (parsed.issues) out.issues = parsed.issues;
      if (!out.workflow) return out;
      try { out.findings = engine.analyze(out.workflow); }
      catch (e) { out.issues.push({ level: "error", msg: "analysis failed: " + e.message }); }
      if (costJson != null) {
        try {
          var model = _io().parseCostModel(costJson);
          out.cost = engine.expectedCost(out.workflow, model.model || model);
        } catch (e) {
          out.issues.push({ level: "warn", msg: "cost skipped: " + e.message });
        }
      }
      // Three-tier provenance labelling (see Architecture doc §Provenance).
      out.provenance = {
        structure: "lemma-certified",     // findings verdicts
        cost: out.cost ? "assumption-based" : "n/a",
        engine: engine.version, lemma: engine.lemmaVersion
      };
      return out;
    },

    /* ---- example fixtures (authored demo workflows) -------------------- */
    fixtures: function () {
      var c = _core();
      return { loan: c.loan, golden: c.golden, parallel: c.parallel };
    }
  };

  return engine;
})();
