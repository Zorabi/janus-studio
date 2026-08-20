import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  applySchemaSuggestion,
  filterSchemaSuggestions,
  removeSchemaToken,
} from "../../apps/desktop/src/renderer/features/quality/SchemaSuggestionInput.tsx";

test("filters Schema suggestions by partial input using natural order", () => {
  assert.deepEqual(
    filterSchemaSuggestions("v", ["v10", "account", "v2", "v1"]),
    ["v1", "v2", "v10"],
  );
  assert.deepEqual(
    filterSchemaSuggestions("NAME", ["displayName", "createdAt", "name"]),
    ["displayName", "name"],
  );
});

test("filters the active token and excludes values already chosen in a multi-value field", () => {
  assert.deepEqual(
    filterSchemaSuggestions("person, comp", ["person", "company", "computer", "project"], true),
    ["company", "computer"],
  );
  assert.deepEqual(
    filterSchemaSuggestions("v1", ["v1", "v10", "v2"], true),
    ["v1", "v10"],
  );
  assert.deepEqual(
    filterSchemaSuggestions("v1, cp1", ["v1", "cp1", "cp10", "cp2"], true),
    ["cp1", "cp10"],
  );
});

test("applies single and multi-value Schema suggestions", () => {
  assert.equal(applySchemaSuggestion("pers", "person"), "person");
  assert.equal(applySchemaSuggestion("person, comp", "company", true), "person, company");
  assert.equal(applySchemaSuggestion("person, person", "person", true), "person");
});

test("removes only the selected Schema token", () => {
  assert.deepEqual(removeSchemaToken(["v1", "v2", "v10"], "v2"), ["v1", "v10"]);
  assert.deepEqual(removeSchemaToken(["cp1", "cp2"], "missing"), ["cp1", "cp2"]);
});

test("renders selected Schema values as whole tokens with whole-token keyboard deletion", () => {
  const source = readFileSync(new URL("../../apps/desktop/src/renderer/features/quality/SchemaSuggestionInput.tsx", import.meta.url), "utf8");
  assert.match(source, /setSelectionRange\(end, end\)/);
  assert.match(source, /event\.key === "Backspace" \|\| event\.key === "Delete"/);
  assert.match(source, /removeToken\(token\)/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(source, /setDraft\(selectedValues\.at\(-1\)/);
});
