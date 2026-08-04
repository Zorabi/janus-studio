import { decodeGraphValue } from "./result-model";

export type GremlinSchemaCatalog = {
  vertexLabels: string[];
  edgeLabels: string[];
  propertyKeys: string[];
};

export type GremlinCompletion = {
  label: string;
  category: "step" | "vertexLabel" | "edgeLabel" | "propertyKey";
  insertText: string;
  detail: string;
};

export const EMPTY_SCHEMA_CATALOG: GremlinSchemaCatalog = {
  vertexLabels: [],
  edgeLabels: [],
  propertyKeys: [],
};

export function schemaRowsFromItems(items: unknown[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const visit = (item: unknown) => {
    const decoded = decodeGraphValue(item);
    if (Array.isArray(decoded)) {
      decoded.forEach(visit);
      return;
    }
    if (!decoded || typeof decoded !== "object") return;
    const row = decoded as Record<string, unknown>;
    if (typeof row.group === "string" && typeof row.name === "string") rows.push(row);
  };
  items.forEach(visit);
  return rows;
}

export function schemaCatalogFromRows(items: unknown[]): GremlinSchemaCatalog {
  const catalog: GremlinSchemaCatalog = { vertexLabels: [], edgeLabels: [], propertyKeys: [] };
  for (const value of schemaRowsFromItems(items)) {
    if (typeof value.name !== "string") continue;
    if (value.group === "vertexLabels") catalog.vertexLabels.push(value.name);
    if (value.group === "edgeLabels") catalog.edgeLabels.push(value.name);
    if (value.group === "propertyKeys") catalog.propertyKeys.push(value.name);
  }
  return {
    vertexLabels: [...new Set(catalog.vertexLabels)].sort(),
    edgeLabels: [...new Set(catalog.edgeLabels)].sort(),
    propertyKeys: [...new Set(catalog.propertyKeys)].sort(),
  };
}

function schemaValuesBeforeCursor(
  text: string,
  catalog: GremlinSchemaCatalog,
): { category: GremlinCompletion["category"]; values: string[] } | null {
  const tail = text.slice(Math.max(0, text.length - 180));
  if (/\baddV\(\s*['"]?[^'")]*$/i.test(tail)) return { category: "vertexLabel", values: catalog.vertexLabels };
  if (/\baddE\(\s*['"]?[^'")]*$/i.test(tail)) return { category: "edgeLabel", values: catalog.edgeLabels };
  if (/\b(?:out|in|both|outE|inE|bothE)\(\s*['"]?[^'")]*$/i.test(tail)) {
    return { category: "edgeLabel", values: catalog.edgeLabels };
  }
  if (/\bhasLabel\(\s*['"]?[^'")]*$/i.test(tail)) {
    return { category: "vertexLabel", values: [...catalog.vertexLabels, ...catalog.edgeLabels] };
  }
  if (/\b(?:has|hasKey|values|valueMap|propertyMap|properties|property|by)\(\s*['"]?[^,'")]*$/i.test(tail)) {
    return { category: "propertyKey", values: catalog.propertyKeys };
  }
  return null;
}

export function schemaCompletions(
  textBeforeCursor: string,
  catalog: GremlinSchemaCatalog,
): GremlinCompletion[] {
  const context = schemaValuesBeforeCursor(textBeforeCursor, catalog);
  if (!context) return [];
  const quoteOpen = /['"][^'"]*$/.test(textBeforeCursor);
  return [...new Set(context.values)].map((value) => ({
    label: value,
    category: context.category,
    insertText: quoteOpen ? value : `'${value}'`,
    detail:
      context.category === "propertyKey"
        ? "JanusGraph Property Key"
        : context.category === "edgeLabel"
          ? "JanusGraph Edge Label"
          : "JanusGraph Vertex Label",
  }));
}
