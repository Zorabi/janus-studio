import assert from "node:assert/strict";
import test from "node:test";
import { StructuredLogger } from "../../apps/desktop/src/main/diagnostics/structured-logger.ts";

function loggerWithCapacity(capacity: number) {
  let id = 0;
  let second = 0;
  return new StructuredLogger(capacity, {
    id: () => `log-${++id}`,
    now: () => new Date(`2026-08-13T10:00:${String(second++).padStart(2, "0")}.000Z`),
  });
}

test("keeps only the newest entries in a fixed-capacity ring", () => {
  const logger = loggerWithCapacity(3);
  for (let index = 1; index <= 5; index += 1) {
    logger.info("application", `event-${index}`, `message-${index}`);
  }

  assert.deepEqual(logger.list().map((entry) => entry.event), ["event-5", "event-4", "event-3"]);
});

test("filters by level and source before applying the newest-first limit", () => {
  const logger = loggerWithCapacity(10);
  logger.info("application", "app.started", "started");
  logger.warn("query", "query.slow", "slow");
  logger.error("query", "query.failed", "failed");
  logger.error("storage", "storage.failed", "failed");

  const entries = logger.list({ levels: ["error", "warn"], sources: ["query"], limit: 1 });
  assert.deepEqual(entries.map((entry) => entry.event), ["query.failed"]);
});

test("redacts values at ingestion and never returns mutable internal entries", () => {
  const logger = loggerWithCapacity(3);
  const context = { password: "context-secret", connectionName: "Docker" };
  const stored = logger.write({
    level: "error",
    source: "connection",
    event: "connection.failed",
    message: "Authorization: Bearer message-token",
    context,
    error: new Error("password=error-secret"),
  });
  context.password = "changed-after-write";

  const serialized = JSON.stringify(logger.list());
  for (const secret of ["context-secret", "message-token", "error-secret", "changed-after-write"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(serialized.includes("Docker"), true);

  stored.message = "mutated-return-value";
  const listed = logger.list();
  listed[0]!.message = "mutated-snapshot";
  assert.notEqual(logger.list()[0]!.message, "mutated-return-value");
  assert.notEqual(logger.list()[0]!.message, "mutated-snapshot");
});

test("removes explicitly sensitive query text and bindings from server errors", () => {
  const logger = loggerWithCapacity(3);
  const query = "g.V().has('secret','literal-value')";
  logger.write({
    level: "error",
    source: "query",
    event: "query.failed",
    message: "Gremlin query failed",
    error: new Error(`Evaluation failed for request [${query}] with binding-secret`),
    sensitiveTexts: [query, "binding-secret"],
  });

  const serialized = JSON.stringify(logger.list());
  assert.equal(serialized.includes(query), false);
  assert.equal(serialized.includes("literal-value"), false);
  assert.equal(serialized.includes("binding-secret"), false);
});

test("rejects invalid capacities", () => {
  assert.throws(() => new StructuredLogger(0), /positive integer/);
  assert.throws(() => new StructuredLogger(1.5), /positive integer/);
});
