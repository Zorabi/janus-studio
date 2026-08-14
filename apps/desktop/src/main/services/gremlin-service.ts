import { connectionEndpoint } from "@janusgraph/application";
import type {
  ConnectionProfile,
  ConnectionTestReport,
  QueryExecutionResult,
} from "@janusgraph/domain";
import gremlin from "gremlin";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import net from "node:net";
import tls from "node:tls";
import { Agent as HttpsAgent } from "node:https";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import {
  createWebSocketProxyAgent,
  openProxyTunnel,
  proxyHost,
  resolveConnectionProxy,
  type ResolvedProxy,
  type SystemProxyResolver,
} from "./proxy-support";

const GRAPHSON_V3 = "application/vnd.gremlin-v3.0+json";
const MAX_RESULT_ITEMS = 10_000;

type CollectedItems = {
  items: unknown[];
  totalCount: number;
  truncated: boolean;
};

type TlsMaterial = { ca?: Buffer; cert?: Buffer; key?: Buffer; passphrase?: string };

async function readTlsFile(path: string, label: string): Promise<Buffer | undefined> {
  if (!path) return undefined;
  try {
    return await readFile(path);
  } catch {
    throw new Error(`${label}不可读取，请重新选择文件`);
  }
}

async function tlsMaterial(profile: ConnectionProfile, passphrase = ""): Promise<TlsMaterial> {
  if (profile.protocol !== "wss" && profile.protocol !== "https") return {};
  const [ca, cert, key] = await Promise.all([
    readTlsFile(profile.tlsCaPath, "自定义 CA 证书"),
    readTlsFile(profile.tlsClientCertPath, "客户端证书"),
    readTlsFile(profile.tlsClientKeyPath, "客户端私钥"),
  ]);
  return { ...(ca ? { ca } : {}), ...(cert ? { cert } : {}), ...(key ? { key } : {}), ...(passphrase ? { passphrase } : {}) };
}

function websocketTlsOptions(profile: ConnectionProfile, material: TlsMaterial) {
  const options = { rejectUnauthorized: profile.tlsRejectUnauthorized, ...material };
  return material.key
    ? { rejectUnauthorized: profile.tlsRejectUnauthorized, agent: new HttpsAgent(options) }
    : {
        rejectUnauthorized: profile.tlsRejectUnauthorized,
        ...(material.ca ? { ca: material.ca } : {}),
        ...(material.cert ? { cert: material.cert } : {}),
      };
}

function probeSocket(factory: () => net.Socket, readyEvent: "connect" | "secureConnect", timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = factory();
    const done = (error?: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.setTimeout(timeoutMs, () => done(new Error(`连接超时（${timeoutMs} ms）`)));
    socket.once(readyEvent, () => done());
    socket.once("error", done);
  });
}

function isAuthenticationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /authentication|unauthorized|forbidden|sasl|status(?:code)?\D*(?:401|407)|http\s+(?:401|403)/i.test(message);
}

function isProxyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /proxy|代理|HTTP\s*407/i.test(message);
}

async function probeTlsThroughProxy(
  profile: ConnectionProfile,
  proxy: ResolvedProxy,
  material: TlsMaterial,
): Promise<void> {
  const socket = await openProxyTunnel(proxy, profile.host, profile.port, profile.connectTimeoutMs);
  await probeSocket(() => tls.connect({
    socket,
    servername: isIP(profile.host) ? undefined : profile.host,
    rejectUnauthorized: profile.tlsRejectUnauthorized,
    ...material,
  }), "secureConnect", profile.connectTimeoutMs);
}

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

async function closeClientTransport(
  client: InstanceType<typeof gremlin.driver.Client>,
): Promise<void> {
  const transport = (client as unknown as {
    _connection?: { close: () => Promise<void> };
  })._connection;
  if (transport) {
    await transport.close().catch(() => undefined);
    return;
  }
  await client.close().catch(() => undefined);
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

  constructor(private readonly systemProxyResolver?: SystemProxyResolver) {
    // gremlin 3.7.x prefers Node 22's global WebSocket when it exists, but that
    // implementation ignores the Node-only connection options we rely on for
    // proxy agents, custom headers, compression, custom CAs and mTLS. Removing
    // it in Electron's isolated main process makes the driver use its bundled
    // `ws` transport, where those options are supported.
    if (!Reflect.deleteProperty(globalThis, "WebSocket") && "WebSocket" in globalThis) {
      throw new Error("无法初始化支持代理与 TLS 的 Gremlin WebSocket 传输");
    }
  }

  async test(
    profile: ConnectionProfile,
    password: string,
    tlsClientKeyPassphrase = "",
    proxyPassword = "",
  ): Promise<ConnectionTestReport> {
    const start = performance.now();
    const endpoint = connectionEndpoint(profile);
    const stages: ConnectionTestReport["stages"] = [];
    const runStage = async <T>(stage: ConnectionTestReport["stage"], operation: () => Promise<T>): Promise<T> => {
      const stageStart = performance.now();
      try {
        const result = await operation();
        stages.push({ stage, status: "passed", durationMs: Math.round(performance.now() - stageStart), message: "通过" });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stages.push({ stage, status: "failed", durationMs: Math.round(performance.now() - stageStart), message });
        throw error;
      }
    };
    try {
      let proxy: ResolvedProxy | null;
      try {
        proxy = await resolveConnectionProxy(profile, endpoint, proxyPassword, this.systemProxyResolver);
      } catch (error) {
        stages.push({
          stage: "proxy",
          status: "failed",
          durationMs: 0,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      await runStage("dns", async () => {
        const host = proxy ? proxyHost(proxy) : profile.host;
        if (!isIP(host)) await lookup(host);
      });
      const routeHost = proxy ? proxy.url.hostname : profile.host;
      const routePort = proxy
        ? proxy.url.port ? Number(proxy.url.port) : proxy.url.protocol === "https:" ? 443 : 80
        : profile.port;
      await runStage("tcp", () => probeSocket(() => net.connect({ host: routeHost, port: routePort }), "connect", profile.connectTimeoutMs));
      if (proxy) {
        await runStage("proxy", async () => {
          const socket = await openProxyTunnel(proxy, profile.host, profile.port, profile.connectTimeoutMs);
          socket.destroy();
        });
      } else {
        stages.push({ stage: "proxy", status: "skipped", durationMs: 0, message: profile.proxyMode === "direct" ? "使用直连" : "目标地址已绕过代理" });
      }
      const secure = profile.protocol === "wss" || profile.protocol === "https";
      if (secure) {
        await runStage("tls", async () => {
          const material = await tlsMaterial(profile, tlsClientKeyPassphrase);
          if (proxy) await probeTlsThroughProxy(profile, proxy, material);
          else {
            await probeSocket(() => tls.connect({
              host: profile.host,
              port: profile.port,
              servername: isIP(profile.host) ? undefined : profile.host,
              rejectUnauthorized: profile.tlsRejectUnauthorized,
              ...material,
            }), "secureConnect", profile.connectTimeoutMs);
          }
        });
      } else {
        stages.push({ stage: "tls", status: "skipped", durationMs: 0, message: "当前协议未使用 TLS" });
      }
      try {
        const queryStart = performance.now();
        await this.execute(
          profile,
          password,
          "connection-test",
          randomUUID(),
          "1",
          {},
          profile.queryTimeoutMs,
          false,
          tlsClientKeyPassphrase,
          proxyPassword,
        );
        const queryDuration = Math.round(performance.now() - queryStart);
        stages.push({ stage: "authentication", status: "passed", durationMs: queryDuration, message: profile.username ? "认证通过" : "匿名访问可用" });
        stages.push({ stage: "gremlin", status: "passed", durationMs: queryDuration, message: "Gremlin 请求与响应通过" });
      } catch (error) {
        const stage = isProxyError(error) ? "proxy" : isAuthenticationError(error) ? "authentication" : "gremlin";
        if (stage === "gremlin") {
          stages.push({ stage: "authentication", status: "passed", durationMs: 0, message: profile.username ? "服务端已接受认证信息" : "匿名访问可用" });
        }
        stages.push({ stage, status: "failed", durationMs: 0, message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
      const schemaResult = await runStage("schema", () => this.execute(
        profile,
        password,
        "connection-test",
        randomUUID(),
        `if (!this.binding.hasVariable(__janusStudioGraphBinding)) { return false }
def __janusStudioGraph = this.binding.getVariable(__janusStudioGraphBinding)
def __janusStudioManagement = __janusStudioGraph.openManagement()
try { return __janusStudioManagement != null } finally { __janusStudioManagement.rollback() }`,
        { __janusStudioGraphBinding: profile.graphBinding },
        profile.queryTimeoutMs,
        false,
        tlsClientKeyPassphrase,
        proxyPassword,
      ));
      if (schemaResult.items[0] !== true) stages[stages.length - 1] = { stage: "schema", status: "skipped", durationMs: stages.at(-1)?.durationMs ?? 0, message: `未找到 Graph Binding：${profile.graphBinding}` };
      return {
        success: true,
        latencyMs: Math.round(performance.now() - start),
        endpoint,
        stage: "schema",
        message: schemaResult.items[0] === true ? "网络、TLS、认证、Gremlin 与 Schema Binding 均已通过" : "查询连接可用；Schema Binding 未在服务端暴露",
        stages,
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Math.round(performance.now() - start),
        endpoint,
        stage: stages.find((stage) => stage.status === "failed")?.stage ?? "tcp",
        message: error instanceof Error ? error.message : "无法连接到 JanusGraph Server",
        stages,
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
    serverCancellation = false,
    tlsClientKeyPassphrase = "",
    proxyPassword = "",
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
            serverCancellation,
            tlsClientKeyPassphrase,
            proxyPassword,
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
            tlsClientKeyPassphrase,
            proxyPassword,
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
    tlsClientKeyPassphrase = "",
    proxyPassword = "",
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
        profile.queryTimeoutMs,
        tlsClientKeyPassphrase,
        proxyPassword,
      );
      await writeItems(collected.items.map((item) => toSerializable(item)));
      return { totalCount: collected.totalCount, durationMs: Math.round(performance.now() - startedAt) };
    }

    const endpoint = connectionEndpoint(profile);
    const material = await tlsMaterial(profile, tlsClientKeyPassphrase);
    const proxy = await resolveConnectionProxy(profile, endpoint, proxyPassword, this.systemProxyResolver);
    const authenticator = profile.username && password
      ? new gremlin.driver.auth.PlainTextSaslAuthenticator(profile.username, password)
      : undefined;
    const client = new gremlin.driver.Client(endpoint, {
      traversalSource: profile.traversalSource,
      mimeType: GRAPHSON_V3,
      authenticator,
      headers: customHeaders(profile),
      ...(proxy
        ? { agent: createWebSocketProxyAgent(profile, proxy, { rejectUnauthorized: profile.tlsRejectUnauthorized, ...material }) }
        : websocketTlsOptions(profile, material)),
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
    serverCancellation: boolean,
    tlsClientKeyPassphrase: string,
    proxyPassword: string,
  ): Promise<CollectedItems> {
    const material = await tlsMaterial(profile, tlsClientKeyPassphrase);
    const proxy = await resolveConnectionProxy(profile, endpoint, proxyPassword, this.systemProxyResolver);
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
        ...(proxy
          ? { agent: createWebSocketProxyAgent(profile, proxy, { rejectUnauthorized: profile.tlsRejectUnauthorized, ...material }) }
          : websocketTlsOptions(profile, material)),
        enableCompression: profile.enableCompression,
        ...(sessioned
          ? { processor: "session", session: randomUUID() }
          : {}),
      });
    const dedicatedSession = serverCancellation;
    const sessioned = profile.clientMode === "sessioned" || dedicatedSession;
    const sessionKey = `${profile.id}\u0000${consoleId}`;
    let client: InstanceType<typeof gremlin.driver.Client>;
    if (dedicatedSession) {
      client = createClient(true);
    } else if (sessioned) {
      const credentialHash = createHash("sha256")
        .update(`${profile.username}\u0000${password}`)
        .digest("hex");
      const signature = [
        endpoint,
        profile.traversalSource,
        String(profile.tlsRejectUnauthorized),
        profile.tlsCaPath,
        profile.tlsClientCertPath,
        profile.tlsClientKeyPath,
        String(profile.enableCompression),
        profile.customHeaders,
        profile.proxyMode,
        profile.proxyUrl,
        profile.proxyHost,
        String(profile.proxyPort),
        profile.proxyBypass,
        profile.proxyUsername,
        credentialHash,
        createHash("sha256").update(tlsClientKeyPassphrase).digest("hex"),
        createHash("sha256").update(proxyPassword).digest("hex"),
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
        if (sessioned && !dedicatedSession) this.sessionClients.delete(sessionKey);
        if (sessioned) {
          await closeClientTransport(client);
          return;
        }
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
      if (execution.cancelled) {
        await closeClientTransport(client);
        throw new Error("查询已停止");
      }
      const requestClient = client as typeof client & {
        stream: (
          message: string,
          requestBindings: Record<string, unknown>,
          options: { evaluationTimeout: number; requestId: string },
        ) => ReturnType<typeof client.stream>;
      };
      const stream = requestClient.stream(query, bindings, {
        evaluationTimeout: timeoutMs,
        requestId: executionId,
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
        await closeClientTransport(client);
      }
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
      if (!sessioned) {
        await client.close().catch(() => undefined);
      } else if (dedicatedSession) {
        if (execution.cancelled) await closeClientTransport(client);
        else await client.close().catch(() => undefined);
      }
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
    tlsClientKeyPassphrase = "",
    proxyPassword = "",
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
    const material = await tlsMaterial(profile, tlsClientKeyPassphrase);
    const proxy = await resolveConnectionProxy(profile, endpoint, proxyPassword, this.systemProxyResolver);
    const dispatcher = proxy
      ? new ProxyAgent({
          uri: proxy.url.toString(),
          ...(proxy.authorization ? { token: proxy.authorization } : {}),
          proxyTunnel: true,
          requestTls: { rejectUnauthorized: profile.tlsRejectUnauthorized, ...material },
        })
      : profile.protocol === "https"
        ? new Agent({ connect: { rejectUnauthorized: profile.tlsRejectUnauthorized, ...material } })
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
        undiciFetch(endpoint, {
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
        }),
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
