import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionProfile } from "@janusgraph/domain";
import {
  CompatibilityService,
  COMPATIBILITY_PROBE_QUERY,
  parseCompatibilityProbe,
} from "../../apps/desktop/src/main/services/compatibility-service.ts";

test("parses GraphSON capability maps without treating missing capabilities as supported", () => {
  const parsed = parseCompatibilityProbe([{
    "@type": "g:Map",
    "@value": [
      "janusGraphVersion", "1.1.0",
      "configuredGraphFactory", true,
      "jsonSchemaInitialization", false,
    ],
  }]);
  assert.equal(parsed?.janusGraphVersion, "1.1.0");
  assert.equal(parsed?.configuredGraphFactory, true);
  assert.equal(parsed?.jsonSchemaInitialization, false);
  assert.equal(parsed?.janusGraphManager, undefined);
});

test("uses official JanusGraph capability classes in the read-only probe", () => {
  assert.match(COMPATIBILITY_PROBE_QUERY, /org\.janusgraph\.core\.ConfiguredGraphFactory/);
  assert.match(COMPATIBILITY_PROBE_QUERY, /org\.janusgraph\.graphdb\.management\.JanusGraphManager/);
  assert.match(COMPATIBILITY_PROBE_QUERY, /org\.janusgraph\.core\.schema\.json\.definition\.JsonSchemaDefinition/);
  assert.doesNotMatch(COMPATIBILITY_PROBE_QUERY, /\.open\(/);
});

test("detects server versions from official manifest keys with safe metadata fallbacks", () => {
  assert.match(COMPATIBILITY_PROBE_QUERY, /Manifests/);
  assert.match(COMPATIBILITY_PROBE_QUERY, /"janusgraphVersion"/);
  assert.match(COMPATIBILITY_PROBE_QUERY, /"tinkerpopVersion"/);
  assert.match(COMPATIBILITY_PROBE_QUERY, /getImplementationVersion/);
  assert.match(COMPATIBILITY_PROBE_QUERY, /pom\.properties/);
  assert.match(COMPATIBILITY_PROBE_QUERY, /getCodeSource/);
  assert.match(
    COMPATIBILITY_PROBE_QUERY,
    /Pattern\.compile\('\(\?:\^\|\/\)' \+ java\.util\.regex\.Pattern\.quote\(__artifact\)/,
  );
  assert.doesNotMatch(COMPATIBILITY_PROBE_QUERY, /Pattern\.compile\("[^"\n]*\$\|/);
  assert.ok(
    COMPATIBILITY_PROBE_QUERY.indexOf("__manifestVersion(__manifestAttribute)")
      < COMPATIBILITY_PROBE_QUERY.indexOf("__packageVersion(__type)"),
  );
  assert.doesNotMatch(COMPATIBILITY_PROBE_QUERY, /ConfiguredGraphFactory\.open/);
});

test("caches a compatibility profile until the connection signature changes or refresh is requested", async () => {
  const profile: ConnectionProfile = {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Docker",
    protocol: "ws",
    host: "127.0.0.1",
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
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
  let executions = 0;
  const service = new CompatibilityService(
    { profile: () => profile } as never,
    {
      execute: async () => {
        executions += 1;
        return {
          executionId: "probe",
          durationMs: 1,
          items: [[{
            janusGraphVersion: "1.1.0",
            tinkerPopVersion: "3.7.3",
            managementApi: true,
            configuredGraphFactory: true,
            configurationManagementGraph: true,
            janusGraphManager: true,
            jsonSchemaInitialization: true,
            graphsonIo: true,
          }]],
          truncated: false,
          totalCount: 1,
        };
      },
      closeConsole: async () => undefined,
    } as never,
  );

  const first = await service.get(profile.id);
  const cached = await service.get(profile.id);
  const refreshed = await service.get(profile.id, true);
  assert.equal(executions, 2);
  assert.equal(first.status, "ready");
  assert.equal(first.capabilities.serverCancellation, "supported");
  assert.equal(cached.detectedAt, first.detectedAt);
  assert.equal(refreshed.janusGraphVersion, "1.1.0");
});
