import { schemaRowsFromItems } from "./gremlin-completion";

export type SchemaSnapshotBaseline = {
  savedAt: string;
  rows: Record<string, unknown>[];
};

export type SchemaSnapshotDiff = {
  added: string[];
  missing: string[];
  changed: string[];
};

export function schemaSnapshotRows(items: unknown[]): Record<string, unknown>[] {
  return schemaRowsFromItems(items)
    .map((value) => ({ ...value }))
    .sort((left, right) => `${left.group}:${left.name}`.localeCompare(`${right.group}:${right.name}`));
}

export function compareSchemaRows(
  previous: Record<string, unknown>[],
  current: Record<string, unknown>[],
): SchemaSnapshotDiff {
  const keyed = (values: Record<string, unknown>[]) => new Map(
    values.map((value) => [`${value.group}:${value.name}`, JSON.stringify(value)]),
  );
  const before = keyed(previous);
  const after = keyed(current);
  return {
    added: [...after.keys()].filter((key) => !before.has(key)),
    missing: [...before.keys()].filter((key) => !after.has(key)),
    changed: [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)),
  };
}

export function parseSchemaSnapshotBaseline(value: string | null): SchemaSnapshotBaseline | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(value) as unknown;
    if (Array.isArray(decoded)) {
      const rows = recordRows(decoded);
      return rows.length > 0 ? { savedAt: "", rows } : null;
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
    const snapshot = decoded as { savedAt?: unknown; rows?: unknown };
    if (!Array.isArray(snapshot.rows)) return null;
    return {
      savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : "",
      rows: recordRows(snapshot.rows),
    };
  } catch {
    return null;
  }
}

function recordRows(values: unknown[]): Record<string, unknown>[] {
  return values.filter((row): row is Record<string, unknown> =>
    Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
}
