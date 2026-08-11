import { connectionEndpoint } from "@janusgraph/application";
import type {
  ConnectionProfile,
  ConnectionTestReport,
  QueryExecutionResult,
} from "@janusgraph/domain";
import gremlin from "gremlin";
import { createHash, randomUUID } from "node:crypto";
import { Agent } from "undici";

const GRAPHSON_V3 = "application/vnd.gremlin-v3.0+json";
const MAX_RESULT_ITEMS = 10_000;

type CollectedItems = {
  items: unknown[];
  totalCount: number;
  truncated: boolean;
};

function graphsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function consoleValue(value: unknown, depth = 0): string {
  if (depth > 12) return "...";
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "object") {
    const rendered = String(value);
    if (rendered && !/^\[object .+\]$/.test(rendered) && !Array.isArray(value)) return rendered;
  }
  const record = graphsonRecord(value);
  const graphsonType = typeof record?.["@type"] === "string" ? String(record["@type"]) : "";
  const graphsonValue = record?.["@value"];
  if (graphsonType === "g:Map" && Array.isArray(graphsonValue)) {
    const entries: string[] = [];
    for (let index = 0; index + 1 < graphsonValue.length; index += 2) {
      entries.push(`${consoleValue(graphsonValue[index], depth + 1)}=${consoleValue(graphsonValue[index + 1], depth + 1)}`);
    }
    return `{${entries.join(", ")}}`;
  }
  if (graphsonType === "g:Vertex" && graphsonRecord(graphsonValue)?.id !== undefined) {
    return `v[${consoleValue(graphsonRecord(graphsonValue)!.id, depth + 1)}]`;
  }
  if (graphsonType === "g:Edge") {
    const edge = graphsonRecord(graphsonValue);
    if (edge?.id !== undefined) return `e[${consoleValue(edge.id, depth + 1)}][${consoleValue(edge.outV, depth + 1)}-${String(edge.label ?? "edge")}->${consoleValue(edge.inV, depth + 1)}]`;
  }
  if (graphsonType && graphsonValue !== undefined) return consoleValue(graphsonValue, depth + 1);
  if (Array.isArray(value)) return `[${value.map((item) => consoleValue(item, depth + 1)).join(", ")}]`;
  if (value instanceof Map) return `{${Array.from(value, ([key, item]) => `${consoleValue(key, depth + 1)}=${consoleValue(item, depth + 1)}`).join(", ")}}`;
  if (value instanceof Set) return `[${Array.from(value, (item) => consoleValue(item, depth + 1)).join(", ")}]`;
  if (record) return `{${Object.entries(record).map(([key, item]) => `${key}=${consoleValue(item, depth + 1)}`).join(", ")}}`;
  return String(value);
}

export function gremlinConsoleText(items: unknown[]): string {
  return items.map((item) => `==>${consoleValue(item)}`).join("\n");
}

function toSerializable(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[Maximum depth reached]";
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return { "@type": "g:Int64", "@value": value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item, depth + 1));
  }
  if (value instanceof Map) {
    return {
      "@type": "g:Map",
      "@value": Array.from(value.entries()).flatMap(([key, entryValue]) => [
        toSerializable(key, depth + 1),
        toSerializable(entryValue, depth + 1),
      ]),
    };
  }
  if (value instanceof Set) {
    return Array.from(value, (item) => toSerializable(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([, entryValue]) => {
      return typeof entryValue !== "function";
    });
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, toSerializable(entryValue, depth + 1)]),
    );
  }
  return String(value);
}

function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function customHeaders(profile: ConnectionProfile): Record<string, string> {
  const value = JSON.parse(profile.customHeaders || "{}") as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, String(entry)]),
  );
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class GremlinService {
  private readonly sessionClients = new Map<
    string,
    {
      connectionId: string;
      consoleId: string;
      signature: string;
      client: InstanceType<typeof gremlin.driver.Client>;
    }
  >();
  private readonly activeExecutions = new Map<
    string,
    {
      cancelled: boolean;
      cancel: () => Promise<void>;
    }
  >();

  async test(
    profile: ConnectionProfile,
    password: string,
  ): Promise<ConnectionTestReport> {
    const start = performance.now();
    const endpoint = connectionEndpoint(profile);

    try {
      await this.execute(
        profile,
        password,
        "connection-test",
        randomUUID(),
        "g.V().limit(1).count()",
        {},
      );
      return {
        success: true,
        latencyMs: Math.round(performance.now() - start),
        endpoint,
        stage: "query",
        message: "连接、认证与轻量查询均已通过",
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Math.round(performance.now() - start),
        endpoint,
        stage: "network",
        message: error instanceof Error ? error.message : "无法连接到 JanusGraph Server",
      };
    } finally {
      await this.closeConsole(profile.id, "connection-test");
    }
  }

  async execute(
    profile: ConnectionProfile,
    password: string,
    consoleId: string,
    executionId: string,
    query: string,
    bindings: Record<string, unknown>,
    timeoutMs = profile.queryTimeoutMs,
  ): Promise<QueryExecutionResult> {
    const startedAt = performance.now();
    const endpoint = connectionEndpoint(profile);
    if (
      profile.clientMode === "sessioned" &&
      profile.protocol !== "ws" &&
      profile.protocol !== "wss"
    ) {
      throw new Error("Sessioned Client 仅支持 WS/WSS 协议");
    }
    const collected =
      profile.protocol === "ws" || profile.protocol === "wss"
        ? await this.executeWebSocket(
            profile,
            password,
            endpoint,
            consoleId,
            executionId,
            query,
            bindings,
            timeoutMs,
          )
        : await this.executeHttp(
            profile,
            password,
            endpoint,
            executionId,
            query,
            bindings,
            MAX_RESULT_ITEMS,
            timeoutMs,
          );

    return {
      executionId,
      durationMs: Math.round(performance.now() - startedAt),
      items: collected.items.map((item) => toSerializable(item)),
      consoleText: gremlinConsoleText(collected.items),
      truncated: collected.truncated,
      totalCount: collected.totalCount,
    };
  }

  async exportAll(
    profile: ConnectionProfile,
    password: string,
    executionId: string,
    query: string,
    bindings: Record<string, unknown>,
    writeItems: (items: unknown[]) => Promise<void>,
  ): Promise<{ totalCount: number; durationMs: number }> {
    const startedAt = performance.now();
    if (profile.protocol === "http" || profile.protocol === "https") {
      const endpoint = connectionEndpoint(profile);
      const collected = await this.executeHttp(
        profile,
        password,
        endpoint,
        executionId,
        query,
        bindings,
        Number.MAX_SAFE_INTEGER,
      );
      await writeItems(collected.items.map((item) => toSerializable(item)));
      return { totalCount: collected.totalCount, durationMs: Math.round(performance.now() - startedAt) };
    }

    const endpoint = connectionEndpoint(profile);
    const authenticator = profile.username && password
      ? new gremlin.driver.auth.PlainTextSaslAuthenticator(profile.username, password)
      : undefined;
    const client = new gremlin.driver.Client(endpoint, {
      traversalSource: profile.traversalSource,
      mimeType: GRAPHSON_V3,
      authenticator,
      headers: customHeaders(profile),
      rejectUnauthorized: profile.tlsRejectUnauthorized,
      enableCompression: profile.enableCompression,
    });
    const execution = {
      cancelled: false,
      cancel: async () => {
        execution.cancelled = true;
        await client.close().catch(() => undefined);
      },
    };
    this.activeExecutions.set(executionId, execution);
    try {
      const openClient = client as typeof client & { open: () => Promise<void> };
      await withTimeout(openClient.open(), profile.connectTimeoutMs, `WebSocket 连接超时（${profile.connectTimeoutMs} ms）`);
      let totalCount = 0;
      await withTimeout((async () => {
        for await (const resultSet of client.stream(query, bindings)) {
          const batch = [...resultSet];
          totalCount += batch.length;
          await writeItems(batch.map((item) => toSerializable(item)));
        }
      })(), profile.queryTimeoutMs, `Gremlin 流式导出超时（${profile.queryTimeoutMs} ms）`);
      return { totalCount, durationMs: Math.round(performance.now() - startedAt) };
    } catch (error) {
      if (execution.cancelled) throw new Error("查询已停止");
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
      await client.close().catch(() => undefined);
    }
  }

  private async executeWebSocket(
    profile: ConnectionProfile,
    password: string,
    endpoint: string,
    consoleId: string,
    executionId: string,
    query: string,
    bindings: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<CollectedItems> {
    const authenticator =
      profile.username && password
        ? new gremlin.driver.auth.PlainTextSaslAuthenticator(
            profile.username,
            password,
          )
        : undefined;
    const createClient = (sessioned: boolean) =>
      new gremlin.driver.Client(endpoint, {
        traversalSource: profile.traversalSource,
        mimeType: GRAPHSON_V3,
        authenticator,
        headers: customHeaders(profile),
        rejectUnauthorized: profile.tlsRejectUnauthorized,
        enableCompression: profile.enableCompression,
        ...(sessioned
          ? { processor: "session", session: randomUUID() }
          : {}),
      });
    const sessioned = profile.clientMode === "sessioned";
    const sessionKey = `${profile.id}\u0000${consoleId}`;
    let client: InstanceType<typeof gremlin.driver.Client>;
    if (sessioned) {
      const credentialHash = createHash("sha256")
        .update(`${profile.username}\u0000${password}`)
        .digest("hex");
      const signature = [
        endpoint,
        profile.traversalSource,
        String(profile.tlsRejectUnauthorized),
        String(profile.enableCompression),
        profile.customHeaders,
        credentialHash,
      ].join("\u0000");
      const existing = this.sessionClients.get(sessionKey);
      if (existing && existing.signature !== signature) {
        await existing.client.close().catch(() => undefined);
        this.sessionClients.delete(sessionKey);
      }
      const current = this.sessionClients.get(sessionKey);
      if (current) {
        client = current.client;
      } else {
        client = createClient(true);
        this.sessionClients.set(sessionKey, {
          connectionId: profile.id,
          consoleId,
          signature,
          client,
        });
      }
    } else {
      client = createClient(false);
    }

    const execution = {
      cancelled: false,
      cancel: async () => {
        execution.cancelled = true;
        if (sessioned) this.sessionClients.delete(sessionKey);
        await client.close().catch(() => undefined);
      },
    };
    this.activeExecutions.set(executionId, execution);

    try {
      const openClient = client as typeof client & { open: () => Promise<void> };
      await withTimeout(
        openClient.open(),
        profile.connectTimeoutMs,
        `WebSocket 连接超时（${profile.connectTimeoutMs} ms）`,
      );
      const requestClient = client as typeof client & {
        stream: (
          message: string,
          requestBindings: Record<string, unknown>,
          options: { evaluationTimeout: number },
        ) => ReturnType<typeof client.stream>;
      };
      const stream = requestClient.stream(query, bindings, {
        evaluationTimeout: timeoutMs,
      });
      const collected = await withTimeout(
        (async (): Promise<CollectedItems> => {
          const items: unknown[] = [];
          let totalCount = 0;
          for await (const resultSet of stream) {
            totalCount += resultSet.length;
            for (const item of resultSet) {
              if (items.length < MAX_RESULT_ITEMS) items.push(item);
            }
          }
          return {
            items,
            totalCount,
            truncated: totalCount > items.length,
          };
        })(),
        timeoutMs,
        `Gremlin 查询超时（${timeoutMs} ms）`,
      );
      return collected;
    } catch (error) {
      if (execution.cancelled) throw new Error("查询已停止");
      if (sessioned) {
        this.sessionClients.delete(sessionKey);
        await client.close().catch(() => undefined);
      }
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
      if (!sessioned) await client.close();
    }
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) return false;
    execution.cancelled = true;
    await execution.cancel();
    return true;
  }

  async closeConsole(connectionId: string, consoleId: string): Promise<void> {
    const sessionKey = `${connectionId}\u0000${consoleId}`;
    const session = this.sessionClients.get(sessionKey);
    if (!session) return;
    this.sessionClients.delete(sessionKey);
    await session.client.close().catch(() => undefined);
  }

  async closeConnection(connectionId: string): Promise<void> {
    const sessions = [...this.sessionClients.entries()].filter(
      ([, session]) => session.connectionId === connectionId,
    );
    sessions.forEach(([key]) => this.sessionClients.delete(key));
    await Promise.all(
      sessions.map(([, session]) => session.client.close().catch(() => undefined)),
    );
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessionClients.values()];
    this.sessionClients.clear();
    await Promise.all(
      sessions.map((session) => session.client.close().catch(() => undefined)),
    );
  }

  private async executeHttp(
    profile: ConnectionProfile,
    password: string,
    endpoint: string,
    executionId: string,
    query: string,
    bindings: Record<string, unknown>,
    maxItems = MAX_RESULT_ITEMS,
    timeoutMs = profile.queryTimeoutMs,
  ): Promise<CollectedItems> {
    const headers: Record<string, string> = {
      ...customHeaders(profile),
      Accept: GRAPHSON_V3,
      "Content-Type": "application/json",
    };
    if (profile.username && password) {
      headers.Authorization = basicAuth(profile.username, password);
    }

    const controller = new AbortController();
    const dispatcher = profile.protocol === "https"
      ? new Agent({ connect: { rejectUnauthorized: profile.tlsRejectUnauthorized } })
      : undefined;
    const execution = {
      cancelled: false,
      cancel: async () => {
        execution.cancelled = true;
        controller.abort();
      },
    };
    this.activeExecutions.set(executionId, execution);
    try {
      const response = await withTimeout(
        fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            gremlin: query,
            bindings,
            aliases: { g: profile.traversalSource },
            evaluationTimeout: timeoutMs,
          }),
          signal: controller.signal,
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit & { dispatcher?: Agent }),
        timeoutMs,
        `Gremlin HTTP 查询超时（${timeoutMs} ms）`,
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const body = (await withTimeout(
        response.json(),
        timeoutMs,
        `Gremlin HTTP 响应读取超时（${timeoutMs} ms）`,
      )) as {
        result?: { data?: unknown };
        message?: string;
      };
      const data = body.result?.data;
      if (Array.isArray(data)) {
        return {
          items: data.slice(0, maxItems),
          totalCount: data.length,
          truncated: data.length > maxItems,
        };
      }
      if (data && typeof data === "object") {
        const graphson = data as { "@type"?: unknown; "@value"?: unknown };
        if (graphson["@type"] === "g:List" && Array.isArray(graphson["@value"])) {
          return {
            items: graphson["@value"].slice(0, maxItems),
            totalCount: graphson["@value"].length,
            truncated: graphson["@value"].length > maxItems,
          };
        }
      }
      throw new Error(body.message || "Gremlin HTTP 响应缺少 result.data 列表");
    } catch (error) {
      controller.abort();
      if (execution.cancelled) throw new Error("查询已停止");
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
      await dispatcher?.close();
    }
  }
}
