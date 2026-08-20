import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isMutationQuery } from "../../packages/application/src/index.ts";
import { buildDuplicateBatchScript, buildQualityIssueBatchScript, buildQualityScript } from "../../apps/desktop/src/main/services/data-quality-scripts.ts";
import { openApplicationDatabase } from "../../apps/desktop/src/main/storage/database.ts";
import { QualityRepository } from "../../apps/desktop/src/main/storage/quality-repository.ts";

const context = { graphAccess: "configured" as const, graphName: "graph2", graphBinding: "graph2", traversalSource: "graph2_traversal", mode: "bounded" as const, scanLimit: 10_000, sampleLimit: 50 };

test("all server-side quality scripts are read-only and bounded mode declares a limit", () => {
  const rules = [
    { kind: "isolated-vertex", vertexLabels: ["person"] },
    { kind: "required-property", vertexLabel: "person", propertyKeys: ["name"] },
    { kind: "property-domain", vertexLabel: "person", propertyKey: "age", constraint: "number-range", minimum: 0, maximum: 120 },
    { kind: "edge-endpoint", edgeLabel: "knows", outVertexLabels: ["person"], inVertexLabels: ["person"] },
    { kind: "degree-range", vertexLabel: "person", direction: "both", minDegree: 1, maxDegree: 100 },
    { kind: "distribution", includeVertices: true, includeEdges: true },
  ] as const;
  for (const value of rules) {
    const script = buildQualityScript({ id: crypto.randomUUID(), name: value.kind, enabled: true, severity: "warning", ...value }, context);
    assert.equal(isMutationQuery(script.query), false, value.kind);
    assert.match(script.query, /limit\(qualityScanLimit\)/);
    assert.doesNotMatch(script.query, /\.drop\(|\.property\(|\.commit\(/);
  }
  const isolated = buildQualityScript({ id: crypto.randomUUID(), name: "isolated", kind: "isolated-vertex", enabled: true, severity: "warning" }, context);
  assert.match(isolated.query, /values:__qualityValues/);
  assert.match(isolated.query, /values\.size\(\) < 24/);
  const distribution = buildQualityScript({ id:crypto.randomUUID(), name:"distribution", kind:"distribution", enabled:true, severity:"info" }, context);
  assert.match(distribution.query, /label:"vertex"/);
  assert.match(distribution.query, /label:"edge"/);
});

test("complete issue export pages the original read-only rule scope", () => {
  const script = buildQualityIssueBatchScript({ id:crypto.randomUUID(), name:"required", kind:"required-property", enabled:true, severity:"warning", vertexLabel:"v1", propertyKeys:["cp1"] }, context, 1_000, 1_000);
  assert.equal(isMutationQuery(script.query), false);
  assert.match(script.query, /range\(qualityOffset, qualityOffset \+ qualityBatchSize\)/);
  assert.match(script.query, /values:__qualityValues/);
  assert.equal(script.bindings.qualityOffset, 1_000);
  assert.equal(script.bindings.qualityBatchSize, 1_000);
});

test("duplicate checking reads fixed-size vertex batches without server groupCount", () => {
  const script = buildDuplicateBatchScript({ id: crypto.randomUUID(), name: "duplicate", kind: "duplicate-vertex", enabled: true, severity: "warning", vertexLabel: "person", propertyKeys: ["email"] }, context, 2_000, 2_000);
  assert.equal(isMutationQuery(script.query), false);
  assert.match(script.query, /range\(qualityOffset, qualityOffset \+ qualityBatchSize\)/);
  assert.doesNotMatch(script.query, /groupCount|group\(\)/);
  assert.equal(script.bindings.qualityOffset, 2_000);
});

test("quality repository snapshots rule sets and interrupts orphaned runs", () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-studio-quality-"));
  const path = join(directory, "app.sqlite");
  const database = openApplicationDatabase(path);
  try {
    const repository = new QualityRepository(database);
    const set = repository.saveRuleSet({ name: "Baseline", description: "", connectionId: crypto.randomUUID(), graphName: "graph1", graphBinding: "graph1", graphAccess: "configured", rules: [{ id: crypto.randomUUID(), name: "Distribution", kind: "distribution", enabled: true, severity: "info" }] });
    const now = new Date().toISOString();
    repository.createRun({ id: crypto.randomUUID(), ruleSetId: set.id, ruleSetName: set.name, connectionId: set.connectionId, connectionName: "Docker", graphName: set.graphName, graphBinding: set.graphBinding, graphAccess: set.graphAccess, mode: "bounded", sampleLimit: 50, scanLimit: 10_000, status: "running", stage: "running-rule", currentRule: 0, totalRules: 1, issueCount: 0, checkedCount: 0, message: "running", ruleSetSnapshot: structuredClone(set), createdAt: now, updatedAt: now, completedAt: "" });
    repository.saveRuleSet({ ...set, name: "Changed" });
    repository.interruptRunning();
    const run = repository.listRuns({ limit: 1 })[0]!;
    assert.equal(run.ruleSetSnapshot.name, "Baseline");
    assert.equal(run.status, "interrupted");
    assert.match(run.message, /显式重试/);
    repository.removeRuleSet(set.id);
    assert.equal(repository.getRuleSet(set.id), undefined);
    assert.equal(repository.getRun(run.id)?.ruleSetSnapshot.name, "Baseline", "deleting a rule set must retain immutable run history");
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 18);
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("quality history retains only the newest 200 terminal runs",()=>{
  const directory=mkdtempSync(join(tmpdir(),"janus-studio-quality-retention-"));const database=openApplicationDatabase(join(directory,"app.sqlite"));
  try{
    const repository=new QualityRepository(database);const connectionId=crypto.randomUUID();const set=repository.saveRuleSet({name:"retention",description:"",connectionId,graphName:"graph",graphBinding:"graph",graphAccess:"binding",rules:[{id:crypto.randomUUID(),name:"distribution",kind:"distribution",enabled:true,severity:"info"}]});
    for(let index=0;index<205;index++){const timestamp=new Date(Date.UTC(2026,0,1,0,0,index)).toISOString();repository.createRun({id:crypto.randomUUID(),ruleSetId:set.id,ruleSetName:set.name,connectionId,connectionName:"Docker",graphName:"graph",graphBinding:"graph",graphAccess:"binding",mode:"bounded",sampleLimit:50,scanLimit:1000,status:"succeeded",stage:"completed",currentRule:1,totalRules:1,issueCount:index,checkedCount:1,message:"done",ruleSetSnapshot:structuredClone(set),createdAt:timestamp,updatedAt:timestamp,completedAt:timestamp});}
    const retained=repository.listRuns({connectionId,limit:200});assert.equal(retained.length,200);assert.equal(retained[0]?.issueCount,204);assert.equal(retained.at(-1)?.issueCount,5);
  }finally{database.close();rmSync(directory,{recursive:true,force:true});}
});
