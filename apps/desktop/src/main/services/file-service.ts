import type {
  PickedDataFile,
  PickedQueryFile,
  SaveDataFileInput,
  SaveResultFileInput,
  SaveQueryFileInput,
} from "@janusgraph/domain";
import { dialog, type BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";

const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export class FileService {
  constructor(private readonly window: BrowserWindow) {}

  async pickDataFile(): Promise<PickedDataFile | null> {
    const result = await dialog.showOpenDialog(this.window, {
      title: "选择图数据文件",
      properties: ["openFile"],
      filters: [
        { name: "JanusGraph Observatory 图归档", extensions: ["json"] },
      ],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;

    const content = await readFile(path, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) {
      throw new Error("导入文件不能超过 200 MB");
    }
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

    const temporaryPath = `${result.filePath}.observatory-partial-${randomUUID()}`;
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
}
