import type { ConnectionProfile } from "@janusgraph/domain";
import http, { Agent as HttpAgent } from "node:http";
import https, { Agent as HttpsAgent } from "node:https";
import net from "node:net";
import tls from "node:tls";

export type SystemProxyResolver = (endpoint: string) => Promise<string>;

export type ResolvedProxy = {
  url: URL;
  authorization: string;
  source: "manual" | "system";
};

type TargetTlsOptions = {
  rejectUnauthorized?: boolean;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
  passphrase?: string;
};

function proxyUrl(value: string): URL {
  const parsed = new URL(value.includes("://") ? value : `http://${value}`);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("当前仅支持 HTTP/HTTPS 代理");
  }
  if (!parsed.hostname) throw new Error("代理地址缺少主机名");
  return parsed;
}

function wildcardMatch(hostname: string, pattern: string): boolean {
  const normalized = pattern.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "*") return true;
  const withoutScheme = normalized.replace(/^[a-z]+:\/\//, "").split("/")[0] ?? "";
  const withoutPort = withoutScheme.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1").replace(/:\d+$/, "");
  if (withoutPort.startsWith(".")) {
    return hostname === withoutPort.slice(1) || hostname.endsWith(withoutPort);
  }
  const escaped = withoutPort.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(hostname);
}

export function isProxyBypassed(hostname: string, bypass: string): boolean {
  return bypass
    .split(/[\s,;]+/)
    .some((entry) => wildcardMatch(hostname.toLowerCase(), entry));
}

function parseSystemProxy(value: string): URL | null {
  for (const entry of value.split(";")) {
    const directive = entry.trim();
    if (!directive) continue;
    if (/^DIRECT$/i.test(directive)) return null;
    const match = directive.match(/^(PROXY|HTTP|HTTPS)\s+(.+)$/i);
    if (match) return proxyUrl(`${match[1]?.toUpperCase() === "HTTPS" ? "https" : "http"}://${match[2] ?? ""}`);
  }
  throw new Error("系统代理返回了当前不支持的代理类型");
}

export async function resolveConnectionProxy(
  profile: ConnectionProfile,
  endpoint: string,
  proxyPassword: string,
  systemResolver?: SystemProxyResolver,
): Promise<ResolvedProxy | null> {
  if (profile.proxyMode === "direct" || isProxyBypassed(profile.host, profile.proxyBypass)) return null;
  if (profile.proxyMode === "system") {
    if (!systemResolver) throw new Error("当前运行环境无法解析系统代理");
    const resolved = parseSystemProxy(await systemResolver(endpoint));
    return resolved ? { url: resolved, authorization: "", source: "system" } : null;
  }
  const resolved = proxyUrl(profile.proxyUrl || `http://${profile.proxyHost}:${profile.proxyPort}`);
  const authorization = profile.proxyUsername
    ? `Basic ${Buffer.from(`${profile.proxyUsername}:${proxyPassword}`).toString("base64")}`
    : "";
  return { url: resolved, authorization, source: "manual" };
}

function authority(host: string, port: number): string {
  return `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

export function openProxyTunnel(
  proxy: ResolvedProxy,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const request = (proxy.url.protocol === "https:" ? https : http).request({
      protocol: proxy.url.protocol,
      hostname: proxy.url.hostname,
      port: proxy.url.port ? Number(proxy.url.port) : proxy.url.protocol === "https:" ? 443 : 80,
      method: "CONNECT",
      path: authority(targetHost, targetPort),
      headers: {
        Host: authority(targetHost, targetPort),
        ...(proxy.authorization ? { "Proxy-Authorization": proxy.authorization } : {}),
      },
      timeout: timeoutMs,
    });
    const fail = (error: Error) => {
      request.destroy();
      reject(error);
    };
    request.once("connect", (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        const message = response.statusCode === 407
          ? "代理认证失败（HTTP 407）"
          : `代理隧道建立失败（HTTP ${response.statusCode ?? "unknown"}）`;
        fail(new Error(message));
        return;
      }
      request.removeAllListeners();
      if (head.length > 0) socket.unshift(head);
      resolve(socket);
    });
    request.once("timeout", () => fail(new Error(`代理连接超时（${timeoutMs} ms）`)));
    request.once("error", fail);
    request.end();
  });
}

export function createWebSocketProxyAgent(
  profile: ConnectionProfile,
  proxy: ResolvedProxy,
  targetTls: TargetTlsOptions,
): HttpAgent | HttpsAgent {
  const secureTarget = profile.protocol === "wss";
  const agent = secureTarget ? new HttpsAgent({ keepAlive: true }) : new HttpAgent({ keepAlive: true });
  agent.createConnection = ((_options: object, callback: (error: Error | null, socket?: net.Socket) => void) => {
    void openProxyTunnel(proxy, profile.host, profile.port, profile.connectTimeoutMs)
      .then((socket) => {
        if (!secureTarget) {
          callback(null, socket);
          return;
        }
        const secureSocket = tls.connect({
          socket,
          servername: net.isIP(profile.host) ? undefined : profile.host,
          ...targetTls,
        });
        secureSocket.once("secureConnect", () => callback(null, secureSocket));
        secureSocket.once("error", callback);
      })
      .catch((error: Error) => callback(error));
    return undefined as never;
  }) as typeof agent.createConnection;
  return agent;
}

export function proxyHost(proxy: ResolvedProxy): string {
  return proxy.url.hostname;
}
