"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeReportPayload } = require("../src/ai-analysis-reports.js");

function payload() {
  return {
    title: "Portfolio optimization · 2 workflows",
    report: { executive_summary: "Advisory summary", workflow_optimizations: [] },
    mathematicalSnapshot: { workflow_count: 2, finding_count: 5 },
    inputSignature: "stable-signature",
    aiGeneratedAt: "2026-08-22T12:00:00.000Z",
    workflows: [
      {
        sourceWorkflowKey: "employee_onboarding",
        sourceWorkflowId: "f6c8431e-4a60-4c15-8abc-7df0f2c58291",
        sourceVersionId: "version-1",
        name: "Employee onboarding",
        workflowCreatedAt: "2026-08-01T09:30:00.000Z",
        snapshot: { workflow: { id: "employee_onboarding", states: [], transitions: [] } }
      },
      {
        sourceWorkflowKey: "purchase_approval",
        name: "Purchase request approval",
        snapshot: { workflow: { id: "purchase_approval", states: [], transitions: [] } }
      }
    ]
  };
}

test("normalizes a durable AI analysis report with independent workflow snapshots", function () {
  const result = normalizeReportPayload(payload());
  assert.equal(result.workflows.length, 2);
  assert.equal(result.workflows[0].sourceWorkflowKey, "employee_onboarding");
  assert.equal(result.workflows[0].workflowCreatedAt, "2026-08-01T09:30:00.000Z");
  assert.equal(result.workflows[1].sourceWorkflowId, null);
  assert.deepEqual(result.workflows[1].snapshot.workflow.states, []);
});

test("rejects an AI analysis report without workflow snapshots", function () {
  const value = payload();
  value.workflows = [];
  assert.throws(function () { normalizeReportPayload(value); }, /At least one workflow snapshot/);
});

test("rejects invalid report and mathematical content", function () {
  const value = payload();
  value.report = [];
  assert.throws(function () { normalizeReportPayload(value); }, /report content is required/i);
  value.report = {};
  value.mathematicalSnapshot = null;
  assert.throws(function () { normalizeReportPayload(value); }, /mathematical snapshot is required/i);
});

test("rejects invalid workflow creation timestamps", function () {
  const value = payload();
  value.workflows[0].workflowCreatedAt = "not-a-date";
  assert.throws(function () { normalizeReportPayload(value); }, /valid timestamp/);
});
