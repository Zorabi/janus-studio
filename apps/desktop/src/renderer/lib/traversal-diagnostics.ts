export type TraversalAnalysisKind = "explain" | "profile";

export type TraversalDiagnosticStep = {
  name: string;
  count?: number;
  traversers?: number;
  durationMs?: number;
  percent?: number;
};

export type TraversalDiagnosticStrategy = {
  name: string;
  category?: string;
  traversal?: string;
};

export type TraversalDiagnostics = {
  kind: TraversalAnalysisKind;
  steps: TraversalDiagnosticStep[];
  strategies: TraversalDiagnosticStrategy[];
  totalDurationMs?: number;
  source: "object" | "text";
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  if (value instanceof Map) return Object.fromEntries(value) as UnknownRecord;
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function graphsonValue(value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  const candidate = record(value);
  if (!candidate || !("@value" in candidate)) return value;
  const type = typeof candidate["@type"] === "string" ? candidate["@type"] : "";
  const inner = candidate["@value"];
  if (/Map$/i.test(type) && Array.isArray(inner)) {
    const mapped: UnknownRecord = {};
    for (let index = 0; index + 1 < inner.length; index += 2) {
      mapped[String(graphsonValue(inner[index]))] = graphsonValue(inner[index + 1]);
    }
    return mapped;
  }
  return graphsonValue(inner);
}

function field(source: UnknownRecord, names: string[]): unknown {
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null) {
      return graphsonValue(source[name]);
    }
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const unwrapped = graphsonValue(value);
  if (typeof unwrapped === "number") return Number.isFinite(unwrapped) ? unwrapped : undefined;
  if (typeof unwrapped !== "string") return undefined;
  const parsed = Number(unwrapped.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function durationMs(value: unknown, key = ""): number | undefined {
  const unwrapped = graphsonValue(value);
  if (typeof unwrapped === "string") {
    const match = /(-?[\d,.]+)\s*(ns|(?:microseconds?|µs|us)|ms|milliseconds?|s|seconds?)?/i.exec(unwrapped);
    if (!match) return undefined;
    const amount = Number(match[1]!.replace(/,/g, ""));
    if (!Number.isFinite(amount)) return undefined;
    const unit = match[2]?.toLowerCase();
    if (unit === "ns") return amount / 1_000_000;
    if (unit === "µs" || unit === "us" || unit?.startsWith("micro")) return amount / 1_000;
    if (unit === "s" || unit?.startsWith("second")) return amount * 1_000;
    return /nano|durationns/i.test(key) ? amount / 1_000_000 : amount;
  }
  const amount = finiteNumber(unwrapped);
  if (amount === undefined) return undefined;
  return /nano|durationns/i.test(key) ? amount / 1_000_000 : amount;
}

function findDuration(source: UnknownRecord): number | undefined {
  for (const key of ["durationMs", "durationMillis", "dur", "duration", "durationNs", "nanoseconds"]) {
    if (source[key] === undefined) continue;
    const parsed = durationMs(source[key], key);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  const unwrapped = graphsonValue(value);
  return Array.isArray(unwrapped) ? unwrapped : [];
}

function parseMetric(value: unknown): TraversalDiagnosticStep | null {
  const metric = record(graphsonValue(value));
  if (!metric) return null;
  const counts = record(graphsonValue(field(metric, ["counts", "counters"]))) ?? {};
  const rawName = field(metric, ["name", "step", "label", "id"]);
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) return null;
  const count = finiteNumber(field(metric, ["count", "elementCount"]) ?? field(counts, ["count", "elementCount"]));
  const traversers = finiteNumber(field(metric, ["traversers", "traverserCount"]) ?? field(counts, ["traversers", "traverserCount"]));
  const percent = finiteNumber(field(metric, ["percent", "percentage", "percentDuration"]));
  const metricDurationMs = findDuration(metric);
  return {
    name,
    ...(count === undefined ? {} : { count }),
    ...(traversers === undefined ? {} : { traversers }),
    ...(metricDurationMs === undefined ? {} : { durationMs: metricDurationMs }),
    ...(percent === undefined ? {} : { percent }),
  };
}

function collectRecords(value: unknown): UnknownRecord[] {
  const result: UnknownRecord[] = [];
  const queue: unknown[] = [value];
  const visited = new Set<object>();
  while (queue.length > 0 && result.length < 2_000) {
    const current = graphsonValue(queue.shift());
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const currentRecord = current as UnknownRecord;
    result.push(currentRecord);
    queue.push(...Object.values(currentRecord));
  }
  return result;
}

function completePercentages(steps: TraversalDiagnosticStep[], totalDurationMs?: number) {
  const total = totalDurationMs ?? steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);
  if (!(total > 0)) return steps;
  return steps.map((step) => step.percent === undefined && step.durationMs !== undefined
    ? { ...step, percent: (step.durationMs / total) * 100 }
    : step);
}

function parseProfileObject(items: unknown[]): TraversalDiagnostics | null {
  for (const candidate of collectRecords(items)) {
    const rawMetrics = field(candidate, ["metrics", "steps", "stepMetrics"]);
    const metrics = asArray(rawMetrics).map(parseMetric).filter((metric): metric is TraversalDiagnosticStep => Boolean(metric));
    if (metrics.length === 0) continue;
    const total = findDuration(candidate);
    return {
      kind: "profile",
      steps: completePercentages(metrics, total),
      strategies: [],
      ...(total === undefined ? {} : { totalDurationMs: total }),
      source: "object",
    };
  }
  return null;
}

function splitTraversalSteps(traversal: string): string[] {
  const body = traversal.trim().replace(/^\[/, "").replace(/\]$/, "");
  const steps: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (quote) {
      if (character === quote && body[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if ("([{<".includes(character)) depth += 1;
    else if (")]}>".includes(character)) depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      const step = body.slice(start, index).trim();
      if (step) steps.push(step);
      start = index + 1;
    }
  }
  const last = body.slice(start).trim();
  if (last) steps.push(last);
  return steps;
}

function traversalText(value: unknown): string {
  const unwrapped = graphsonValue(value);
  if (typeof unwrapped === "string") return unwrapped.trim();
  if (Array.isArray(unwrapped)) {
    const steps = unwrapped.map((step) => {
      if (typeof graphsonValue(step) === "string") return String(graphsonValue(step));
      const stepRecord = record(graphsonValue(step));
      const name = stepRecord && field(stepRecord, ["name", "step", "label", "id"]);
      return typeof name === "string" ? name : "";
    }).filter(Boolean);
    return steps.length > 0 ? `[${steps.join(", ")}]` : "";
  }
  const traversalRecord = record(unwrapped);
  if (!traversalRecord) return "";
  const nested = field(traversalRecord, ["steps", "traversal", "value", "name"]);
  return nested === unwrapped ? "" : traversalText(nested);
}

function parseExplainObject(items: unknown[]): TraversalDiagnostics | null {
  const records = collectRecords(items);
  const strategies: TraversalDiagnosticStrategy[] = [];
  let finalTraversal = "";
  for (const candidate of records) {
    const rawFinal = field(candidate, ["finalTraversal", "final", "optimizedTraversal"]);
    if (!finalTraversal) finalTraversal = traversalText(rawFinal);
    const rawName = field(candidate, ["strategy", "strategyName"]);
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) continue;
    const rawCategory = field(candidate, ["category", "type"]);
    const rawTraversal = field(candidate, ["traversal", "result"]);
    const strategyTraversal = traversalText(rawTraversal);
    strategies.push({
      name,
      ...(typeof rawCategory === "string" && rawCategory ? { category: rawCategory } : {}),
      ...(strategyTraversal ? { traversal: strategyTraversal } : {}),
    });
  }
  if (!finalTraversal && strategies.length > 0) {
    finalTraversal = strategies.at(-1)?.traversal ?? "";
  }
  const steps = splitTraversalSteps(finalTraversal).map((name) => ({ name }));
  if (strategies.length === 0 && steps.length === 0) return null;
  return { kind: "explain", steps, strategies, source: "object" };
}

function textItems(items: unknown[]): string[] {
  return items.flatMap((item) => {
    const value = graphsonValue(item);
    if (typeof value === "string") return [value.replace(/^==>/, "")];
    return [];
  });
}

function parseProfileText(text: string): TraversalDiagnostics | null {
  const steps: TraversalDiagnosticStep[] = [];
  let totalDurationMs: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    const total = /^\s*>?TOTAL\s+(?:-\s+){1,3}([\d,.]+)(?:\s+-)?\s*$/i.exec(line);
    if (total) {
      totalDurationMs = Number(total[1]!.replace(/,/g, ""));
      continue;
    }
    const match = /^\s*(.+?)\s+(?:(\d[\d,]*)\s+(\d[\d,]*)\s+)?([\d,.]+)\s+([\d,.]+)\s*$/.exec(line);
    if (!match || /^(?:Step|TOTAL)$/i.test(match[1]!.trim())) continue;
    steps.push({
      name: match[1]!.trim(),
      ...(match[2] ? { count: Number(match[2].replace(/,/g, "")) } : {}),
      ...(match[3] ? { traversers: Number(match[3].replace(/,/g, "")) } : {}),
      durationMs: Number(match[4]!.replace(/,/g, "")),
      percent: Number(match[5]!.replace(/,/g, "")),
    });
  }
  if (steps.length === 0) return null;
  return {
    kind: "profile",
    steps: completePercentages(steps, totalDurationMs),
    strategies: [],
    ...(totalDurationMs === undefined ? {} : { totalDurationMs }),
    source: "text",
  };
}

function parseExplainText(text: string): TraversalDiagnostics | null {
  const strategies: TraversalDiagnosticStrategy[] = [];
  let finalTraversal = "";
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const final = /^\s*Final Traversal\s+(.+)\s*$/i.exec(line);
    if (final) {
      finalTraversal = final[1]!.trim();
      continue;
    }
    const strategy = /^\s*([\w.$]+Strategy)\s+(?:\[([A-Z])\]\s+)?(.+?)\s*$/.exec(line);
    if (!strategy) continue;
    strategies.push({
      name: strategy[1]!,
      ...(strategy[2] ? { category: strategy[2] } : {}),
      traversal: strategy[3]!.trim(),
    });
  }
  if (!finalTraversal) finalTraversal = strategies.at(-1)?.traversal ?? "";
  const steps = splitTraversalSteps(finalTraversal).map((name) => ({ name }));
  if (strategies.length === 0 && steps.length === 0) return null;
  return { kind: "explain", steps, strategies, source: "text" };
}

export function parseTraversalDiagnostics(
  items: unknown[],
  kind: TraversalAnalysisKind,
): TraversalDiagnostics | null {
  const objectResult = kind === "profile"
    ? parseProfileObject(items)
    : parseExplainObject(items);
  if (objectResult) return objectResult;
  const text = textItems(items).join("\n");
  if (!text.trim()) return null;
  return kind === "profile" ? parseProfileText(text) : parseExplainText(text);
}
