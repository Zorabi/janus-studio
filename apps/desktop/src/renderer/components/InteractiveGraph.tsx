import {
  AlertTriangle,
  Activity,
  CircleDot,
  ChevronDown,
  Download,
  FileImage,
  FileJson,
  LocateFixed,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  Save,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { SelectControl } from "./SelectControl";
import type {
  GraphEdgeModel,
  GraphModel,
  GraphNodeModel,
} from "../lib/result-model";
import { orderedInspectorEntries, printableValue } from "../lib/result-model";
import { useTranslate } from "../lib/i18n";
import {
  graphEdgeEndpoints,
  graphEdgeLabelWidth,
  graphEdgePathMidpoint,
  graphNodeLabelWidth,
  resolveGraphEdgeLabelPositions,
} from "../lib/graph-label-layout";
import type {
  GraphLayoutConfiguration,
  GraphLayoutMode,
} from "../lib/settings";

type Point = { x: number; y: number };

export type GraphSelection =
  | { kind: "node"; value: GraphNodeModel }
  | { kind: "edge"; value: GraphEdgeModel }
  | null;

type DragState = {
  kind: "node" | "edge";
  id: string;
  pointerId: number;
  startClient: Point;
  moved: boolean;
};

type Camera = { x: number; y: number; scale: number };
type GraphExportFormat = "png" | "jpg" | "svg" | "json";
type GraphExportPhase = "rendering" | "encoding" | "saving";

function blobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image data"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const separator = value.indexOf(",");
      if (separator < 0) {
        reject(new Error("Unable to encode image data"));
        return;
      }
      resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function scalarCaption(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    return value.map(scalarCaption).find(Boolean) ?? null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["@value", "value", "values"]) {
      const unwrapped = scalarCaption(record[key]);
      if (unwrapped) return unwrapped;
    }
    const entries = Object.entries(record);
    return entries.length === 1 ? scalarCaption(entries[0]?.[1]) : null;
  }
  const text = String(value).trim();
  return text ? text.slice(0, 56) : null;
}

function displayValue(
  entity: GraphNodeModel | GraphEdgeModel,
  fields: string,
): string {
  const candidates = fields
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  for (const field of candidates) {
    const raw =
      field === "~label" || field === "label"
        ? entity.label
        : field === "~id" || field === "id"
          ? entity.id
          : entity.properties[field];
    const caption = scalarCaption(raw);
    if (caption) return caption;
  }
  return entity.label || entity.id;
}

function graphCaption(
  entity: GraphNodeModel | GraphEdgeModel,
  fields: string,
): string {
  const value = displayValue(entity, fields);
  return value.length > 30 ? `${value.slice(0, 29)}…` : value;
}

function labelColor(label: string): string {
  const palette = [
    "#c8ff55",
    "#64d8ff",
    "#ff9f68",
    "#b79cff",
    "#58e6b2",
    "#ff7eae",
    "#ffd166",
    "#78a6ff",
    "#e58cff",
    "#83e377",
  ];
  let hash = 0;
  for (const character of label) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return palette[hash % palette.length]!;
}

function indexedLabelColor(index: number): string {
  const hue = (82 + index * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} 78% 64%)`;
}

function signatureHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function edgeMarkerId(label: string): string {
  return `interactive-graph-arrow-${signatureHash(label)}`;
}

function initialPositions(
  nodes: GraphNodeModel[],
  labelFields: string,
): Record<string, Point> {
  const centerX = 480;
  const centerY = 280;
  const widestCaption = Math.max(
    10,
    ...nodes.map((node) => graphCaption(node, labelFields).length),
  );
  const radialGap = Math.min(44, Math.max(27, widestCaption * 0.72 + 22));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  return Object.fromEntries(
    nodes.map((node, index) => {
      const angle = index * goldenAngle;
      const radius = radialGap * Math.sqrt(index + 0.35);
      return [
        node.id,
        {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        },
      ];
    }),
  );
}

function radialPositions(
  nodes: GraphNodeModel[],
  configuration: GraphLayoutConfiguration["radial"],
): Record<string, Point> {
  const count = Math.max(nodes.length, 1);
  const ringCapacity = configuration.ringCapacity;
  const startAngle = (configuration.startAngle * Math.PI) / 180;
  return Object.fromEntries(
    nodes.map((node, index) => {
      const ring = Math.floor(index / ringCapacity);
      const ringStart = ring * ringCapacity;
      const ringCount = Math.min(ringCapacity, count - ringStart);
      const angle =
        ((index - ringStart) / Math.max(ringCount, 1)) * Math.PI * 2 +
        startAngle;
      const radius =
        nodes.length === 1 ? 0 : configuration.ringGap * (ring + 1);
      return [
        node.id,
        { x: 480 + Math.cos(angle) * radius, y: 280 + Math.sin(angle) * radius },
      ];
    }),
  );
}

function gridPositions(
  nodes: GraphNodeModel[],
  configuration: GraphLayoutConfiguration["grid"],
): Record<string, Point> {
  const automaticColumns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.6)));
  const columns = Math.max(
    1,
    Math.min(nodes.length || 1, configuration.columns || automaticColumns),
  );
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const horizontalGap = configuration.columnGap;
  const verticalGap = configuration.rowGap;
  const width = (columns - 1) * horizontalGap;
  const height = (rows - 1) * verticalGap;
  return Object.fromEntries(
    nodes.map((node, index) => [
      node.id,
      {
        x: 480 - width / 2 + (index % columns) * horizontalGap,
        y: 280 - height / 2 + Math.floor(index / columns) * verticalGap,
      },
    ]),
  );
}

function hierarchicalPositions(
  nodes: GraphNodeModel[],
  edges: GraphEdgeModel[],
  configuration: GraphLayoutConfiguration["hierarchical"],
): Record<string, Point> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const indegree = Object.fromEntries(nodes.map((node) => [node.id, 0])) as Record<string, number>;
  const outgoing = Object.fromEntries(nodes.map((node) => [node.id, [] as string[]])) as Record<
    string,
    string[]
  >;
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to) return;
    outgoing[edge.from]!.push(edge.to);
    indegree[edge.to] = (indegree[edge.to] ?? 0) + 1;
  });
  const queue = nodes.filter((node) => indegree[node.id] === 0).map((node) => node.id);
  if (queue.length === 0 && nodes[0]) queue.push(nodes[0].id);
  const levels = new Map<string, number>();
  queue.forEach((id) => levels.set(id, 0));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!;
    const level = levels.get(id) ?? 0;
    outgoing[id]!.forEach((nextId) => {
      levels.set(nextId, Math.max(levels.get(nextId) ?? 0, level + 1));
      indegree[nextId] = (indegree[nextId] ?? 1) - 1;
      if (indegree[nextId] === 0) queue.push(nextId);
    });
  }
  const fallbackLevel = Math.max(0, ...levels.values());
  nodes.forEach((node) => {
    if (!levels.has(node.id)) levels.set(node.id, fallbackLevel);
  });
  const groups = new Map<number, GraphNodeModel[]>();
  nodes.forEach((node) => {
    const level = levels.get(node.id) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), node]);
  });
  const orderedLevels = [...groups.keys()].sort((left, right) => left - right);
  const levelGap = configuration.levelGap;
  const totalLevelSpan = (orderedLevels.length - 1) * levelGap;
  const positions: Record<string, Point> = {};
  orderedLevels.forEach((level, levelIndex) => {
    const group = groups.get(level)!;
    const nodeGap = configuration.nodeGap;
    const totalNodeSpan = (group.length - 1) * nodeGap;
    group.forEach((node, index) => {
      positions[node.id] =
        configuration.direction === "left-right"
          ? {
              x: 480 - totalLevelSpan / 2 + levelIndex * levelGap,
              y: 280 - totalNodeSpan / 2 + index * nodeGap,
            }
          : {
              x: 480 - totalNodeSpan / 2 + index * nodeGap,
              y: 280 - totalLevelSpan / 2 + levelIndex * levelGap,
            };
    });
  });
  return positions;
}

function positionsForLayout(
  nodes: GraphNodeModel[],
  edges: GraphEdgeModel[],
  labelFields: string,
  mode: GraphLayoutMode,
  configuration: GraphLayoutConfiguration,
): Record<string, Point> {
  if (mode === "radial") return radialPositions(nodes, configuration.radial);
  if (mode === "grid") return gridPositions(nodes, configuration.grid);
  if (mode === "hierarchical") {
    return hierarchicalPositions(nodes, edges, configuration.hierarchical);
  }
  return initialPositions(nodes, labelFields);
}

function collisionRadius(node: GraphNodeModel, labelFields: string): number {
  const captionLength = graphCaption(node, labelFields).length;
  return Math.min(128, Math.max(48, captionLength * 3.5 + 32));
}

function fitCamera(positions: Record<string, Point>): Camera {
  const values = Object.values(positions);
  if (values.length === 0) return { x: 0, y: 0, scale: 1 };
  const xs = values.map((point) => point.x);
  const ys = values.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs) + 210;
  const height = Math.max(...ys) - Math.min(...ys) + 150;
  const scale = Math.min(1, 880 / width, 490 / height);
  return {
    scale,
    x: 480 - ((Math.min(...xs) + Math.max(...xs)) / 2) * scale,
    y: 280 - ((Math.min(...ys) + Math.max(...ys)) / 2) * scale,
  };
}

function defaultControl(from: Point, to: Point, index: number): Point {
  const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const offset = ((index % 3) - 1) * 26;
  return {
    x: middle.x - (dy / length) * offset,
    y: middle.y + (dx / length) * offset,
  };
}

export function InteractiveGraph({
  model,
  selection,
  onSelect,
  nodeLimit,
  edgeLimit,
  showLabels,
  showGrid,
  layoutMode,
  layoutConfiguration,
  onLayoutModeChange,
  vertexLabelFields,
  edgeLabelFields,
  detailStatus = "idle",
  detailError = "",
  onExportComplete,
  onExportError,
}: {
  model: GraphModel;
  selection: GraphSelection;
  onSelect: (selection: GraphSelection) => void;
  nodeLimit: number;
  edgeLimit: number;
  showLabels: boolean;
  showGrid: boolean;
  layoutMode: GraphLayoutMode;
  layoutConfiguration: GraphLayoutConfiguration;
  onLayoutModeChange: (mode: GraphLayoutMode) => void;
  vertexLabelFields: string;
  edgeLabelFields: string;
  detailStatus?: "idle" | "loading" | "error";
  detailError?: string;
  onExportComplete?: (path: string) => void;
  onExportError?: (message: string) => void;
}) {
  const { repulsion, linkDistance, centerStrength, damping } =
    layoutConfiguration.force;
  const t = useTranslate();
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const canvasDragRef = useRef<{
    pointerId: number;
    start: Point;
    camera: Camera;
  } | null>(null);
  const exportControlRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [search, setSearch] = useState("");
  const [layoutSaved, setLayoutSaved] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportState, setExportState] = useState<{
    format: GraphExportFormat;
    phase: GraphExportPhase;
  } | null>(null);
  const visibleNodes = useMemo(
    () => model.nodes.slice(0, nodeLimit),
    [model.nodes, nodeLimit],
  );
  const nodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  );
  const visibleEdges = useMemo(
    () =>
      model.edges
        .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
        .slice(0, edgeLimit),
    [edgeLimit, model.edges, nodeIds],
  );
  const nodeSignature = visibleNodes
    .map((node) => `${node.id}:${graphCaption(node, vertexLabelFields)}`)
    .sort()
    .join("\u0000");
  const edgeSignature = visibleEdges.map((edge) => edge.id).sort().join("\u0000");
  const activeLayoutConfiguration = layoutConfiguration[layoutMode];
  const graphIdentity = [
    ...visibleNodes.map((node) => `v:${node.id}`).sort(),
    ...visibleEdges
      .map((edge) => `e:${edge.id}:${edge.from}->${edge.to}`)
      .sort(),
  ].join("\u0000");
  const layoutStorageKey = `janusgraph.graphLayout.v3.${signatureHash(`${layoutMode}\u0000${JSON.stringify(activeLayoutConfiguration)}\u0000${graphIdentity}`)}`;
  const [camera, setCamera] = useState<Camera>(() =>
    fitCamera(
      positionsForLayout(
        visibleNodes,
        visibleEdges,
        vertexLabelFields,
        layoutMode,
        layoutConfiguration,
      ),
    ),
  );
  const [positions, setPositions] = useState<Record<string, Point>>(() =>
    positionsForLayout(
      visibleNodes,
      visibleEdges,
      vertexLabelFields,
      layoutMode,
      layoutConfiguration,
    ),
  );
  const [controls, setControls] = useState<Record<string, Point>>({});
  const edgeLabelPositions = useMemo(
    () =>
      resolveGraphEdgeLabelPositions(
        visibleNodes.flatMap((node) => {
          const position = positions[node.id];
          return position
            ? [
                {
                  id: node.id,
                  position,
                  caption: graphCaption(node, vertexLabelFields),
                },
              ]
            : [];
        }),
        visibleEdges.flatMap((edge, index) => {
          const from = positions[edge.from];
          const to = positions[edge.to];
          return from && to
            ? [
                {
                  id: edge.id,
                  from: edge.from,
                  to: edge.to,
                  control: controls[edge.id] ?? defaultControl(from, to, index),
                  caption: graphCaption(edge, edgeLabelFields),
                  index,
                },
              ]
            : [];
        }),
      ),
    [
      controls,
      edgeLabelFields,
      positions,
      vertexLabelFields,
      visibleEdges,
      visibleNodes,
    ],
  );
  const positionsRef = useRef(positions);
  const velocitiesRef = useRef<Record<string, Point>>({});
  const physicsAlphaRef = useRef(1);
  const [physicsRunning, setPhysicsRunning] = useState(layoutMode === "force");
  const [simulationVersion, setSimulationVersion] = useState(0);

  useEffect(() => {
    const generated = positionsForLayout(
      visibleNodes,
      visibleEdges,
      vertexLabelFields,
      layoutMode,
      layoutConfiguration,
    );
    let next = generated;
    let nextControls: Record<string, Point> = {};
    let nextCamera = fitCamera(generated);
    try {
      const stored = JSON.parse(localStorage.getItem(layoutStorageKey) ?? "null") as {
        positions?: Record<string, Point>;
        controls?: Record<string, Point>;
        camera?: Camera;
      } | null;
      if (stored?.positions && visibleNodes.every((node) => stored.positions?.[node.id])) {
        next = stored.positions;
        nextControls = stored.controls ?? {};
        if (stored.camera && Number.isFinite(stored.camera.scale)) nextCamera = stored.camera;
      }
    } catch {
      // Ignore an invalid saved layout and regenerate it.
    }
    positionsRef.current = next;
    velocitiesRef.current = {};
    physicsAlphaRef.current = 1;
    setPositions(next);
    setControls(nextControls);
    setCamera(nextCamera);
    setPhysicsRunning(layoutMode === "force");
    setSimulationVersion((current) => current + 1);
  }, [
    edgeSignature,
    layoutConfiguration,
    layoutMode,
    layoutStorageKey,
    nodeSignature,
    vertexLabelFields,
  ]);

  useEffect(() => {
    if (layoutMode !== "force") return;
    velocitiesRef.current = {};
    physicsAlphaRef.current = 1;
    setPhysicsRunning(true);
    setSimulationVersion((current) => current + 1);
  }, [centerStrength, damping, layoutMode, linkDistance, repulsion]);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    if (!fullscreen) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [fullscreen]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!exportControlRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (layoutMode !== "force" || !physicsRunning || visibleNodes.length === 0) return;
    let frame = 0;
    let ticks = 0;
    let previousTime = performance.now();

    const tick = (time: number) => {
      ticks += 1;
      const elapsed = Math.min(2, Math.max(0.55, (time - previousTime) / 16.67));
      previousTime = time;
      const alpha = physicsAlphaRef.current;
      const current = positionsRef.current;
      const velocities = velocitiesRef.current;
      const forces = Object.fromEntries(
        visibleNodes.map((node) => [node.id, { x: 0, y: 0 }]),
      ) as Record<string, Point>;

      for (let leftIndex = 0; leftIndex < visibleNodes.length; leftIndex += 1) {
        const leftNode = visibleNodes[leftIndex]!;
        const left = current[leftNode.id];
        if (!left) continue;
        for (
          let rightIndex = leftIndex + 1;
          rightIndex < visibleNodes.length;
          rightIndex += 1
        ) {
          const rightNode = visibleNodes[rightIndex]!;
          const right = current[rightNode.id];
          if (!right) continue;
          let dx = right.x - left.x;
          let dy = right.y - left.y;
          if (dx === 0 && dy === 0) {
            dx = (rightIndex % 2 ? 1 : -1) * 0.01;
            dy = 0.01;
          }
          const distance = Math.max(Math.hypot(dx, dy), 1);
          const ux = dx / distance;
          const uy = dy / distance;
          const minimumDistance =
            collisionRadius(leftNode, vertexLabelFields) +
            collisionRadius(rightNode, vertexLabelFields);
          const repulsionForce = Math.min(8, repulsion / (distance * distance));
          const collision =
            distance < minimumDistance
              ? (minimumDistance - distance) * 0.036
              : 0;
          const strength = (repulsionForce + collision) * alpha;
          forces[leftNode.id]!.x -= ux * strength;
          forces[leftNode.id]!.y -= uy * strength;
          forces[rightNode.id]!.x += ux * strength;
          forces[rightNode.id]!.y += uy * strength;
        }
      }

      visibleEdges.forEach((edge) => {
        const from = current[edge.from];
        const to = current[edge.to];
        if (!from || !to) return;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const stretch = distance - linkDistance;
        const strength = stretch * 0.012 * alpha;
        const fx = (dx / distance) * strength;
        const fy = (dy / distance) * strength;
        forces[edge.from]!.x += fx;
        forces[edge.from]!.y += fy;
        forces[edge.to]!.x -= fx;
        forces[edge.to]!.y -= fy;
      });

      let kineticEnergy = 0;
      const next: Record<string, Point> = {};
      visibleNodes.forEach((node) => {
        const point = current[node.id] ?? { x: 480, y: 280 };
        const force = forces[node.id]!;
        force.x += (480 - point.x) * centerStrength * 0.0003 * alpha;
        force.y += (280 - point.y) * centerStrength * 0.0003 * alpha;
        const previousVelocity = velocities[node.id] ?? { x: 0, y: 0 };
        const velocity = {
          x: (previousVelocity.x + force.x * elapsed) * (damping / 100),
          y: (previousVelocity.y + force.y * elapsed) * (damping / 100),
        };
        const speed = Math.hypot(velocity.x, velocity.y);
        if (speed > 12) {
          velocity.x = (velocity.x / speed) * 12;
          velocity.y = (velocity.y / speed) * 12;
        }
        velocities[node.id] = velocity;
        kineticEnergy += Math.hypot(velocity.x, velocity.y);
        next[node.id] =
          dragRef.current?.kind === "node" && dragRef.current.id === node.id
            ? point
            : {
                x: point.x + velocity.x * elapsed,
                y: point.y + velocity.y * elapsed,
              };
      });

      positionsRef.current = next;
      setPositions(next);
      physicsAlphaRef.current = Math.max(0.025, alpha * 0.992);
      if (
        ticks > 720 ||
        (physicsAlphaRef.current <= 0.026 &&
          kineticEnergy / Math.max(visibleNodes.length, 1) < 0.075)
      ) {
        setPhysicsRunning(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    edgeSignature,
    centerStrength,
    damping,
    layoutMode,
    linkDistance,
    physicsRunning,
    repulsion,
    simulationVersion,
    vertexLabelFields,
    visibleEdges,
    visibleNodes,
  ]);

  const viewPointFromClient = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(matrix.inverse());
    return { x: local.x, y: local.y };
  };

  const pointFromEvent = (event: ReactPointerEvent): Point => {
    const viewPoint = viewPointFromClient(event.clientX, event.clientY);
    return {
      x: (viewPoint.x - camera.x) / camera.scale,
      y: (viewPoint.y - camera.y) / camera.scale,
    };
  };

  const beginDrag = (
    event: ReactPointerEvent<SVGGElement>,
    kind: DragState["kind"],
    id: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind,
      id,
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      moved: false,
    };
  };

  const moveDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - drag.startClient.x,
      event.clientY - drag.startClient.y,
    );
    if (!drag.moved && distance <= 5) return;
    drag.moved = true;
    const point = pointFromEvent(event);
    if (drag.kind === "node") {
      velocitiesRef.current[drag.id] = { x: 0, y: 0 };
      positionsRef.current = { ...positionsRef.current, [drag.id]: point };
      setPositions(positionsRef.current);
    } else {
      setControls((current) => ({ ...current, [drag.id]: point }));
    }
  };

  const endDrag = (
    event: ReactPointerEvent<SVGGElement>,
    selectionValue: GraphSelection,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) onSelect(selectionValue);
    if (layoutMode === "force" && drag.kind === "node" && drag.moved) {
      physicsAlphaRef.current = Math.max(physicsAlphaRef.current, 0.34);
      setPhysicsRunning(true);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resetLayout = () => {
    localStorage.removeItem(layoutStorageKey);
    setLayoutSaved(false);
    const next = positionsForLayout(
      visibleNodes,
      visibleEdges,
      vertexLabelFields,
      layoutMode,
      layoutConfiguration,
    );
    positionsRef.current = next;
    velocitiesRef.current = {};
    physicsAlphaRef.current = 1;
    setPositions(next);
    setControls({});
    setCamera(fitCamera(next));
    setPhysicsRunning(layoutMode === "force");
    setSimulationVersion((current) => current + 1);
  };

  const saveLayout = () => {
    localStorage.setItem(layoutStorageKey, JSON.stringify({ positions, controls, camera }));
    setLayoutSaved(true);
    window.setTimeout(() => setLayoutSaved(false), 1_500);
  };

  const graphExportFrame = () => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const include = (
      point: Point,
      horizontalPadding = 0,
      topPadding = horizontalPadding,
      bottomPadding = topPadding,
    ) => {
      minX = Math.min(minX, point.x - horizontalPadding);
      maxX = Math.max(maxX, point.x + horizontalPadding);
      minY = Math.min(minY, point.y - topPadding);
      maxY = Math.max(maxY, point.y + bottomPadding);
    };

    visibleNodes.forEach((node) => {
      const position = positions[node.id];
      if (!position) return;
      const caption = graphCaption(node, vertexLabelFields);
      const halfLabelWidth = showLabels
        ? graphNodeLabelWidth(caption) / 2
        : 34;
      include(position, halfLabelWidth, 36, showLabels ? 68 : 36);
    });
    visibleEdges.forEach((edge, index) => {
      const from = positions[edge.from];
      const to = positions[edge.to];
      if (!from || !to) return;
      const control = controls[edge.id] ?? defaultControl(from, to, index);
      const labelPosition = edgeLabelPositions[edge.id] ?? control;
      const caption = graphCaption(edge, edgeLabelFields);
      const halfLabelWidth = showLabels
        ? graphEdgeLabelWidth(caption) / 2
        : 12;
      include(from, 36);
      include(to, 36);
      include(
        control,
        18,
        edge.from === edge.to ? 96 : 18,
        18,
      );
      include(
        labelPosition,
        halfLabelWidth,
        showLabels ? 18 : 12,
        showLabels ? 18 : 12,
      );
    });

    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
      return { x: 0, y: 0, width: 960, height: 560 };
    }
    const padding = 72;
    return {
      x: minX - padding,
      y: minY - padding,
      width: Math.max(320, maxX - minX + padding * 2),
      height: Math.max(240, maxY - minY + padding * 2),
    };
  };

  const serializedSvg = () => {
    const source = svgRef.current;
    if (!source) return null;
    const frame = graphExportFrame();
    const aspect = frame.width / frame.height;
    const outputWidth = aspect >= 1
      ? 2400
      : Math.max(640, Math.round(2400 * aspect));
    const outputHeight = aspect >= 1
      ? Math.max(640, Math.round(2400 / aspect))
      : 2400;
    const clone = source.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(outputWidth));
    clone.setAttribute("height", String(outputHeight));
    clone.setAttribute(
      "viewBox",
      `${frame.x} ${frame.y} ${frame.width} ${frame.height}`,
    );
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
    clone.querySelector<SVGGElement>(".graph-world")?.removeAttribute("transform");
    const markerSize = Math.min(
      52,
      Math.max(
        22,
        Math.max(frame.width / outputWidth, frame.height / outputHeight) * 20,
      ),
    );
    clone.querySelectorAll<SVGMarkerElement>("marker.graph-arrow").forEach((marker) => {
      marker.setAttribute("markerWidth", markerSize.toFixed(2));
      marker.setAttribute("markerHeight", markerSize.toFixed(2));
    });
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.setAttribute("x", String(frame.x));
    background.setAttribute("y", String(frame.y));
    background.setAttribute("width", String(frame.width));
    background.setAttribute("height", String(frame.height));
    background.setAttribute("fill", "#0d100e");
    background.setAttribute("class", "export-background");
    clone.prepend(background);
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      svg { background: #0d100e; font-family: ui-monospace, monospace; }
      .edge-hit,.edge-handle { display:none; }
      .edge-line { fill:none; stroke:var(--edge-color,#829087); stroke-width:2.4; }
      .edge-label-leader { fill:none; stroke:var(--edge-color,#829087); stroke-width:1; stroke-dasharray:3 4; opacity:.58; }
      .graph-arrow path { stroke:#0d100e; stroke-width:.9; stroke-linejoin:round; paint-order:stroke fill; }
      .edge-label-background { fill:#111612; stroke:var(--edge-color,#829087); stroke-width:1; }
      .graph-edge text { fill:var(--edge-color,#d7dfd8); font-size:12px; font-weight:650; text-anchor:middle; }
      .graph-node circle { fill:color-mix(in srgb,var(--node-color,#c8ff55) 17%,#111612); stroke:var(--node-color,#c8ff55); stroke-width:2; }
      .graph-node svg { color:var(--node-color,#c8ff55); }
      .node-label-background { fill:#111612; stroke:var(--node-color,#c8ff55); }
      .node-label { fill:#eef1eb; font-size:12px; text-anchor:middle; }
    `;
    clone.prepend(style);
    return {
      source: new XMLSerializer().serializeToString(clone),
      width: outputWidth,
      height: outputHeight,
    };
  };

  const reportExportError = (error: unknown) => {
    onExportError?.(error instanceof Error ? error.message : String(error));
  };

  const saveGraphFile = async (
    content: string,
    format: GraphExportFormat,
  ) => {
    if (!window.janusGraphDesktop) {
      throw new Error(t("桌面文件服务不可用", "Desktop file service is unavailable"));
    }
    setExportState((current) => ({
      format: current?.format ?? format,
      phase: "saving",
    }));
    const path = await window.janusGraphDesktop.files.saveGraphFile({
      suggestedName: `janusgraph-topology-${Date.now()}.${format}`,
      format,
      content,
    });
    if (path) onExportComplete?.(path);
  };

  const exportSvg = async () => {
    setExportState({ format: "svg", phase: "rendering" });
    try {
      const source = serializedSvg();
      if (!source) throw new Error(t("拓扑画布不可用", "Graph canvas is unavailable"));
      await saveGraphFile(source.source, "svg");
    } catch (error) {
      reportExportError(error);
    } finally {
      setExportState(null);
    }
  };

  const exportRaster = (format: "png" | "jpeg") => {
    const exportFormat = format === "jpeg" ? "jpg" : "png";
    setExportState({ format: exportFormat, phase: "rendering" });
    const source = serializedSvg();
    if (!source) {
      reportExportError(new Error(t("拓扑画布不可用", "Graph canvas is unavailable")));
      setExportState(null);
      return;
    }
    const sourceUrl = URL.createObjectURL(
      new Blob([source.source], { type: "image/svg+xml;charset=utf-8" }),
    );
    const image = new Image();
    image.onload = () => {
      void (async () => {
        setExportState({ format: exportFormat, phase: "encoding" });
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error(t("无法创建图片画布", "Unable to create image canvas"));
        context.fillStyle = "#0d100e";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((value) => {
            if (value) resolve(value);
            else reject(new Error(t("无法生成拓扑图图片", "Unable to generate graph image")));
          }, `image/${format}`, format === "jpeg" ? 0.92 : undefined);
        });
        await saveGraphFile(
          await blobAsBase64(blob),
          exportFormat,
        );
      })().catch(reportExportError).finally(() => {
        URL.revokeObjectURL(sourceUrl);
        setExportState(null);
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reportExportError(new Error(t("无法解析拓扑图画布", "Unable to render graph canvas")));
      setExportState(null);
    };
    image.src = sourceUrl;
  };

  const exportJson = async () => {
    setExportState({ format: "json", phase: "rendering" });
    try {
      const content = JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        layout: layoutMode,
        camera,
        positions: Object.fromEntries(
          visibleNodes.map((node) => [node.id, positions[node.id]]),
        ),
        controls,
        nodes: visibleNodes,
        edges: visibleEdges,
      }, (_key, value) => typeof value === "bigint" ? String(value) : value, 2);
      await saveGraphFile(content, "json");
    } catch (error) {
      reportExportError(error);
    } finally {
      setExportState(null);
    }
  };

  const zoomAtCenter = (factor: number) => {
    setCamera((current) => {
      const scale = Math.min(3.5, Math.max(0.25, current.scale * factor));
      const worldCenter = {
        x: (480 - current.x) / current.scale,
        y: (280 - current.y) / current.scale,
      };
      return {
        scale,
        x: 480 - worldCenter.x * scale,
        y: 280 - worldCenter.y * scale,
      };
    });
  };

  if (visibleNodes.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <Move size={30} />
        </div>
        <strong>{t("当前结果不能转换为拓扑", "This result cannot be rendered as a graph")}</strong>
        <p>
          {t(
            "请返回 Vertex、Edge、Path 或包含 id、label、outV、inV 的对象。",
            "Return Vertex, Edge, Path, or objects containing id, label, outV and inV.",
          )}
        </p>
      </div>
    );
  }

  const layoutOptions = [
    { value: "force", label: t("力导向", "Force") },
    { value: "hierarchical", label: t("层级", "Hierarchy") },
    { value: "radial", label: t("环形", "Radial") },
    { value: "grid", label: t("网格", "Grid") },
  ];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matchingNodeIds = new Set(
    visibleNodes
      .filter((node) => !normalizedSearch || [node.id, node.label, ...Object.values(node.properties).map(printableValue)].join(" ").toLocaleLowerCase().includes(normalizedSearch))
      .map((node) => node.id),
  );
  const legendEntries: Array<[
    string,
    { kind: "V" | "E"; label: string },
  ]> = [
    ...visibleNodes.map((node): [string, { kind: "V"; label: string }] => [
      `V:${node.label}`,
      { kind: "V", label: node.label },
    ]),
    ...visibleEdges.map((edge): [string, { kind: "E"; label: string }] => [
      `E:${edge.label}`,
      { kind: "E", label: edge.label },
    ]),
  ];
  const legend = [...new Map(legendEntries).values()];
  const graphLabelColors = new Map(
    legend.map((entry, index) => [
      `${entry.kind}:${entry.label}`,
      indexedLabelColor(index),
    ]),
  );
  const exportPhaseIndex = exportState
    ? { rendering: 0, encoding: 1, saving: 2 }[exportState.phase]
    : -1;
  const exportPhaseLabel = exportState?.phase === "rendering"
    ? t("正在渲染拓扑画布", "Rendering graph canvas")
    : exportState?.phase === "encoding"
      ? t("正在编码图片", "Encoding image")
      : t("等待选择保存位置", "Waiting for save location");

  const stage = (
    <div
      ref={stageRef}
      className={`graph-stage ${showGrid ? "has-grid" : ""} ${fullscreen ? "is-fullscreen" : ""}`}
      style={{
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        ["--graph-grid-scale" as string]: camera.scale,
      }}
    >
      <div className="graph-floating-toolbar">
        <span>{visibleNodes.length} V</span>
        <span>{visibleEdges.length} E</span>
        <div className="graph-layout-control">
          <Activity size={14} />
          <SelectControl
            className="graph-layout-select"
            ariaLabel={t("拓扑布局", "Graph layout")}
            value={layoutMode}
            onValueChange={(value) => onLayoutModeChange(value as GraphLayoutMode)}
            options={layoutOptions}
          />
        </div>
        <label className="graph-search">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("查找顶点", "Find vertex")}
            aria-label={t("查找拓扑顶点", "Find graph vertex")}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const node = visibleNodes.find((candidate) => matchingNodeIds.has(candidate.id));
              const point = node ? positions[node.id] : undefined;
              if (!node || !point) return;
              onSelect({ kind: "node", value: node });
              setCamera((current) => ({ ...current, x: 480 - point.x * current.scale, y: 280 - point.y * current.scale }));
            }}
          />
          {search && <small>{matchingNodeIds.size}</small>}
        </label>
        {layoutMode === "force" && (
          <button
            type="button"
            className={physicsRunning ? "is-running" : ""}
            onClick={() => {
              if (!physicsRunning) {
                physicsAlphaRef.current = Math.max(physicsAlphaRef.current, 0.22);
                setSimulationVersion((current) => current + 1);
              }
              setPhysicsRunning((current) => !current);
            }}
            aria-label={
              physicsRunning
                ? t("暂停物理布局", "Pause physics")
                : t("继续物理布局", "Resume physics")
            }
            title={
              physicsRunning
                ? t("暂停物理布局", "Pause physics")
                : t("继续物理布局", "Resume physics")
            }
          >
            {physicsRunning ? <Pause size={15} /> : <Play size={15} />}
          </button>
        )}
        <button type="button" onClick={() => zoomAtCenter(1.2)} aria-label={t("放大", "Zoom in")}>
          <ZoomIn size={15} />
        </button>
        <button type="button" onClick={() => zoomAtCenter(1 / 1.2)} aria-label={t("缩小", "Zoom out")}>
          <ZoomOut size={15} />
        </button>
        <button type="button" onClick={resetLayout}>
          <RotateCcw size={15} />
          {t("重置布局", "Reset layout")}
        </button>
        <button
          type="button"
          onClick={saveLayout}
          title={t(
            "按当前可见顶点 ID、关系 ID 与方向、布局模式和参数识别相同图，并恢复顶点位置、关系控制点与缩放视角",
            "Identify the same graph by visible vertex IDs, edge IDs and directions, layout mode and settings, then restore positions, controls, and camera",
          )}
        >
          {layoutSaved ? <CircleDot size={15} /> : <Save size={15} />}
          {layoutSaved ? t("已保存", "Saved") : t("保存布局", "Save layout")}
        </button>
        <div className="graph-export-control" ref={exportControlRef}>
          <button
            type="button"
            onClick={() => setExportMenuOpen((current) => !current)}
            title={t("下载拓扑图", "Download graph")}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            aria-busy={Boolean(exportState)}
            disabled={Boolean(exportState)}
          >
            {exportState ? (
              <>
                <LoaderCircle className="spin" size={15} />
                <span>{exportState.format.toUpperCase()}</span>
              </>
            ) : (
              <>
                <Download size={15} />
                <ChevronDown size={13} />
              </>
            )}
          </button>
          {exportMenuOpen && (
            <div className="graph-export-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setExportMenuOpen(false); exportRaster("png"); }}>
                <FileImage size={16} />
                <span><strong>PNG</strong><small>{t("高清位图", "High-resolution image")}</small></span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setExportMenuOpen(false); exportRaster("jpeg"); }}>
                <FileImage size={16} />
                <span><strong>JPG</strong><small>{t("适合分享的压缩图片", "Compressed image for sharing")}</small></span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setExportMenuOpen(false); void exportSvg(); }}>
                <FileImage size={16} />
                <span><strong>SVG</strong><small>{t("可缩放矢量图", "Scalable vector image")}</small></span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setExportMenuOpen(false); void exportJson(); }}>
                <FileJson size={16} />
                <span><strong>JSON</strong><small>{t("图数据与布局坐标", "Graph data and layout coordinates")}</small></span>
              </button>
            </div>
          )}
          {exportState && (
            <div className="graph-export-progress" role="status" aria-live="polite">
              <header>
                <LoaderCircle className="spin" size={16} />
                <span>
                  <strong>{t(`正在生成 ${exportState.format.toUpperCase()}`, `Generating ${exportState.format.toUpperCase()}`)}</strong>
                  <small>{exportPhaseLabel}</small>
                </span>
              </header>
              <div className="graph-export-progress-track" aria-hidden="true">
                {[0, 1, 2].map((step) => (
                  <i key={step} className={step <= exportPhaseIndex ? "is-active" : ""} />
                ))}
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFullscreen((current) => !current)}
          aria-label={fullscreen ? t("退出全屏", "Exit fullscreen") : t("全屏", "Fullscreen")}
        >
          {fullscreen ? (
            <>
              <Minimize2 size={15} />
              {t("退出全屏", "Exit fullscreen")}
            </>
          ) : (
            <Maximize2 size={15} />
          )}
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 960 560"
        role="img"
        aria-label={t("查询结果拓扑图", "Query result graph")}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          canvasDragRef.current = {
            pointerId: event.pointerId,
            start: viewPointFromClient(event.clientX, event.clientY),
            camera,
          };
        }}
        onPointerMove={(event) => {
          const drag = canvasDragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const point = viewPointFromClient(event.clientX, event.clientY);
          setCamera({
            ...drag.camera,
            x: drag.camera.x + point.x - drag.start.x,
            y: drag.camera.y + point.y - drag.start.y,
          });
        }}
        onPointerUp={(event) => {
          if (canvasDragRef.current?.pointerId !== event.pointerId) return;
          canvasDragRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          canvasDragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          const viewPoint = viewPointFromClient(event.clientX, event.clientY);
          setCamera((current) => {
            const scale = Math.min(
              3.5,
              Math.max(0.25, current.scale * Math.exp(-event.deltaY * 0.0015)),
            );
            const world = {
              x: (viewPoint.x - current.x) / current.scale,
              y: (viewPoint.y - current.y) / current.scale,
            };
            return {
              scale,
              x: viewPoint.x - world.x * scale,
              y: viewPoint.y - world.y * scale,
            };
          });
        }}
      >
        <defs>
          {[...new Set(visibleEdges.map((edge) => edge.label))].map((label) => {
            const color = graphLabelColors.get(`E:${label}`) ?? labelColor(label);
            return (
              <marker
                key={label}
                id={edgeMarkerId(label)}
                className="graph-arrow"
                viewBox="0 0 12 12"
                refX="10.8"
                refY="6"
                markerWidth="22"
                markerHeight="22"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path
                  d="M 1 1 L 11 6 L 1 11 L 3.4 6 Z"
                  fill={color}
                  stroke="#0d100e"
                  strokeWidth="0.75"
                  strokeLinejoin="round"
                />
              </marker>
            );
          })}
        </defs>
        <g className="graph-world" transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
        <g className="edge-layer">
          {visibleEdges.map((edge, index) => {
            const from = positions[edge.from];
            const to = positions[edge.to];
            if (!from || !to) return null;
            const selected =
              selection?.kind === "edge" && selection.value.id === edge.id;
            const control =
              controls[edge.id] ?? defaultControl(from, to, index);
            const edgePathMidpoint = graphEdgePathMidpoint(
              from,
              to,
              control,
              edge.from === edge.to,
            );
            const edgeLabelPosition =
              edgeLabelPositions[edge.id] ?? edgePathMidpoint;
            const edgeCaption = graphCaption(edge, edgeLabelFields);
            const edgeCaptionWidth = graphEdgeLabelWidth(edgeCaption);
            const endpoints = graphEdgeEndpoints(from, to);
            const path =
              edge.from === edge.to
                ? `M ${from.x - 18} ${from.y - 24} Q ${control.x} ${control.y - 80} ${from.x + 18} ${from.y - 24}`
                : `M ${endpoints.start.x} ${endpoints.start.y} Q ${control.x} ${control.y} ${endpoints.end.x} ${endpoints.end.y}`;
            return (
              <g
                key={edge.id}
                className={`${selected ? "graph-edge is-selected" : "graph-edge"} ${normalizedSearch && !matchingNodeIds.has(edge.from) && !matchingNodeIds.has(edge.to) ? "is-dimmed" : ""}`}
                style={
                  { "--edge-color": graphLabelColors.get(`E:${edge.label}`) ?? labelColor(edge.label) } as CSSProperties
                }
                role="button"
                tabIndex={0}
                aria-label={`${edge.label} ${edge.from} → ${edge.to}`}
                onPointerDown={(event) => beginDrag(event, "edge", edge.id)}
                onPointerMove={moveDrag}
                onPointerUp={(event) =>
                  endDrag(event, { kind: "edge", value: edge })
                }
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onSelect({ kind: "edge", value: edge });
                  }
                }}
              >
                <path className="edge-hit" d={path} />
                <path
                  className="edge-line"
                  d={path}
                  markerEnd={`url(#${edgeMarkerId(edge.label)})`}
                />
                <circle className="edge-handle" cx={control.x} cy={control.y} r="7" />
                {showLabels && (
                  <>
                    {Math.hypot(
                      edgeLabelPosition.x - edgePathMidpoint.x,
                      edgeLabelPosition.y - edgePathMidpoint.y,
                    ) > 1 && (
                      <path
                        className="edge-label-leader"
                        d={`M ${edgePathMidpoint.x} ${edgePathMidpoint.y} L ${edgeLabelPosition.x} ${edgeLabelPosition.y}`}
                      />
                    )}
                    <rect
                      className="edge-label-background"
                      x={edgeLabelPosition.x - edgeCaptionWidth / 2}
                      y={edgeLabelPosition.y - 12}
                      width={edgeCaptionWidth}
                      height="24"
                      rx="8"
                    />
                    <text x={edgeLabelPosition.x} y={edgeLabelPosition.y + 5}>
                      {edgeCaption}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>
        <g className="node-layer">
          {visibleNodes.map((node) => {
            const position = positions[node.id];
            if (!position) return null;
            const selected =
              selection?.kind === "node" && selection.value.id === node.id;
            const caption = graphCaption(node, vertexLabelFields);
            const captionWidth = graphNodeLabelWidth(caption);
            return (
              <g
                key={node.id}
                className={`${selected ? "graph-node is-selected" : "graph-node"} ${normalizedSearch && !matchingNodeIds.has(node.id) ? "is-dimmed" : ""}`}
                transform={`translate(${position.x} ${position.y})`}
                style={
                  { "--node-color": graphLabelColors.get(`V:${node.label}`) ?? labelColor(node.label) } as CSSProperties
                }
                role="button"
                tabIndex={0}
                aria-label={`${node.label} ${node.id}`}
                onPointerDown={(event) => beginDrag(event, "node", node.id)}
                onPointerMove={moveDrag}
                onPointerUp={(event) =>
                  endDrag(event, { kind: "node", value: node })
                }
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onSelect({ kind: "node", value: node });
                  }
                }}
              >
                <circle r="30" />
                <CircleDot x={-10} y={-10} width={20} height={20} />
                {showLabels && (
                  <>
                    <rect
                      className="node-label-background"
                      x={-captionWidth / 2}
                      y="36"
                      width={captionWidth}
                      height="27"
                      rx="13.5"
                    />
                    <text className="node-label" y="54">
                      {caption}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>
        </g>
      </svg>
      <div className="graph-navigation-hint">
        <LocateFixed size={14} />
        {t("拖动画布平移 · 滚轮缩放", "Drag canvas to pan · Wheel to zoom")}
      </div>
      <div className="graph-legend" aria-label={t("Label 颜色图例", "Label color legend")}>
        {legend.slice(0, 10).map((entry) => (
          <span key={`${entry.kind}:${entry.label}`}>
            <i style={{ background: graphLabelColors.get(`${entry.kind}:${entry.label}`) ?? labelColor(entry.label) }} />
            <b>{entry.kind}</b>
            {entry.label}
          </span>
        ))}
        {legend.length > 10 && <small>+{legend.length - 10}</small>}
      </div>
      {(model.nodes.length > nodeLimit || model.edges.length > edgeLimit) && (
        <div className="graph-limit">
          {t(
            `按当前设置渲染前 ${nodeLimit} 个顶点和 ${edgeLimit} 条边`,
            `Rendering the first ${nodeLimit} vertices and ${edgeLimit} edges`,
          )}
        </div>
      )}
      {fullscreen && selection && (
        <aside
          className="graph-fullscreen-inspector"
          aria-label={t("图元素详情", "Graph element details")}
        >
          <header>
            <div>
              <span className="eyebrow">
                {selection.kind === "node" ? "VERTEX DETAIL" : "EDGE DETAIL"}
              </span>
              <h3>{selection.value.label}</h3>
            </div>
            <button
              type="button"
              aria-label={t("关闭详情", "Close details")}
              onClick={() => onSelect(null)}
            >
              <X size={17} />
            </button>
          </header>
          {detailStatus === "loading" && (
            <div className="inspector-status is-loading" role="status">
              <LoaderCircle className="spin" size={17} />
              <span>
                {t(
                  "正在读取 JanusGraph 中的完整属性…",
                  "Loading complete properties from JanusGraph…",
                )}
              </span>
            </div>
          )}
          {detailStatus === "error" && (
            <div className="inspector-status is-error" role="alert">
              <AlertTriangle size={17} />
              <span>{detailError}</span>
            </div>
          )}
          <dl className="property-list">
            {orderedInspectorEntries({
              ID: selection.value.id,
              LABEL: selection.value.label,
              ...(selection.kind === "edge"
                ? { FROM: selection.value.from, TO: selection.value.to }
                : {}),
              ...selection.value.properties,
            }).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{printableValue(value)}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </div>
  );
  return fullscreen ? createPortal(stage, document.body) : stage;
}
