import assert from "node:assert/strict";
import test from "node:test";
import type { QueryHistoryEntry } from "@janusgraph/domain";
import { filterQueryHistory } from "../../apps/desktop/src/renderer/features/history/history-filters.ts";

function entry(
  id: string,
  status: QueryHistoryEntry["status"],
  connectionId: string,
  createdAt: string,
  query = `g.V('${id}')`,
): QueryHistoryEntry {
  return {
    id,
    connectionId,
    connectionName: connectionId === "a" ? "Development" : "Production",
    query,
    status,
    durationMs: 10,
    resultCount: status === "success" || status === "truncated" ? 1 : 0,
    errorMessage: status === "error" ? "permission denied" : "",
    createdAt,
  };
}

const now = new Date("2026-08-10T12:00:00.000Z");
const history = [
  entry("today", "success", "a", "2026-08-10T02:00:00.000Z"),
  entry("recent", "truncated", "b", "2026-08-05T12:00:00.000Z"),
  entry("cancelled", "cancelled", "a", "2026-07-20T12:00:00.000Z"),
  entry("failed", "error", "b", "2026-06-01T12:00:00.000Z"),
];

test("filters query history by connection, complete status and date range", () => {
  assert.deepEqual(
    filterQueryHistory(
      history,
      { search: "", connectionId: "b", status: "truncated", date: "7d" },
      now,
    ).map(({ id }) => id),
    ["recent"],
  );
  assert.deepEqual(
    filterQueryHistory(
      history,
      { search: "", connectionId: "", status: "cancelled", date: "30d" },
      now,
    ).map(({ id }) => id),
    ["cancelled"],
  );
});

test("searches query, connection name and error message", () => {
  const defaults = { connectionId: "", status: "all" as const, date: "all" as const };
  assert.equal(filterQueryHistory(history, { ...defaults, search: "production" }, now).length, 2);
  assert.equal(filterQueryHistory(history, { ...defaults, search: "PERMISSION" }, now)[0]?.id, "failed");
});
