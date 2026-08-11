import assert from "node:assert/strict";
import test from "node:test";
import { gremlinConsoleText } from "../../apps/desktop/src/main/services/gremlin-service.ts";

test("prefers canonical TinkerPop object strings for console output", () => {
  const vertex = { id: 7, toString: () => "v[7]" };
  assert.equal(gremlinConsoleText([vertex, new Map([["name", "Alice"]])]), "==>v[7]\n==>{name=Alice}");
});

test("renders HTTP GraphSON elements with Gremlin Console notation", () => {
  assert.equal(gremlinConsoleText([{
    "@type": "g:Vertex",
    "@value": { id: { "@type": "g:Int64", "@value": 42 }, label: "person" },
  }]), "==>v[42]");
});

test("preserves multiline server text for profile and explain reports", () => {
  assert.equal(gremlinConsoleText(["Traversal Metrics\nStep  Count"]), "==>Traversal Metrics\nStep  Count");
});
