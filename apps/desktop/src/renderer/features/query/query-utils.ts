import type { GraphEdgeModel, GraphNodeModel } from "../../lib/result-model";

export function parseBindings(bindingsText: string): Record<string, unknown> {
  const value = JSON.parse(bindingsText || "{}") as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("查询参数必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

export function gremlinFileName(title: string): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\.+$/g, "") || "query";
  return /\.(?:gremlin|groovy)$/i.test(safeTitle) ? safeTitle : `${safeTitle}.gremlin`;
}

export function tabTitleFromFileName(fileName: string): string {
  const title = fileName.replace(/\.(?:gremlin|groovy|grem)$/i, "").trim();
  return title || "query";
}

export function isMutationQuery(query: string): boolean {
  const normalized = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
  return /\.(?:addV|addE|mergeV|mergeE|property|drop|sideEffect|write)\s*\(|\.tx\s*\(\)|Management\s*\(/i.test(normalized);
}

export function withTraversalAnalysis(query: string, step: "explain" | "profile") {
  const source = query.trim().replace(/;\s*$/, "");
  if (new RegExp(`\\.${step}\\(\\)\\.next\\(\\)\\.toString\\(\\)$`).test(source)) {
    return source;
  }
  const traversal = source.replace(/\.(?:toList|next|iterate)\s*\(\s*\)\s*$/, "");
  const analyzed = traversal.endsWith(`.${step}()`) ? traversal : `${traversal}.${step}()`;
  return `${analyzed}.next().toString()`;
}

export function configuredPropertyFields(fields: string): string[] {
  return fields
    .split(",")
    .map((field) => field.trim())
    .filter(
      (field) =>
        field &&
        field !== "label" &&
        field !== "~label" &&
        field !== "id" &&
        field !== "~id",
    );
}

export function hasDisplayProperty(
  entity: GraphNodeModel | GraphEdgeModel,
  fields: string[],
): boolean {
  return fields.some((field) => {
    const value = entity.properties[field];
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}
