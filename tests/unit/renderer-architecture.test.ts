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
    "settings-overlays.css",
    "refinements.css",
    "schema-factory.css",
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
