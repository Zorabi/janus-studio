export type ResultRow = Record<string, unknown>;

export type GraphNodeModel = {
  id: string;
  rawId?: unknown;
  label: string;
  properties: Record<string, unknown>;
};

export type GraphEdgeModel = {
  id: string;
  rawId?: unknown;
  label: string;
  from: string;
  to: string;
  properties: Record<string, unknown>;
};

export type GraphModel = {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
};

function graphKey(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of ["elementName", "name", "value", "typeName"]) {
      if (typeof object[key] === "string") return object[key];
    }
  }
  return JSON.stringify(value);
}

export function decodeGraphValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeGraphValue);
  if (!value || typeof value !== "object") return value;

  const object = value as Record<string, unknown>;
  if (object["@type"] === "g:Map" && Array.isArray(object["@value"])) {
    const pairs = object["@value"];
    const decoded: Record<string, unknown> = {};
    for (let index = 0; index < pairs.length; index += 2) {
      decoded[graphKey(decodeGraphValue(pairs[index]))] = decodeGraphValue(
        pairs[index + 1],
      );
    }
    return decoded;
  }
  if (typeof object["@type"] === "string" && "@value" in object) {
    return decodeGraphValue(object["@value"]);
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [key, decodeGraphValue(entry)]),
  );
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function endpointId(value: unknown): string {
  const object = recordOf(value);
  if (object) {
    for (const key of ["id", "_id", "value", "elementId", "relationId"]) {
      if (object[key] !== undefined) return endpointId(object[key]);
    }
  }
  return value === undefined || value === null ? "" : String(value);
}

function endpointRawId(value: unknown): unknown {
  const object = recordOf(value);
  if (object) {
    for (const key of ["id", "_id", "value", "elementId", "relationId"]) {
      if (object[key] !== undefined) return endpointRawId(object[key]);
    }
  }
  return value;
}

function endpointLabel(value: unknown): string | undefined {
  const object = recordOf(value);
  if (!object) return undefined;
  const label = firstValue(object, ["label", "_label", "type", "elementLabel"]);
  return label === undefined || label === null ? undefined : String(label);
}

function firstValue(
  object: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (object[key] !== undefined) return object[key];
  }
  return undefined;
}

function graphProperties(
  object: Record<string, unknown>,
  omitted: Set<string>,
): Record<string, unknown> {
  const direct = recordOf(object.properties);
  if (direct) return direct;
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => !omitted.has(key)),
  );
}

export function buildGraphModel(items: unknown[]): GraphModel {
  const nodes = new Map<string, GraphNodeModel>();
  const edges = new Map<string, GraphEdgeModel>();
  const endpointMetadata = new Map<
    string,
    { rawId: unknown; label?: string }
  >();

  const visit = (raw: unknown): void => {
    const value = decodeGraphValue(raw);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const object = recordOf(value);
    if (!object) return;

    const fromValue = firstValue(object, [
      "outV",
      "_outV",
      "outVertex",
      "OUT",
      "out",
      "from",
      "source",
      "~from",
      "Direction.OUT",
    ]);
    const toValue = firstValue(object, [
      "inV",
      "_inV",
      "inVertex",
      "IN",
      "in",
      "to",
      "target",
      "~to",
      "Direction.IN",
    ]);
    const from = endpointId(fromValue);
    const to = endpointId(toValue);
    const idValue = firstValue(object, ["id", "_id", "elementId"]);
    const id = idValue === undefined ? "" : endpointId(idValue);
    const label = String(
      firstValue(object, ["label", "_label", "type", "elementLabel"]) ?? "element",
    );

    if (from && to) {
      endpointMetadata.set(from, {
        rawId: endpointRawId(fromValue),
        label: endpointLabel(fromValue),
      });
      endpointMetadata.set(to, {
        rawId: endpointRawId(toValue),
        label: endpointLabel(toValue),
      });
      const edgeId = id || `${from}:${label}:${to}:${edges.size}`;
      edges.set(edgeId, {
        id: edgeId,
        rawId: idValue ?? edgeId,
        label,
        from,
        to,
        properties: graphProperties(
          object,
          new Set([
            "id",
            "label",
            "type",
            "outV",
            "_outV",
            "outVertex",
            "OUT",
            "out",
            "from",
            "source",
            "~from",
            "Direction.OUT",
            "inV",
            "_inV",
            "inVertex",
            "IN",
            "in",
            "to",
            "target",
            "~to",
            "Direction.IN",
            "properties",
          ]),
        ),
      });
    } else if (id && ("label" in object || "type" in object || "properties" in object)) {
      nodes.set(id, {
        id,
        rawId: idValue,
        label,
        properties: graphProperties(
          object,
          new Set(["id", "label", "type", "properties"]),
        ),
      });
    }

    for (const entry of Object.values(object)) {
      if (entry !== object.properties) visit(entry);
    }
  };

  items.forEach(visit);
  for (const edge of edges.values()) {
    if (!nodes.has(edge.from)) {
      const metadata = endpointMetadata.get(edge.from);
      nodes.set(edge.from, {
        id: edge.from,
        rawId: metadata?.rawId ?? edge.from,
        label: metadata?.label ?? "vertex",
        properties: {},
      });
    }
    if (!nodes.has(edge.to)) {
      const metadata = endpointMetadata.get(edge.to);
      nodes.set(edge.to, {
        id: edge.to,
        rawId: metadata?.rawId ?? edge.to,
        label: metadata?.label ?? "vertex",
        properties: {},
      });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function mergeGraphModels(
  base: GraphModel,
  enrichment: GraphModel,
): GraphModel {
  const nodes = new Map(
    base.nodes.map((node) => [node.id, { ...node, properties: { ...node.properties } }]),
  );
  const edges = new Map(
    base.edges.map((edge) => [edge.id, { ...edge, properties: { ...edge.properties } }]),
  );

  enrichment.nodes.forEach((node) => {
    const current = nodes.get(node.id);
    nodes.set(
      node.id,
      current
        ? {
            ...current,
            ...node,
            rawId: current.rawId ?? node.rawId,
            properties: { ...current.properties, ...node.properties },
          }
        : { ...node, properties: { ...node.properties } },
    );
  });
  enrichment.edges.forEach((edge) => {
    const current = edges.get(edge.id);
    edges.set(
      edge.id,
      current
        ? {
            ...current,
            ...edge,
            rawId: current.rawId ?? edge.rawId,
            properties: { ...current.properties, ...edge.properties },
          }
        : { ...edge, properties: { ...edge.properties } },
    );
  });

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function flattenObject(
  object: Record<string, unknown>,
  prefix = "",
  depth = 0,
): ResultRow {
  const row: ResultRow = {};
  for (const [key, rawValue] of Object.entries(object)) {
    if (key === "properties") {
      const properties = recordOf(decodeGraphValue(rawValue));
      if (properties) {
        for (const [propertyKey, propertyValue] of Object.entries(properties)) {
          const decoded = decodeGraphValue(propertyValue);
          const values = Array.isArray(decoded)
            ? decoded.map(unwrapPropertyValue)
            : unwrapPropertyValue(decoded);
          const value = Array.isArray(values) && values.length === 1 ? values[0] : values;
          const column = row[propertyKey] === undefined && object[propertyKey] === undefined
            ? propertyKey
            : `property.${propertyKey}`;
          row[column] = value;
        }
        continue;
      }
    }
    const column = prefix ? `${prefix}.${key}` : key;
    const value = decodeGraphValue(rawValue);
    const nested = recordOf(value);
    if (nested && depth < 1) {
      Object.assign(row, flattenObject(nested, column, depth + 1));
    } else if (Array.isArray(value) || nested) {
      row[column] = JSON.stringify(value);
    } else {
      row[column] = value;
    }
  }
  return row;
}

function unwrapPropertyValue(value: unknown): unknown {
  const object = recordOf(value);
  if (!object || !("value" in object)) return value;
  return decodeGraphValue(object.value);
}

export function buildTableRows(items: unknown[]): ResultRow[] {
  return items.map((raw, index) => {
    const value = decodeGraphValue(raw);
    const object = recordOf(value);
    return object
      ? { "#": index + 1, ...flattenObject(object) }
      : { "#": index + 1, value };
  });
}

export function structuredJsonItems(items: unknown[]): unknown[] {
  return items.map((raw) => {
    const value = decodeGraphValue(raw);
    const object = recordOf(value);
    if (!object) return value;
    const flattened = flattenObject(object);
    return Object.fromEntries(
      tableColumns([flattened]).map((key) => [key, flattened[key]]),
    );
  });
}

export function tableColumns(rows: ResultRow[]): string[] {
  const columns = new Set<string>();
  rows.slice(0, 200).forEach((row) => {
    Object.keys(row).forEach((key) => columns.add(key));
  });
  const pinned = new Map([
    ["#", 0],
    ["id", 1],
    ["label", 2],
    ["value", 3],
  ]);
  const natural = new Intl.Collator("en", {
    numeric: true,
    sensitivity: "base",
  });
  return [...columns].sort((left, right) => {
    const leftPriority = pinned.get(left);
    const rightPriority = pinned.get(right);
    if (leftPriority !== undefined || rightPriority !== undefined) {
      return (leftPriority ?? Number.MAX_SAFE_INTEGER) -
        (rightPriority ?? Number.MAX_SAFE_INTEGER);
    }
    return natural.compare(left, right);
  });
}

export function orderedInspectorEntries(
  record: Record<string, unknown>,
): Array<[string, unknown]> {
  const pinned = new Map([
    ["id", 0],
    ["label", 1],
    ["from", 2],
    ["to", 3],
  ]);
  const natural = new Intl.Collator("en", {
    numeric: true,
    sensitivity: "base",
  });
  return Object.entries(record).sort(([left], [right]) => {
    const leftPriority = pinned.get(left.toLocaleLowerCase());
    const rightPriority = pinned.get(right.toLocaleLowerCase());
    if (leftPriority !== undefined || rightPriority !== undefined) {
      return (leftPriority ?? Number.MAX_SAFE_INTEGER) -
        (rightPriority ?? Number.MAX_SAFE_INTEGER);
    }
    return natural.compare(left, right);
  });
}

export function printableValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatGremlinConsoleValue(value: unknown, depth = 0): string {
  const decoded = decodeGraphValue(value);
  if (depth > 12) return "...";
  if (decoded === null) return "null";
  if (decoded === undefined) return "";
  if (typeof decoded === "string") return decoded.replaceAll("\n", "\\n").replaceAll("\r", "\\r");
  if (typeof decoded === "number" || typeof decoded === "boolean") return String(decoded);
  if (Array.isArray(decoded)) {
    return `[${decoded.map((entry) => formatGremlinConsoleValue(entry, depth + 1)).join(", ")}]`;
  }
  if (typeof decoded === "object") {
    return `{${Object.entries(decoded)
      .map(([key, entry]) => `${key}=${formatGremlinConsoleValue(entry, depth + 1)}`)
      .join(", ")}}`;
  }
  return String(decoded);
}

function consoleRecord(value: unknown): unknown {
  const decoded = decodeGraphValue(value);
  const object = recordOf(decoded);
  if (!object) return decoded;

  const flattened = flattenObject(object);
  const metadata = new Set(["id", "label"]);
  const natural = new Intl.Collator("en", {
    numeric: true,
    sensitivity: "base",
  });
  const entries = Object.entries(flattened).sort(([left], [right]) => {
    const leftIsMetadata = metadata.has(left);
    const rightIsMetadata = metadata.has(right);
    if (leftIsMetadata !== rightIsMetadata) return leftIsMetadata ? 1 : -1;
    if (leftIsMetadata && rightIsMetadata) {
      return left === right ? 0 : left === "id" ? -1 : 1;
    }
    return natural.compare(left, right);
  });
  return Object.fromEntries(entries);
}

export function gremlinConsoleOutput(items: unknown[]): string {
  return items
    .map((item) => {
      const value = consoleRecord(item);
      return `==>${typeof value === "string" ? value : formatGremlinConsoleValue(value)}`;
    })
    .join("\n");
}
