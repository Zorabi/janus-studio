import type { PickedDataFile } from "@janusgraph/domain";
import { decodeGraphValue, printableValue, type ResultRow } from "./result-model";

export type GraphArchiveVertex = {
  id: string;
  label: string;
  properties: Record<string, unknown>;
};

export type GraphArchiveEdge = {
  id: string;
  label: string;
  from: string;
  to: string;
  properties: Record<string, unknown>;
};

export type GraphArchive = {
  format: "janus-studio.graph/v1";
  exportedAt: string;
  vertices: GraphArchiveVertex[];
  edges: GraphArchiveEdge[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function archiveProperties(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function parseGraphArchive(file: PickedDataFile): GraphArchive {
  if (file.extension !== "json") {
    throw new Error("整图导入仅支持 Janus Studio JSON 图归档");
  }
  const decoded = decodeGraphValue(JSON.parse(file.content));
  if (
    !isRecord(decoded) ||
    decoded.format !== "janus-studio.graph/v1" ||
    !Array.isArray(decoded.vertices) ||
    !Array.isArray(decoded.edges)
  ) {
    throw new Error("文件不是有效的 Janus Studio v1 图归档");
  }
  const vertices = decoded.vertices.map((value, index) => {
    if (!isRecord(value) || value.id === undefined || !value.label) {
      throw new Error(`第 ${index + 1} 个顶点缺少 id 或 label`);
    }
    return {
      id: String(value.id),
      label: String(value.label),
      properties: archiveProperties(value.properties),
    };
  });
  const edges = decoded.edges.map((value, index) => {
    if (
      !isRecord(value) ||
      value.id === undefined ||
      !value.label ||
      value.from === undefined ||
      value.to === undefined
    ) {
      throw new Error(`第 ${index + 1} 条边缺少 id、label、from 或 to`);
    }
    return {
      id: String(value.id),
      label: String(value.label),
      from: String(value.from),
      to: String(value.to),
      properties: archiveProperties(value.properties),
    };
  });
  return {
    format: "janus-studio.graph/v1",
    exportedAt:
      typeof decoded.exportedAt === "string"
        ? decoded.exportedAt
        : new Date().toISOString(),
    vertices,
    edges,
  };
}

export function parseCsv(content: string): ResultRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      record.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  record.push(field);
  if (record.some((value) => value.length > 0)) records.push(record);
  const headers = records.shift()?.map((header) => header.trim()) ?? [];
  return records.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

export function parseDataFile(file: PickedDataFile): ResultRow[] {
  if (file.extension === "csv") return parseCsv(file.content);
  const decoded = decodeGraphValue(JSON.parse(file.content));
  if (Array.isArray(decoded)) {
    return decoded.filter(
      (value): value is ResultRow =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value),
    );
  }
  if (decoded && typeof decoded === "object") {
    const object = decoded as Record<string, unknown>;
    for (const key of ["vertices", "data", "items", "result"]) {
      if (Array.isArray(object[key])) {
        return (object[key] as unknown[]).filter(
          (value): value is ResultRow =>
            Boolean(value) && typeof value === "object" && !Array.isArray(value),
        );
      }
    }
    return [object];
  }
  throw new Error("JSON 文件必须包含对象数组");
}

function escapeCsv(value: unknown): string {
  const text = printableValue(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows: ResultRow[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    columns.map(escapeCsv).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}
