import assert from "node:assert/strict";
import test from "node:test";
import { formatGremlin } from "../../apps/desktop/src/renderer/lib/gremlin-format.ts";

test("formats a traversal as a vertical Gremlin pipeline", () => {
  assert.equal(
    formatGremlin("g.V().hasLabel('person').has('age',gt(30)).out('knows').limit(10).elementMap()"),
    [
      "g.V()",
      "  .hasLabel('person')",
      "  .has('age', gt(30))",
      "  .out('knows')",
      "  .limit(10)",
      "  .elementMap()",
    ].join("\n"),
  );
});

test("preserves dots, commas and comment text inside literals", () => {
  assert.equal(
    formatGremlin("g.V().has('address','a.b,c') // keep.a,b\n.limit(2)"),
    "g.V()\n  .has('address', 'a.b,c') // keep.a,b\n  .limit(2)",
  );
});

test("is idempotent and keeps nested traversals compact", () => {
  const formatted = formatGremlin("g.V().repeat(out().simplePath()).times(3).path().by(elementMap())");
  assert.equal(formatGremlin(formatted), formatted);
  assert.match(formatted, /\.repeat\(out\(\)\.simplePath\(\)\)/);
});
