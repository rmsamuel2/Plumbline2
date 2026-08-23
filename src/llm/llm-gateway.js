/* ============================================================================
 * Plumbline — LLM interaction layer (window.PlumblineLLM)
 * ----------------------------------------------------------------------------
 * The ONLY channel through which the UI reaches a language model. It is
 * strictly ADVISORY: the LLM never certifies a finding (only the Lemma kernel
 * does that) and never computes cost. It provides natural language around
 * results the engine already proved — the seam the methodology calls for
 * ("last move: get Claude to suggest [stage] names").
 *
 * Intents (task-shaped, not free-form chat):
 *   suggestStageNames(stages)  — name the buckets produced by "Zoom out"
 *   explainFinding(finding)    — a plain-business paragraph for one finding
 *   suggestTileName(context)   — propose a name for a box/step/team
 *   summarizeWorkflow(wf)      — an executive one-paragraph read of the process
 *   analyzeStrategicPortfolio  — manually requested cross-workflow interpretation
 *
 * Providers (interchangeable, same interface):
 *   • MockProvider     — offline, deterministic heuristics. No key, no network.
 *                        Keeps the feature usable with nothing configured.
 *   • AnthropicProvider— posts {intent, payload} to the Plumbline API
 *                        (server/ -> POST /api/llm). The API holds the key and
 *                        calls Anthropic (claude-*). NO API KEY EVER IN THE
 *                        BROWSER — the proxy is the trust + secrecy boundary.
 *
 * Every method returns a Promise. Responses are normalised to plain data so
 * the UI is identical whichever provider is active.
 * ==========================================================================*/
window.PlumblineLLM = (function () {
  "use strict";

  var TITLE_STOP = { the: 1, a: 1, an: 1, of: 1, and: 1, to: 1, for: 1, in: 1, on: 1 };
  function titleCase(s) {
    return String(s || "").replace(/[_-]+/g, " ").trim().split(/\s+/).map(function (w, i) {
      if (i && TITLE_STOP[w.toLowerCase()]) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }

  /* ========================================================================
   * MockProvider — deterministic, offline. Good enough to demo the feature.
   * ======================================================================*/
  function MockProvider() {
    var STAGE_WORDS = ["Intake", "Review", "Build", "Validate", "Approve",
                       "Publish", "Resolve", "Close"];
    return {
      name: "mock",
      async health() { return { ok: true, mode: "mock" }; },

      async suggestStageNames(stages) {
        // stages: [{ id, members:[stateNames] }]
        return (stages || []).map(function (st, i) {
          var members = (st.members || []).join(" ").toLowerCase();
          var guess =
            /submit|intake|receive|open/.test(members) ? "Intake" :
            /review|assess|check|verify/.test(members) ? "Review & Verify" :
            /build|map|value|compute/.test(members) ? "Build" :
            /approve|sign|author|decision/.test(members) ? "Approve" :
            /file|publish|deploy|close|complete/.test(members) ? "Publish & Close" :
            STAGE_WORDS[i % STAGE_WORDS.length];
          return { id: st.id, name: guess,
                   rationale: "Heuristic label from member statuses (offline)." };
        });
      },

      async explainFinding(finding) {
        var f = finding || {};
        var verdict = f.verdict && f.verdict.ok ? "certified" : "a counterexample";
        var lead = {
          spot_duplicates: "Two steps behave identically, so one is redundant.",
          zoom_out: "The detailed statuses roll up into a few clean stages.",
          find_loops: "A rework loop was found; the question is whether it terminates.",
          run_in_parallel: "Some work is independent and can run at the same time.",
          check_redesign: "The redesign was compared against the original for equivalence."
        }[f.tool] || "A structural property of the workflow was examined.";
        return {
          text: lead + " Plumbline records this as " + verdict + ". " +
                (f.detail || "") + " Because it is machine-checked, the result can be " +
                "re-verified independently.",
          provenance: "narrative-only (not a certificate)"
        };
      },

      async suggestTileName(context) {
        var c = context || {};
        var base = c.role === "decision" ? "Decision" :
                   c.role === "terminal" ? "Outcome" :
                   c.hint ? titleCase(c.hint) : "Step";
        return { name: base, alternatives: [base + " Review", base + " Gate", "Handle " + base] };
      },

      async summarizeWorkflow(wf) {
        var n = (wf && wf.states && wf.states.length) || 0;
        var t = (wf && wf.transitions && wf.transitions.length) || 0;
        return { text: "This workflow has " + n + " states and " + t + " transitions. " +
                       "Run the six tools to surface redundant steps, hidden loops, and " +
                       "parallelisable work — each finding carries a certificate or a counterexample." };
      },

      async analyzeStrategicPortfolio() {
        throw new Error("AI strategic analysis is unavailable until the Claude connection is configured.");
      }
    };
  }

  /* ========================================================================
   * AnthropicProvider — via the server proxy (key stays server-side).
   * ======================================================================*/
  function AnthropicProvider(baseUrl, model) {
    var base = (baseUrl || "").replace(/\/$/, "");
    async function call(intent, payload) {
      var res = await fetch(base + "/api/llm", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: intent, payload: payload, model: model || undefined })
      });
      var data = null; try { data = await res.json(); } catch (e) {}
      if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
      return data;   // server returns already-normalised shapes per intent
    }
    return {
      name: "anthropic",
      health()               { return call("health", {}); },
      suggestStageNames(s)   { return call("suggest_stage_names", { stages: s }); },
      explainFinding(f)      { return call("explain_finding", { finding: f }); },
      suggestTileName(c)     { return call("suggest_tile_name", { context: c }); },
      summarizeWorkflow(wf)  { return call("summarize_workflow", { workflow: wf }); },
      analyzeStrategicPortfolio(portfolio) { return call("strategic_analysis", { analysis: portfolio }); }
    };
  }

  /* ========================================================================
   * Gateway singleton.
   * ======================================================================*/
  var active = MockProvider();     // offline by default
  var gateway = {
    // configure({mode:'mock'}) or configure({mode:'anthropic', baseUrl, model})
    configure: function (opts) {
      opts = opts || {};
      if (opts.mode === "anthropic") active = AnthropicProvider(opts.baseUrl || "", opts.model);
      else active = MockProvider();
      return gateway;
    },
    provider: function () { return active.name; },
    // Prefer the server LLM if it answers; else stay on the offline mock.
    autodetect: async function (baseUrl, model) {
      try {
        var p = AnthropicProvider(baseUrl || "", model);
        var h = await p.health();
        if (h && h.ok) { active = p; return "anthropic"; }
      } catch (e) { /* fall through */ }
      active = MockProvider(); return "mock";
    }
  };
  ["health", "suggestStageNames", "explainFinding", "suggestTileName", "summarizeWorkflow", "analyzeStrategicPortfolio"]
    .forEach(function (m) {
      gateway[m] = function () { return active[m].apply(active, arguments); };
    });

  return gateway;
})();
