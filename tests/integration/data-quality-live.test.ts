import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { AuthenticationProfileRepository } from "../../apps/desktop/src/main/storage/authentication-profile-repository.ts";
import { ConnectionRepository } from "../../apps/desktop/src/main/storage/connection-repository.ts";
import { openApplicationDatabase } from "../../apps/desktop/src/main/storage/database.ts";
import { CredentialVault } from "../../apps/desktop/src/main/security/credential-vault.ts";
import { AuthenticationProfileService } from "../../apps/desktop/src/main/services/authentication-profile-service.ts";
import { ConnectionService } from "../../apps/desktop/src/main/services/connection-service.ts";
import { buildDuplicateBatchScript, buildQualityScript } from "../../apps/desktop/src/main/services/data-quality-scripts.ts";
import { GremlinService } from "../../apps/desktop/src/main/services/gremlin-service.ts";

const live = process.env.JANUSGRAPH_QUALITY_LIVE === "1";
const userData = process.env.JANUS_STUDIO_USER_DATA ?? "~/Library/Application Support/Janus Studio";

test("runs every bounded read-only quality rule against local static and configured graphs", { skip: !live }, async () => {
  const database = openApplicationDatabase(join(userData, "janusgraph-desktop.sqlite"));
  const gremlin = new GremlinService();
  try {
    const vault = new CredentialVault(join(userData, "credential-vault.key"), true);
    const auth = new AuthenticationProfileService(new AuthenticationProfileRepository(database), vault);
    const connections = new ConnectionService(new ConnectionRepository(database), vault, gremlin, auth);
    const profile = connections.list().find((item) => item.host === "127.0.0.1" && item.port === 8182 && (item.protocol === "ws" || item.protocol === "wss"));
    assert.ok(profile, "a saved local WS/WSS connection on 127.0.0.1:8182 is required");
    const credentials = await connections.credentialsFor(profile.id);
    const execute = (query: string, bindings: Record<string, unknown>) => gremlin.execute(profile, credentials, "quality-live", crypto.randomUUID(), query, bindings, 5_000, true);
    const row = (items: unknown[]) => { const value=(Array.isArray(items[0])?items[0][0]:items[0]) as Record<string,unknown>; if(value?.["@type"]!=="g:Map") return value; const entries=value["@value"] as unknown[]; return Object.fromEntries(Array.from({length:entries.length/2},(_,index)=>[String(entries[index*2]),entries[index*2+1]])); };
    const base = { graphAccess:"binding" as const, graphName:profile.graphBinding, graphBinding:profile.graphBinding, traversalSource:profile.traversalSource, mode:"bounded" as const, scanLimit:100, sampleLimit:10 };
    const distribution = buildQualityScript({ id:crypto.randomUUID(),name:"distribution",kind:"distribution",enabled:true,severity:"info",includeVertices:true,includeEdges:true }, base);
    const distributionResult = await execute(distribution.query, distribution.bindings);
    assert.ok(Number(row(distributionResult.items).checkedCount) >= 0);
    const syntaxRules = [
      { id:crypto.randomUUID(),name:"isolated",kind:"isolated-vertex" as const,enabled:true,severity:"warning" as const,vertexLabels:["v1"],ignoredEdgeLabels:[] },
      { id:crypto.randomUUID(),name:"required",kind:"required-property" as const,enabled:true,severity:"warning" as const,vertexLabel:"v1",propertyKeys:["p1"] },
      { id:crypto.randomUUID(),name:"domain",kind:"property-domain" as const,enabled:true,severity:"warning" as const,vertexLabel:"v1",propertyKey:"p1",constraint:"not-blank" as const },
      { id:crypto.randomUUID(),name:"endpoint",kind:"edge-endpoint" as const,enabled:true,severity:"warning" as const,edgeLabel:"v1_rt1_v4",outVertexLabels:["v1"],inVertexLabels:["v4"] },
      { id:crypto.randomUUID(),name:"degree",kind:"degree-range" as const,enabled:true,severity:"warning" as const,vertexLabel:"v1",direction:"both" as const,minDegree:0,maxDegree:100 },
    ];
    for (const rule of syntaxRules) {
      const script = buildQualityScript(rule, base);
      const result = await execute(script.query, script.bindings).catch((error) => { throw new Error(`${rule.kind} phase: ${error instanceof Error ? error.message : String(error)}`); });
      assert.ok(Number(row(result.items).checkedCount) >= 0);
    }
    const duplicate = buildDuplicateBatchScript({ id:crypto.randomUUID(),name:"duplicate",kind:"duplicate-vertex",enabled:true,severity:"warning",vertexLabel:"v1",propertyKeys:["p1"] }, base, 0, 100);
    const duplicateResult = await execute(duplicate.query, duplicate.bindings).catch((error) => { throw new Error(`duplicate phase: ${error instanceof Error ? error.message : String(error)}`); });
    assert.ok(Number(row(duplicateResult.items).checkedCount) >= 0);
    const names = await execute("ConfiguredGraphFactory.getGraphNames().toList().sort()", {});
    const graphNames = (names.items.length === 1 && Array.isArray(names.items[0]) ? names.items[0] : names.items).map(String);
    if (graphNames.length) {
      const configured = buildQualityScript({ id:crypto.randomUUID(),name:"distribution",kind:"distribution",enabled:true,severity:"info",includeVertices:true,includeEdges:true }, { ...base, graphAccess:"configured", graphName:graphNames[0]! });
      const configuredResult = await execute(configured.query, configured.bindings);
      assert.ok(Number(row(configuredResult.items).checkedCount) >= 0);
    }

  } finally {
    await gremlin.closeAll();
    database.close();
  }
});
