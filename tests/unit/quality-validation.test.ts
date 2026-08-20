import assert from "node:assert/strict";
import test from "node:test";
import type { SaveQualityRuleSetInput } from "@janusgraph/domain";
import { friendlyQualitySaveError, validateQualityRuleSet } from "../../apps/desktop/src/renderer/features/quality/quality-validation.ts";

const input = (): SaveQualityRuleSetInput => ({
  name: "policy", description: "", connectionId: "connection", graphName: "graph1", graphBinding: "graph1",
  graphAccess: "binding", rules: [{ id: "rule", name: "required", kind: "required-property", enabled: true,
    severity: "warning", vertexLabel: "v1", propertyKeys: [] }],
});

test("reports friendly field-level validation before a quality rule set reaches IPC", () => {
  assert.deepEqual(validateQualityRuleSet(input()), [{ code: "required-properties-required", field: "propertyKeys", ruleIndex: 0 }]);
  assert.deepEqual(validateQualityRuleSet({ ...input(), rules: [{ ...input().rules[0]!, propertyKeys: ["cp1"] }] }), []);
});

test("extracts readable messages from an IPC validation failure", () => {
  const error = new Error(`Error invoking remote method 'quality:rule-sets:save': [ { "code": "custom", "path": [ "rules", 2, "propertyKeys" ], "message": "必填属性规则至少选择一个属性" } ]`);
  assert.equal(friendlyQualitySaveError(error), "必填属性规则至少选择一个属性");
});
