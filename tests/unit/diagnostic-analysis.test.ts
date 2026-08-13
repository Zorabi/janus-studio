import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDiagnosticDocuments, diagnosticReportMarkdown } from "../../packages/application/src/diagnostic-analysis.ts";

test("identifies known JanusGraph failures with evidence and confidence", () => {
  const report = analyzeDiagnosticDocuments([
    { source: "logs.ndjson", content: "Server error: A JanusGraph graph with the same instance id [abc] is already open. Might required forced shutdown." },
    { source: "tasks.json", content: "Evaluation exceeded the configured evaluationTimeout threshold of 180000 ms" },
  ], "2026-08-13T12:00:00.000Z");
  assert.deepEqual(report.findings.map((finding) => finding.code), ["instance-id-conflict", "evaluation-timeout"]);
  assert.equal(report.findings[0]!.confidence, "confirmed");
  assert.equal(report.findings[0]!.evidence[0]!.source, "logs.ndjson");
});

test("recognizes Elasticsearch, serialization, Schema and ConfiguredGraphFactory patterns", () => {
  const report = analyzeDiagnosticDocuments([{ source: "bundle", content: [
    "this action would add [2] shards, but this cluster currently has maximum normal shards open",
    "Error during serialization: Could not find a type identifier for class SchemaStatus",
    "violates a uniqueness constraint [SystemIndex#~T$SchemaName]",
    "DROP_VERIFICATION_FAILED: Dynamic graph is still registered: graph5",
  ].join("\n") }]);
  assert.deepEqual(report.findings.map((finding) => finding.code), [
    "elasticsearch-shard-limit", "graphson-serialization", "schema-name-conflict", "configured-graph-factory",
  ]);
});

test("returns an explicit empty report and renders a readable markdown artifact", () => {
  const report = analyzeDiagnosticDocuments([{ source: "summary.json", content: "healthy but unknown" }]);
  assert.equal(report.findings.length, 0);
  assert.match(diagnosticReportMarkdown(report), /未识别已知模式/);
});
