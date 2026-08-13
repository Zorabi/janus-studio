import assert from "node:assert/strict";
import test from "node:test";
import type { DiagnosticPreviewSnapshot } from "@janusgraph/domain";
import {
  buildDiagnosticPreviewFiles,
  DEFAULT_DIAGNOSTIC_PREVIEW_SELECTION,
  diagnosticPreviewContainsExcludedContent,
} from "../../packages/application/src/diagnostic-preview.ts";

const snapshot: DiagnosticPreviewSnapshot = {
  generatedAt: "2026-08-13T14:00:00.000Z",
  runtime: {
    appVersion: "0.2.0",
    electronVersion: "37.2.6",
    nodeVersion: "22.17.0",
    platform: "darwin",
    osRelease: "25.0.0",
    architecture: "arm64",
  },
  tasks: [{
    id: "task-a",
    kind: "transfer",
    action: "import",
    title: "Import graph2",
    connectionId: "connection-secret-id",
    connectionName: "Docker",
    graphName: "graph2",
    status: "failed",
    stage: "importing",
    message: "Timed out",
    progressCurrent: 25,
    progressTotal: 100,
    progressUnit: "vertices",
    cancellable: false,
    retriable: true,
    acknowledged: false,
    createdAt: "2026-08-13T13:00:00.000Z",
    updatedAt: "2026-08-13T13:10:00.000Z",
    completedAt: "2026-08-13T13:10:00.000Z",
  }],
  logs: [{
    id: "log-a",
    timestamp: "2026-08-13T13:10:00.000Z",
    level: "error",
    source: "transfer",
    event: "ipc.invoke-failed",
    message: "IPC operation failed: data-transfers:start",
  }],
};

test("enables every safe diagnostic preview file by default", () => {
  assert.deepEqual(DEFAULT_DIAGNOSTIC_PREVIEW_SELECTION, {
    summary: true,
    tasks: true,
    logs: true,
  });
  assert.deepEqual(
    buildDiagnosticPreviewFiles(snapshot, DEFAULT_DIAGNOSTIC_PREVIEW_SELECTION).map((file) => file.name),
    ["summary.json", "tasks.json", "logs.ndjson"],
  );
});

test("builds stable preview documents without internal connection ids", () => {
  const files = buildDiagnosticPreviewFiles(snapshot, DEFAULT_DIAGNOSTIC_PREVIEW_SELECTION);
  const summary = JSON.parse(files[0]!.content) as Record<string, unknown>;
  const tasks = JSON.parse(files[1]!.content) as Array<Record<string, unknown>>;

  assert.equal((summary.privacy as Record<string, unknown>).queryTextIncluded, false);
  assert.equal(tasks[0]!.connectionName, "Docker");
  assert.match(String(tasks[0]!.createdAt), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
  assert.equal(String(tasks[0]!.createdAt).includes("T"), false);
  assert.equal(String(tasks[0]!.updatedAt).endsWith("Z"), false);
  assert.equal(String(tasks[0]!.completedAt).endsWith("Z"), false);
  assert.equal(JSON.stringify(tasks).includes("connection-secret-id"), false);
  assert.equal(files[2]!.content.split("\n").length, 1);
});

test("omits disabled sections and detects forbidden credential markers", () => {
  const files = buildDiagnosticPreviewFiles(snapshot, { summary: true, tasks: false, logs: false });
  assert.deepEqual(files.map((file) => file.name), ["summary.json"]);
  assert.equal(diagnosticPreviewContainsExcludedContent(files), false);
  assert.equal(diagnosticPreviewContainsExcludedContent([{
    ...files[0]!,
    content: "Authorization: Bearer leaked-token",
  }]), true);
});
