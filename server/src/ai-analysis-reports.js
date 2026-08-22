"use strict";

const MAX_REPORT_BYTES = 6 * 1024 * 1024;
const MAX_WORKFLOWS = 25;

function publicError(message, status) {
  const error = new Error(message);
  error.status = status || 400;
  error.expose = true;
  return error;
}

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalTimestamp(value, label) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw publicError(label + " must be a valid timestamp");
  return date.toISOString();
}

function trimText(value, fallback, max) {
  const text = String(value || fallback || "").trim();
  return text.slice(0, max);
}

function normalizeReportPayload(body) {
  const source = body || {};
  if (!plainObject(source.report)) throw publicError("AI report content is required");
  if (!plainObject(source.mathematicalSnapshot))
    throw publicError("The mathematical snapshot is required");
  if (!Array.isArray(source.workflows) || !source.workflows.length)
    throw publicError("At least one workflow snapshot is required");
  if (source.workflows.length > MAX_WORKFLOWS)
    throw publicError("An AI report can reference at most " + MAX_WORKFLOWS + " workflows", 413);

  const workflows = source.workflows.map(function (workflow, index) {
    if (!plainObject(workflow) || !plainObject(workflow.snapshot))
      throw publicError("Workflow snapshot " + (index + 1) + " is invalid");
    const name = trimText(workflow.name, "Untitled workflow", 200);
    const key = trimText(workflow.sourceWorkflowKey || workflow.sourceWorkflowId ||
      (workflow.snapshot.workflow && workflow.snapshot.workflow.id), "workflow-" + (index + 1), 200);
    return {
      position: index,
      sourceWorkflowKey: key,
      sourceWorkflowId: trimText(workflow.sourceWorkflowId, "", 200) || null,
      name,
      workflowCreatedAt: optionalTimestamp(workflow.workflowCreatedAt, "workflowCreatedAt"),
      sourceVersionId: trimText(workflow.sourceVersionId, "", 200) || null,
      snapshot: workflow.snapshot
    };
  });

  const normalized = {
    title: trimText(source.title, "AI workflow optimization report", 160),
    report: source.report,
    mathematicalSnapshot: source.mathematicalSnapshot,
    inputSignature: trimText(source.inputSignature, "", 350000),
    aiGeneratedAt: optionalTimestamp(source.aiGeneratedAt, "aiGeneratedAt"),
    workflows
  };
  if (!normalized.title) normalized.title = "AI workflow optimization report";
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_REPORT_BYTES)
    throw publicError("The AI analysis report is too large to save", 413);
  return normalized;
}

module.exports = { normalizeReportPayload, MAX_REPORT_BYTES, MAX_WORKFLOWS };
