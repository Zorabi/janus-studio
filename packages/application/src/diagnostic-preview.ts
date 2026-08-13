import type {
  BackgroundTask,
  DiagnosticLogEntry,
  DiagnosticPreviewSelection,
  DiagnosticPreviewSnapshot,
  DiagnosticRuntimeSummary,
} from "@janusgraph/domain";

export type DiagnosticSensitivity = "low" | "moderate" | "elevated";

export type DiagnosticPreviewFile = {
  id: keyof DiagnosticPreviewSelection;
  name: string;
  sensitivity: DiagnosticSensitivity;
  itemCount: number;
  content: string;
};

export const DEFAULT_DIAGNOSTIC_PREVIEW_SELECTION: DiagnosticPreviewSelection = {
  summary: true,
  tasks: true,
  logs: true,
};

function runtimeDocument(
  runtime: DiagnosticRuntimeSummary,
  generatedAt: string,
  incident?: DiagnosticPreviewSnapshot["incident"],
): Record<string, unknown> {
  return {
    generatedAt: readableLocalTime(generatedAt),
    incident: incident ? {
      ...incident,
      occurredAt: readableLocalTime(incident.occurredAt),
    } : null,
    application: { name: "Janus Studio", version: runtime.appVersion },
    runtime: {
      electron: runtime.electronVersion,
      node: runtime.nodeVersion,
      platform: runtime.platform,
      osRelease: runtime.osRelease,
      architecture: runtime.architecture,
    },
    privacy: {
      credentialsIncluded: false,
      authenticationHeadersIncluded: false,
      queryTextIncluded: false,
    },
  };
}

function readableLocalTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").replace(/Z$/, "");
  const pad = (part: number, size = 2) => String(part).padStart(size, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
  ].join(" ");
}

function taskDocument(task: BackgroundTask): Record<string, unknown> {
  return {
    id: task.id,
    kind: task.kind,
    action: task.action,
    title: task.title,
    connectionName: task.connectionName,
    graphName: task.graphName,
    status: task.status,
    stage: task.stage,
    message: task.message,
    progress: {
      current: task.progressCurrent,
      total: task.progressTotal,
      unit: task.progressUnit,
    },
    createdAt: readableLocalTime(task.createdAt),
    updatedAt: readableLocalTime(task.updatedAt),
    completedAt: readableLocalTime(task.completedAt),
  };
}

export function buildDiagnosticPreviewFiles(
  snapshot: DiagnosticPreviewSnapshot,
  selection: DiagnosticPreviewSelection,
): DiagnosticPreviewFile[] {
  const files: DiagnosticPreviewFile[] = [];
  if (selection.summary) {
    files.push({
      id: "summary",
      name: "summary.json",
      sensitivity: "low",
      itemCount: 1,
      content: JSON.stringify(runtimeDocument(snapshot.runtime, snapshot.generatedAt, snapshot.incident), null, 2),
    });
  }
  if (selection.tasks) {
    const tasks = snapshot.tasks.map(taskDocument);
    files.push({
      id: "tasks",
      name: "tasks.json",
      sensitivity: "moderate",
      itemCount: tasks.length,
      content: JSON.stringify(tasks, null, 2),
    });
  }
  if (selection.logs) {
    files.push({
      id: "logs",
      name: "logs.ndjson",
      sensitivity: "elevated",
      itemCount: snapshot.logs.length,
      content: snapshot.logs.map((entry: DiagnosticLogEntry) => JSON.stringify(entry)).join("\n"),
    });
  }
  return files;
}

export function diagnosticPreviewContainsExcludedContent(files: DiagnosticPreviewFile[]): boolean {
  const content = files.map((file) => file.content).join("\n").toLowerCase();
  return ["passwordcipher", "authorization: bearer", "begin private key"].some((marker) =>
    content.includes(marker),
  );
}
