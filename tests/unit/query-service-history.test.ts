import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionProfile, QueryExecutionResult } from "@janusgraph/domain";
import { QueryService } from "../../apps/desktop/src/main/services/query-service.ts";
import type { ConnectionService } from "../../apps/desktop/src/main/services/connection-service.ts";
import type { FileService } from "../../apps/desktop/src/main/services/file-service.ts";
import type { GremlinService } from "../../apps/desktop/src/main/services/gremlin-service.ts";
import type { HistoryRepository } from "../../apps/desktop/src/main/storage/history-repository.ts";

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
});

test("records a reliably identified cancellation separately from errors", async () => {
  const { service, historyCalls } = serviceFor(async () => {
    throw new Error("查询已停止");
  });
  await assert.rejects(service.execute(request), /查询已停止/);
  assert.equal(historyCalls[0]?.[3], "cancelled");
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
