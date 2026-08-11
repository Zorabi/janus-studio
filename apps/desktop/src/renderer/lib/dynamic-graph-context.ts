import type { ConnectionSummary } from "@janusgraph/domain";

export type DynamicGraphTarget = {
  name: string;
  graphBinding: string;
  traversalSource: string;
};

export type DynamicGraphContext = DynamicGraphTarget & { connectionId: string };

export function dynamicGraphContext(
  connectionId: string,
  graph: DynamicGraphTarget,
): DynamicGraphContext {
  return { connectionId, ...graph };
}

export function graphContextFromQueryTab(tab: {
  connectionId: string;
  graphBindingOverride: string;
  traversalSourceOverride: string;
} | null): DynamicGraphContext | null {
  return tab?.connectionId && tab.graphBindingOverride && tab.traversalSourceOverride
    ? dynamicGraphContext(tab.connectionId, {
        name: tab.graphBindingOverride,
        graphBinding: tab.graphBindingOverride,
        traversalSource: tab.traversalSourceOverride,
      })
    : null;
}

export function graphContextForConnection(
  context: DynamicGraphContext | null,
  connectionId: string,
): DynamicGraphContext | null {
  return context?.connectionId === connectionId ? context : null;
}

export function connectionWithGraphContext(
  connection: ConnectionSummary | undefined,
  context: DynamicGraphContext | null,
): ConnectionSummary | undefined {
  return connection && context
    ? { ...connection, graphBinding: context.graphBinding, traversalSource: context.traversalSource }
    : connection;
}
