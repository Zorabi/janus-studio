import assert from "node:assert/strict";
import test from "node:test";
import {
  graphEdgePathMidpoint,
  resolveGraphEdgeLabelPositions,
} from "../../apps/desktop/src/renderer/lib/graph-label-layout.ts";

test("places a straight relationship label at the rendered path midpoint", () => {
  const positions = resolveGraphEdgeLabelPositions(
    [
      { id: "left", position: { x: 0, y: 0 }, caption: "left" },
      { id: "right", position: { x: 180, y: 0 }, caption: "right" },
    ],
    [
      {
        id: "edge",
        from: "left",
        to: "right",
        control: { x: 90, y: 0 },
        caption: "RELATION",
        index: 0,
      },
    ],
  );

  assert.deepEqual(positions.edge, { x: 89, y: 0 });
});

test("places a curved relationship label at the quadratic Bezier midpoint", () => {
  const positions = resolveGraphEdgeLabelPositions(
    [
      { id: "source", position: { x: 0, y: 0 }, caption: "source" },
      { id: "target", position: { x: 0, y: 200 }, caption: "target" },
    ],
    [
      {
        id: "edge",
        from: "source",
        to: "target",
        control: { x: 40, y: 100 },
        caption: "RELATION",
        index: 0,
      },
    ],
  );

  assert.deepEqual(positions.edge, { x: 20, y: 99 });
});

test("places a self-loop label at the center of its visible arc", () => {
  const positions = resolveGraphEdgeLabelPositions(
    [{ id: "node", position: { x: 100, y: 100 }, caption: "node" }],
    [
      {
        id: "loop",
        from: "node",
        to: "node",
        control: { x: 100, y: 100 },
        caption: "LOOP",
        index: 0,
      },
    ],
  );

  assert.deepEqual(positions.loop, { x: 100, y: 48 });
});

test("displaces a label and preserves its midpoint anchor when vertices are dragged together", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 0, y: 70 };
  const control = { x: 0, y: 35 };
  const midpoint = graphEdgePathMidpoint(from, to, control, false);
  const positions = resolveGraphEdgeLabelPositions(
    [
      { id: "source", position: from, caption: "source" },
      { id: "target", position: to, caption: "target" },
    ],
    [
      {
        id: "edge",
        from: "source",
        to: "target",
        control,
        caption: "RELATION",
        index: 0,
      },
    ],
  );

  assert.deepEqual(midpoint, { x: 0, y: 34 });
  assert.notDeepEqual(positions.edge, midpoint);
  assert.ok(Math.hypot(positions.edge!.x - midpoint.x, positions.edge!.y - midpoint.y) > 1);
});
