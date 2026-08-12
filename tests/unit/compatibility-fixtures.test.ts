import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { routeCompatibility } from "../../packages/application/src/index.ts";
import type { CompatibilityProfile } from "@janusgraph/domain";

function fixture(version: "1.0" | "1.1"): CompatibilityProfile {
  return JSON.parse(readFileSync(
    new URL(`../fixtures/compatibility/janusgraph-${version}.json`, import.meta.url),
    "utf8",
  )) as CompatibilityProfile;
}

for (const protocol of ["ws", "http"] as const) {
  for (const graphAccess of ["static", "configured"] as const) {
    test(`routes JanusGraph 1.0 ${protocol} ${graphAccess} fixture without native JSON schema`, () => {
      const profile = fixture("1.0");
      assert.equal(routeCompatibility(profile, "schemaManagement").status, "available");
      assert.equal(routeCompatibility(profile, "officialSchemaJson").status, "unavailable");
      assert.equal(
        routeCompatibility(profile, graphAccess === "configured" ? "configuredGraphsonIo" : "graphsonIo").status,
        "available",
      );
    });

    test(`routes JanusGraph 1.1 ${protocol} ${graphAccess} fixture with native JSON schema`, () => {
      const profile = fixture("1.1");
      assert.equal(routeCompatibility(profile, "officialSchemaJson").status, "available");
      assert.equal(routeCompatibility(profile, "schemaIndexLifecycle").status, "available");
      assert.equal(
        routeCompatibility(profile, graphAccess === "configured" ? "configuredGraphsonIo" : "graphsonIo").status,
        "available",
      );
    });
  }
}
