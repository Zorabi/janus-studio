import type { DiagnosticFinding, DiagnosticReport } from "@janusgraph/domain";
import { DIAGNOSTIC_GUIDANCE } from "@janusgraph/application";
import { AlertOctagon, CheckCircle2, ChevronRight, FileSearch, Lightbulb, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useTranslate } from "../../lib/i18n";

function FindingIcon({ finding }: { finding: DiagnosticFinding }) {
  return finding.severity === "critical"
    ? <AlertOctagon size={21} />
    : finding.severity === "warning"
      ? <ShieldAlert size={21} />
      : <Lightbulb size={21} />;
}

export function DiagnosticReportPanel({ report, sourceName }: { report: DiagnosticReport; sourceName?: string }) {
  const t = useTranslate();
  const [expanded, setExpanded] = useState(report.findings[0]?.code ?? "");
  const confidence = (value: DiagnosticFinding["confidence"]) => value === "confirmed"
    ? t("已确认", "Confirmed")
    : value === "likely" ? t("很可能", "Likely") : t("提示", "Hint");
  return (
    <section className="diagnostic-report" aria-label={t("自动诊断报告", "Automated diagnostic report")}>
      <header>
        <span className="diagnostic-report-mark"><FileSearch size={24} /></span>
        <div>
          <span className="eyebrow">EVIDENCE-BASED ANALYSIS</span>
          <h2>{sourceName ? t("离线诊断结果", "Offline diagnostic result") : t("自动诊断结果", "Automated diagnostic result")}</h2>
          <p>{sourceName
            ? `${sourceName} · ${report.signalsScanned} ${t("个信号", "signals")}`
            : `${t("已扫描", "Scanned")} ${report.signalsScanned} ${t("个任务、日志与故障信号", "task, log and incident signals")}`}</p>
        </div>
        <strong className={report.findings.length > 0 ? "has-findings" : "is-clear"}>{report.findings.length}</strong>
      </header>
      {report.findings.length === 0 ? (
        <div className="diagnostic-no-findings">
          <CheckCircle2 size={22} />
          <div><strong>{t("未识别到已知故障模式", "No known failure pattern identified")}</strong><p>{t("这不表示系统没有问题。请展开高级选项检查原始证据，或将诊断包交给开发和运维进一步分析。", "This does not mean nothing is wrong. Review raw evidence in advanced options or share the bundle for deeper analysis.")}</p></div>
        </div>
      ) : (
        <div className="diagnostic-findings">
          {report.findings.map((finding) => {
            const guidance = DIAGNOSTIC_GUIDANCE[finding.code];
            const open = expanded === finding.code;
            return <article className={`diagnostic-finding is-${finding.severity} ${open ? "is-open" : ""}`} key={finding.code}>
              <button type="button" onClick={() => setExpanded(open ? "" : finding.code)} aria-expanded={open}>
                <span className="diagnostic-finding-icon"><FindingIcon finding={finding} /></span>
                <span><strong>{t(guidance.titleZh, guidance.titleEn)}</strong><small>{t(guidance.causeZh, guidance.causeEn)}</small></span>
                <em>{confidence(finding.confidence)}</em>
                <ChevronRight size={17} />
              </button>
              {open && <div className="diagnostic-finding-detail">
                <section><span>{t("建议操作", "Recommended actions")}</span><ol>{guidance.actionsZh.map((action, index) => <li key={action}>{t(action, guidance.actionsEn[index])}</li>)}</ol></section>
                <section><span>{t("匹配证据", "Matched evidence")}</span><div className="diagnostic-evidence-list">{finding.evidence.map((evidence, index) => <blockquote key={`${evidence.source}:${index}`}><code>{evidence.source}</code><p>{evidence.excerpt}</p></blockquote>)}</div></section>
              </div>}
            </article>;
          })}
        </div>
      )}
      <footer>{t("规则分析仅提供排查方向；执行强制关闭、Drop 或集群配置变更前仍需人工确认。", "Rules provide troubleshooting direction only; confirm manually before forced shutdown, drop or cluster configuration changes.")}</footer>
    </section>
  );
}
