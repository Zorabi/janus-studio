import type { QualityRule, SaveQualityRuleSetInput } from "@janusgraph/domain";

export type QualityValidationCode =
  | "name-required" | "graph-name-required" | "graph-binding-required" | "rule-required" | "rule-name-required"
  | "vertex-label-required" | "duplicate-properties-required" | "required-properties-required"
  | "property-domain-required" | "edge-label-required" | "edge-endpoints-required" | "degree-range-invalid";

export type QualityValidationIssue = {
  code: QualityValidationCode;
  field: keyof QualityRule | "name" | "graphName" | "graphBinding" | "rules";
  ruleIndex?: number;
};

export function validateQualityRuleSet(input: SaveQualityRuleSetInput): QualityValidationIssue[] {
  const issues: QualityValidationIssue[] = [];
  if (!input.name.trim()) issues.push({ code: "name-required", field: "name" });
  if (!input.graphName.trim()) issues.push({ code: "graph-name-required", field: "graphName" });
  if (!input.graphBinding.trim()) issues.push({ code: "graph-binding-required", field: "graphBinding" });
  if (!input.rules.length) issues.push({ code: "rule-required", field: "rules" });
  input.rules.forEach((rule, ruleIndex) => {
    if (!rule.name.trim()) issues.push({ code: "rule-name-required", field: "name", ruleIndex });
    if (["duplicate-vertex", "required-property", "property-domain", "degree-range"].includes(rule.kind) && !rule.vertexLabel?.trim()) {
      issues.push({ code: "vertex-label-required", field: "vertexLabel", ruleIndex });
    }
    if (rule.kind === "duplicate-vertex" && (!rule.propertyKeys?.length || rule.propertyKeys.length > 5)) {
      issues.push({ code: "duplicate-properties-required", field: "propertyKeys", ruleIndex });
    }
    if (rule.kind === "required-property" && !rule.propertyKeys?.length) {
      issues.push({ code: "required-properties-required", field: "propertyKeys", ruleIndex });
    }
    if (rule.kind === "property-domain" && !rule.propertyKey?.trim()) {
      issues.push({ code: "property-domain-required", field: "propertyKey", ruleIndex });
    }
    if (rule.kind === "edge-endpoint") {
      if (!rule.edgeLabel?.trim()) issues.push({ code: "edge-label-required", field: "edgeLabel", ruleIndex });
      if (!rule.outVertexLabels?.length || !rule.inVertexLabels?.length) issues.push({ code: "edge-endpoints-required", field: "outVertexLabels", ruleIndex });
    }
    if (rule.kind === "degree-range" && (rule.minDegree ?? 0) > (rule.maxDegree ?? Number.MAX_SAFE_INTEGER)) {
      issues.push({ code: "degree-range-invalid", field: "maxDegree", ruleIndex });
    }
  });
  return issues;
}

export function friendlyQualitySaveError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const messages = [...text.matchAll(/"message"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
  return [...new Set(messages)].join("；") || text.replace(/^Error invoking remote method '[^']+':\s*/, "");
}
