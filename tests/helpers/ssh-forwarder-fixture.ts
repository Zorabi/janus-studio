import { generateKeyPairSync } from "node:crypto";
import net from "node:net";
import { Server as SshServer, utils, type Connection as SshServerConnection } from "ssh2";
import { sshHostKeyFingerprint } from "../../apps/desktop/src/main/services/ssh-tunnel-service.ts";

export type SshForwarderFixture = {
  host: string;
  port: number;
  username: string;
  password: string;
  fingerprint: string;
  close(): Promise<void>;
};

export async function startSshForwarderFixture(): Promise<SshForwarderFixture> {
  const username = "studio";
  const password = "fixture-password";
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const parsed = utils.parseKey(privateKey);
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error("SSH fixture host key is invalid");
  const clients = new Set<SshServerConnection>();
  const server = new SshServer({ hostKeys: [privateKey] }, (client) => {
    clients.add(client);
    client.on("error", () => undefined);
    client.once("close", () => clients.delete(client));
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === username && context.password === password) context.accept();
      else context.reject();
    });
    client.on("ready", () => client.on("tcpip", (accept, reject, info) => {
      const channel = accept();
      if (!channel) {
        reject();
        return;
      }
      const upstream = net.connect(info.destPort, info.destIP, () => {
        channel.pipe(upstream);
        upstream.pipe(channel);
      });
      upstream.once("error", () => channel.close());
      channel.once("error", () => upstream.destroy());
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SSH fixture port allocation failed");

  return {
    host: "127.0.0.1",
    port: address.port,
    username,
    password,
    fingerprint: sshHostKeyFingerprint(parsed.getPublicSSH()),
    close: async () => {
      for (const client of clients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
