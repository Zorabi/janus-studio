import type { QualityGraphAccess, QualityRule, QualityRunMode } from "@janusgraph/domain";

export type QualityScript = { query: string; bindings: Record<string, unknown> };
export type QualityScriptContext = {
  graphAccess: QualityGraphAccess;
  graphName: string;
  graphBinding: string;
  traversalSource: string;
  mode: QualityRunMode;
  scanLimit: number;
  sampleLimit: number;
};

function traversal(context: QualityScriptContext, body: string): string {
  const source = context.graphAccess === "configured"
    ? `def __qualityGraph = ConfiguredGraphFactory.open(qualityGraphName)\ndef __qualityG = __qualityGraph.traversal()`
    : `def __qualityG = this.binding.hasVariable(qualityTraversalSource) ? this.binding.getVariable(qualityTraversalSource) : this.binding.getVariable(qualityGraphBinding).traversal()`;
  return `${source}
def __qualityValues = { element ->
  def values = [:]
  def properties = element.properties()
  try {
    while (properties.hasNext() && values.size() < 24) {
      def property = properties.next()
      def raw = property.value()
      values[property.key()] = raw == null || raw instanceof Number || raw instanceof Boolean || raw instanceof CharSequence ? raw : String.valueOf(raw)
    }
  } finally { try { properties.close() } catch (ignored) {} }
  return values
}
try {
${body}
} finally {
  if (qualityGraphAccess == "configured") { try { __qualityG.close() } catch (ignored) {} }
}`;
}

function baseBindings(context: QualityScriptContext): Record<string, unknown> {
  return {
    qualityGraphAccess: context.graphAccess,
    qualityGraphName: context.graphName,
    qualityGraphBinding: context.graphBinding,
    qualityTraversalSource: context.traversalSource,
    qualityScanLimit: context.scanLimit,
    qualitySampleLimit: context.sampleLimit,
  };
}

const scope = (context: QualityScriptContext, traversalText: string) =>
  context.mode === "bounded"
    ? traversalText.replace("__qualityG.V()", "__qualityG.V().limit(qualityScanLimit)").replace("__qualityG.E()", "__qualityG.E().limit(qualityScanLimit)")
    : traversalText;

const sampleProjection = `.limit(qualitySampleLimit).map{ element -> [id:element.get().id(),label:element.get().label(),values:__qualityValues(element.get())] }.toList()`;

export function buildQualityScript(rule: QualityRule, context: QualityScriptContext): QualityScript {
  const bindings: Record<string, unknown> = baseBindings(context);
  let body: string;
  if (rule.kind === "isolated-vertex") {
    Object.assign(bindings, { qualityVertexLabels:rule.vertexLabels ?? [], qualityIgnoredEdgeLabels:rule.ignoredEdgeLabels ?? [] });
    const base = scope(context, `__qualityG.V()${rule.vertexLabels?.length ? ".filter{ qualityVertexLabels.contains(it.get().label()) }" : ""}`);
    body = `  def __checked = ${base}.count().next()\n  def __issues = ${base}.filter{ v -> def edges = v.get().edges(Direction.BOTH); try { while (edges.hasNext()) { def e = edges.next(); if (!qualityIgnoredEdgeLabels.contains(e.label())) return false }; return true } finally { try { edges.close() } catch (ignored) {} } }\n  def __count = __issues.clone().count().next()\n  return [[checkedCount:__checked,issueCount:__count,samples:__issues${sampleProjection}]]`;
  } else if (rule.kind === "required-property") {
    Object.assign(bindings, { qualityVertexLabel:rule.vertexLabel ?? "", qualityPropertyKeys:rule.propertyKeys ?? [] });
    const base = scope(context, `__qualityG.V().hasLabel(qualityVertexLabel)`);
    body = `  def __missing = { vertex, key -> def it=vertex.properties(key); try { return !it.hasNext() } finally { try{it.close()}catch(ignored){} } }\n  def __checked = ${base}.count().next()\n  def __issues = ${base}.filter{ v -> qualityPropertyKeys.any{ k -> __missing(v.get(),k) } }\n  def __count = __issues.clone().count().next()\n  def __samples = __issues.limit(qualitySampleLimit).map{ v -> def missing = qualityPropertyKeys.findAll{ k -> __missing(v.get(),k) }; [id:v.get().id(),label:v.get().label(),missing:missing.join(", ")] }.toList()\n  return [[checkedCount:__checked,issueCount:__count,samples:__samples]]`;
  } else if (rule.kind === "property-domain") {
    Object.assign(bindings, { qualityVertexLabel:rule.vertexLabel ?? "", qualityPropertyKey:rule.propertyKey ?? "", qualityAllowedValues:rule.allowedValues ?? [], qualityMinimum:rule.minimum ?? Number.MIN_SAFE_INTEGER, qualityMaximum:rule.maximum ?? Number.MAX_SAFE_INTEGER });
    const base = scope(context, `__qualityG.V().hasLabel(qualityVertexLabel)`);
    const invalid = rule.constraint === "number-range"
      ? `if (p == null || !(p.value() instanceof Number)) return true; def n = ((Number)p.value()).doubleValue(); return n < qualityMinimum || n > qualityMaximum`
      : rule.constraint === "enum"
        ? `return p == null || !qualityAllowedValues.contains(String.valueOf(p.value()))`
        : `return p == null || String.valueOf(p.value()).trim().isEmpty()`;
    body = `  def __read = { vertex -> def it=vertex.properties(qualityPropertyKey); try { return it.hasNext()?it.next():null } finally { try{it.close()}catch(ignored){} } }\n  def __checked = ${base}.count().next()\n  def __issues = ${base}.filter{ v -> def p=__read(v.get()); ${invalid} }\n  def __count = __issues.clone().count().next()\n  def __samples = __issues.limit(qualitySampleLimit).map{ v -> def p=__read(v.get()); [id:v.get().id(),label:v.get().label(),value:p!=null?String.valueOf(p.value()):null] }.toList()\n  return [[checkedCount:__checked,issueCount:__count,samples:__samples]]`;
  } else if (rule.kind === "edge-endpoint") {
    Object.assign(bindings, { qualityEdgeLabel:rule.edgeLabel ?? "", qualityOutLabels:rule.outVertexLabels ?? [], qualityInLabels:rule.inVertexLabels ?? [] });
    const base = scope(context, `__qualityG.E().hasLabel(qualityEdgeLabel)`);
    body = `  def __checked = ${base}.count().next()\n  def __issues = ${base}.filter{ e -> def edge=e.get(); return !qualityOutLabels.contains(edge.outVertex().label()) || !qualityInLabels.contains(edge.inVertex().label()) }\n  def __count = __issues.clone().count().next()\n  def __samples = __issues.limit(qualitySampleLimit).map{ e -> def edge=e.get(); [id:edge.id(),label:edge.label(),outLabel:edge.outVertex().label(),inLabel:edge.inVertex().label()] }.toList()\n  return [[checkedCount:__checked,issueCount:__count,samples:__samples]]`;
  } else if (rule.kind === "degree-range") {
    Object.assign(bindings, { qualityVertexLabel:rule.vertexLabel ?? "", qualityEdgeLabel:rule.edgeLabel ?? "", qualityMinDegree:rule.minDegree ?? 0, qualityMaxDegree:rule.maxDegree ?? Number.MAX_SAFE_INTEGER });
    const base = scope(context, `__qualityG.V().hasLabel(qualityVertexLabel)`);
    const direction = rule.direction === "in" ? "IN" : rule.direction === "out" ? "OUT" : "BOTH";
    const edges = rule.edgeLabel
      ? `v.get().edges(Direction.${direction}, qualityEdgeLabel)`
      : `v.get().edges(Direction.${direction})`;
    body = `  def __checked = ${base}.count().next()\n  def __issues = ${base}.filter{ v -> def it=${edges}; long degree=0; try { while(it.hasNext()){it.next();degree++} } finally { try{it.close()}catch(ignored){} }; return degree < qualityMinDegree || degree > qualityMaxDegree }\n  def __count = __issues.clone().count().next()\n  return [[checkedCount:__checked,issueCount:__count,samples:__issues${sampleProjection}]]`;
  } else if (rule.kind === "distribution") {
    const vertex = rule.includeVertices !== false ? `${scope(context, "__qualityG.V()")}.groupCount().by(T.label).next()` : `[:]`;
    const edge = rule.includeEdges !== false ? `${scope(context, "__qualityG.E()")}.groupCount().by(T.label).next()` : `[:]`;
    body = `  def __vertices=${vertex}\n  def __edges=${edge}\n  def __checked=__vertices.values().sum(0)+__edges.values().sum(0)\n  def __samples=[]\n  __vertices.each{ name,count -> __samples << [id:"vertex:"+name,label:"vertex",name:String.valueOf(name),count:count] }\n  __edges.each{ name,count -> __samples << [id:"edge:"+name,label:"edge",name:String.valueOf(name),count:count] }\n  return [[checkedCount:__checked,issueCount:0,samples:__samples]]`;
  } else {
    throw new Error(`规则 ${rule.kind} 使用客户端分批执行`);
  }
  return { query: traversal(context, body), bindings };
}

export function buildQualityIssueBatchScript(rule: QualityRule, context: QualityScriptContext, offset: number, batchSize: number): QualityScript {
  const bindings: Record<string, unknown> = { ...baseBindings(context), qualityOffset: offset, qualityBatchSize: batchSize };
  let issues: string;
  let projection = `.range(qualityOffset, qualityOffset + qualityBatchSize).map{ element -> [id:element.get().id(),label:element.get().label(),values:__qualityValues(element.get())] }.toList()`;
  if (rule.kind === "isolated-vertex") {
    Object.assign(bindings, { qualityVertexLabels:rule.vertexLabels ?? [], qualityIgnoredEdgeLabels:rule.ignoredEdgeLabels ?? [] });
    const base = scope(context, `__qualityG.V()${rule.vertexLabels?.length ? ".filter{ qualityVertexLabels.contains(it.get().label()) }" : ""}`);
    issues = `${base}.filter{ v -> def edges=v.get().edges(Direction.BOTH); try { while(edges.hasNext()){ def e=edges.next(); if(!qualityIgnoredEdgeLabels.contains(e.label())) return false }; return true } finally { try{edges.close()}catch(ignored){} } }`;
  } else if (rule.kind === "required-property") {
    Object.assign(bindings, { qualityVertexLabel:rule.vertexLabel ?? "", qualityPropertyKeys:rule.propertyKeys ?? [] });
    const base = scope(context, `__qualityG.V().hasLabel(qualityVertexLabel)`);
    issues = `${base}.filter{ v -> qualityPropertyKeys.any{ k -> def it=v.get().properties(k); try{return !it.hasNext()}finally{try{it.close()}catch(ignored){}} } }`;
    projection = `.range(qualityOffset, qualityOffset + qualityBatchSize).map{ v -> def vertex=v.get(); def missing=qualityPropertyKeys.findAll{ k -> def it=vertex.properties(k); try{return !it.hasNext()}finally{try{it.close()}catch(ignored){}} }; [id:vertex.id(),label:vertex.label(),missing:missing.join(", "),values:__qualityValues(vertex)] }.toList()`;
  } else if (rule.kind === "property-domain") {
    Object.assign(bindings, { qualityVertexLabel:rule.vertexLabel ?? "", qualityPropertyKey:rule.propertyKey ?? "", qualityAllowedValues:rule.allowedValues ?? [], qualityMinimum:rule.minimum ?? Number.MIN_SAFE_INTEGER, qualityMaximum:rule.maximum ?? Number.MAX_SAFE_INTEGER });
    const base = scope(context, `__qualityG.V().hasLabel(qualityVertexLabel)`);
    const invalid = rule.constraint === "number-range"
      ? `if(p==null || !(p.value() instanceof Number)) return true; def n=((Number)p.value()).doubleValue(); return n<qualityMinimum || n>qualityMaximum`
      : rule.constraint === "enum" ? `return p==null || !qualityAllowedValues.contains(String.valueOf(p.value()))` : `return p==null || String.valueOf(p.value()).trim().isEmpty()`;
    issues = `${base}.filter{ v -> def it=v.get().properties(qualityPropertyKey); def p=null; try{p=it.hasNext()?it.next():null}finally{try{it.close()}catch(ignored){}}; ${invalid} }`;
  } else if (rule.kind === "edge-endpoint") {
    Object.assign(bindings, { qualityEdgeLabel:rule.edgeLabel ?? "", qualityOutLabels:rule.outVertexLabels ?? [], qualityInLabels:rule.inVertexLabels ?? [] });
    const base = scope(context, `__qualityG.E().hasLabel(qualityEdgeLabel)`);
    issues = `${base}.filter{ e -> def edge=e.get(); !qualityOutLabels.contains(edge.outVertex().label()) || !qualityInLabels.contains(edge.inVertex().label()) }`;
    projection = `.range(qualityOffset, qualityOffset + qualityBatchSize).map{ e -> def edge=e.get(); [id:edge.id(),label:edge.label(),outLabel:edge.outVertex().label(),inLabel:edge.inVertex().label(),values:__qualityValues(edge)] }.toList()`;
  } else if (rule.kind === "degree-range") {
    Object.assign(bindings, { qualityVertexLabel:rule.vertexLabel ?? "", qualityEdgeLabel:rule.edgeLabel ?? "", qualityMinDegree:rule.minDegree ?? 0, qualityMaxDegree:rule.maxDegree ?? Number.MAX_SAFE_INTEGER });
    const base = scope(context, `__qualityG.V().hasLabel(qualityVertexLabel)`);
    const direction = rule.direction === "in" ? "IN" : rule.direction === "out" ? "OUT" : "BOTH";
    const edgeArgs = rule.edgeLabel ? `Direction.${direction},qualityEdgeLabel` : `Direction.${direction}`;
    issues = `${base}.filter{ v -> def it=v.get().edges(${edgeArgs}); long degree=0; try{while(it.hasNext()){it.next();degree++}}finally{try{it.close()}catch(ignored){}}; degree<qualityMinDegree || degree>qualityMaxDegree }`;
  } else {
    throw new Error(`规则 ${rule.kind} 不使用问题分页脚本`);
  }
  return { query: traversal(context, `  def __rows=${issues}${projection}\n  return [[samples:__rows]]`), bindings };
}

export function buildDuplicateBatchScript(rule: QualityRule, context: QualityScriptContext, offset: number, batchSize: number): QualityScript {
  const bindings = { ...baseBindings(context), qualityVertexLabel:rule.vertexLabel ?? "", qualityPropertyKeys:rule.propertyKeys ?? [], qualityOffset: offset, qualityBatchSize: batchSize };
  const source = context.mode === "bounded" ? "__qualityG.V().limit(qualityScanLimit).hasLabel(qualityVertexLabel)" : "__qualityG.V().hasLabel(qualityVertexLabel)";
  const body = `  def __rows = ${source}.range(qualityOffset, qualityOffset + qualityBatchSize).project("id","label","values").by(T.id).by(T.label).by(__.valueMap(qualityPropertyKeys as String[])).toList()\n  return [[checkedCount:__rows.size(),issueCount:0,samples:__rows]]`;
  return { query: traversal(context, body), bindings };
}
