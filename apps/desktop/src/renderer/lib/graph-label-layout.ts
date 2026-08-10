export type GraphLabelPoint = { x: number; y: number };

type LabelNode = {
  id: string;
  position: GraphLabelPoint;
  caption: string;
};

type LabelEdge = {
  id: string;
  from: string;
  to: string;
  control: GraphLabelPoint;
  caption: string;
  index: number;
};

type LabelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const NODE_RADIUS = 34;
const NODE_LABEL_TOP = 36;
const NODE_LABEL_HEIGHT = 27;
const EDGE_LABEL_HEIGHT = 24;
const LABEL_CLEARANCE = 6;

export function graphNodeLabelWidth(caption: string): number {
  return Math.min(230, Math.max(64, caption.length * 7.4 + 20));
}

export function graphEdgeLabelWidth(caption: string): number {
  return Math.min(210, Math.max(46, caption.length * 7.2 + 16));
}

export function graphEdgeEndpoints(
  from: GraphLabelPoint,
  to: GraphLabelPoint,
): { start: GraphLabelPoint; end: GraphLabelPoint } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const ux = dx / length;
  const uy = dy / length;
  return {
    start: { x: from.x + ux * 31, y: from.y + uy * 31 },
    end: { x: to.x - ux * 35, y: to.y - uy * 35 },
  };
}

function quadraticMidpoint(
  start: GraphLabelPoint,
  control: GraphLabelPoint,
  end: GraphLabelPoint,
): GraphLabelPoint {
  return {
    x: (start.x + control.x * 2 + end.x) / 4,
    y: (start.y + control.y * 2 + end.y) / 4,
  };
}

export function graphEdgePathMidpoint(
  from: GraphLabelPoint,
  to: GraphLabelPoint,
  control: GraphLabelPoint,
  selfLoop: boolean,
): GraphLabelPoint {
  if (selfLoop) {
    return quadraticMidpoint(
      { x: from.x - 18, y: from.y - 24 },
      { x: control.x, y: control.y - 80 },
      { x: from.x + 18, y: from.y - 24 },
    );
  }
  const endpoints = graphEdgeEndpoints(from, to);
  return quadraticMidpoint(endpoints.start, control, endpoints.end);
}

function rectanglesOverlap(left: LabelRect, right: LabelRect): boolean {
  return !(
    left.x + left.width + LABEL_CLEARANCE <= right.x ||
    right.x + right.width + LABEL_CLEARANCE <= left.x ||
    left.y + left.height + LABEL_CLEARANCE <= right.y ||
    right.y + right.height + LABEL_CLEARANCE <= left.y
  );
}

function nodeObstacles(node: LabelNode): LabelRect[] {
  const labelWidth = graphNodeLabelWidth(node.caption);
  return [
    {
      x: node.position.x - NODE_RADIUS,
      y: node.position.y - NODE_RADIUS,
      width: NODE_RADIUS * 2,
      height: NODE_RADIUS * 2,
    },
    {
      x: node.position.x - labelWidth / 2,
      y: node.position.y + NODE_LABEL_TOP,
      width: labelWidth,
      height: NODE_LABEL_HEIGHT,
    },
  ];
}

function labelRect(position: GraphLabelPoint, caption: string): LabelRect {
  const width = graphEdgeLabelWidth(caption);
  return {
    x: position.x - width / 2,
    y: position.y - EDGE_LABEL_HEIGHT / 2,
    width,
    height: EDGE_LABEL_HEIGHT,
  };
}

function placeEdgeLabel(
  edge: LabelEdge,
  nodesById: Map<string, LabelNode>,
  obstacles: LabelRect[],
): GraphLabelPoint {
  const from = nodesById.get(edge.from)?.position;
  const to = nodesById.get(edge.to)?.position;
  if (!from || !to) return edge.control;
  const preferred = graphEdgePathMidpoint(
    from,
    to,
    edge.control,
    edge.from === edge.to,
  );
  const preferredRect = labelRect(preferred, edge.caption);
  const blocking = obstacles.filter((obstacle) =>
    rectanglesOverlap(preferredRect, obstacle),
  );
  if (blocking.length === 0) return preferred;

  const minX = Math.min(...blocking.map((obstacle) => obstacle.x));
  const minY = Math.min(...blocking.map((obstacle) => obstacle.y));
  const maxX = Math.max(...blocking.map((obstacle) => obstacle.x + obstacle.width));
  const maxY = Math.max(...blocking.map((obstacle) => obstacle.y + obstacle.height));
  const halfWidth = preferredRect.width / 2;
  const halfHeight = preferredRect.height / 2;
  const left = {
    x: minX - LABEL_CLEARANCE - 1 - halfWidth,
    y: preferred.y,
  };
  const right = {
    x: maxX + LABEL_CLEARANCE + 1 + halfWidth,
    y: preferred.y,
  };
  const above = {
    x: preferred.x,
    y: minY - LABEL_CLEARANCE - 1 - halfHeight,
  };
  const below = {
    x: preferred.x,
    y: maxY + LABEL_CLEARANCE + 1 + halfHeight,
  };
  const vertical = Math.abs(to.y - from.y) >= Math.abs(to.x - from.x);
  const candidates = vertical ? [left, right, above, below] : [above, below, left, right];
  if (edge.index % 2 !== 0) {
    [candidates[0], candidates[1]] = [candidates[1]!, candidates[0]!];
  }
  const clear = candidates.find((candidate) => {
    const rectangle = labelRect(candidate, edge.caption);
    return obstacles.every((obstacle) => !rectanglesOverlap(rectangle, obstacle));
  });
  return clear ?? candidates[0]!;
}

export function resolveGraphEdgeLabelPositions(
  nodes: LabelNode[],
  edges: LabelEdge[],
): Record<string, GraphLabelPoint> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const obstacles = nodes.flatMap(nodeObstacles);
  return Object.fromEntries(
    edges.map((edge) => [
      edge.id,
      placeEdgeLabel(edge, nodesById, obstacles),
    ]),
  );
}
