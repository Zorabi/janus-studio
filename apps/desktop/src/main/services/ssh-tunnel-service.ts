import type { ConnectionProfile, ConnectionSshTunnelSnapshot } from "@janusgraph/domain";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { Client, type ConnectConfig } from "ssh2";
import type { ConnectionRuntimeCredentials } from "./connection-service";

export type RoutedConnectionProfile = ConnectionProfile & { routeServerName?: string };

type ActiveTunnel = {
  signature: string;
  client: Client;
  server: net.Server;
  localPort: number;
  sockets: Set<net.Socket>;
  alive: boolean;
  closing?: Promise<void>;
};

export function sshHostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function secretHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class SshTunnelService {
  private readonly tunnels = new Map<string, ActiveTunnel>();

  snapshot(connectionId: string): ConnectionSshTunnelSnapshot {
    const tunnel = this.tunnels.get(connectionId);
    return tunnel?.alive
      ? { status: "connected", localPort: tunnel.localPort }
      : { status: "inactive" };
  }

  async route(profile: ConnectionProfile, credentials: ConnectionRuntimeCredentials): Promise<RoutedConnectionProfile> {
    if (!profile.sshEnabled) return profile;
    const tunnel = await this.ensure(profile, credentials);
    return {
      ...profile,
      host: "127.0.0.1",
      port: tunnel.localPort,
      proxyMode: "direct",
      routeServerName: profile.host,
    };
  }

  async close(connectionId: string): Promise<void> {
    const tunnel = this.tunnels.get(connectionId);
    if (!tunnel) return;
    this.tunnels.delete(connectionId);
    await this.shutdown(tunnel);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.tunnels.keys()].map((id) => this.close(id)));
  }

  private async ensure(profile: ConnectionProfile, credentials: ConnectionRuntimeCredentials): Promise<ActiveTunnel> {
    const signature = [
      profile.sshHost,
      profile.sshPort,
      profile.sshUsername,
      profile.sshAuthMode,
      profile.sshPrivateKeyPath,
      profile.sshAgentPath,
      profile.sshHostKeyFingerprint,
      profile.host,
      profile.port,
      secretHash(credentials.sshPassword),
      secretHash(credentials.sshPrivateKeyPassphrase),
    ].join("\0");
    const current = this.tunnels.get(profile.id);
    if (current?.signature === signature && current.alive) return current;
    if (current) await this.close(profile.id);

    const client = new Client();
    let observedFingerprint = "";
    const config: ConnectConfig = {
      host: profile.sshHost,
      port: profile.sshPort,
      username: profile.sshUsername,
      readyTimeout: profile.connectTimeoutMs,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => {
        observedFingerprint = sshHostKeyFingerprint(key);
        return observedFingerprint === profile.sshHostKeyFingerprint.replace(/=+$/, "");
      },
    };
    if (profile.sshAuthMode === "password") config.password = credentials.sshPassword;
    else if (profile.sshAuthMode === "private-key") {
      config.privateKey = await readFile(profile.sshPrivateKeyPath);
      if (credentials.sshPrivateKeyPassphrase) config.passphrase = credentials.sshPrivateKeyPassphrase;
    } else {
      config.agent = profile.sshAgentPath || process.env.SSH_AUTH_SOCK;
      if (!config.agent) throw new Error("未找到 SSH Agent，请配置 Agent Socket 路径");
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        client.off("ready", ready);
        client.off("error", fail);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const fail = (error: Error) => {
        cleanup();
        client.end();
        if (observedFingerprint && observedFingerprint !== profile.sshHostKeyFingerprint.replace(/=+$/, "")) {
          reject(new Error(`SSH 主机密钥不匹配；服务端指纹为 ${observedFingerprint}`));
        } else reject(error);
      };
      client.once("ready", ready);
      client.once("error", fail);
      client.connect(config);
    });

    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      client.forwardOut("127.0.0.1", 0, profile.host, profile.port, (error, stream) => {
        if (error) {
          socket.destroy(error);
          return;
        }
        socket.pipe(stream);
        stream.pipe(socket);
        socket.once("error", () => stream.destroy());
        stream.once("error", () => socket.destroy());
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      client.end();
      throw new Error("SSH 本地转发端口分配失败");
    }
    const tunnel: ActiveTunnel = {
      signature,
      client,
      server,
      localPort: address.port,
      sockets,
      alive: true,
    };
    const deactivate = () => {
      if (!tunnel.alive) return;
      tunnel.alive = false;
      if (this.tunnels.get(profile.id) === tunnel) this.tunnels.delete(profile.id);
      void this.shutdown(tunnel);
    };
    client.once("error", deactivate);
    client.once("close", deactivate);
    this.tunnels.set(profile.id, tunnel);
    return tunnel;
  }

  private shutdown(tunnel: ActiveTunnel): Promise<void> {
    if (tunnel.closing) return tunnel.closing;
    tunnel.alive = false;
    tunnel.closing = (async () => {
      for (const socket of tunnel.sockets) socket.destroy();
      tunnel.sockets.clear();
      tunnel.client.end();
      if (!tunnel.server.listening) return;
      await new Promise<void>((resolve) => tunnel.server.close(() => resolve()));
    })();
    return tunnel.closing;
  }
}
