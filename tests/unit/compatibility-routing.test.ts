import assert from "node:assert/strict";
import test from "node:test";
import { routeCompatibility } from "../../packages/application/src/index.ts";
import type {
  CompatibilityCapability,
  CompatibilityCapabilityState,
  CompatibilityProfile,
} from "@janusgraph/domain";

function profile(
  overrides: Partial<Record<CompatibilityCapability, CompatibilityCapabilityState>> = {},
): CompatibilityProfile {
  const supported = Object.fromEntries([
    "sessionedClient",
    "requestTimeout",
    "serverCancellation",
    "managementApi",
    "configuredGraphFactory",
    "configurationManagementGraph",
    "janusGraphManager",
    "jsonSchemaInitialization",
    "graphsonIo",
    "indexFieldStatus",
    "indexStatusAwait",
    "traversalExplain",
    "traversalProfile",
  ].map((capability) => [capability, "supported"]));
  return {
    connectionId: "connection",
    connectionSignature: "signature",
    status: "ready",
    janusGraphVersion: "1.1.0",
    tinkerPopVersion: "3.7.3",
    capabilities: { ...supported, ...overrides } as CompatibilityProfile["capabilities"],
    detectedAt: "2026-08-12T00:00:00.000Z",
    message: "",
  };
}

test("routes supported capabilities without checking version strings", () => {
  const route = routeCompatibility(profile(), "schemaIndexLifecycle");
  assert.equal(route.status, "available");
  assert.deepEqual(route.required, ["managementApi", "indexFieldStatus", "indexStatusAwait"]);
});

test("blocks known unsupported operations before their scripts execute", () => {
  const route = routeCompatibility(
    profile({ configuredGraphFactory: "unsupported" }),
    "configuredGraphFactory",
  );
  assert.equal(route.status, "unavailable");
  assert.deepEqual(route.unsupported, ["configuredGraphFactory"]);
});

test("keeps unknown probe results unverified instead of reporting false support", () => {
  const route = routeCompatibility(
    profile({ traversalProfile: "unknown" }),
    "traversalProfile",
  );
  assert.equal(route.status, "unverified");
  assert.deepEqual(route.unknown, ["traversalProfile"]);
  assert.equal(routeCompatibility(null, "graphsonIo").status, "unverified");
});
