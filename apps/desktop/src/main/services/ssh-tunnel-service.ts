import type { ConnectionProfile } from "@janusgraph/domain";
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
};

export function sshHostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function secretHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class SshTunnelService {
  private readonly tunnels = new Map<string, ActiveTunnel>();

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
    await new Promise<void>((resolve) => tunnel.server.close(() => resolve()));
    tunnel.client.end();
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
    if (current?.signature === signature) return current;
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
      const fail = (error: Error) => {
        client.end();
        if (observedFingerprint && observedFingerprint !== profile.sshHostKeyFingerprint.replace(/=+$/, "")) {
          reject(new Error(`SSH 主机密钥不匹配；服务端指纹为 ${observedFingerprint}`));
        } else reject(error);
      };
      client.once("ready", resolve);
      client.once("error", fail);
      client.connect(config);
    });

    const server = net.createServer((socket) => {
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
    const tunnel = { signature, client, server, localPort: address.port };
    client.once("close", () => {
      if (this.tunnels.get(profile.id) === tunnel) this.tunnels.delete(profile.id);
      server.close();
    });
    this.tunnels.set(profile.id, tunnel);
    return tunnel;
  }
}
