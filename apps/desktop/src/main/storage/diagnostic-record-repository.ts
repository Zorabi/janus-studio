import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  DiagnosticRecord,
  DiagnosticRecordStatus,
  DiagnosticReport,
  SaveDiagnosticRecordInput,
} from "@janusgraph/domain";

type Row = {
  id: string; fingerprint: string; origin: DiagnosticRecord["origin"]; source_name: string;
  status: DiagnosticRecordStatus; incident_json: string; report_json: string;
  occurrence_count: number; created_at: string; updated_at: string;
};

function recordFromRow(row: Row): DiagnosticRecord {
  return {
    id: row.id, fingerprint: row.fingerprint, origin: row.origin, sourceName: row.source_name,
    status: row.status, incident: row.incident_json ? JSON.parse(row.incident_json) : undefined,
    report: JSON.parse(row.report_json) as DiagnosticReport, occurrenceCount: row.occurrence_count,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function fingerprint(input: SaveDiagnosticRecordInput): string {
  const stable = JSON.stringify({
    origin: input.origin,
    sourceName: input.sourceName ?? "",
    incident: input.incident ? {
      source: input.incident.source,
      title: input.incident.title,
      connectionName: input.incident.connectionName ?? "",
      graphName: input.incident.graphName ?? "",
      stage: input.incident.stage ?? "",
      message: input.incident.message ?? "",
      occurredAt: input.incident.occurredAt,
    } : null,
    findings: input.report.findings.map((finding) => input.incident
      ? finding.code
      : {
          code: finding.code,
          evidence: finding.evidence.map((item) => ({ source: item.source, excerpt: item.excerpt })),
        }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
  return createHash("sha256").update(stable).digest("hex");
}

export class DiagnosticRecordRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(limit = 200): DiagnosticRecord[] {
    return (this.database.prepare("SELECT * FROM diagnostic_records ORDER BY updated_at DESC LIMIT ?").all(limit) as Row[]).map(recordFromRow);
  }

  save(input: SaveDiagnosticRecordInput): DiagnosticRecord {
    const key = fingerprint(input);
    const now = new Date().toISOString();
    const existing = this.database.prepare("SELECT * FROM diagnostic_records WHERE fingerprint = ?").get(key) as Row | undefined;
    if (existing) {
      this.database.prepare(`UPDATE diagnostic_records SET report_json = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(input.report), now, existing.id);
      return this.get(existing.id)!;
    }
    const id = randomUUID();
    this.database.prepare(`INSERT INTO diagnostic_records (id, fingerprint, origin, source_name, status, incident_json, report_json, occurrence_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'unread', ?, ?, 1, ?, ?)`)
      .run(id, key, input.origin, input.sourceName ?? "", input.incident ? JSON.stringify(input.incident) : "", JSON.stringify(input.report), now, now);
    this.prune();
    return this.get(id)!;
  }

  get(id: string): DiagnosticRecord | undefined {
    const row = this.database.prepare("SELECT * FROM diagnostic_records WHERE id = ?").get(id) as Row | undefined;
    return row ? recordFromRow(row) : undefined;
  }

  setStatus(id: string, status: DiagnosticRecordStatus): DiagnosticRecord {
    this.database.prepare("UPDATE diagnostic_records SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), id);
    const record = this.get(id);
    if (!record) throw new Error("诊断记录不存在或已被删除");
    return record;
  }

  remove(id: string): void { this.database.prepare("DELETE FROM diagnostic_records WHERE id = ?").run(id); }

  private prune(): void {
    this.database.exec(`DELETE FROM diagnostic_records WHERE datetime(updated_at) < datetime('now', '-90 days') OR id NOT IN (SELECT id FROM diagnostic_records ORDER BY updated_at DESC LIMIT 200)`);
  }
}
