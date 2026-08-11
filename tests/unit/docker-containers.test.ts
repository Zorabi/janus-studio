import assert from "node:assert/strict";
import test from "node:test";
import { graphServerContainers } from "../../apps/desktop/src/renderer/lib/docker-containers.ts";

test("keeps JanusGraph server containers without matching Compose project prefixes", () => {
  const containers = graphServerContainers([
    { id: "graph", name: "janusgraph-server", image: "janusgraph/janusgraph:1.1.0", status: "Up" },
    { id: "cassandra", name: "janusgraph-cassandra", image: "cassandra:3.11", status: "Up" },
    { id: "es", name: "janusgraph-es", image: "docker.elastic.co/elasticsearch/elasticsearch:7.17.10", status: "Up" },
  ]);
  assert.deepEqual(containers.map((container) => container.id), ["graph"]);
});

test("falls back to all containers for custom graph-server images", () => {
  const containers = graphServerContainers([
    { id: "custom", name: "database", image: "company/graph-platform:latest", status: "Up" },
  ]);
  assert.equal(containers[0]?.id, "custom");
});
