import {
  Activity,
  Gauge,
  ListTree,
  Timer,
  Workflow,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslate } from "../../lib/i18n";
import type { TraversalDiagnostics } from "../../lib/traversal-diagnostics";

function formatDuration(value: number | undefined) {
  if (value === undefined) return "—";
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} s`;
  if (value >= 10) return `${value.toFixed(1)} ms`;
  return `${value.toFixed(3)} ms`;
}

function formatCount(value: number | undefined) {
  return value === undefined ? "—" : value.toLocaleString();
}

function shortStepName(name: string) {
  return name.replace(/^(?:org\.apache\.tinkerpop\.[\w.]+\.)/, "");
}

export function TraversalDiagnosticsPanel({ diagnostic }: { diagnostic: TraversalDiagnostics }) {
  const t = useTranslate();
  const bottlenecks = useMemo(() => diagnostic.steps
    .filter((step) => step.durationMs !== undefined)
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 3), [diagnostic.steps]);
  const measuredStepCount = diagnostic.steps.filter((step) => step.durationMs !== undefined).length;
  const isProfile = diagnostic.kind === "profile";

  return (
    <section className="traversal-diagnostics" aria-label={t("遍历诊断", "Traversal diagnostics")}>
      <header className="traversal-diagnostics-header">
        <div className="traversal-diagnostics-mark" aria-hidden="true">
          {isProfile ? <Activity size={19} /> : <Workflow size={19} />}
        </div>
        <div>
          <span className="eyebrow">{isProfile ? "PROFILE ANALYSIS" : "EXPLAIN ANALYSIS"}</span>
          <strong>{isProfile ? t("遍历性能诊断", "Traversal performance") : t("遍历策略诊断", "Traversal strategy plan")}</strong>
        </div>
        <span className="traversal-diagnostics-source">
          {diagnostic.source === "object" ? t("结构化响应", "Structured response") : t("文本解析", "Parsed text")}
        </span>
      </header>

      <div className="traversal-diagnostics-summary">
        <article>
          <Timer size={16} aria-hidden="true" />
          <span>{t("总耗时", "Total time")}</span>
          <strong>{formatDuration(diagnostic.totalDurationMs)}</strong>
        </article>
        <article>
          <ListTree size={16} aria-hidden="true" />
          <span>{t("遍历步骤", "Traversal steps")}</span>
          <strong>{diagnostic.steps.length.toLocaleString()}</strong>
        </article>
        <article>
          <Gauge size={16} aria-hidden="true" />
          <span>{isProfile ? t("已测量步骤", "Measured steps") : t("已应用策略", "Applied strategies")}</span>
          <strong>{(isProfile ? measuredStepCount : diagnostic.strategies.length).toLocaleString()}</strong>
        </article>
      </div>

      {isProfile && bottlenecks.length > 0 && (
        <section className="traversal-bottlenecks">
          <div className="traversal-diagnostics-section-title">
            <Zap size={15} aria-hidden="true" />
            <strong>{t("瓶颈排行", "Bottleneck ranking")}</strong>
            <small>{t("按步骤耗时从高到低", "Steps ranked by elapsed time")}</small>
          </div>
          <div className="traversal-bottleneck-grid">
            {bottlenecks.map((step, index) => (
              <article key={`${step.name}-${index}`}>
                <span className="traversal-bottleneck-rank">0{index + 1}</span>
                <div title={step.name}>
                  <strong>{shortStepName(step.name)}</strong>
                  <span>{formatDuration(step.durationMs)}</span>
                </div>
                <em>{step.percent === undefined ? "—" : `${step.percent.toFixed(1)}%`}</em>
              </article>
            ))}
          </div>
        </section>
      )}

      {!isProfile && diagnostic.strategies.length > 0 && (
        <section className="traversal-strategies">
          <div className="traversal-diagnostics-section-title">
            <Workflow size={15} aria-hidden="true" />
            <strong>{t("策略摘要", "Strategy summary")}</strong>
            <small>{t("按优化计划应用顺序展示", "Shown in optimization order")}</small>
          </div>
          <div className="traversal-strategy-list">
            {diagnostic.strategies.map((strategy, index) => (
              <article key={`${strategy.name}-${index}`} title={strategy.traversal}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{strategy.name}</strong>
                {strategy.category && <em>{strategy.category}</em>}
              </article>
            ))}
          </div>
        </section>
      )}

      {diagnostic.steps.length > 0 && (
        <section className="traversal-step-section">
          <div className="traversal-diagnostics-section-title">
            <ListTree size={15} aria-hidden="true" />
            <strong>{t("步骤明细", "Step details")}</strong>
          </div>
          <div className="traversal-step-table-wrap">
            <table className="traversal-step-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("步骤", "Step")}</th>
                  {isProfile && <th>{t("元素", "Elements")}</th>}
                  {isProfile && <th>{t("遍历器", "Traversers")}</th>}
                  {isProfile && <th>{t("耗时", "Duration")}</th>}
                  {isProfile && <th>{t("占比", "Share")}</th>}
                </tr>
              </thead>
              <tbody>
                {diagnostic.steps.map((step, index) => (
                  <tr key={`${step.name}-${index}`}>
                    <td>{String(index + 1).padStart(2, "0")}</td>
                    <td title={step.name}><code>{shortStepName(step.name)}</code></td>
                    {isProfile && <td>{formatCount(step.count)}</td>}
                    {isProfile && <td>{formatCount(step.traversers)}</td>}
                    {isProfile && <td>{formatDuration(step.durationMs)}</td>}
                    {isProfile && (
                      <td>
                        <div className="traversal-step-share">
                          <span><i style={{ width: `${Math.min(100, Math.max(0, step.percent ?? 0))}%` }} /></span>
                          <em>{step.percent === undefined ? "—" : `${step.percent.toFixed(1)}%`}</em>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
