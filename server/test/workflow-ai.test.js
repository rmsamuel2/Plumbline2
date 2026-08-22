"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateEditorWorkflow,
  workflowEditPrompt,
  workflowEditSystemPrompt,
  mapAnthropicError,
  mapGeneratedTransitionKeys,
  countOptionalSchemaProperties,
  editWorkflowSchema,
  strategicAnalysisSchema,
  promptFor
} = require("../src/llm.js");

function workflow() {
  return {
    process: { process_key: "order_flow", name: "Order flow" },
    stages: [
      { process_key: "order_flow", stage_key: "intake", stage_order: 1, name: "Intake" }
    ],
    custom_state_types: [],
    states: [
      {
        process_key: "order_flow", state_key: "S1", stage_key: "intake",
        state_type: "START", name: "Received"
      },
      {
        process_key: "order_flow", state_key: "S2", stage_key: "intake",
        state_type: "FINAL", name: "Done"
      }
    ],
    transitions: [
      {
        process_key: "order_flow", transition_key: "T1",
        from_state_key: "S1", to_state_key: "S2", event_name: "complete"
      }
    ],
    costs: []
  };
}

test("validates and normalises a Workflow Editor document", function () {
  const value = workflow();
  value.states[0].process_key = "wrong";
  const result = validateEditorWorkflow(value);
  assert.equal(result.process.process_key, "order_flow");
  assert.equal(result.states[0].process_key, "order_flow");
  assert.notStrictEqual(result, value);
});

test("preserves the original process key in an AI result", function () {
  const value = workflow();
  value.process.process_key = "claude_changed_this";
  const result = validateEditorWorkflow(value, { processKey: "order_flow" });
  assert.equal(result.process.process_key, "order_flow");
  assert.ok(result.stages.every(function (row) {
    return row.process_key === "order_flow";
  }));
});

test("rejects dangling transition references", function () {
  const value = workflow();
  value.transitions[0].to_state_key = "missing";
  assert.throws(
    function () { validateEditorWorkflow(value); },
    /references an unknown state/
  );
});

test("rejects duplicate events leaving the same state", function () {
  const value = workflow();
  value.transitions.push({
    transition_key: "T2", from_state_key: "S1",
    to_state_key: "S1", event_name: "complete"
  });
  assert.throws(
    function () { validateEditorWorkflow(value); },
    /unique event names/
  );
});

test("rejects undefined custom state types", function () {
  const value = workflow();
  value.states[0].state_type = "MANUAL_REVIEW";
  assert.throws(
    function () { validateEditorWorkflow(value); },
    /undefined state type/
  );
});

test("accepts a declared custom state type", function () {
  const value = workflow();
  value.custom_state_types.push({
    type_key: "MANUAL_REVIEW", label: "Manual review",
    fill_color: "#fff", stroke_color: "#000"
  });
  value.states[0].state_type = "manual_review";
  const result = validateEditorWorkflow(value);
  assert.equal(result.states[0].state_type, "MANUAL_REVIEW");
});

test("maps a missing generated connection key before validation", function () {
  const value = workflow();
  delete value.transitions[0].transition_key;
  mapGeneratedTransitionKeys(value);
  assert.equal(value.transitions[0].transition_key, "AI_T001");
  assert.doesNotThrow(function () { validateEditorWorkflow(value); });
});

test("prompt treats workflow and request as delimited data", function () {
  const prompt = workflowEditPrompt(workflow(), "Add a review box");
  assert.match(prompt, /<user_change>\nAdd a review box\n<\/user_change>/);
  assert.match(prompt, /<current_workflow_json>/);
  assert.match(prompt, /complete updated document, not a patch/i);
});

test("AI edits always receive the server-owned Workflow Builder explanation", function () {
  const system = workflowEditSystemPrompt();
  assert.match(system, /Workflow Builder context:/);
  assert.match(system, /stages are ordered visual categories/i);
  assert.match(system, /states are editable boxes/i);
  assert.match(system, /transitions are directed connections/i);
  assert.match(system, /complete, internally consistent workflow/i);
});

test("strategic AI output is structured and all fields are required", function () {
  assert.deepEqual(strategicAnalysisSchema.required,
    ["executive_summary", "priorities", "patterns", "risks",
      "portfolio_optimization"]);
  assert.deepEqual(strategicAnalysisSchema.properties.priorities.items.required,
    ["title", "workflow", "rationale"]);
  assert.deepEqual(
    strategicAnalysisSchema.properties.portfolio_optimization
      .properties.actions.items.required,
    ["sequence", "workflows", "change", "leverage", "how", "reason", "success_measure"]
  );
  assert.equal(countOptionalSchemaProperties(strategicAnalysisSchema), 0);
});

test("strategic AI prompt forbids recomputing or inventing mathematical results", function () {
  const prompt = promptFor("strategic_analysis", {
    analysis: { portfolio: { workflow_count: 2, cost_opportunity_illustrative: 50 } }
  });
  assert.match(prompt, /Do not recompute, invent, extrapolate, or certify/i);
  assert.match(prompt, /illustrative assumptions, not guaranteed savings/i);
  assert.match(prompt, /zero coverage does not invalidate findings/i);
  assert.match(prompt, /Do not claim low coverage means checks have not run/i);
  assert.match(prompt, /do not create isolated optimization plans for individual workflows/i);
  assert.match(prompt, /how the workflows can leverage each other/i);
  assert.match(prompt, /at least two supplied workflows/i);
  assert.match(prompt, /"workflow_count": 2/);
});

test("maps provider details to safe public errors", function () {
  const upstream = new Error("secret provider diagnostic");
  upstream.status = 401;
  const originalConsoleError = console.error;
  console.error = function () {};
  let result;
  try {
    result = mapAnthropicError(upstream);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(result.status, 503);
  assert.equal(result.expose, true);
  assert.doesNotMatch(result.message, /secret provider diagnostic/);
});

test("Claude edit schema stays below the provider optional-field limit", function () {
  assert.ok(countOptionalSchemaProperties(editWorkflowSchema) <= 24);
});
