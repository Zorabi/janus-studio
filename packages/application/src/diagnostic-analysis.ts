import type {
  DiagnosticFinding,
  DiagnosticFindingCode,
  DiagnosticPreviewSnapshot,
  DiagnosticReport,
} from "@janusgraph/domain";

export type DiagnosticDocument = { source: string; content: string };

export type DiagnosticGuidance = {
  titleZh: string;
  titleEn: string;
  causeZh: string;
  causeEn: string;
  actionsZh: string[];
  actionsEn: string[];
};

export const DIAGNOSTIC_GUIDANCE: Record<DiagnosticFindingCode, DiagnosticGuidance> = {
  "instance-id-conflict": {
    titleZh: "JanusGraph 实例 ID 冲突", titleEn: "JanusGraph instance ID conflict",
    causeZh: "同一图仍保留相同实例 ID 的活动或残留注册。", causeEn: "The graph still has an active or stale registration with the same instance ID.",
    actionsZh: ["确认旧节点或进程已经停止。", "在动态图实例列表中核对并强制移除确认失效的其他实例。", "检查 graph.replace-instance-if-exists 与唯一实例 ID 配置。"],
    actionsEn: ["Confirm the old node or process has stopped.", "Inspect dynamic graph sessions and remove only confirmed stale instances.", "Review graph.replace-instance-if-exists and instance ID uniqueness."],
  },
  "graphson-serialization": {
    titleZh: "服务端对象无法通过 GraphSON 序列化", titleEn: "Server object cannot be serialized through GraphSON",
    causeZh: "查询返回了 Management、SchemaStatus 或驱动内部对象，而不是字符串、Map 等可传输结果。", causeEn: "The query returned a Management, SchemaStatus or driver-internal object rather than a transport-safe string or map.",
    actionsZh: ["将服务端对象转换为 toString()、名称或基础 Map 后再返回。", "Management 对象仅在 Sessioned 会话中绑定使用，不直接作为最后返回值。", "对状态枚举返回 name()。"],
    actionsEn: ["Return toString(), names or a primitive map instead of the server object.", "Bind Management objects only in a sessioned console and do not return them directly.", "Return name() for status enums."],
  },
  "evaluation-timeout": {
    titleZh: "Gremlin 服务端执行超时", titleEn: "Gremlin server evaluation timeout",
    causeZh: "请求超过 Gremlin Server evaluationTimeout，或被服务端主动取消。", causeEn: "The request exceeded Gremlin Server evaluationTimeout or was cancelled server-side.",
    actionsZh: ["先确认查询是否缺少 limit、索引或过滤条件。", "长任务使用标签页临时超时或迁移专用长超时。", "服务端 evaluationTimeout 必须不小于客户端超时。"],
    actionsEn: ["Check for missing limits, indexes or filters first.", "Use a tab override or transfer-specific long timeout for long jobs.", "Keep server evaluationTimeout at least as large as the client timeout."],
  },
  "elasticsearch-shard-limit": {
    titleZh: "Elasticsearch 分片上限阻止索引操作", titleEn: "Elasticsearch shard limit blocked an index operation",
    causeZh: "新建或重建 Mixed Index 需要更多分片，但集群已达到分片安全上限。", causeEn: "A new or rebuilt mixed index needs more shards, but the cluster reached its shard safety limit.",
    actionsZh: ["清理无用索引或关闭不需要的索引。", "核对模板中的主分片与副本数量。", "确认资源足够后再调整 cluster.max_shards_per_node。"],
    actionsEn: ["Remove unused indexes or close indexes no longer needed.", "Review primary and replica counts in index templates.", "Raise cluster.max_shards_per_node only after capacity review."],
  },
  "schema-name-conflict": {
    titleZh: "Schema 名称冲突", titleEn: "Schema name conflict",
    causeZh: "同名 Schema 已被先前批次创建，或当前定义与导入定义不一致。", causeEn: "A prior batch created the same schema name, or the existing definition differs from the import.",
    actionsZh: ["重新读取当前 Schema 并生成新导入计划。", "一致定义选择跳过；不一致定义必须人工审阅。", "不要从批次 1 盲目重试已部分提交的导入。"],
    actionsEn: ["Reload the current schema and generate a fresh import plan.", "Skip identical definitions and manually review differences.", "Do not blindly retry partially committed imports from batch one."],
  },
  "index-lifecycle": {
    titleZh: "索引生命周期或 API 版本不匹配", titleEn: "Index lifecycle or API version mismatch",
    causeZh: "索引状态查询使用了当前 JanusGraph 版本不支持的签名，或索引仍停留在 REGISTERED/REINDEX。", causeEn: "Index status used an unsupported signature, or the index remains in REGISTERED/REINDEX.",
    actionsZh: ["使用服务端能力探测选择对应 JanusGraph 版本脚本。", "按 REGISTER_INDEX、REINDEX、ENABLED 顺序推进并等待状态。", "不要返回 SchemaStatus 对象本体。"],
    actionsEn: ["Use capability detection to select the correct JanusGraph script.", "Advance REGISTER_INDEX, REINDEX and ENABLED in order and await each state.", "Do not return raw SchemaStatus objects."],
  },
  "configured-graph-factory": {
    titleZh: "ConfiguredGraphFactory 配置或注册残留", titleEn: "ConfiguredGraphFactory configuration or registration residue",
    causeZh: "动态图配置仍被注册、ConfigurationManagementGraph 不可用，或 Drop 后校验未完成。", causeEn: "The dynamic graph remains registered, ConfigurationManagementGraph is unavailable, or drop verification did not complete.",
    actionsZh: ["刷新动态图及实例会话状态。", "Drop 前确认当前节点已加载图并清理失效实例。", "校验配置记录、绑定和后端数据均按预期移除。"],
    actionsEn: ["Refresh dynamic graph and instance session state.", "Before drop, load the graph on the current node and remove confirmed stale instances.", "Verify configuration, bindings and backend data were removed as intended."],
  },
  "capability-probe": {
    titleZh: "服务端能力探测脚本失败", titleEn: "Server capability probe script failed",
    causeZh: "Groovy 语法、类路径或服务器安全策略阻止了只读能力探测。", causeEn: "Groovy syntax, classpath or server security policy blocked the read-only capability probe.",
    actionsZh: ["查看完整服务端编译错误与失败行号。", "确认 JanusGraph/TinkerPop 版本和官方类是否存在。", "修复探测脚本后重新探测，不把 unknown 当作 unsupported。"],
    actionsEn: ["Inspect the full server compile error and line number.", "Confirm JanusGraph/TinkerPop versions and official class availability.", "Retry after fixing the probe and do not treat unknown as unsupported."],
  },
};

type Rule = {
  code: DiagnosticFindingCode;
  severity: DiagnosticFinding["severity"];
  confidence: DiagnosticFinding["confidence"];
  patterns: RegExp[];
};

const RULES: Rule[] = [
  { code: "instance-id-conflict", severity: "critical", confidence: "confirmed", patterns: [/same instance id[^\n]*already open/i, /might required forced shutdown/i] },
  { code: "elasticsearch-shard-limit", severity: "critical", confidence: "confirmed", patterns: [/maximum normal shards open/i, /this action would add[^\n]*shards/i, /cluster\.max_shards_per_node/i] },
  { code: "graphson-serialization", severity: "warning", confidence: "likely", patterns: [/error during serialization/i, /could not find a type identifier/i, /defaultprotocolversion/i] },
  { code: "evaluation-timeout", severity: "warning", confidence: "likely", patterns: [/evaluationtimeout/i, /evaluation exceeded[^\n]*threshold/i, /request timed out/i] },
  { code: "schema-name-conflict", severity: "warning", confidence: "likely", patterns: [/uniqueness constraint[^\n]*schemaname/i, /duplicate schema/i, /schema[^\n]*already exists/i] },
  { code: "index-lifecycle", severity: "warning", confidence: "likely", patterns: [/getindexstatus\(\)[^\n]*not applicable/i, /awaitgraphindexstatus/i, /index[^\n]*(?:registered|reindex|enabled)/i] },
  { code: "configured-graph-factory", severity: "warning", confidence: "likely", patterns: [/drop_verification_failed/i, /dynamic graph is still registered/i, /configurationmanagementgraph/i, /configuredgraphfactory[^\n]*(?:unavailable|not support|failed)/i] },
  { code: "capability-probe", severity: "warning", confidence: "likely", patterns: [/startup failed[^\n]*script/i, /token recognition error/i, /capability[^\n]*(?:probe|detection)[^\n]*(?:failed|unavailable)/i] },
];

function excerptAround(content: string, pattern: RegExp): string | null {
  const match = pattern.exec(content);
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, content.lastIndexOf("\n", match.index - 1) + 1);
  const nextLine = content.indexOf("\n", match.index + match[0].length);
  const end = Math.min(content.length, nextLine < 0 ? match.index + 260 : nextLine);
  return content.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 280);
}

export function analyzeDiagnosticDocuments(
  documents: DiagnosticDocument[],
  generatedAt = new Date().toISOString(),
): DiagnosticReport {
  const findings = RULES.flatMap((rule): DiagnosticFinding[] => {
    const evidence: DiagnosticFinding["evidence"] = [];
    for (const document of documents) {
      for (const pattern of rule.patterns) {
        const excerpt = excerptAround(document.content, pattern);
        if (excerpt && !evidence.some((item) => item.excerpt === excerpt)) {
          evidence.push({ source: document.source, excerpt });
        }
        if (evidence.length >= 3) break;
      }
      if (evidence.length >= 3) break;
    }
    return evidence.length > 0 ? [{ ...rule, evidence }] : [];
  });
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  findings.sort((left, right) => rank[left.severity] - rank[right.severity]);
  return { generatedAt, signalsScanned: documents.length, findings };
}

export function analyzeDiagnosticSnapshot(snapshot: DiagnosticPreviewSnapshot): DiagnosticReport {
  const documents: DiagnosticDocument[] = [];
  if (snapshot.incident) documents.push({ source: "incident", content: JSON.stringify(snapshot.incident) });
  for (const task of snapshot.tasks) documents.push({ source: `task:${task.id}`, content: JSON.stringify(task) });
  for (const log of snapshot.logs) documents.push({ source: `log:${log.source}:${log.event}`, content: JSON.stringify(log) });
  return analyzeDiagnosticDocuments(documents, snapshot.generatedAt);
}

export function diagnosticReportMarkdown(report: DiagnosticReport): string {
  const lines = [
    "# Janus Studio 自动诊断报告 / Automated Diagnostic Report",
    "",
    `- 生成时间 / Generated: ${report.generatedAt}`,
    `- 扫描信号 / Signals scanned: ${report.signalsScanned}`,
    `- 发现问题 / Findings: ${report.findings.length}`,
    "",
    "> 本报告由确定性规则匹配生成。置信度表示证据强度，不替代服务端日志和人工复核。",
    "> This report is generated by deterministic rules. Confidence indicates evidence strength and does not replace server logs or human review.",
  ];
  if (report.findings.length === 0) {
    lines.push("", "## 未识别已知模式 / No known pattern identified", "", "请结合 summary.json、tasks.json 与 logs.ndjson 人工检查。", "Review summary.json, tasks.json and logs.ndjson manually.");
  }
  report.findings.forEach((finding, index) => {
    const guidance = DIAGNOSTIC_GUIDANCE[finding.code];
    lines.push("", `## ${index + 1}. ${guidance.titleZh} / ${guidance.titleEn}`, "", `- 严重度 / Severity: ${finding.severity}`, `- 置信度 / Confidence: ${finding.confidence}`, "", `${guidance.causeZh} ${guidance.causeEn}`, "", "### 建议 / Recommended actions");
    guidance.actionsZh.forEach((action, actionIndex) => lines.push(`${actionIndex + 1}. ${action} / ${guidance.actionsEn[actionIndex]}`));
    lines.push("", "### 证据 / Evidence");
    finding.evidence.forEach((evidence) => lines.push(`- \`${evidence.source}\`: ${evidence.excerpt}`));
  });
  return `${lines.join("\n")}\n`;
}
