import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionProfile } from "../../packages/domain/src/index.ts";
import { GremlinService } from "../../apps/desktop/src/main/services/gremlin-service.ts";

const live = process.env.JANUSGRAPH_COMPAT_LIVE === "1";

function profile(protocol: "ws" | "http", port: number, clientMode: "sessionless" | "sessioned" = "sessionless"): ConnectionProfile {
  const now = new Date().toISOString();
  return {
    id: `${protocol}-${clientMode}`,
    name: `${protocol} compatibility`,
    protocol,
    host: "127.0.0.1",
    port,
    path: "gremlin",
    username: "",
    environment: "dev",
    connectionReadOnly: false,
    clientMode,
    traversalSource: "g",
    graphBinding: "graph",
    connectTimeoutMs: 5_000,
    queryTimeoutMs: 15_000,
    tlsRejectUnauthorized: true,
    enableCompression: false,
    customHeaders: "{}",
    createdAt: now,
    updatedAt: now,
  };
}

async function eventually<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 90_000;
  let latest: unknown;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      latest = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/(ECONNREFUSED|socket|connect|closed|fetch failed|503|network)/i.test(message)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw latest;
}

test("JanusGraph WebSocket supports sessionless queries, bindings and GraphSON", { skip: !live }, async () => {
  const service = new GremlinService();
  const connection = profile("ws", 18_182);
  try {
    const result = await eventually(() => service.execute(
      connection,
      "",
      "compat-console",
      crypto.randomUUID(),
      "g.addV(labelName).property('compatKey', compatValue).values('compatKey')",
      { labelName: "compat_vertex", compatValue: "websocket-ok" },
    ));
    assert.deepEqual(result.items, ["websocket-ok"]);

    const janusGraphClass = await service.execute(
      connection,
      "",
      "compat-console",
      crypto.randomUUID(),
      "graph.getClass().getName()",
      {},
    );
    assert.match(String(janusGraphClass.items[0]), /janusgraph/i);

    const large = await service.execute(
      connection,
      "",
      "compat-console",
      crypto.randomUUID(),
      "g.inject((1..10050).toArray()).unfold()",
      {},
    );
    assert.equal(large.totalCount, 10_050);
    assert.equal(large.items.length, 10_000);
    assert.equal(large.truncated, true);

    const streamed: unknown[] = [];
    const exported = await service.exportAll(
      connection,
      "",
      crypto.randomUUID(),
      "g.inject((1..2500).toArray()).unfold()",
      {},
      async (items) => { streamed.push(...items); },
    );
    assert.equal(exported.totalCount, 2_500);
    assert.equal(streamed.length, 2_500);
  } finally {
    await service.closeAll();
  }
});

test("JanusGraph WebSocket supports isolated sessioned clients", { skip: !live }, async () => {
  const service = new GremlinService();
  const connection = profile("ws", 18_182, "sessioned");
  try {
    const result = await eventually(() => service.execute(
      connection,
      "",
      "session-a",
      crypto.randomUUID(),
      "x = 41; x + 1",
      {},
    ));
    assert.deepEqual(result.items, [42]);
    const retained = await service.execute(
      connection,
      "",
      "session-a",
      crypto.randomUUID(),
      "x",
      {},
    );
    assert.deepEqual(retained.items, [41]);
  } finally {
    await service.closeAll();
  }
});

test("JanusGraph sessioned clients retain explicit transactions until rollback", { skip: !live }, async () => {
  const service = new GremlinService();
  const connection = profile("ws", 18_182, "sessioned");
  try {
    const opened = await eventually(() => service.execute(
      connection,
      "",
      "transaction-console",
      crypto.randomUUID(),
      "if (!graph.tx().isOpen()) { graph.tx().open() }; graph.tx().isOpen()",
      {},
    ));
    assert.deepEqual(opened.items, [true]);

    const retained = await service.execute(
      connection,
      "",
      "transaction-console",
      crypto.randomUUID(),
      "graph.tx().isOpen()",
      {},
    );
    assert.deepEqual(retained.items, [true]);

    await service.execute(
      connection,
      "",
      "transaction-console",
      crypto.randomUUID(),
      "graph.tx().rollback()",
      {},
    );
    const rolledBack = await service.execute(
      connection,
      "",
      "transaction-console",
      crypto.randomUUID(),
      "graph.tx().isOpen()",
      {},
    );
    assert.deepEqual(rolledBack.items, [false]);
  } finally {
    await service.closeAll();
  }
});

test("JanusGraph HTTP channelizer supports bindings and aliases", { skip: !live }, async () => {
  const service = new GremlinService();
  const connection = profile("http", 18_183);
  try {
    const result = await eventually(() => service.execute(
      connection,
      "",
      "http-console",
      crypto.randomUUID(),
      "g.inject(compatValue).map { it.get().toUpperCase() }",
      { compatValue: "http-ok" },
    ));
    assert.equal(result.items.length, 1);
    assert.match(JSON.stringify(result.items[0]), /HTTP-OK/);
  } finally {
    await service.closeAll();
  }
});
