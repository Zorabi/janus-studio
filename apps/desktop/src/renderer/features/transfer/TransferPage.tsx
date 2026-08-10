import type {
  ConnectionSummary,
  PickedDataFile,
  QueryExecutionResult,
} from "@janusgraph/domain";
import {
  AlertTriangle,
  CircleDot,
  Database,
  Download,
  FileJson,
  FileUp,
  LoaderCircle,
  Square,
  Upload,
  Waypoints,
} from "lucide-react";
import { useRef, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { PageHeader } from "../../components/ui";
import {
  parseGraphArchive,
  type GraphArchive,
} from "../../lib/data-files";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";
import { buildGraphModel, decodeGraphValue } from "../../lib/result-model";
import type { ToastState } from "../query/query-workspace";

export function TransferPage({
  activeConnection,
  execute,
  notify,
}: {
  activeConnection: ConnectionSummary | undefined;
  execute: (
    query: string,
    bindings?: Record<string, unknown>,
    recordHistory?: boolean,
  ) => Promise<QueryExecutionResult>;
  notify: (toast: ToastState) => void;
}) {
  const t = useTranslate();
  const [file, setFile] = useState<PickedDataFile | null>(null);
  const [archive, setArchive] = useState<GraphArchive | null>(null);
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [batchSize, setBatchSize] = useState(100);
  const [continueOnError, setContinueOnError] = useState(false);
  const [conflictPolicy, setConflictPolicy] = useState<"append" | "skip">("append");
  const [identityProperty, setIdentityProperty] = useState("_janusStudioSourceId");
  const [failures, setFailures] = useState<Array<{
    phase: string;
    offset: number;
    message: string;
  }>>([]);
  const cancelTransferRef = useRef(false);
  const [progress, setProgress] = useState({
    phase: "",
    completed: 0,
    total: 0,
  });

  const pick = async () => {
    if (!window.janusGraphDesktop) return;
    try {
      const picked = await window.janusGraphDesktop.files.pickDataFile();
      if (!picked) return;
      const parsed = parseGraphArchive(picked);
      setFile(picked);
      setArchive(parsed);
      notify({
        tone: "success",
        message: t(
          `已读取 ${parsed.vertices.length} 个顶点、${parsed.edges.length} 条边`,
          `Loaded ${parsed.vertices.length} vertices and ${parsed.edges.length} edges`,
        ),
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const importGraph = async () => {
    if (!activeConnection || !archive) return;
    setBusy("import");
    setFailures([]);
    cancelTransferRef.current = false;
    setProgress({
      phase: t("正在创建顶点", "Creating vertices"),
      completed: 0,
      total: archive.vertices.length + archive.edges.length,
    });
    try {
      const idMap = new Map<string, unknown>();
      for (
        let index = 0;
        index < archive.vertices.length;
        index += batchSize
      ) {
        if (cancelTransferRef.current) break;
        const rows = archive.vertices
          .slice(index, index + batchSize)
          .map((vertex) => ({
            sourceId: vertex.id,
            label: vertex.label,
            properties: vertex.properties,
            conflictPolicy,
            identityProperty,
          }));
        try {
          const response = await execute(
          `rows.collect { row ->
  def existing = row.conflictPolicy == "skip" ? g.V().has(row.identityProperty.toString(), row.sourceId).tryNext().orElse(null) : null
  if (existing != null) return [sourceId: row.sourceId, targetId: existing.id()]
  def traversal = g.addV(row.label.toString())
  if (row.conflictPolicy == "skip") traversal = traversal.property(row.identityProperty.toString(), row.sourceId)
  row.properties.each { key, value ->
    if (value instanceof Collection) {
      value.each { item ->
        if (item != null) traversal = traversal.property(key.toString(), item)
      }
    } else if (value != null) {
      traversal = traversal.property(key.toString(), value)
    }
  }
  def vertex = traversal.next()
  [sourceId: row.sourceId, targetId: vertex.id()]
}`,
          { rows },
          false,
        );
          response.items.map(decodeGraphValue).forEach((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return;
            const mapping = value as Record<string, unknown>;
            if (mapping.sourceId !== undefined && mapping.targetId !== undefined) {
              idMap.set(String(mapping.sourceId), mapping.targetId);
            }
          });
        } catch (error) {
          setFailures((current) => [...current, {
            phase: "vertices",
            offset: index,
            message: errorMessage(error),
          }]);
          if (!continueOnError) throw error;
        }
        setProgress((current) => ({
          ...current,
          completed: Math.min(index + rows.length, archive.vertices.length),
        }));
      }

      setProgress((current) => ({
        ...current,
        phase: t("正在创建关系", "Creating edges"),
      }));
      for (let index = 0; index < archive.edges.length; index += batchSize) {
        if (cancelTransferRef.current) break;
        try {
          const rows = archive.edges
          .slice(index, index + batchSize)
          .map((edge) => {
            const fromId = idMap.get(edge.from);
            const toId = idMap.get(edge.to);
            if (fromId === undefined || toId === undefined) {
              throw new Error(`关系 ${edge.id} 引用了归档中不存在的顶点`);
            }
            return {
              label: edge.label,
              fromId,
              toId,
              properties: edge.properties,
            };
          });
          await execute(
          `rows.each { row ->
  def traversal = g.V(row.fromId).addE(row.label.toString()).to(g.V(row.toId))
  row.properties.each { key, value ->
    if (value instanceof Collection) {
      value.each { item ->
        if (item != null) traversal = traversal.property(key.toString(), item)
      }
    } else if (value != null) {
      traversal = traversal.property(key.toString(), value)
    }
  }
  traversal.iterate()
}
rows.size()`,
          { rows },
          false,
        );
          setProgress((current) => ({
            ...current,
            completed:
              archive.vertices.length +
              Math.min(index + rows.length, archive.edges.length),
          }));
        } catch (error) {
          setFailures((current) => [...current, {
            phase: "edges",
            offset: index,
            message: errorMessage(error),
          }]);
          if (!continueOnError) throw error;
        }
      }
      notify({
        tone: cancelTransferRef.current ? "info" : "success",
        message: cancelTransferRef.current
          ? t(
              "导入已在当前批次完成后停止，已写入的数据不会自动回滚。",
              "Import stopped after the current batch. Previously written data was not rolled back.",
            )
          : t(
              `整图导入完成：${archive.vertices.length} 个顶点、${archive.edges.length} 条边`,
              `Graph import complete: ${archive.vertices.length} vertices and ${archive.edges.length} edges`,
            ),
      });
    } catch (error) {
      setFailures((current) => current.length > 0 ? current : [{
        phase: "import",
        offset: progress.completed,
        message: errorMessage(error),
      }]);
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const exportGraph = async () => {
    if (!activeConnection || !window.janusGraphDesktop) return;
    setBusy("export");
    setFailures([]);
    cancelTransferRef.current = false;
    setProgress({ phase: t("正在统计图数据", "Counting graph data"), completed: 0, total: 0 });
    try {
      const [vertexCountResult, edgeCountResult] = await Promise.all([
        execute("g.V().count()", {}, false),
        execute("g.E().count()", {}, false),
      ]);
      const vertexCount = Number(decodeGraphValue(vertexCountResult.items[0]) ?? 0);
      const edgeCount = Number(decodeGraphValue(edgeCountResult.items[0]) ?? 0);
      const total = vertexCount + edgeCount;
      setProgress({
        phase: t("正在导出顶点", "Exporting vertices"),
        completed: 0,
        total,
      });
      const vertices = new Map<string, GraphArchive["vertices"][number]>();
      const edges = new Map<string, GraphArchive["edges"][number]>();
      const exportBatchSize = Math.max(250, batchSize * 4);
      for (let offset = 0; offset < vertexCount; offset += exportBatchSize) {
        if (cancelTransferRef.current) break;
        const response = await execute(
          `g.V().range(${offset}, ${Math.min(offset + exportBatchSize, vertexCount)}).elementMap()`,
          {},
          false,
        );
        const model = buildGraphModel(response.items);
        model.nodes.forEach((vertex) => vertices.set(vertex.id, vertex));
        setProgress((current) => ({
          ...current,
          completed: Math.min(offset + exportBatchSize, vertexCount),
        }));
      }
      setProgress((current) => ({
        ...current,
        phase: t("正在导出关系", "Exporting edges"),
      }));
      for (let offset = 0; offset < edgeCount; offset += exportBatchSize) {
        if (cancelTransferRef.current) break;
        const response = await execute(
          `g.E().range(${offset}, ${Math.min(offset + exportBatchSize, edgeCount)}).elementMap()`,
          {},
          false,
        );
        const model = buildGraphModel(response.items);
        model.edges.forEach((edge) => edges.set(edge.id, edge));
        setProgress((current) => ({
          ...current,
          completed:
            vertexCount + Math.min(offset + exportBatchSize, edgeCount),
        }));
      }
      if (cancelTransferRef.current) {
        notify({
          tone: "info",
          message: t(
            "导出已停止，未生成不完整归档。",
            "Export stopped; no partial archive was created.",
          ),
        });
        return;
      }
      const graphArchive: GraphArchive = {
        format: "janus-studio.graph/v1",
        exportedAt: new Date().toISOString(),
        vertices: [...vertices.values()],
        edges: [...edges.values()],
      };
      const path = await window.janusGraphDesktop.files.saveDataFile({
        suggestedName: `janusgraph-graph-${Date.now()}.json`,
        format: "json",
        content: JSON.stringify(graphArchive),
      });
      if (path) {
        notify({
          tone: "success",
          message: t(`整图归档已保存到 ${path}`, `Graph archive saved to ${path}`),
        });
      }
    } catch (error) {
      setFailures([{
        phase: "export",
        offset: progress.completed,
        message: errorMessage(error),
      }]);
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const exportFailureLog = async () => {
    if (!window.janusGraphDesktop || failures.length === 0) return;
    try {
      await window.janusGraphDesktop.files.saveDataFile({
        suggestedName: `janusgraph-transfer-failures-${Date.now()}.json`,
        format: "json",
        content: JSON.stringify(failures, null, 2),
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  return (
    <div className="page-scroll">
      <PageHeader
        eyebrow="DATA TRANSFER"
        title={t("导入与导出")}
        description={t(
          "以可移植 JSON 归档导入或导出完整图数据，包括顶点、关系及其属性。查询结果导出已移至查询结果工具栏。",
          "Import or export complete graph data as a portable JSON archive, including vertices, edges and properties. Query-result export now lives in the result toolbar.",
        )}
      />
      <div className="transfer-grid">
        <section className="surface transfer-card">
          <header className="surface-header">
            <div>
              <span className="eyebrow">IMPORT</span>
              <strong>{t("导入完整图归档", "Import complete graph archive")}</strong>
            </div>
            <Upload size={20} />
          </header>
          <div className="transfer-content">
            <button type="button" className="file-drop" onClick={pick}>
              <FileUp size={28} />
              <strong>{file?.name ?? t("选择图归档 JSON", "Choose a graph archive JSON")}</strong>
              <span>
                {t(
                  "支持最高 200 MB 的 Janus Studio v1 图归档",
                  "Supports Janus Studio v1 graph archives up to 200 MB",
                )}
              </span>
            </button>
            {archive && (
              <>
                <div className="import-summary">
                  <span>{archive.vertices.length.toLocaleString()} V</span>
                  <span>{archive.edges.length.toLocaleString()} E</span>
                  <span>JANUS STUDIO V1</span>
                </div>
                <div className="transfer-preview-list" aria-label={t("归档预览", "Archive preview")}>
                  {archive.vertices.slice(0, 3).map((vertex) => (
                    <div key={`v:${vertex.id}`}>
                      <CircleDot size={15} />
                      <strong>{vertex.label}</strong>
                      <code>{vertex.id}</code>
                      <small>{Object.keys(vertex.properties).length} properties</small>
                    </div>
                  ))}
                  {archive.edges.slice(0, 2).map((edge) => (
                    <div key={`e:${edge.id}`}>
                      <Waypoints size={15} />
                      <strong>{edge.label}</strong>
                      <code>{edge.from} → {edge.to}</code>
                      <small>{Object.keys(edge.properties).length} properties</small>
                    </div>
                  ))}
                </div>
                <div className="transfer-options">
                  <label className="field">
                    <span>{t("批次大小", "Batch size")}</span>
                    <SelectControl
                      ariaLabel={t("导入批次大小", "Import batch size")}
                      value={String(batchSize)}
                      onValueChange={(value) => setBatchSize(Number(value))}
                      options={[25, 50, 100, 250].map((value) => ({ value: String(value), label: String(value) }))}
                    />
                  </label>
                  <label className="field">
                    <span>{t("冲突策略", "Conflict policy")}</span>
                    <SelectControl
                      ariaLabel={t("冲突策略", "Conflict policy")}
                      value={conflictPolicy}
                      onValueChange={(value) => setConflictPolicy(value as typeof conflictPolicy)}
                      options={[
                        { value: "append", label: t("追加新元素", "Append new elements") },
                        { value: "skip", label: t("按来源 ID 跳过已有顶点", "Skip vertices by source ID") },
                      ]}
                    />
                  </label>
                  {conflictPolicy === "skip" && (
                    <label className="field field-span-2">
                      <span>{t("来源 ID 属性键", "Source ID property key")}</span>
                      <input value={identityProperty} onChange={(event) => setIdentityProperty(event.target.value)} required />
                      <small>{t("该 Property Key 必须已存在于 Schema；首次导入会写入来源 ID。", "This Property Key must already exist in schema; source IDs are written during the first import.")}</small>
                    </label>
                  )}
                  <label className="check-field field-span-2">
                    <input type="checkbox" checked={continueOnError} onChange={(event) => setContinueOnError(event.target.checked)} />
                    <span>
                      <strong>{t("记录失败并继续下一批", "Log failures and continue")}</strong>
                      <small>{t("适合容错迁移；失败批次可在操作后导出。", "Useful for tolerant migrations; failed batches can be exported afterwards.")}</small>
                    </span>
                  </label>
                </div>
                <button
                  type="button"
                  className="button primary"
                  disabled={Boolean(busy) || !activeConnection}
                  onClick={() => void importGraph()}
                >
                  {busy === "import" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Upload size={17} />
                  )}
                  {t("导入整图到", "Import complete graph to")} {activeConnection?.name ?? t("未选择连接")}
                </button>
              </>
            )}
          </div>
        </section>
        <section className="surface transfer-card">
          <header className="surface-header">
            <div>
              <span className="eyebrow">EXPORT</span>
              <strong>{t("导出完整图数据", "Export complete graph data")}</strong>
            </div>
            <Download size={20} />
          </header>
          <div className="transfer-content">
            <div className="export-metric">
              <Database size={28} />
              <strong>{t("VERTICES + EDGES", "VERTICES + EDGES")}</strong>
              <span>{t("保留 Label、属性和关系方向", "Preserves labels, properties and edge directions")}</span>
            </div>
            <button
              type="button"
              className="export-option"
              disabled={Boolean(busy) || !activeConnection}
              onClick={() => void exportGraph()}
            >
              {busy === "export" ? <LoaderCircle className="spin" size={22} /> : <FileJson size={22} />}
              <span>
                <strong>{t("创建整图 JSON 归档", "Create complete graph JSON archive")}</strong>
                <small>{t(`大图会按 ${Math.max(250, batchSize * 4)} 个元素分批读取`, `Large graphs are read in batches of ${Math.max(250, batchSize * 4)} elements`)}</small>
              </span>
              <Download size={17} />
            </button>
            <small className="transfer-note">
              {t(
                "超过 200 MB 或生产级迁移仍建议使用 JanusGraph Bulk Loading 工具链。",
                "For archives above 200 MB or production migration, use the JanusGraph bulk-loading toolchain.",
              )}
            </small>
          </div>
        </section>
      </div>
      {busy && (
        <section className="transfer-progress" aria-live="polite">
          <div>
            <LoaderCircle className="spin" size={17} />
            <strong>{progress.phase}</strong>
            <span>
              {progress.total
                ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`
                : t("准备中", "Preparing")}
            </span>
            <button type="button" className="button danger" onClick={() => { cancelTransferRef.current = true; }}>
              <Square size={14} fill="currentColor" />
              {t("当前批次后停止", "Stop after batch")}
            </button>
          </div>
          <progress max={Math.max(progress.total, 1)} value={progress.completed} />
        </section>
      )}
      {failures.length > 0 && (
        <section className="transfer-failures" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>{t(`${failures.length} 个批次失败`, `${failures.length} batches failed`)}</strong>
            <small>{failures.at(-1)?.message}</small>
          </div>
          <button type="button" className="button secondary" onClick={() => void exportFailureLog()}>
            <Download size={16} />
            {t("导出失败日志", "Export failure log")}
          </button>
        </section>
      )}
    </div>
  );
}

