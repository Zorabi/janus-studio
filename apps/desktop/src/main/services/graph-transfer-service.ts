import type {
  BackgroundTask,
  PublishBackgroundTaskInput,
  StartGraphTransferInput,
} from "@janusgraph/domain";
import { routeCompatibility } from "@janusgraph/application";
import { randomUUID } from "node:crypto";
import {
  graphsonExportFileName,
  parseBatchLoadingSnapshot,
  parseDeletedVertexBatch,
  parseExportProgress,
  parseVertexCount,
  SERVER_GRAPHSON_QUERIES,
  type BatchLoadingSnapshot,
} from "../../shared/server-graphson-transfer";
import { BackgroundTaskRepository } from "../storage/background-task-repository";
import { GraphTransferRepository } from "../storage/graph-transfer-repository";
import { CompatibilityService } from "./compatibility-service";
import { ConnectionService } from "./connection-service";
import { FileService } from "./file-service";
import { QueryService } from "./query-service";

const timeoutMs = 86_400_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : "GraphSON transfer failed";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

export class GraphTransferService {
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly tasks: BackgroundTaskRepository,
    private readonly runs: GraphTransferRepository,
    private readonly connections: ConnectionService,
    private readonly queries: QueryService,
    private readonly files: FileService,
    private readonly compatibility: CompatibilityService,
  ) {}

  start(input: StartGraphTransferInput): BackgroundTask {
    const profile = this.connections.profile(input.connectionId);
    const active = this.tasks.list(1_000).find((task) =>
      task.kind === "transfer" &&
      task.connectionId === input.connectionId &&
      task.graphName === input.graphName &&
      (task.status === "running" || task.status === "cancel_requested"),
    );
    if (active) throw new Error(`图“${input.graphName}”已有迁移任务正在运行`);
    if (profile.connectionReadOnly && input.action !== "export") {
      throw new Error("只读连接不能导入或清空图数据");
    }
    if (profile.environment === "prod" && input.action !== "export" && !input.productionConfirmed) {
      throw new Error("生产环境写操作尚未确认");
    }
    const id = randomUUID();
    this.runs.save(id, input);
    const task = this.publish(id, input, {
      status: "running",
      stage: input.action === "purge" ? "purging" : input.action === "import" ? "preparing" : "exporting",
      message: input.action === "purge"
        ? `正在统计“${input.graphName}”的顶点总数`
        : input.action === "import"
          ? `正在准备向“${input.graphName}”导入 GraphSON`
          : `正在从“${input.graphName}”导出 GraphSON`,
      progressCurrent: 0,
      progressTotal: 0,
      progressUnit: input.action === "purge" ? "vertex" : input.action === "export" ? "byte" : "file",
      cancellable: true,
      retriable: false,
    });
    this.launch(id, input);
    return task;
  }

  async cancel(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || task.kind !== "transfer" || task.status !== "running") return false;
    this.tasks.requestCancellation(id, task.action === "purge"
      ? "将在当前 100 顶点批次完成后停止"
      : "正在中断服务端迁移任务");
    if (task.action === "import" || task.action === "export") {
      await this.queries.cancel(id).catch(() => false);
    }
    return true;
  }

  retry(id: string): BackgroundTask {
    const previous = this.tasks.get(id);
    if (!previous || previous.kind !== "transfer" || !previous.retriable) {
      throw new Error("该迁移任务当前不能重试");
    }
    const input = this.runs.input(id);
    if (!input) throw new Error("迁移任务缺少可恢复执行信息");
    const recovery = this.runs.recovery(id);
    if (recovery) return this.startRecovery(input, recovery);
    if (input.action === "import" && input.fileAccess === "docker") {
      throw new Error("Docker 导入临时文件已清理，请返回迁移页重新选择文件后重试");
    }
    return this.start(input);
  }

  private startRecovery(input: StartGraphTransferInput, recovery: BatchLoadingSnapshot): BackgroundTask {
    const id = randomUUID();
    this.runs.save(id, input);
    this.runs.setRecovery(id, recovery);
    const task = this.publish(id, input, {
      status: "running", stage: "restoring", message: "正在恢复上次导入遗留的图配置",
      progressCurrent: 0, progressTotal: 1, progressUnit: "step", cancellable: false, retriable: false,
    });
    const work = this.restoreOnly(id, input, recovery).finally(() => this.running.delete(id));
    this.running.set(id, work);
    void work;
    return task;
  }

  private async restoreOnly(id: string, input: StartGraphTransferInput, recovery: BatchLoadingSnapshot): Promise<void> {
    try {
      await this.query(id, input, SERVER_GRAPHSON_QUERIES.restoreBatchLoading, {
        graphName: input.graphName, ...recovery,
      }, true);
      this.runs.setRecovery(id, null);
      this.publish(id, input, {
        status: "succeeded", stage: "completed", message: "上次导入遗留的图配置已恢复",
        progressCurrent: 1, progressTotal: 1, progressUnit: "step", cancellable: false, retriable: false,
      });
    } catch (error) {
      this.publish(id, input, {
        status: "failed", stage: "restoring", message: `恢复图配置失败：${message(error)}`,
        progressCurrent: 0, progressTotal: 1, progressUnit: "step", cancellable: false, retriable: true,
      });
    }
  }

  private launch(id: string, input: StartGraphTransferInput): void {
    const work = this.run(id, input).finally(() => this.running.delete(id));
    this.running.set(id, work);
    void work;
  }

  private async run(id: string, input: StartGraphTransferInput): Promise<void> {
    try {
      await this.requireCapability(input);
      if (input.action === "purge") await this.purge(id, input);
      else if (input.action === "import") await this.importGraph(id, input);
      else await this.exportGraph(id, input);
    } catch (error) {
      const current = this.tasks.get(id);
      const interrupted = current?.status === "cancel_requested";
      const recovery = this.runs.recovery(id);
      this.publish(id, input, {
        status: interrupted ? "interrupted" : "failed",
        stage: recovery ? "restoring" : current?.stage ?? "completed",
        message: interrupted ? this.interruptedMessage(input) : message(error),
        progressCurrent: current?.progressCurrent ?? 0,
        progressTotal: current?.progressTotal ?? 0,
        progressUnit: current?.progressUnit ?? "file",
        cancellable: false,
        retriable: recovery ? true : input.action !== "import" || input.fileAccess !== "docker",
      });
    }
  }

  private async requireCapability(input: StartGraphTransferInput): Promise<void> {
    const profile = await this.compatibility.get(input.connectionId);
    const route = routeCompatibility(profile, input.graphAccess === "configured" ? "configuredGraphsonIo" : "graphsonIo");
    if (route.status === "unavailable") {
      throw new Error("能力探测确认当前服务端不支持所选图的 GraphSON 整图迁移");
    }
  }

  private query(id: string, input: StartGraphTransferInput, query: string, bindings: Record<string, unknown>, mutation: boolean) {
    return this.queries.execute({
      connectionId: input.connectionId,
      consoleId: `transfer:${id}`,
      executionId: id,
      query,
      bindings,
      recordHistory: false,
      productionConfirmed: mutation ? input.productionConfirmed : false,
      timeoutMs,
      serverCancellation: true,
    });
  }

  private target(input: StartGraphTransferInput) {
    return {
      graphName: input.graphName,
      graphBinding: input.graphBinding,
      graphAccess: input.graphAccess,
    };
  }

  private async importGraph(id: string, input: StartGraphTransferInput): Promise<void> {
    let recovery: BatchLoadingSnapshot | undefined;
    let transferId = input.dockerTransferId;
    let primaryError: unknown;
    let recoveryError: unknown;
    const serverPath = input.fileAccess === "docker"
      ? this.files.dockerTransfer(transferId!, "import").serverPath
      : input.serverPath!;
    try {
      if (input.graphAccess === "configured" && input.enableBatchLoading) {
        this.stage(id, input, "configuring", "正在保存并切换批量加载配置", false);
        const state = await this.query(id, input, SERVER_GRAPHSON_QUERIES.batchLoadingStatus, { graphName: input.graphName }, false);
        recovery = parseBatchLoadingSnapshot(state.items) ?? undefined;
        if (!recovery) throw new Error("无法读取批量加载配置");
        this.runs.setRecovery(id, recovery);
        await this.query(id, input, SERVER_GRAPHSON_QUERIES.enableBatchLoading, {
          graphName: input.graphName,
          disableAutomaticSchema: input.disableAutomaticSchema ?? true,
        }, true);
      }
      this.stage(id, input, "importing", `JanusGraph 正在向“${input.graphName}”导入完整 GraphSON`, true);
      await this.query(id, input, SERVER_GRAPHSON_QUERIES.importGraph, {
        ...this.target(input), serverPath,
      }, true);
      if (this.tasks.get(id)?.status === "cancel_requested") throw new Error("查询已停止");
    } catch (error) {
      primaryError = error;
    } finally {
      if (recovery) {
        try {
          this.stage(id, input, "restoring", "正在恢复原始图配置", false);
          await this.query(id, input, SERVER_GRAPHSON_QUERIES.restoreBatchLoading, {
            graphName: input.graphName, ...recovery,
          }, true);
          this.runs.setRecovery(id, null);
        } catch (restoreError) {
          recoveryError = restoreError;
        }
      }
      if (transferId) await this.files.cleanupDockerTransfer(transferId);
    }
    if (recoveryError) {
      throw new Error(`恢复批量加载配置失败：${message(recoveryError)}${primaryError ? `；原始任务：${message(primaryError)}` : ""}`);
    }
    if (primaryError) throw primaryError;
    this.publish(id, input, {
      status: "succeeded", stage: "completed", message: `GraphSON 已导入“${input.graphName}”`,
      progressCurrent: 1, progressTotal: 1, progressUnit: "file", cancellable: false, retriable: false,
    });
  }

  private async exportGraph(id: string, input: StartGraphTransferInput): Promise<void> {
    let dockerTarget: Awaited<ReturnType<FileService["prepareDockerExport"]>> | undefined;
    let timer: NodeJS.Timeout | undefined;
    let monitoring = true;
    try {
      let serverPath = input.serverPath!;
      if (input.fileAccess === "docker") {
        dockerTarget = await this.files.prepareDockerExport(input.dockerContainerId!);
        serverPath = dockerTarget.serverPath;
      }
      const partialPath = `${serverPath}.janus-studio-partial-${id}`;
      const monitor = async () => {
        if (!monitoring) return;
        try {
          const result = await this.query(`${id}:progress`, input, SERVER_GRAPHSON_QUERIES.exportProgress, { partialPath }, false);
          const progress = parseExportProgress(result.items);
          if (!progress || !monitoring || this.tasks.get(id)?.status === "cancel_requested") return;
          this.publish(id, input, {
            status: "running", stage: "exporting",
            message: progress.exists ? `正在生成 GraphSON，已写入 ${formatBytes(progress.sizeBytes)}` : "正在等待服务器生成第一个 GraphSON 数据块",
            progressCurrent: progress.sizeBytes, progressTotal: 0, progressUnit: "byte", cancellable: true, retriable: false,
          });
        } catch { /* Progress is best effort. */ }
      };
      timer = setInterval(() => void monitor(), 1_500);
      void monitor();
      await this.query(id, input, SERVER_GRAPHSON_QUERIES.exportGraph, {
        ...this.target(input), serverPath, partialPath,
        overwrite: input.fileAccess === "docker" || input.overwrite === true,
      }, false);
      if (this.tasks.get(id)?.status === "cancel_requested") throw new Error("查询已停止");
      monitoring = false;
      if (timer) clearInterval(timer);
      let finalMessage = `GraphSON 已写入服务器 ${serverPath}`;
      if (dockerTarget) {
        this.stage(id, input, "docker-download", "正在将文件从容器保存到本机", false);
        const savedPath = await this.files.finishDockerExport(dockerTarget.transferId, graphsonExportFileName(input.graphName));
        if (!savedPath) throw new Error("已取消保存导出文件");
        finalMessage = `GraphSON 已保存到 ${savedPath}`;
      }
      const current = this.tasks.get(id);
      this.publish(id, input, {
        status: "succeeded", stage: "completed", message: finalMessage,
        progressCurrent: current?.progressCurrent ?? 0, progressTotal: current?.progressCurrent ?? 0,
        progressUnit: "byte", cancellable: false, retriable: false,
      });
    } finally {
      monitoring = false;
      if (timer) clearInterval(timer);
      if (dockerTarget) await this.files.cleanupDockerTransfer(dockerTarget.transferId);
    }
  }

  private async purge(id: string, input: StartGraphTransferInput): Promise<void> {
    const countResult = await this.query(id, input, SERVER_GRAPHSON_QUERIES.countVertices, this.target(input), false);
    const count = parseVertexCount(countResult.items);
    if (!count) throw new Error("无法读取目标图顶点总数");
    let deleted = 0;
    this.publish(id, input, {
      status: "running", stage: "purging", message: `准备删除 ${count.total} 个顶点`,
      progressCurrent: 0, progressTotal: count.total, progressUnit: "vertex", cancellable: true, retriable: false,
    });
    while (this.tasks.get(id)?.status === "running") {
      const result = await this.query(id, input, SERVER_GRAPHSON_QUERIES.deleteVertexBatch, {
        ...this.target(input), batchSize: 100,
      }, true);
      const batch = parseDeletedVertexBatch(result.items);
      if (!batch) throw new Error("无法读取批次删除结果");
      deleted += batch.deleted;
      if (this.tasks.get(id)?.status === "cancel_requested") break;
      this.publish(id, input, {
        status: "running", stage: "purging",
        message: `已删除 ${deleted} 个顶点，剩余 ${Math.max(count.total - deleted, 0)} 个`,
        progressCurrent: deleted, progressTotal: count.total, progressUnit: "vertex", cancellable: true, retriable: false,
      });
      if (batch.complete) break;
    }
    const stopped = this.tasks.get(id)?.status === "cancel_requested";
    this.publish(id, input, {
      status: stopped ? "interrupted" : "succeeded", stage: "completed",
      message: stopped ? `已在批次边界停止，共删除 ${deleted} 个顶点` : `目标图数据已清空，共删除 ${deleted} 个顶点`,
      progressCurrent: deleted, progressTotal: count.total, progressUnit: "vertex", cancellable: false, retriable: stopped,
    });
  }

  private stage(id: string, input: StartGraphTransferInput, stage: string, text: string, cancellable: boolean): void {
    const current = this.tasks.get(id);
    this.publish(id, input, {
      status: current?.status === "cancel_requested" ? "cancel_requested" : "running",
      stage,
      message: current?.status === "cancel_requested" ? current.message : text,
      progressCurrent: current?.progressCurrent ?? 0, progressTotal: current?.progressTotal ?? 0,
      progressUnit: current?.progressUnit ?? "file",
      cancellable: current?.status === "cancel_requested" ? false : cancellable,
      retriable: false,
    });
  }

  private interruptedMessage(input: StartGraphTransferInput): string {
    const protocol = this.connections.profile(input.connectionId).protocol;
    if (input.action === "purge") return "已在批次边界停止";
    return protocol === "ws" || protocol === "wss"
      ? "Gremlin Server 迁移会话已中断；已经写入的数据不会回滚"
      : "客户端已停止等待；HTTP 服务端任务可能继续运行至超时";
  }

  private publish(
    id: string,
    input: StartGraphTransferInput,
    value: Omit<PublishBackgroundTaskInput, "id" | "kind" | "action" | "title" | "connectionId" | "graphName">,
  ): BackgroundTask {
    return this.tasks.publish({
      id, kind: "transfer", action: input.action, title: input.graphName,
      connectionId: input.connectionId, graphName: input.graphName, ...value,
    }, this.connections.profile(input.connectionId).name);
  }
}
