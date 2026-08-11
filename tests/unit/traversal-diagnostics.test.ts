import assert from "node:assert/strict";
import test from "node:test";
import { parseTraversalDiagnostics } from "../../apps/desktop/src/renderer/lib/traversal-diagnostics.ts";
import { traversalAnalysisKind, withTraversalAnalysis } from "../../apps/desktop/src/renderer/features/query/query-utils.ts";

test("detects the analysis type from the executed traversal", () => {
  assert.equal(traversalAnalysisKind("g.V().profile().next().toString()"), "profile");
  assert.equal(traversalAnalysisKind("g.V().EXPLAIN()"), "explain");
  assert.equal(traversalAnalysisKind("g.V().toList()"), undefined);
});

test("builds Gremlin Console text for Explain and Profile without calling next on Explain", () => {
  assert.equal(withTraversalAnalysis("g.V().count()", "explain"), "g.V().count().explain().toString()");
  assert.equal(withTraversalAnalysis("g.V().toList();", "profile"), "g.V().profile().next().toString()");
  assert.equal(
    withTraversalAnalysis("g.V().explain().next().toString()", "explain"),
    "g.V().explain().toString()",
  );
});

test("parses serialized traversal metrics and computes missing percentages", () => {
  const diagnostic = parseTraversalDiagnostics([{
    durationMs: 10,
    metrics: [
      {
        id: "0.0.0()",
        name: "JanusGraphStep(vertex,[name.eq(alice)])",
        durationMs: 7.5,
        counts: { elementCount: 2, traverserCount: 2 },
      },
      {
        id: "1.0.0()",
        name: "PropertiesStep([name],value)",
        durationMs: 2.5,
        counts: { elementCount: 2, traverserCount: 2 },
      },
    ],
  }], "profile");

  assert.ok(diagnostic);
  assert.equal(diagnostic.source, "object");
  assert.equal(diagnostic.totalDurationMs, 10);
  assert.deepEqual(diagnostic.steps, [
    {
      name: "JanusGraphStep(vertex,[name.eq(alice)])",
      count: 2,
      traversers: 2,
      durationMs: 7.5,
      percent: 75,
    },
    {
      name: "PropertiesStep([name],value)",
      count: 2,
      traversers: 2,
      durationMs: 2.5,
      percent: 25,
    },
  ]);
});

test("parses Gremlin Console traversal metrics text", () => {
  const diagnostic = parseTraversalDiagnostics([`Traversal Metrics
Step                                                               Count  Traversers       Time (ms)    % Dur
==============================================================================================================
JanusGraphStep(vertex,[~label.eq(person)])                              4           4           8.400    84.00
PropertiesStep([name],value)                                            4           4           1.600    16.00
                                            >TOTAL                     -           -          10.000        -`], "profile");

  assert.ok(diagnostic);
  assert.equal(diagnostic.source, "text");
  assert.equal(diagnostic.totalDurationMs, 10);
  assert.equal(diagnostic.steps[0]?.name, "JanusGraphStep(vertex,[~label.eq(person)])");
  assert.equal(diagnostic.steps[0]?.percent, 84);
});

test("parses JanusGraph profile rows whose Count and Traversers columns are blank", () => {
  const diagnostic = parseTraversalDiagnostics([`Traversal Metrics
Step                                                               Count  Traversers       Time (ms)    % Dur
=============================================================================================================
JanusGraphStep([])                                                                             1.171    97.04
  constructGraphCentricQuery                                                                   0.001
CountGlobalStep                                                        1           1           0.035     2.96
                                            >TOTAL                     -           -           1.206        -`], "profile");

  assert.ok(diagnostic);
  assert.equal(diagnostic.totalDurationMs, 1.206);
  assert.deepEqual(diagnostic.steps.map((step) => step.name), ["JanusGraphStep([])", "CountGlobalStep"]);
  assert.equal(diagnostic.steps[0]?.count, undefined);
  assert.equal(diagnostic.steps[1]?.count, 1);
});

test("parses explain strategies and final traversal steps", () => {
  const diagnostic = parseTraversalDiagnostics([`Traversal Explanation
========================================================================================================================
Original Traversal                    [GraphStep(vertex,[]), HasStep([~label.eq(person)]), ValuesStep([name])]
JanusGraphStepStrategy          [P]   [JanusGraphStep(vertex,[~label.eq(person)]), ValuesStep([name])]
AdjacentVertexFilterOptimizerStrategy [O] [JanusGraphStep(vertex,[~label.eq(person)]), ValuesStep([name])]
Final Traversal                       [JanusGraphStep(vertex,[~label.eq(person)]), ValuesStep([name])]`], "explain");

  assert.ok(diagnostic);
  assert.equal(diagnostic.kind, "explain");
  assert.deepEqual(diagnostic.steps.map((step) => step.name), [
    "JanusGraphStep(vertex,[~label.eq(person)])",
    "ValuesStep([name])",
  ]);
  assert.deepEqual(diagnostic.strategies.map((strategy) => strategy.name), [
    "JanusGraphStepStrategy",
    "AdjacentVertexFilterOptimizerStrategy",
  ]);
});

test("parses serialized explain plans with array traversals", () => {
  const diagnostic = parseTraversalDiagnostics([{
    finalTraversal: [
      { name: "JanusGraphStep(vertex,[name.eq(alice)])" },
      { name: "ValueMapStep([name])" },
    ],
    intermediateTraversals: [{
      strategy: "JanusGraphStepStrategy",
      category: "provider optimization",
      traversal: ["JanusGraphStep(vertex,[name.eq(alice)])", "ValueMapStep([name])"],
    }],
  }], "explain");

  assert.ok(diagnostic);
  assert.equal(diagnostic.source, "object");
  assert.equal(diagnostic.strategies[0]?.name, "JanusGraphStepStrategy");
  assert.deepEqual(diagnostic.steps.map((step) => step.name), [
    "JanusGraphStep(vertex,[name.eq(alice)])",
    "ValueMapStep([name])",
  ]);
});

test("parses GraphSON-wrapped profile metrics", () => {
  const diagnostic = parseTraversalDiagnostics([{
    "@type": "g:TraversalMetrics",
    "@value": {
      dur: { "@type": "g:Double", "@value": 3.2 },
      metrics: [{
        name: "GraphStep(vertex,[])",
        dur: 3.2,
        counts: {
          "@type": "g:Map",
          "@value": ["elementCount", 1, "traverserCount", 1],
        },
      }],
    },
  }], "profile");

  assert.ok(diagnostic);
  assert.equal(diagnostic.steps[0]?.count, 1);
  assert.equal(diagnostic.steps[0]?.durationMs, 3.2);
});

test("returns null for unrecognized reports so the console can remain the fallback", () => {
  assert.equal(parseTraversalDiagnostics(["server-specific report"], "profile"), null);
  assert.equal(parseTraversalDiagnostics([{ message: "unknown" }], "explain"), null);
});
