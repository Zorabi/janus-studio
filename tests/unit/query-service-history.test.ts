import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionProfile, QueryExecutionResult } from "@janusgraph/domain";
import { QueryService } from "../../apps/desktop/src/main/services/query-service.ts";
import type { ConnectionService } from "../../apps/desktop/src/main/services/connection-service.ts";
import type { FileService } from "../../apps/desktop/src/main/services/file-service.ts";
import type { GremlinService } from "../../apps/desktop/src/main/services/gremlin-service.ts";
import type { HistoryRepository } from "../../apps/desktop/src/main/storage/history-repository.ts";
import { StructuredLogger } from "../../apps/desktop/src/main/diagnostics/structured-logger.ts";

const profile: ConnectionProfile = {
  id: "connection-a",
  name: "A",
  protocol: "ws",
  host: "localhost",
  port: 8182,
  path: "/gremlin",
  username: "",
  environment: "dev",
  connectionReadOnly: false,
  clientMode: "sessionless",
  traversalSource: "g",
  graphBinding: "graph",
  connectTimeoutMs: 5_000,
  queryTimeoutMs: 30_000,
  tlsRejectUnauthorized: true,
  enableCompression: false,
  customHeaders: "{}",
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

function serviceFor(
  execute: (...args: unknown[]) => Promise<QueryExecutionResult>,
  connectionProfile: ConnectionProfile = profile,
  logger?: StructuredLogger,
) {
  const historyCalls: unknown[][] = [];
  const service = new QueryService(
    {
      profile: () => connectionProfile,
      passwordFor: async () => "",
    } as unknown as ConnectionService,
    { execute } as unknown as GremlinService,
    {
      add: (...args: unknown[]) => {
        historyCalls.push(args);
      },
    } as unknown as HistoryRepository,
    {} as FileService,
    logger,
  );
  return { service, historyCalls };
}

const request = {
  connectionId: profile.id,
  consoleId: "console-a",
  executionId: "execution-a",
  query: "g.V()",
};

test("records successful queries with truncated results as truncated", async () => {
  const result: QueryExecutionResult = {
    executionId: request.executionId,
    durationMs: 25,
    items: [],
    truncated: true,
    totalCount: 10_001,
  };
  const { service, historyCalls } = serviceFor(async () => result);
  await service.execute(request);
  assert.equal(historyCalls[0]?.[3], "truncated");
  assert.equal(historyCalls[0]?.[5], 10_001);
  assert.equal(historyCalls[0]?.[7], "graph");
  assert.equal(historyCalls[0]?.[8], "g");
});

test("records a reliably identified cancellation separately from errors", async () => {
  const { service, historyCalls } = serviceFor(async () => {
    throw new Error("查询已停止");
  });
  await assert.rejects(service.execute(request), /查询已停止/);
  assert.equal(historyCalls[0]?.[3], "cancelled");
});

test("does not retain nested string bindings when a server error echoes them", async () => {
  const logger = new StructuredLogger();
  const query = "g.V(vertexId).has('tenant', tenant.name)";
  const { service } = serviceFor(async () => {
    throw new Error(`Server rejected [${query}] for top-secret-tenant`);
  }, profile, logger);

  await assert.rejects(service.execute({
    ...request,
    query,
    bindings: { tenant: { name: "top-secret-tenant" }, vertexId: 1 },
  }));

  const serialized = JSON.stringify(logger.list());
  assert.equal(serialized.includes(query), false);
  assert.equal(serialized.includes("top-secret-tenant"), false);
});

test("forwards server cancellation mode for interruptible transfer sessions", async () => {
  let executeArguments: unknown[] = [];
  const result: QueryExecutionResult = {
    executionId: request.executionId,
    durationMs: 1,
    items: [],
    truncated: false,
    totalCount: 0,
  };
  const { service } = serviceFor(async (...args) => {
    executeArguments = args;
    return result;
  });

  await service.execute({ ...request, serverCancellation: true });
  assert.equal(executeArguments[7], true);
});

test("returns a serializable summary instead of a raw ManagementSystem", async () => {
  let executeArguments: unknown[] = [];
  const result: QueryExecutionResult = {
    executionId: request.executionId,
    durationMs: 1,
    items: [],
    truncated: false,
    totalCount: 0,
  };
  const { service } = serviceFor(async (...args) => {
    executeArguments = args;
    return result;
  }, { ...profile, clientMode: "sessioned" });

  await service.execute({ ...request, query: "m = graph3.openManagement()" });
  assert.equal(
    executeArguments[4],
    'm = graph3.openManagement(); [binding: "m", objectType: m.getClass().getName(), state: "open", scope: "session"]',
  );
});

test("rolls back an unbound ManagementSystem after returning its summary", async () => {
  let normalizedQuery = "";
  const result: QueryExecutionResult = {
    executionId: request.executionId,
    durationMs: 1,
    items: [],
    truncated: false,
    totalCount: 0,
  };
  const { service } = serviceFor(async (...args) => {
    normalizedQuery = String(args[4]);
    return result;
  });

  await service.execute({ ...request, query: "graph3.openManagement()" });
  assert.match(normalizedQuery, /^def __janusStudioManagement = graph3\.openManagement\(\)/);
  assert.match(normalizedQuery, /finally \{ __janusStudioManagement\.rollback\(\) \}$/);
});

test("enforces connection-level read-only protection before reaching Gremlin", async () => {
  let executions = 0;
  const { service } = serviceFor(async () => {
    executions += 1;
    throw new Error("should not execute");
  }, { ...profile, connectionReadOnly: true });

  await assert.rejects(
    service.execute({ ...request, query: "g.V().drop().iterate()" }),
    /连接级只读保护/,
  );
  assert.equal(executions, 0);
});

test("allows read-only connections to inspect schema and roll back a transaction", async () => {
  const result: QueryExecutionResult = {
    executionId: request.executionId,
    durationMs: 1,
    items: [],
    truncated: false,
    totalCount: 0,
  };
  let executions = 0;
  const { service } = serviceFor(async () => {
    executions += 1;
    return result;
  }, { ...profile, connectionReadOnly: true });

  await service.execute({ ...request, query: "graph.openManagement().printSchema()" });
  await service.execute({ ...request, query: "graph.tx().rollback()" });
  assert.equal(executions, 2);
});

test("requires an explicit confirmation token for production mutations", async () => {
  const result: QueryExecutionResult = {
    executionId: request.executionId,
    durationMs: 1,
    items: [],
    truncated: false,
    totalCount: 0,
  };
  let executions = 0;
  const { service } = serviceFor(async () => {
    executions += 1;
    return result;
  }, { ...profile, environment: "prod" });
  const mutation = { ...request, query: "g.addV('person')" };

  await assert.rejects(service.execute(mutation), /生产环境写操作尚未确认/);
  assert.equal(executions, 0);
  await service.execute({ ...mutation, productionConfirmed: true });
  assert.equal(executions, 1);
});

test("applies a tab-level traversal source override without changing the stored profile", async () => {
  const result: QueryExecutionResult = {
    executionId: request.executionId,
    durationMs: 1,
    items: [],
    truncated: false,
    totalCount: 0,
  };
  let executedTraversalSource = "";
  const { service } = serviceFor(async (...args) => {
    executedTraversalSource = (args[0] as ConnectionProfile).traversalSource;
    return result;
  });

  await service.execute({ ...request, traversalSource: "tenant_a_traversal" });

  assert.equal(executedTraversalSource, "tenant_a_traversal");
  assert.equal(profile.traversalSource, "g");
});

test("passes an operation-specific timeout to long-running Gremlin work", async () => {
  const result: QueryExecutionResult = {
    executionId: request.executionId,
    durationMs: 1,
    items: [],
    truncated: false,
    totalCount: 0,
  };
  let executedTimeout: unknown;
  const { service } = serviceFor(async (...args) => {
    executedTimeout = args[6];
    return result;
  });

  await service.execute({ ...request, timeoutMs: 86_400_000 });

  assert.equal(executedTimeout, 86_400_000);
});
