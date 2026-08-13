import type {
  DockerRuntimeStatus,
  DockerTransferTarget,
  PickedDataFile,
  PickedQueryFile,
  PickedSchemaFile,
  SaveDataFileInput,
  SaveGraphFileInput,
  SaveResultFileInput,
  SaveQueryFileInput,
  SaveSchemaFileInput,
  DiagnosticBundleResult,
  DiagnosticBundleInspectionResult,
} from "@janusgraph/domain";
import { dialog, type BrowserWindow } from "electron";
import { access, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import {
  createDockerServerPath,
  dockerCliCandidates,
  dockerExecAsRoot,
  parseDockerContainers,
  validateDockerTarget,
} from "./docker-transfer";
import { analyzeDiagnosticDocuments } from "@janusgraph/application";
import { createZipArchive, readZipArchive, type ZipArchiveEntry } from "../diagnostics/zip-archive";
import { redactDiagnosticText } from "../diagnostics/redactor";

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export class FileService {
  private dockerCommandPromise: Promise<string> | undefined;

  private readonly dockerTransfers = new Map<string, {
    containerId: string;
    serverPath: string;
    direction: "import" | "export";
    name: string;
    sizeBytes?: number;
  }>();

  constructor(private readonly window: BrowserWindow) {}

  private resolveDockerCommand(): Promise<string> {
    if (!this.dockerCommandPromise) {
      this.dockerCommandPromise = (async () => {
        for (const candidate of dockerCliCandidates()) {
          try {
            await access(candidate, constants.X_OK);
            return candidate;
          } catch {
            // Continue through known GUI-runtime and package-manager locations.
          }
        }
        throw new Error("未找到 Docker CLI。请安装 Docker Desktop、OrbStack 或 Rancher Desktop 后重试。");
      })().catch((error) => {
        this.dockerCommandPromise = undefined;
        throw error;
      });
    }
    return this.dockerCommandPromise;
  }

  private async runDocker(args: string[], timeout = 86_400_000): Promise<string> {
    const dockerCommand = await this.resolveDockerCommand();
    return new Promise((resolve, reject) => {
      execFile(dockerCommand, args, {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout,
      }, (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message).trim();
          reject(new Error(detail ? `Docker 操作失败：${detail}` : "Docker 操作失败"));
          return;
        }
        resolve(String(stdout));
      });
    });
  }

  async dockerStatus(): Promise<DockerRuntimeStatus> {
    let cliPath: string | undefined;
    try {
      cliPath = await this.resolveDockerCommand();
      const output = await this.runDocker(["ps", "--format", "{{json .}}"], 10_000);
      return { available: true, containers: parseDockerContainers(output), cliPath };
    } catch (error) {
      return {
        available: false,
        containers: [],
        cliPath,
        message: error instanceof Error ? error.message : "Docker 不可用",
      };
    }
  }

  async stageDockerImport(containerId: string): Promise<DockerTransferTarget | null> {
    const target = validateDockerTarget(containerId);
    const result = await dialog.showOpenDialog(this.window, {
      title: "选择 TinkerPop GraphSON 整图文件",
      properties: ["openFile"],
      filters: [{ name: "TinkerPop GraphSON", extensions: ["json", "graphson"] }],
    });
    const localPath = result.filePaths[0];
    if (result.canceled || !localPath) return null;
    const file = await stat(localPath);
    if (!file.isFile()) throw new Error("选择的 GraphSON 路径不是文件");
    const extension = extname(localPath).toLowerCase().slice(1) || "graphson";
    const serverPath = createDockerServerPath(extension);
    try {
      await this.runDocker(["cp", localPath, `${target}:${serverPath}`]);
      await this.runDocker(dockerExecAsRoot(target, "chmod", "0644", serverPath), 30_000);
    } catch (error) {
      await this.runDocker(dockerExecAsRoot(target, "rm", "-f", serverPath), 30_000).catch(() => undefined);
      throw error;
    }
    const transferId = randomUUID();
    const name = localPath.split(/[\\/]/).at(-1) ?? "data.graphson";
    this.dockerTransfers.set(transferId, {
      containerId: target,
      serverPath,
      direction: "import",
      name,
      sizeBytes: file.size,
    });
    return { transferId, containerId: target, serverPath, name, sizeBytes: file.size };
  }

  async prepareDockerExport(containerId: string): Promise<DockerTransferTarget> {
    const target = validateDockerTarget(containerId);
    const transferId = randomUUID();
    const serverPath = createDockerServerPath("graphson");
    const name = `janusgraph-${Date.now()}.graphson`;
    this.dockerTransfers.set(transferId, {
      containerId: target,
      serverPath,
      direction: "export",
      name,
    });
    return { transferId, containerId: target, serverPath, name };
  }

  async finishDockerExport(transferId: string, suggestedName: string): Promise<string | null> {
    const transfer = this.dockerTransfers.get(transferId);
    if (!transfer || transfer.direction !== "export") throw new Error("Docker 导出任务不存在或已过期");
    const result = await dialog.showSaveDialog(this.window, {
      title: "保存 TinkerPop GraphSON 整图文件",
      defaultPath: suggestedName,
      filters: [{ name: "TinkerPop GraphSON", extensions: ["graphson", "json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await this.runDocker(["cp", `${transfer.containerId}:${transfer.serverPath}`, result.filePath]);
    return result.filePath;
  }

  async cleanupDockerTransfer(transferId: string): Promise<boolean> {
    const transfer = this.dockerTransfers.get(transferId);
    if (!transfer) return false;
    this.dockerTransfers.delete(transferId);
    try {
      await this.runDocker(dockerExecAsRoot(transfer.containerId, "rm", "-f", transfer.serverPath), 30_000);
      return true;
    } catch {
      return false;
    }
  }

  dockerTransfer(transferId: string, direction: "import" | "export"): DockerTransferTarget {
    const transfer = this.dockerTransfers.get(transferId);
    if (!transfer || transfer.direction !== direction) {
      throw new Error("Docker 迁移任务不存在、方向不匹配或已过期");
    }
    return {
      transferId,
      containerId: transfer.containerId,
      serverPath: transfer.serverPath,
      name: transfer.name,
      ...(transfer.sizeBytes === undefined ? {} : { sizeBytes: transfer.sizeBytes }),
    };
  }

  async pickDataFile(): Promise<PickedDataFile | null> {
    const result = await dialog.showOpenDialog(this.window, {
      title: "选择图数据文件",
      properties: ["openFile"],
      filters: [
        { name: "Janus Studio 图归档", extensions: ["json"] },
      ],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;

    const file = await stat(path);
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error("该归档超出便携模式的单文件内存保护范围。请使用“大型 GraphSON”，应用会自动搬运完整文件。");
    }
    const content = await readFile(path, "utf8");
    const extension = extname(path).toLowerCase().slice(1);
    if (extension !== "json") {
      throw new Error("整图导入仅支持 JSON 图归档");
    }
    return {
      name: path.split(/[\\/]/).at(-1) ?? "data",
      extension,
      content,
    };
  }

  async saveDataFile(input: SaveDataFileInput): Promise<string | null> {
    const result = await dialog.showSaveDialog(this.window, {
      title:
        input.format === "json"
          ? "导出 JSON 数据"
          : input.format === "jsonl"
            ? "导出 JSON Lines 数据"
            : "导出 CSV 数据",
      defaultPath: input.suggestedName,
      filters:
        input.format === "csv"
          ? [{ name: "CSV", extensions: ["csv"] }]
          : input.format === "jsonl"
            ? [{ name: "JSON Lines", extensions: ["jsonl", "ndjson"] }]
            : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, input.content, "utf8");
    return result.filePath;
  }

  async saveResultFile(input: SaveResultFileInput): Promise<string | null> {
    const result = await dialog.showSaveDialog(this.window, {
      title: input.format === "csv" ? "导出 CSV 数据" : input.format === "jsonl" ? "导出 JSON Lines 数据" : "导出 JSON 数据",
      defaultPath: input.suggestedName,
      filters: input.format === "csv"
        ? [{ name: "CSV", extensions: ["csv"] }]
        : input.format === "jsonl"
          ? [{ name: "JSON Lines", extensions: ["jsonl", "ndjson"] }]
          : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    const stream = createWriteStream(result.filePath, { encoding: "utf8" });
    const write = async (value: string) => {
      if (!stream.write(value)) await once(stream, "drain");
    };
    const csvCell = (value: unknown) => {
      const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    try {
      if (input.format === "json") {
        await write("[\n");
        for (let index = 0; index < input.items.length; index += 1) {
          await write(`${index === 0 ? "" : ",\n"}${JSON.stringify(input.items[index], null, 2)}`);
        }
        await write("\n]\n");
      } else if (input.format === "jsonl") {
        for (const item of input.items) await write(`${JSON.stringify(item)}\n`);
      } else {
        const rows = input.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
        const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
        await write(`${columns.map(csvCell).join(",")}\n`);
        for (const row of rows) await write(`${columns.map((column) => csvCell(row[column])).join(",")}\n`);
      }
      stream.end();
      await once(stream, "close");
      return result.filePath;
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }

  async saveGraphFile(input: SaveGraphFileInput): Promise<string | null> {
    const labels = {
      png: "PNG 图片",
      jpg: "JPEG 图片",
      svg: "SVG 矢量图",
      json: "JSON 图数据",
    } as const;
    const result = await dialog.showSaveDialog(this.window, {
      title: "导出拓扑图",
      defaultPath: input.suggestedName,
      filters: [{ name: labels[input.format], extensions: [input.format] }],
    });
    if (result.canceled || !result.filePath) return null;
    const binary = input.format === "png" || input.format === "jpg";
    await writeFile(
      result.filePath,
      binary ? Buffer.from(input.content, "base64") : input.content,
      binary ? undefined : "utf8",
    );
    return result.filePath;
  }

  async streamQueryResult(
    suggestedName: string,
    format: "json" | "jsonl",
    producer: (writeItems: (items: unknown[]) => Promise<void>) => Promise<{ totalCount: number; durationMs: number }>,
  ): Promise<{ path: string | null; totalCount: number; durationMs: number }> {
    const result = await dialog.showSaveDialog(this.window, {
      title: format === "jsonl" ? "流式导出完整 JSON Lines 结果" : "流式导出完整 JSON 结果",
      defaultPath: suggestedName,
      filters: format === "jsonl"
        ? [{ name: "JSON Lines", extensions: ["jsonl", "ndjson"] }]
        : [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { path: null, totalCount: 0, durationMs: 0 };

    const temporaryPath = `${result.filePath}.janus-studio-partial-${randomUUID()}`;
    const stream = createWriteStream(temporaryPath, { encoding: "utf8" });
    let first = true;
    const write = async (value: string) => {
      if (!stream.write(value)) await once(stream, "drain");
    };
    try {
      if (format === "json") await write("[\n");
      const summary = await producer(async (items) => {
        for (const item of items) {
          if (format === "jsonl") await write(`${JSON.stringify(item)}\n`);
          else {
            await write(`${first ? "" : ",\n"}${JSON.stringify(item)}`);
            first = false;
          }
        }
      });
      if (format === "json") await write("\n]\n");
      stream.end();
      await once(stream, "close");
      await rename(temporaryPath, result.filePath);
      return { path: result.filePath, ...summary };
    } catch (error) {
      stream.destroy();
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async pickQueryFile(): Promise<PickedQueryFile | null> {
    const result = await dialog.showOpenDialog(this.window, {
      title: "打开 Gremlin 脚本",
      properties: ["openFile"],
      filters: [
        { name: "Gremlin / Groovy", extensions: ["gremlin", "groovy", "grem"] },
        { name: "文本文件", extensions: ["txt"] },
      ],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    const content = await readFile(path, "utf8");
    if (Buffer.byteLength(content, "utf8") > 5 * 1024 * 1024) {
      throw new Error("Gremlin 脚本不能超过 5 MB");
    }
    return {
      name: path.split(/[\\/]/).at(-1) ?? "query.gremlin",
      path,
      content,
    };
  }

  async saveQueryFile(input: SaveQueryFileInput): Promise<string | null> {
    const result = await dialog.showSaveDialog(this.window, {
      title: "保存 Gremlin 脚本",
      defaultPath: input.suggestedName.endsWith(".gremlin")
        ? input.suggestedName
        : `${input.suggestedName}.gremlin`,
      filters: [
        { name: "Gremlin", extensions: ["gremlin"] },
        { name: "Groovy", extensions: ["groovy"] },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, input.content, "utf8");
    return result.filePath;
  }

  async pickSchemaFile(): Promise<PickedSchemaFile | null> {
    const result = await dialog.showOpenDialog(this.window, {
      title: "导入 Schema 定义",
      properties: ["openFile"],
      filters: [{ name: "Janus Studio Schema", extensions: ["json"] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    const content = await readFile(path, "utf8");
    if (Buffer.byteLength(content, "utf8") > 5 * 1024 * 1024) {
      throw new Error("Schema 文件不能超过 5 MB");
    }
    return {
      name: path.split(/[\\/]/).at(-1) ?? "schema.json",
      content,
    };
  }

  async saveSchemaFile(input: SaveSchemaFileInput): Promise<string | null> {
    const result = await dialog.showSaveDialog(this.window, {
      title: "导出 Schema 定义",
      defaultPath: input.suggestedName.endsWith(".json")
        ? input.suggestedName
        : `${input.suggestedName}.json`,
      filters: [{ name: "Janus Studio Schema", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, input.content, "utf8");
    return result.filePath;
  }

  async saveDiagnosticBundle(entries: ZipArchiveEntry[], suggestedName: string): Promise<DiagnosticBundleResult> {
    const result = await dialog.showSaveDialog(this.window, {
      title: "生成问题诊断包",
      defaultPath: suggestedName.endsWith(".zip") ? suggestedName : `${suggestedName}.zip`,
      filters: [{ name: "Janus Studio 诊断包", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { path: null, fileCount: entries.length };
    await writeFile(result.filePath, createZipArchive(entries));
    return { path: result.filePath, fileCount: entries.length };
  }

  async inspectDiagnosticBundle(): Promise<DiagnosticBundleInspectionResult | null> {
    const result = await dialog.showOpenDialog(this.window, {
      title: "选择 Janus Studio 问题诊断包",
      properties: ["openFile"],
      filters: [{ name: "Janus Studio 诊断包", extensions: ["zip"] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    const file = await stat(path);
    if (!file.isFile() || file.size > 32 * 1024 * 1024) throw new Error("诊断包不是文件或超过 32 MB 安全限制");
    const entries = readZipArchive(await readFile(path));
    const allowed = new Set(["summary.json", "tasks.json", "logs.ndjson", "diagnostic-report.md", "README.txt"]);
    const documents = entries
      .filter((entry) => allowed.has(entry.name) && entry.name !== "diagnostic-report.md" && entry.name !== "README.txt")
      .map((entry) => ({
        source: entry.name,
        content: redactDiagnosticText(Buffer.from(entry.content).toString("utf8")),
      }));
    if (!documents.some((document) => document.source === "summary.json")) {
      throw new Error("诊断包缺少 summary.json，无法确认来源");
    }
    return {
      name: path.split(/[\\/]/).at(-1) ?? "diagnostics.zip",
      fileNames: entries.map((entry) => entry.name),
      report: analyzeDiagnosticDocuments(documents),
    };
  }
}
