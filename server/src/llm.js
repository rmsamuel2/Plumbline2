// Plumbline LLM proxy — the server-side half of the LLM interaction layer.
// The browser NEVER holds the Anthropic API key; it POSTs {intent, payload} to
// /api/llm and this module calls Claude with the key from the environment.
//
// Uses the official Anthropic SDK (@anthropic-ai/sdk), model claude-opus-4-8,
// adaptive thinking, and output_config.format so each intent returns JSON that
// already matches the shape window.PlumblineLLM expects.
const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const client = new Anthropic();   // reads ANTHROPIC_API_KEY (or an `ant` profile)

// JSON schemas per intent — guarantee a parseable, correctly-shaped response.
const SCHEMAS = {
  suggest_stage_names: {
    type: "object", additionalProperties: false,
    properties: {
      stages: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            rationale: { type: "string" }
          },
          required: ["id", "name", "rationale"]
        }
      }
    },
    required: ["stages"]
  },
  explain_finding: {
    type: "object", additionalProperties: false,
    properties: { text: { type: "string" }, provenance: { type: "string" } },
    required: ["text", "provenance"]
  },
  suggest_tile_name: {
    type: "object", additionalProperties: false,
    properties: {
      name: { type: "string" },
      alternatives: { type: "array", items: { type: "string" } }
    },
    required: ["name", "alternatives"]
  },
  summarize_workflow: {
    type: "object", additionalProperties: false,
    properties: { text: { type: "string" } },
    required: ["text"]
  }
};

const SYSTEM =
  "You are Plumbline's naming and explanation assistant. Plumbline models a " +
  "business process as a finite-state machine and CERTIFIES its findings with a " +
  "formal kernel. You are advisory only: you never certify a finding and never " +
  "invent numbers. Name stages and steps in crisp business language; explain " +
  "findings plainly for a non-technical operator. Respond ONLY as JSON matching " +
  "the requested schema.";

// Build the user prompt for each intent from the payload the browser sent.
function promptFor(intent, payload) {
  switch (intent) {
    case "suggest_stage_names":
      return "Name each zoom-out stage from the statuses it groups. Keep names " +
        "2-4 words, business-facing.\n\nStages:\n" +
        JSON.stringify(payload.stages, null, 2);
    case "explain_finding":
      return "Explain this certified/refuted finding in 2-3 plain sentences for " +
        "a business reader. Set provenance to 'narrative-only (not a certificate)'." +
        "\n\nFinding:\n" + JSON.stringify(payload.finding, null, 2);
    case "suggest_tile_name":
      return "Propose one concise name and up to three alternatives for this " +
        "workflow step/box.\n\nContext:\n" + JSON.stringify(payload.context, null, 2);
    case "summarize_workflow":
      return "Give a one-paragraph executive read of this workflow (states, " +
        "shape, what to look at first).\n\nWorkflow:\n" +
        JSON.stringify(payload.workflow, null, 2).slice(0, 12000);
    default:
      return null;
  }
}

// Called by the /api/llm route. Returns the normalised object for the intent.
async function handle(intent, payload, modelOverride) {
  if (intent === "health") return { ok: true, model: MODEL };
  const schema = SCHEMAS[intent];
  const prompt = promptFor(intent, payload || {});
  if (!schema || !prompt) { const e = new Error("Unknown LLM intent: " + intent); e.status = 400; throw e; }

  const res = await client.messages.create({
    model: modelOverride || MODEL,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: schema } },
    messages: [{ role: "user", content: prompt }]
  });
  const text = (res.content || []).filter(function (b) { return b.type === "text"; })
    .map(function (b) { return b.text; }).join("");
  return JSON.parse(text);   // output_config.format guarantees schema-valid JSON
}

module.exports = { handle };
