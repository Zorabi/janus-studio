import type { ConnectionTestReport, ConnectionTestStage } from "@janusgraph/domain";
import {
  CheckCircle2,
  CircleMinus,
  Database,
  KeyRound,
  LoaderCircle,
  Network,
  Route,
  ShieldCheck,
  TerminalSquare,
  Unplug,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslate } from "../../lib/i18n";

const STAGES: ConnectionTestStage[] = ["dns", "tcp", "proxy", "tls", "authentication", "gremlin", "schema"];

function stageIcon(stage: ConnectionTestStage): ReactNode {
  if (stage === "dns") return <Network size={16} />;
  if (stage === "proxy") return <Route size={16} />;
  if (stage === "tcp") return <Unplug size={16} />;
  if (stage === "tls") return <ShieldCheck size={16} />;
  if (stage === "authentication") return <KeyRound size={16} />;
  if (stage === "gremlin") return <TerminalSquare size={16} />;
  return <Database size={16} />;
}

export function ConnectionTestStages({ report, loading = false }: { report?: ConnectionTestReport | null; loading?: boolean }) {
  const t = useTranslate();
  const labels: Record<ConnectionTestStage, string> = {
    dns: "DNS",
    proxy: t("代理", "Proxy"),
    tcp: "TCP",
    tls: "TLS",
    authentication: t("认证", "Authentication"),
    gremlin: "Gremlin",
    schema: t("Schema 权限", "Schema access"),
  };
  const byStage = new Map(report?.stages.map((result) => [result.stage, result]));

  return (
    <div className={`connection-test-stages ${loading ? "is-loading" : ""}`} aria-live="polite">
      {STAGES.map((stage) => {
        const result = byStage.get(stage);
        const status = loading ? "loading" : result?.status ?? "pending";
        return (
          <div className={`connection-test-stage is-${status}`} key={stage}>
            <span className="connection-test-stage-icon">{stageIcon(stage)}</span>
            <span>
              <strong>{labels[stage]}</strong>
              <small>{loading ? t("正在探测", "Probing") : result?.message ?? t("等待测试", "Awaiting test")}</small>
            </span>
            <span className="connection-test-stage-status" aria-label={status}>
              {status === "loading" ? <LoaderCircle className="spin" size={16} /> : status === "passed" ? <CheckCircle2 size={16} /> : status === "failed" ? <XCircle size={16} /> : <CircleMinus size={16} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}
