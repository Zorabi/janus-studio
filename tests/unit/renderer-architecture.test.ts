import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererRoot = "apps/desktop/src/renderer";

test("keeps feature pages outside the application shell", async () => {
  const app = await readFile(`${rendererRoot}/App.tsx`, "utf8");
  const lines = app.split("\n").length;

  assert.ok(lines <= 1_200, `App.tsx has regrown to ${lines} lines`);
  for (const page of [
    "ConnectionDialog",
    "ConnectionsPage",
    "HistoryPage",
    "DiagnosticsPage",
    "QueryPage",
    "SchemaPage",
    "SettingsPage",
    "TransferPage",
  ]) {
    assert.doesNotMatch(app, new RegExp(`function\\s+${page}\\s*\\(`));
    assert.match(app, new RegExp(`import\\s+\\{\\s*${page}\\s*\\}`));
  }
});

test("loads renderer styles through ordered responsibility-based modules", async () => {
  const entry = await readFile(`${rendererRoot}/styles.css`, "utf8");
  const imports = [...entry.matchAll(/@import\s+"\.\/styles\/([^"]+)";/g)]
    .map((match) => match[1]);

  assert.deepEqual(imports, [
    "foundation.css",
    "query-editor.css",
    "graph.css",
    "data-grid-results.css",
    "feature-pages.css",
    "connection-management.css",
    "query-assets.css",
    "settings-overlays.css",
    "refinements.css",
    "schema-import.css",
    "schema-factory.css",
    "transfer-server.css",
    "task-center.css",
    "compatibility.css",
    "diagnostics.css",
    "quality.css",
    "themes.css",
    "ide-overrides.css",
  ]);
  assert.doesNotMatch(entry, /\{[^}]*\}/s);

  for (const file of imports) {
    const stylesheet = await readFile(`${rendererRoot}/styles/${file}`, "utf8");
    assert.ok(stylesheet.trim().length > 0, `${file} is empty`);
    assert.ok(
      stylesheet.split("\n").length <= 2_500,
      `${file} exceeds the 2,500-line module ceiling`,
    );
  }
});

test("keeps dynamic graph capability probing stable across parent renders", async () => {
  const page = await readFile(
    `${rendererRoot}/features/graph-factory/GraphFactoryPage.tsx`,
    "utf8",
  );
  assert.match(page, /const executeRef = useRef\(execute\)/);
  assert.match(page, /const translateRef = useRef\(t\)/);
  assert.match(
    page,
    /\}, \[activeConnection\?\.id, activeConnection\?\.updatedAt\]\);/,
  );
  assert.doesNotMatch(
    page,
    /\}, \[[^\]]*\bexecute\b[^\]]*\]\);/,
  );
});

test("keeps GraphSON task execution out of renderer session storage", async () => {
  const transferPage = await readFile(`${rendererRoot}/features/transfer/TransferPage.tsx`, "utf8");
  assert.doesNotMatch(transferPage, /sessionStorage|serverTransferTaskStorageKey|writeServerTransferTask/);
  assert.match(transferPage, /dataTransfers\.start/);
  assert.match(transferPage, /tasks\.list/);
});

test("keeps diagnostic bundle creation in the main process with an advanced preview", async () => {
  const page = await readFile(`${rendererRoot}/features/diagnostics/DiagnosticsPage.tsx`, "utf8");
  const ipc = await readFile("apps/desktop/src/main/ipc/register-ipc.ts", "utf8");
  assert.match(page, /生成诊断包/);
  assert.match(page, /advancedOpen/);
  assert.match(page, /diagnostics\.exportBundle/);
  assert.match(page, /analyzeDiagnosticSnapshot/);
  assert.match(page, /diagnostics\.inspectBundle/);
  assert.match(page, /diagnostics\.saveRecord/);
  assert.match(page, /DiagnosticRecordPanel/);
  const recordPanel = await readFile(`${rendererRoot}/features/diagnostics/DiagnosticRecordPanel.tsx`, "utf8");
  assert.match(recordPanel, /const PAGE_SIZE = 8/);
  assert.match(recordPanel, /diagnostic-record-pagination/);
  assert.match(recordPanel, /pageRecords\.map/);
  assert.match(recordPanel, /selectedId === record\.id && <div className="diagnostic-record-actions">/);
  assert.doesNotMatch(recordPanel, /records\.length > PAGE_SIZE && <footer/);
  assert.match(recordPanel, /aria-expanded=\{selectedId === record\.id\}/);
  assert.doesNotMatch(page, /createZipArchive|writeFile/);
  assert.match(ipc, /diagnostics:bundle:export/);
  assert.match(ipc, /diagnosticPreviewContainsExcludedContent/);
  assert.match(ipc, /diagnostic-report\.md/);
});

test("carries business failure context into problem diagnostics", async () => {
  const app = await readFile(`${rendererRoot}/App.tsx`, "utf8");
  const connections = await readFile(`${rendererRoot}/features/connections/ConnectionsPage.tsx`, "utf8");
  const schema = await readFile(`${rendererRoot}/features/schema/SchemaPage.tsx`, "utf8");
  const factory = await readFile(`${rendererRoot}/features/graph-factory/GraphFactoryPage.tsx`, "utf8");
  assert.match(app, /<DiagnosticsPage incident=\{diagnosticIncident\}/);
  assert.match(connections, /source: "connection"/);
  assert.match(schema, /source: "schema"/);
  assert.match(factory, /source: "graphFactory"/);
});

test("keeps Schema writes behind target confirmation and import review discoverable", async () => {
  const schemaPage = await readFile(`${rendererRoot}/features/schema/SchemaPage.tsx`, "utf8");
  const importDialog = await readFile(`${rendererRoot}/features/schema/SchemaImportDialog.tsx`, "utf8");

  assert.match(schemaPage, /setPendingSchemaCreate\(\{/);
  assert.match(schemaPage, /confirmationText=\{pendingSchemaCreate\.targetName\}/);
  assert.match(schemaPage, /schemaImportConfirmationOpen/);
  assert.match(schemaPage, /confirmationText=\{schemaTargetName\}/);
  assert.match(importDialog, /五类影响审阅/);
  assert.match(importDialog, /归档转换预览/);
  assert.doesNotMatch(importDialog, /schema-import-discovery/);
  assert.doesNotMatch(importDialog, /typedTarget|targetConfirmed/);
  assert.match(importDialog, /useDeferredValue\(conversionFormat\)/);
  assert.match(importDialog, /className="schema-conversion-preview"/);
  assert.match(importDialog, /conversionPreviewWindowSize/);
  assert.doesNotMatch(importDialog, /<pre>\{conversionText\}<\/pre>|<textarea/);
});

test("keeps quality rule-set saves observable inside the editor", async () => {
  const qualityPage = await readFile(`${rendererRoot}/features/quality/QualityPage.tsx`, "utf8");

  assert.match(qualityPage, /<form className="quality-editor-shell" onSubmit=/);
  assert.match(qualityPage, /type="submit" className="button primary"/);
  assert.match(qualityPage, /savingRuleSet\?<LoaderCircle/);
  assert.match(qualityPage, /className="quality-editor-feedback" role="alert"/);
  assert.match(qualityPage, /friendlyQualitySaveError\(error\)/);
  assert.match(qualityPage, /validateQualityRuleSet\(editing\)/);
  assert.match(qualityPage, /className="quality-run-workbench"/);
  assert.match(qualityPage, /查看完整数据/);
  assert.match(qualityPage, /Schema 候选/);
  assert.match(qualityPage, /重新读取目标图 Schema 候选/);
  assert.doesNotMatch(qualityPage, /`V \$\{schemaCatalog\.vertexLabels\.length\}/);
});
