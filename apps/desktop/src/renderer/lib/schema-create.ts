import { safeIdentifier, stringLiteral } from "./gremlin-identifiers";

export type SchemaIndexElement = "Vertex" | "Edge";

const schemaNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function sortSchemaNames(values: string[]): string[] {
  return [...values].sort((left, right) => schemaNameCollator.compare(left, right));
}

type IndexConstraint = {
  element: SchemaIndexElement;
  schemaLabel?: string;
};

function constraintScript({ element, schemaLabel }: IndexConstraint): {
  setup: string;
  apply: (builder: string) => string;
} {
  const normalizedLabel = schemaLabel?.trim() ?? "";
  if (!normalizedLabel) return { setup: "", apply: () => "" };
  const getter = element === "Vertex" ? "getVertexLabel" : "getEdgeLabel";
  return {
    setup: `def __indexOnlyLabel = __management.${getter}(${stringLiteral(normalizedLabel)})
if (__indexOnlyLabel == null) { __management.rollback(); throw new IllegalArgumentException(${stringLiteral(`${element} Label not found: ${normalizedLabel}`)}) }`,
    apply: (builder) => `${builder}.indexOnly(__indexOnlyLabel)`,
  };
}

export function buildPropertyKeySchemaScript(input: {
  graphBinding: string;
  name: string;
  dataType: string;
  cardinality: string;
  element: SchemaIndexElement;
  schemaLabel?: string;
  composite?: { name: string; unique: boolean };
  mixed?: { name: string; backend: string };
}): string {
  const graph = safeIdentifier(input.graphBinding);
  const constraint = constraintScript({ element: input.element, schemaLabel: input.schemaLabel });
  const indexScripts = [
    input.composite
      ? `def __compositeBuilder = __management.buildIndex(${stringLiteral(input.composite.name)}, org.apache.tinkerpop.gremlin.structure.${input.element}.class).addKey(__propertyKey)
${constraint.apply("__compositeBuilder")}
${input.composite.unique ? "__compositeBuilder.unique()" : ""}
__compositeBuilder.buildCompositeIndex()`
      : "",
    input.mixed
      ? `def __mixedBuilder = __management.buildIndex(${stringLiteral(input.mixed.name)}, org.apache.tinkerpop.gremlin.structure.${input.element}.class).addKey(__propertyKey)
${constraint.apply("__mixedBuilder")}
__mixedBuilder.buildMixedIndex(${stringLiteral(input.mixed.backend)})`
      : "",
  ].filter(Boolean).join("\n");

  return `def __management = ${graph}.openManagement()
${constraint.setup}
def __propertyKey = __management.makePropertyKey(${stringLiteral(input.name)}).dataType(${input.dataType}.class).cardinality(org.janusgraph.core.Cardinality.${input.cardinality}).make()
${indexScripts}
__management.commit()
${stringLiteral(`PropertyKey ${input.name} created`)}`;
}

export function buildExistingPropertyIndexScript(input: {
  graphBinding: string;
  indexName: string;
  propertyKey: string;
  type: "composite" | "mixed";
  element: SchemaIndexElement;
  schemaLabel?: string;
  unique: boolean;
  backend: string;
}): string {
  const graph = safeIdentifier(input.graphBinding);
  const constraint = constraintScript({ element: input.element, schemaLabel: input.schemaLabel });
  const finish = input.type === "mixed"
    ? `__indexBuilder.buildMixedIndex(${stringLiteral(input.backend)})`
    : `${input.unique ? "__indexBuilder.unique()\n" : ""}__indexBuilder.buildCompositeIndex()`;

  return `def __management = ${graph}.openManagement()
def __propertyKey = __management.getPropertyKey(${stringLiteral(input.propertyKey)})
if (__propertyKey == null) { __management.rollback(); throw new IllegalArgumentException(${stringLiteral(`PropertyKey not found: ${input.propertyKey}`)}) }
${constraint.setup}
def __indexBuilder = __management.buildIndex(${stringLiteral(input.indexName)}, org.apache.tinkerpop.gremlin.structure.${input.element}.class).addKey(__propertyKey)
${constraint.apply("__indexBuilder")}
${finish}
__management.commit()
${stringLiteral(`${input.type} index ${input.indexName} created`)}`;
}
