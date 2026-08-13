import type {
  DiagnosticLogEntry,
  DiagnosticLogLevel,
  DiagnosticLogListInput,
  DiagnosticLogSource,
} from "@janusgraph/domain";
import { redactDiagnosticRecord, redactDiagnosticText, redactDiagnosticValue } from "./redactor";

type LoggerDependencies = {
  now?: () => Date;
  id?: () => string;
};

export type DiagnosticLogInput = {
  level: DiagnosticLogLevel;
  source: DiagnosticLogSource;
  event: string;
  message: string;
  context?: Record<string, unknown>;
  error?: unknown;
  sensitiveTexts?: string[];
};

export class StructuredLogger {
  private readonly entries: DiagnosticLogEntry[] = [];
  private readonly now: () => Date;
  private readonly id: () => string;
  private sequence = 0;

  constructor(
    private readonly capacity = 500,
    dependencies: LoggerDependencies = {},
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Diagnostic log capacity must be a positive integer");
    }
    this.now = dependencies.now ?? (() => new Date());
    this.id = dependencies.id ?? (() => `diagnostic-${++this.sequence}`);
  }

  write(input: DiagnosticLogInput): DiagnosticLogEntry {
    const redactedError = input.error === undefined
      ? undefined
      : redactDiagnosticValue(input.error, input.sensitiveTexts);
    const entry: DiagnosticLogEntry = {
      id: this.id(),
      timestamp: this.now().toISOString(),
      level: input.level,
      source: input.source,
      event: redactDiagnosticText(input.event),
      message: redactDiagnosticText(input.message),
      ...(input.context ? { context: redactDiagnosticRecord(input.context) } : {}),
      ...(input.error !== undefined ? { error: redactedError } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    return structuredClone(entry);
  }

  debug(source: DiagnosticLogSource, event: string, message: string, context?: Record<string, unknown>): void {
    this.write({ level: "debug", source, event, message, context });
  }

  info(source: DiagnosticLogSource, event: string, message: string, context?: Record<string, unknown>): void {
    this.write({ level: "info", source, event, message, context });
  }

  warn(source: DiagnosticLogSource, event: string, message: string, context?: Record<string, unknown>, error?: unknown): void {
    this.write({ level: "warn", source, event, message, context, error });
  }

  error(source: DiagnosticLogSource, event: string, message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.write({ level: "error", source, event, message, context, error });
  }

  list(input: DiagnosticLogListInput = {}): DiagnosticLogEntry[] {
    const levels = input.levels ? new Set(input.levels) : undefined;
    const sources = input.sources ? new Set(input.sources) : undefined;
    const limit = input.limit ?? 200;
    return this.entries
      .filter((entry) => (!levels || levels.has(entry.level)) && (!sources || sources.has(entry.source)))
      .slice(-limit)
      .reverse()
      .map((entry) => structuredClone(entry));
  }
}
