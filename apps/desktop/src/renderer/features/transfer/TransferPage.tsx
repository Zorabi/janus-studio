import type {
  BackgroundTask,
  ConnectionSummary,
  DockerRuntimeStatus,
  DockerTransferTarget,
  PickedDataFile,
  QueryExecutionResult,
} from "@janusgraph/domain";
import { routeCompatibility } from "@janusgraph/application";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleDot,
  Container,
  Database,
  Download,
  FileJson,
  FileUp,
  FolderInput,
  FolderOutput,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Server,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  Waypoints,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { ConfirmDialog, PageHeader } from "../../components/ui";
import {
  parseGraphArchive,
  type GraphArchive,
} from "../../lib/data-files";
import { graphServerContainers } from "../../lib/docker-containers";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";
import { buildGraphModel, decodeGraphValue } from "../../lib/result-model";
import {
  parseConfiguredGraphTargets,
  SERVER_GRAPHSON_QUERIES,
  type ConfiguredGraphTarget,
} from "../../lib/server-graphson-transfer";
import type { ToastState } from "../query/query-workspace";

type TransferMode = "archive" | "server";
type ServerAccessMode = "docker" | "path";
type ServerTransferStage = "docker-upload" | "preparing" | "configuring" | "importing" | "purging" | "exporting" | "docker-download" | "restoring";
type ServerTransferTask = {
  id: string;
  action: "import" | "export" | "purge";
  status: "running" | "succeeded" | "failed" | "stopped";
  stage: ServerTransferStage;
  connectionId: string;
  graphName: string;
  graphAccess: "configured" | "binding";
  message: string;
  totalVertices: number;
  deletedVertices: number;
  batches: number;
  cancelRequested: boolean;
  serverCancellation?: boolean;
  exportedBytes?: number;
  exportOutputStarted?: boolean;
  updatedAt: string;
};
function transferTaskView(task: BackgroundTask, serverCancellation: boolean): ServerTransferTask {
  return {
    id: task.id,
    action: task.action as ServerTransferTask["action"],
    status: task.status === "interrupted"
      ? "stopped"
      : task.status === "cancel_requested"
        ? "running"
        : task.status as ServerTransferTask["status"],
    stage: (task.stage === "completed"
      ? task.action === "purge" ? "purging" : task.action === "export" ? "exporting" : "importing"
      : task.stage) as ServerTransferStage,
    connectionId: task.connectionId,
    graphName: task.graphName,
    graphAccess: "configured",
    message: task.message,
    totalVertices: task.action === "purge" ? task.progressTotal : 0,
    deletedVertices: task.action === "purge" ? task.progressCurrent : 0,
    batches: task.action === "purge" ? Math.ceil(task.progressCurrent / 100) : 0,
    cancelRequested: task.status === "cancel_requested",
    serverCancellation,
    exportedBytes: task.action === "export" ? task.progressCurrent : 0,
    exportOutputStarted: task.action === "export" && task.progressCurrent > 0,
    updatedAt: task.updatedAt,
  };
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

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
    productionConfirmed?: boolean,
    timeoutMs?: number,
    executionId?: string,
    serverCancellation?: boolean,
  ) => Promise<QueryExecutionResult>;
  notify: (toast: ToastState) => void;
}) {
  const t = useTranslate();
  const [mode, setMode] = useState<TransferMode>("archive");
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
  const [docker, setDocker] = useState<DockerRuntimeStatus>({ available: false, containers: [] });
  const [dockerLoading, setDockerLoading] = useState(false);
  const [dockerContainerId, setDockerContainerId] = useState("");
  const [serverAccessMode, setServerAccessMode] = useState<ServerAccessMode>("docker");
  const [graphTargetKey, setGraphTargetKey] = useState("connection");
  const [configuredGraphs, setConfiguredGraphs] = useState<ConfiguredGraphTarget[]>([]);
  const [configuredGraphsLoading, setConfiguredGraphsLoading] = useState(false);
  const [configuredGraphsError, setConfiguredGraphsError] = useState("");
  const [serverImportPath, setServerImportPath] = useState("/tmp/data.graphson");
  const [serverExportPath, setServerExportPath] = useState("/tmp/janusgraph-export.graphson");
  const [stagedImport, setStagedImport] = useState<DockerTransferTarget | null>(null);
  const stagedImportRef = useRef<DockerTransferTarget | null>(null);
  const [serverTask, setServerTask] = useState<ServerTransferTask | null>(null);
  const [trackedServerTaskId, setTrackedServerTaskId] = useState("");
  const [transientServerStage, setTransientServerStage] = useState<ServerTransferStage | null>(null);
  const [enableBatchLoading, setEnableBatchLoading] = useState(true);
  const [disableAutomaticSchema, setDisableAutomaticSchema] = useState(true);
  const [overwriteServerFile, setOverwriteServerFile] = useState(false);
  const [pendingServerAction, setPendingServerAction] = useState<{
    title: string;
    description: string;
    label: string;
    icon?: "upload" | "download" | "trash";
    tone?: "danger" | "primary";
    confirmationText?: string;
    run: () => Promise<void>;
  } | null>(null);

  const setServerStage = (stage: ServerTransferStage | null) => {
    setTransientServerStage(stage);
  };

  useEffect(() => {
    if (!window.janusGraphDesktop || !activeConnection) {
      setServerTask(null);
      return;
    }
    let disposed = false;
    const sync = async () => {
      const tasks = await window.janusGraphDesktop!.tasks.list(200);
      if (disposed) return;
      const transfers = tasks.filter((task) => task.kind === "transfer" && task.connectionId === activeConnection.id);
      const tracked = transfers.find((task) => task.id === trackedServerTaskId);
      const active = transfers.find((task) => task.status === "running" || task.status === "cancel_requested");
      const selected = tracked && (tracked.status === "running" || tracked.status === "cancel_requested")
        ? tracked
        : active ?? tracked ?? transfers[0];
      setServerTask(selected ? transferTaskView(selected, activeConnection.protocol === "ws" || activeConnection.protocol === "wss") : null);
      if (selected && selected.id !== trackedServerTaskId) {
        setTrackedServerTaskId(selected.id);
        setMode("server");
        setGraphTargetKey(selected.graphName === activeConnection.graphBinding ? "connection" : `configured:${selected.graphName}`);
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 800);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [activeConnection?.id, trackedServerTaskId]);

  const serverStage = serverTask?.status === "running" ? serverTask.stage : transientServerStage;
  const purgeProgress = serverTask?.action === "purge"
    ? { total: serverTask.totalVertices, deleted: serverTask.deletedVertices, batches: serverTask.batches }
    : { total: 0, deleted: 0, batches: 0 };
  const purgeStopRequested = serverTask?.action === "purge" && serverTask.cancelRequested;
  const transferStopRequested = (serverTask?.action === "import" || serverTask?.action === "export")
    && serverTask.cancelRequested;
  const displayedTask = transientServerStage && serverTask?.status !== "running" ? null : serverTask;
  const displayedStage = serverStage ?? displayedTask?.stage ?? null;
  const canRetrySafetyCleanup = Boolean(displayedTask?.status === "failed" && displayedTask.stage === "restoring");
  const remainingVertices = Math.max(purgeProgress.total - purgeProgress.deleted, 0);

  const configuredTarget = graphTargetKey.startsWith("configured:")
    ? configuredGraphs.find((graph) => `configured:${graph.name}` === graphTargetKey)
    : undefined;
  const usesConfiguredTarget = graphTargetKey.startsWith("configured:");
  const targetGraphName = configuredTarget?.name
    ?? (usesConfiguredTarget ? graphTargetKey.slice("configured:".length) : activeConnection?.graphBinding)
    ?? "graph";
  const selectableDockerContainers = graphServerContainers(docker.containers);

  useEffect(() => {
    stagedImportRef.current = stagedImport;
  }, [stagedImport]);

  useEffect(() => () => {
    const staged = stagedImportRef.current;
    if (staged && window.janusGraphDesktop) {
      void window.janusGraphDesktop.dataTransfers.cleanupDockerTransfer(staged.transferId);
    }
  }, []);

  const refreshDocker = async () => {
    if (!window.janusGraphDesktop) return;
    setDockerLoading(true);
    try {
      const status = await window.janusGraphDesktop.dataTransfers.dockerStatus();
      const candidates = graphServerContainers(status.containers);
      setDocker(status);
      setDockerContainerId((current) => candidates.some((container) => container.id === current || container.name === current)
        ? current
        : candidates[0]?.id ?? "");
    } finally {
      setDockerLoading(false);
    }
  };

  useEffect(() => {
    if (mode === "server" && serverAccessMode === "docker") void refreshDocker();
  }, [mode, serverAccessMode]);

  const refreshConfiguredGraphs = async () => {
    if (!activeConnection) {
      setConfiguredGraphs([]);
      setGraphTargetKey("connection");
      return;
    }
    setConfiguredGraphsLoading(true);
    setConfiguredGraphsError("");
    try {
      const profile = await window.janusGraphDesktop?.compatibility.get(activeConnection.id);
      if (routeCompatibility(profile, "configuredGraphFactory").status === "unavailable") {
        setConfiguredGraphs([]);
        setGraphTargetKey("connection");
        return;
      }
      const response = await execute(SERVER_GRAPHSON_QUERIES.listConfiguredGraphs, {}, false, false);
      const graphs = parseConfiguredGraphTargets(response.items);
      setConfiguredGraphs(graphs);
      setGraphTargetKey((current) => {
        if (current.startsWith("configured:") && graphs.some((graph) => `configured:${graph.name}` === current)) {
          return current;
        }
        const matchingConnectionGraph = graphs.find((graph) => graph.name === activeConnection.graphBinding);
        return matchingConnectionGraph ? `configured:${matchingConnectionGraph.name}` : "connection";
      });
    } catch (error) {
      setConfiguredGraphs([]);
      setGraphTargetKey((current) => current.startsWith("configured:") ? current : "connection");
      setConfiguredGraphsError(errorMessage(error));
    } finally {
      setConfiguredGraphsLoading(false);
    }
  };

  useEffect(() => {
    if (mode === "server" && activeConnection) void refreshConfiguredGraphs();
  }, [mode, activeConnection?.id]);

  const resolveServerTarget = (): {
    graphName: string;
    graphBinding: string;
    graphAccess: "binding" | "configured";
  } => {
    const name = targetGraphName.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(name)) {
      throw new Error(t("图名称格式无效", "Invalid graph name"));
    }
    return {
      graphName: name,
      graphBinding: name,
      graphAccess: usesConfiguredTarget ? "configured" : "binding",
    };
  };

  const requireGraphsonCapability = async (graphAccess: "binding" | "configured") => {
    if (!activeConnection) throw new Error(t("请先选择连接", "Select a connection first"));
    const profile = await window.janusGraphDesktop?.compatibility.get(activeConnection.id);
    const route = routeCompatibility(
      profile,
      graphAccess === "configured" ? "configuredGraphsonIo" : "graphsonIo",
    );
    if (route.status === "unavailable") {
      throw new Error(t(
        "能力探测确认当前服务端不支持所选图的 GraphSON 整图迁移。",
        "Capability detection confirmed that the server does not support GraphSON migration for the selected graph.",
      ));
    }
  };

  const stopServerTransfer = async (task: ServerTransferTask) => {
    if (task.status !== "running" || task.cancelRequested) return;
    try {
      await window.janusGraphDesktop?.dataTransfers.cancel(task.id);
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const stageDockerImport = async () => {
    if (!window.janusGraphDesktop || !dockerContainerId) return;
    setServerStage("docker-upload");
    try {
      if (stagedImport) {
        await window.janusGraphDesktop.dataTransfers.cleanupDockerTransfer(stagedImport.transferId);
        setStagedImport(null);
      }
      const staged = await window.janusGraphDesktop.dataTransfers.stageDockerImport(dockerContainerId);
      if (staged) {
        setStagedImport(staged);
        notify({
          tone: "success",
          message: t(
            `${staged.name} 已复制到容器临时目录`,
            `${staged.name} copied to the container temporary directory`,
          ),
        });
      }
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
    } finally {
      setServerStage(null);
    }
  };

  const performServerImport = async () => {
    if (!activeConnection || !window.janusGraphDesktop) return;
    try {
      const target = resolveServerTarget();
      await requireGraphsonCapability(target.graphAccess);
      const task = await window.janusGraphDesktop.dataTransfers.start({
        connectionId: activeConnection.id,
        action: "import",
        ...target,
        fileAccess: serverAccessMode,
        ...(serverAccessMode === "docker"
          ? { dockerContainerId, dockerTransferId: stagedImport?.transferId }
          : { serverPath: serverImportPath.trim() }),
        enableBatchLoading: usesConfiguredTarget && enableBatchLoading,
        disableAutomaticSchema,
        productionConfirmed: true,
      });
      setTrackedServerTaskId(task.id);
      setServerTask(transferTaskView(task, activeConnection.protocol === "ws" || activeConnection.protocol === "wss"));
      stagedImportRef.current = null;
      setStagedImport(null);
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
    }
  };

  const requestServerImport = () => {
    if (!activeConnection) return;
    if (activeConnection.connectionReadOnly) {
      notify({ tone: "error", message: t("只读连接不能导入数据", "Read-only connections cannot import data") });
      return;
    }
    const operation = {
      title: t("确认服务端 GraphSON 导入", "Confirm Server-side GraphSON Import"),
      description: t(
        `将向“${targetGraphName.trim()}”写入完整 GraphSON。导入不会自动清空目标图；中断或失败时已经写入的数据不会回滚。`,
        `This writes the complete GraphSON into “${targetGraphName.trim()}”. The target graph is not cleared automatically, and data already written is not rolled back if the import stops or fails.`,
      ),
      label: t("确认并开始导入", "Confirm and start import"),
      icon: "upload" as const,
      tone: "danger" as const,
      confirmationText: targetGraphName.trim(),
      run: async () => {
        setPendingServerAction(null);
        await performServerImport();
      },
    };
    setPendingServerAction(operation);
  };

  const performServerPurge = async () => {
    if (!activeConnection || !window.janusGraphDesktop) return;
    try {
      const target = resolveServerTarget();
      const task = await window.janusGraphDesktop.dataTransfers.start({
        connectionId: activeConnection.id,
        action: "purge",
        ...target,
        fileAccess: "path",
        productionConfirmed: true,
      });
      setTrackedServerTaskId(task.id);
      setServerTask(transferTaskView(task, activeConnection.protocol === "ws" || activeConnection.protocol === "wss"));
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
    }
  };

  const requestServerPurge = () => {
    if (!activeConnection) return;
    if (activeConnection.connectionReadOnly) {
      notify({ tone: "error", message: t("只读连接不能清空图数据", "Read-only connections cannot clear graph data") });
      return;
    }
    setPendingServerAction({
      title: t("确认清空目标图数据", "Confirm clearing target graph data"),
      description: t(
        `将永久删除“${targetGraphName.trim()}”中的全部顶点及其关联边，每批最多 100 个顶点，直到图为空。Schema 不会被删除；该操作无法撤销。`,
        `This permanently deletes every vertex and its incident edges from “${targetGraphName.trim()}”, in batches of up to 100 vertices until the graph is empty. Schema is preserved. This cannot be undone.`,
      ),
      label: t("清空全部图数据", "Clear all graph data"),
      icon: "trash",
      confirmationText: targetGraphName.trim(),
      run: async () => {
        setPendingServerAction(null);
        await performServerPurge();
      },
    });
  };

  const performServerExport = async () => {
    if (!activeConnection || !window.janusGraphDesktop) return;
    try {
      const target = resolveServerTarget();
      await requireGraphsonCapability(target.graphAccess);
      const task = await window.janusGraphDesktop.dataTransfers.start({
        connectionId: activeConnection.id,
        action: "export",
        ...target,
        fileAccess: serverAccessMode,
        ...(serverAccessMode === "docker" ? { dockerContainerId } : { serverPath: serverExportPath.trim() }),
        overwrite: overwriteServerFile,
      });
      setTrackedServerTaskId(task.id);
      setServerTask(transferTaskView(task, activeConnection.protocol === "ws" || activeConnection.protocol === "wss"));
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
    }
  };

  const requestServerExport = () => {
    if (!activeConnection) return;
    const destination = serverAccessMode === "docker"
      ? t("生成完成后将打开本机保存位置选择器", "A local save-location picker will open after generation")
      : t(`写入服务器路径 ${serverExportPath.trim()}${overwriteServerFile ? "，并覆盖同名文件" : ""}`, `Write to server path ${serverExportPath.trim()}${overwriteServerFile ? " and replace an existing file" : ""}`);
    setPendingServerAction({
      title: t("确认服务端 GraphSON 导出", "Confirm Server-side GraphSON Export"),
      description: t(
        `将从“${targetGraphName.trim()}”生成完整 GraphSON。${destination}。大型图可能需要较长时间，开始后可在任务条中停止。`,
        `Generate a complete GraphSON from “${targetGraphName.trim()}”. ${destination}. Large graphs may take a while; the task can be stopped from the task bar after it starts.`,
      ),
      label: t("确认并开始导出", "Confirm and start export"),
      icon: "download",
      tone: "primary",
      confirmationText: targetGraphName.trim(),
      run: async () => {
        setPendingServerAction(null);
        await performServerExport();
      },
    });
  };

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
          "保留便携的 Janus Studio JSON 归档，并支持通过服务端 GraphSON 高效迁移超大图。查询结果导出位于查询结果工具栏。",
          "Keep portable Janus Studio JSON archives and transfer very large graphs efficiently with server-side GraphSON. Query-result export lives in the result toolbar.",
        )}
      />
      <nav className="transfer-mode-tabs" aria-label={t("迁移模式", "Transfer mode")}>
        <button type="button" className={mode === "archive" ? "is-active" : ""} onClick={() => setMode("archive")}>
          <FileJson size={17} />
          <span><strong>{t("Janus Studio 归档", "Janus Studio archive")}</strong><small>{t("可移植、带冲突策略", "Portable, with conflict policies")}</small></span>
        </button>
        <button type="button" className={mode === "server" ? "is-active" : ""} onClick={() => setMode("server")}>
          <Server size={17} />
          <span><strong>{t("大型 GraphSON", "Large GraphSON")}</strong><small>{t("服务端原生读写，适合超大图", "Native server-side I/O for very large graphs")}</small></span>
        </button>
      </nav>

      {mode === "archive" ? <>
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
                  "Janus Studio v1 便携归档，图元素自动按批次处理",
                  "Janus Studio v1 portable archive with automatic element batching",
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
                "便携归档会自动分批读取图元素；超大图可使用“大型 GraphSON”减少桌面端内存占用。",
                "Portable archives read graph elements in automatic batches; Large GraphSON reduces desktop memory use for very large graphs.",
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
      </> : (
        <section className="server-transfer-workbench">
          <div className="server-transfer-context surface">
            <div className="server-transfer-context-title">
              <Boxes size={21} />
              <span>
                <strong>{t("服务端原生整图迁移", "Native server-side graph transfer")}</strong>
                <small>{t(
                  "JanusGraph 在服务器文件系统中直接读写 TinkerPop GraphSON，桌面端不加载文件内容。",
                  "JanusGraph reads or writes TinkerPop GraphSON directly on the server filesystem; the desktop app never loads the file contents.",
                )}</small>
              </span>
            </div>
            <div className="server-transfer-targets">
              <label className="field server-target-field">
                <span>{t("目标图", "Target graph")}</span>
                <div>
                  <SelectControl
                    ariaLabel={t("GraphSON 目标图", "GraphSON target graph")}
                    value={graphTargetKey}
                    onValueChange={setGraphTargetKey}
                    options={[
                      {
                        value: "connection",
                        label: activeConnection?.graphBinding ?? t("连接默认图", "Connection default graph"),
                        description: activeConnection
                          ? t(`连接默认图 · ${activeConnection.name}`, `Connection default graph · ${activeConnection.name}`)
                          : t("尚未选择连接", "No connection selected"),
                      },
                      ...(usesConfiguredTarget && !configuredTarget ? [{
                        value: graphTargetKey,
                        label: targetGraphName,
                        description: t("本次会话任务锁定的目标图", "Target graph locked by this session task"),
                      }] : []),
                      ...configuredGraphs.map((graph) => ({
                        value: `configured:${graph.name}`,
                        label: graph.name,
                        description: `ConfiguredGraphFactory · ${graph.traversalSource}`,
                      })),
                    ]}
                    disabled={Boolean(serverStage) || !activeConnection}
                    className="server-graph-select"
                    popoverClassName="server-graph-select-popover"
                  />
                  <button type="button" className="icon-button" onClick={() => void refreshConfiguredGraphs()} disabled={configuredGraphsLoading || Boolean(serverStage) || !activeConnection} title={t("刷新图列表", "Refresh graph list")}>
                    <RefreshCw className={configuredGraphsLoading ? "spin" : ""} size={17} />
                  </button>
                </div>
                <small className={configuredGraphsError ? "is-error" : ""}>{configuredGraphsError || (usesConfiguredTarget
                  ? t("由 ConfiguredGraphFactory 自动发现", "Discovered automatically from ConfiguredGraphFactory")
                  : t("连接 Graph Binding；支持普通非动态图", "Connection Graph Binding; supports regular non-dynamic graphs"))}</small>
              </label>
              <label className="field">
                <span>{t("文件访问方式", "File access")}</span>
                <SelectControl
                  ariaLabel={t("GraphSON 文件访问方式", "GraphSON file access")}
                  value={serverAccessMode}
                  onValueChange={(value) => setServerAccessMode(value as ServerAccessMode)}
                  options={[
                    { value: "docker", label: t("本机 Docker 自动搬运", "Local Docker automatic bridge") },
                    { value: "path", label: t("服务器文件路径", "Server file path") },
                  ]}
                />
                <small>{t("Docker 模式会自动复制并清理容器临时文件", "Docker mode copies and cleans container temporary files automatically")}</small>
              </label>
              {serverAccessMode === "docker" && (
                <label className="field server-container-field">
                  <span>{t("JanusGraph 容器", "JanusGraph container")}</span>
                  <div>
                    {selectableDockerContainers.length === 1 ? (
                      <div className="server-container-single" title={`${selectableDockerContainers[0]!.name} · ${selectableDockerContainers[0]!.image}`}>
                        <Container size={18} />
                        <span>
                          <strong>{selectableDockerContainers[0]!.name}</strong>
                          <small>{selectableDockerContainers[0]!.image} · {selectableDockerContainers[0]!.status}</small>
                        </span>
                      </div>
                    ) : (
                      <SelectControl
                        ariaLabel={t("JanusGraph Docker 容器", "JanusGraph Docker container")}
                        value={dockerContainerId}
                        onValueChange={(value) => {
                          if (stagedImport && window.janusGraphDesktop) {
                            void window.janusGraphDesktop.dataTransfers.cleanupDockerTransfer(stagedImport.transferId);
                            setStagedImport(null);
                          }
                          setDockerContainerId(value);
                        }}
                        options={selectableDockerContainers.map((container) => ({
                          value: container.id,
                          label: container.name,
                          description: `${container.image} · ${container.status}`,
                        }))}
                        disabled={dockerLoading || selectableDockerContainers.length === 0 || Boolean(serverStage)}
                      />
                    )}
                    <button type="button" className="icon-button" onClick={() => void refreshDocker()} disabled={dockerLoading || Boolean(serverStage)} title={t("刷新容器", "Refresh containers")}>
                      <RefreshCw className={dockerLoading ? "spin" : ""} size={17} />
                    </button>
                  </div>
                  <small className={!docker.available ? "is-error" : ""}>
                    {docker.available
                      ? <>
                          {t(
                            `${selectableDockerContainers.length} 个可用图服务器容器`,
                            `${selectableDockerContainers.length} available graph-server containers`,
                          )}
                          {docker.cliPath && <code title={docker.cliPath}> · {docker.cliPath}</code>}
                        </>
                      : docker.message ?? t("Docker 当前不可用", "Docker is unavailable")}
                  </small>
                </label>
              )}
            </div>
          </div>

          <div className="server-transfer-grid">
            <article className="server-transfer-card surface">
              <header>
                <span className="server-transfer-icon"><FolderInput size={21} /></span>
                <div>
                  <span className="eyebrow">IMPORT · READGRAPH</span>
                  <strong>{t("导入大型 GraphSON", "Import large GraphSON")}</strong>
                  <small>{t("由 JanusGraph Server 直接读取完整文件", "JanusGraph Server reads the complete file directly")}</small>
                </div>
              </header>
              <div className="server-transfer-card-body">
                {serverAccessMode === "docker" ? (
                  <button type="button" className={`server-file-picker${stagedImport ? " has-file" : ""}`} onClick={() => void stageDockerImport()} disabled={!dockerContainerId || Boolean(serverStage)}>
                    {serverStage === "docker-upload" ? <LoaderCircle className="spin" size={24} /> : <HardDrive size={24} />}
                    <span>
                      <strong>{stagedImport?.name ?? t("选择本机 GraphSON 文件", "Choose a local GraphSON file")}</strong>
                      <small>{stagedImport
                        ? t(`${formatBytes(stagedImport.sizeBytes ?? 0)} · 已自动复制到容器临时目录`, `${formatBytes(stagedImport.sizeBytes ?? 0)} · copied to a container temporary directory`)
                        : t("适合超大文件；应用自动完成容器搬运和清理", "Designed for very large files; the app handles container transfer and cleanup")}</small>
                    </span>
                    <FileUp size={18} />
                  </button>
                ) : (
                  <label className="field">
                    <span>{t("服务器 GraphSON 绝对路径", "Absolute server GraphSON path")}</span>
                    <input value={serverImportPath} onChange={(event) => setServerImportPath(event.target.value)} placeholder="/data/import/data.graphson" disabled={Boolean(serverStage)} />
                    <small>{t("路径必须可由 JanusGraph Server 进程读取", "The JanusGraph Server process must be able to read this path")}</small>
                  </label>
                )}
                {usesConfiguredTarget ? (
                  <div className="server-transfer-options">
                    <label className="check-field">
                      <input type="checkbox" checked={enableBatchLoading} onChange={(event) => setEnableBatchLoading(event.target.checked)} disabled={Boolean(serverStage)} />
                      <span><strong>{t("导入期间启用批量加载", "Enable batch loading during import")}</strong><small>storage.batch-loading = true</small></span>
                    </label>
                    <label className="check-field">
                      <input type="checkbox" checked={disableAutomaticSchema} onChange={(event) => setDisableAutomaticSchema(event.target.checked)} disabled={!enableBatchLoading || Boolean(serverStage)} />
                      <span><strong>{t("关闭自动 Schema 创建", "Disable automatic schema creation")}</strong><small>schema.default = none</small></span>
                    </label>
                  </div>
                ) : (
                  <div className="server-static-graph-note">
                    <Database size={18} />
                    <span>
                      <strong>{t("连接默认图模式", "Connection default graph mode")}</strong>
                      <small>{t(
                        "直接使用服务器 Graph Binding，不调用 ConfiguredGraphFactory；批量加载参数由服务器配置管理。",
                        "Uses the server Graph Binding directly without ConfiguredGraphFactory; batch-loading settings remain managed by the server configuration.",
                      )}</small>
                    </span>
                  </div>
                )}
                <div className="server-transfer-warning">
                  <ShieldAlert size={18} />
                  <span>{usesConfiguredTarget
                    ? t(
                        "目标图需先具备所需 Schema。批量加载会暂时降低一致性保护；应用会在成功或失败后恢复原配置，并保留异常中断恢复记录。",
                        "The target graph must already have the required schema. Batch loading temporarily reduces consistency safeguards; the app restores the original configuration after success or failure and retains a crash-recovery record.",
                      )
                    : t(
                        "目标图需先具备所需 Schema。连接默认图不会被自动修改批量加载配置。",
                        "The target graph must already have the required schema. Batch-loading configuration is not changed automatically for the connection default graph.",
                      )}</span>
                </div>
                <button type="button" className="button primary server-transfer-action" disabled={Boolean(serverStage) || !activeConnection || activeConnection.connectionReadOnly || (serverAccessMode === "docker" ? !stagedImport : !serverImportPath.trim())} onClick={requestServerImport}>
                  {serverStage && serverStage !== "exporting" && serverStage !== "docker-download" ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
                  {t("导入完整文件", "Import complete file")}
                </button>
              </div>
            </article>

            <article className="server-transfer-card surface">
              <header>
                <span className="server-transfer-icon"><FolderOutput size={21} /></span>
                <div>
                  <span className="eyebrow">EXPORT · WRITEGRAPH</span>
                  <strong>{t("导出大型 GraphSON", "Export large GraphSON")}</strong>
                  <small>{t("服务器流式写出后再保存到本机", "The server writes the file before it is saved locally")}</small>
                </div>
              </header>
              <div className="server-transfer-card-body">
                {serverAccessMode === "docker" ? (
                  <div className="server-export-route">
                    <Container size={24} />
                    <div>
                      <strong>{t("容器临时目录 → 本机保存位置", "Container temporary directory → local save location")}</strong>
                      <small>{t("导出完成后应用弹出保存窗口，并自动删除容器临时文件。", "After export, the app opens a save dialog and removes the container temporary file automatically.")}</small>
                    </div>
                  </div>
                ) : (
                  <>
                    <label className="field">
                      <span>{t("服务器 GraphSON 输出路径", "Server GraphSON output path")}</span>
                      <input value={serverExportPath} onChange={(event) => setServerExportPath(event.target.value)} placeholder="/data/export/data.graphson" disabled={Boolean(serverStage)} />
                      <small>{t("父目录必须存在并可由 JanusGraph Server 写入", "The parent directory must exist and be writable by JanusGraph Server")}</small>
                    </label>
                    <label className="check-field">
                      <input type="checkbox" checked={overwriteServerFile} onChange={(event) => setOverwriteServerFile(event.target.checked)} disabled={Boolean(serverStage)} />
                      <span><strong>{t("允许覆盖已存在的服务器文件", "Allow overwriting an existing server file")}</strong><small>{t("默认安全阻止覆盖", "Overwrite is blocked by default")}</small></span>
                    </label>
                  </>
                )}
                <div className="server-transfer-note">
                  <Server size={18} />
                  <span>{t(
                    "使用 TinkerPop adjacency-list GraphSON，可由 graph.io(graphson()).readGraph() 直接恢复。",
                    "Uses TinkerPop adjacency-list GraphSON and can be restored directly with graph.io(graphson()).readGraph().",
                  )}</span>
                </div>
                <button type="button" className="button secondary server-transfer-action" disabled={Boolean(serverStage) || !activeConnection || (serverAccessMode === "docker" ? !dockerContainerId : !serverExportPath.trim())} onClick={requestServerExport}>
                  {serverStage === "exporting" || serverStage === "docker-download" ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
                  {t("导出完整文件", "Export complete file")}
                </button>
              </div>
            </article>
          </div>

          <section className="server-purge-card">
            <span className="server-purge-icon"><Trash2 size={20} /></span>
            <div>
              <strong>{t("重新导入前清空目标图", "Clear the target graph before re-importing")}</strong>
              <small>{t(
                "GraphSON 导入采用追加语义。需要完整重导时，可按每批 100 个顶点清空现有数据；Schema 会保留。",
                "GraphSON import is additive. For a full re-import, clear existing data in batches of 100 vertices; schema is preserved.",
              )}</small>
              {purgeProgress.batches > 0 && (
                <span>{t(
                  `总数 ${purgeProgress.total} · 已删除 ${purgeProgress.deleted} · 剩余 ${remainingVertices} · ${purgeProgress.batches} 批`,
                  `Total ${purgeProgress.total} · ${purgeProgress.deleted} deleted · ${remainingVertices} remaining · ${purgeProgress.batches} batches`,
                )}</span>
              )}
            </div>
            <button type="button" className="button danger" disabled={Boolean(serverStage) || !activeConnection || activeConnection.connectionReadOnly} onClick={requestServerPurge}>
              <Trash2 size={17} />
              {t("清空图数据", "Clear graph data")}
            </button>
          </section>

          {displayedStage && (
            <div className={`server-transfer-status${displayedStage === "purging" ? " is-purging" : ""}${displayedTask?.status === "running" && (displayedStage === "importing" || displayedStage === "exporting") ? " is-cancellable" : ""}${displayedTask && displayedTask.status !== "running" ? ` is-${displayedTask.status}` : ""}`} role="status" aria-live="polite">
              {displayedTask?.status === "succeeded" ? <CheckCircle2 size={19} />
                : displayedTask?.status === "failed" ? <XCircle size={19} />
                  : displayedTask?.status === "stopped" ? <Square size={17} />
                    : <LoaderCircle className="spin" size={18} />}
              <div>
                <strong>{displayedTask && displayedTask.status !== "running" ? displayedTask.message : ({
                  "docker-upload": t("正在复制文件到容器", "Copying file to container"),
                  preparing: t("正在准备 GraphSON 迁移", "Preparing GraphSON transfer"),
                  configuring: t("正在保存并切换批量加载配置", "Saving and switching batch-loading configuration"),
                  importing: t("JanusGraph 正在导入完整 GraphSON", "JanusGraph is importing the complete GraphSON"),
                  purging: displayedTask?.message || t(
                    `正在清空图数据 · 总数 ${purgeProgress.total} · 剩余 ${remainingVertices}`,
                    `Clearing graph data · total ${purgeProgress.total} · ${remainingVertices} remaining`,
                  ),
                  exporting: t("JanusGraph 正在写出完整 GraphSON", "JanusGraph is writing the complete GraphSON"),
                  "docker-download": t("正在将文件从容器保存到本机", "Saving the file from the container to this computer"),
                  restoring: t("正在恢复原始图配置", "Restoring the original graph configuration"),
                } as Record<ServerTransferStage, string>)[displayedStage]}</strong>
                {displayedStage === "purging" && purgeProgress.total > 0 && (
                  <span className="server-purge-metrics">
                    <span><small>{t("顶点总数", "Total vertices")}</small><strong>{purgeProgress.total}</strong></span>
                    <span><small>{t("已删除", "Deleted")}</small><strong>{purgeProgress.deleted}</strong></span>
                    <span><small>{t("剩余", "Remaining")}</small><strong>{remainingVertices}</strong></span>
                    <span><small>{t("完成批次", "Batches")}</small><strong>{purgeProgress.batches}</strong></span>
                  </span>
                )}
                {displayedStage === "exporting" && displayedTask?.status === "running" && (
                  <span className="server-export-progress">
                    <small>{displayedTask.exportOutputStarted
                      ? t("临时文件已写入", "Temporary file written")
                      : t("等待首个数据块", "Waiting for first data block")}</small>
                    <strong>{formatBytes(displayedTask.exportedBytes ?? 0)}</strong>
                  </span>
                )}
                <small>{displayedTask && displayedTask.status !== "running"
                  ? t(`目标图：${displayedTask.graphName} · 状态已保存至任务中心`, `Target: ${displayedTask.graphName} · status saved in Task Center`)
                  : displayedStage === "purging"
                  ? (purgeStopRequested
                      ? t("将在当前 100 顶点批次完成后停止", "Stopping after the current 100-vertex batch")
                      : t("每个批次独立提交，Schema 始终保留", "Each batch is committed independently; schema is always preserved"))
                  : transferStopRequested
                    ? displayedTask?.serverCancellation
                      ? t("已关闭专用 Gremlin Session，正在等待服务端中断并执行安全收尾。", "The dedicated Gremlin Session was closed. Waiting for server interruption and cleanup.")
                      : t("客户端已停止等待；HTTP 无法确认服务端任务是否结束。", "The client stopped waiting; HTTP cannot confirm whether the server task ended.")
                  : t("大型服务端 I/O 可能持续较长时间，请保持当前连接可用。", "Large server-side I/O can take a while. Keep the current connection available.")}</small>
              </div>
              {displayedTask?.status === "running" && (displayedStage === "importing" || displayedStage === "exporting") && (
                <button type="button" className="button danger ghost" disabled={transferStopRequested} onClick={() => void stopServerTransfer(displayedTask)}>
                  {transferStopRequested ? <LoaderCircle className="spin" size={15} /> : <Square size={15} fill="currentColor" />}
                  {transferStopRequested
                    ? t("正在停止…", "Stopping…")
                    : displayedTask.serverCancellation
                      ? t("中断服务端任务", "Interrupt server task")
                      : t("停止客户端等待", "Stop client wait")}
                </button>
              )}
              {displayedTask?.status === "running" && displayedStage === "purging" && (
                <button type="button" className="button secondary" disabled={purgeStopRequested} onClick={() => void stopServerTransfer(displayedTask)}>
                  <Square size={15} />
                  {purgeStopRequested ? t("等待当前批次", "Waiting for current batch") : t("当前批次后停止", "Stop after current batch")}
                </button>
              )}
              {canRetrySafetyCleanup && (
                <button type="button" className="button secondary server-transfer-retry" onClick={() => {
                  void window.janusGraphDesktop?.dataTransfers.retry(displayedTask!.id).then((task) => {
                    setTrackedServerTaskId(task.id);
                    setServerTask(transferTaskView(task, activeConnection?.protocol === "ws" || activeConnection?.protocol === "wss"));
                  }).catch((error) => notify({ tone: "error", message: errorMessage(error) }));
                }}>
                  <RefreshCw size={15} />
                  {t("重试安全清理", "Retry safety cleanup")}
                </button>
              )}
              {displayedTask && displayedTask.status !== "running" && !canRetrySafetyCleanup && (
                <button type="button" className="icon-button" onClick={() => {
                  void window.janusGraphDesktop?.tasks.dismiss(displayedTask.id).then(() => {
                    setTrackedServerTaskId("");
                    setServerTask(null);
                  });
                }} title={t("关闭任务状态", "Dismiss task status")}>
                  <X size={16} />
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {pendingServerAction && (
        <ConfirmDialog
          title={pendingServerAction.title}
          description={pendingServerAction.description}
          confirmLabel={pendingServerAction.label}
          confirmIcon={pendingServerAction.icon === "trash" ? <Trash2 size={17} /> : pendingServerAction.icon === "download" ? <Download size={17} /> : <Upload size={17} />}
          confirmationText={pendingServerAction.confirmationText}
          tone={pendingServerAction.tone}
          onCancel={() => setPendingServerAction(null)}
          onConfirm={pendingServerAction.run}
        />
      )}
    </div>
  );
}
