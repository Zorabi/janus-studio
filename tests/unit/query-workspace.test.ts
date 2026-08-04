import assert from "node:assert/strict";
import test from "node:test";
import {
  createFreshQueryWorkspace,
  createQueryTab,
  nextAvailableQuerySequence,
} from "../../apps/desktop/src/renderer/features/query/query-workspace.ts";

test("restarts temporary query numbering after the final tab closes", () => {
  const workspace = createFreshQueryWorkspace("auto", "connection-1");

  assert.equal(workspace.sequence, 1);
  assert.equal(workspace.tabs.length, 1);
  assert.equal(workspace.tabs[0]?.title, "Query 1");
  assert.equal(workspace.activeTabId, workspace.tabs[0]?.id);
});

test("continues fresh numbering without colliding with restored tabs", () => {
  const query1 = createQueryTab(1, "auto", "connection-1");
  const query2 = createQueryTab(2, "auto", "connection-1");
  const query999 = createQueryTab(999, "auto", "connection-1");

  assert.equal(nextAvailableQuerySequence([query1, query999], 1), 2);
  assert.equal(nextAvailableQuerySequence([query1, query2, query999], 1), 3);
});
