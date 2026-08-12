import type {
  CompatibilityCapability,
  CompatibilityCapabilityState,
  CompatibilityProfile,
  ConnectionSummary,
} from "@janusgraph/domain";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Cpu,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";

const capabilityOrder: CompatibilityCapability[] = [
  "configuredGraphFactory",
  "configurationManagementGraph",
  "janusGraphManager",
  "managementApi",
  "jsonSchemaInitialization",
  "graphsonIo",
  "indexFieldStatus",
  "indexStatusAwait",
  "traversalExplain",
  "traversalProfile",
  "sessionedClient",
  "serverCancellation",
  "requestTimeout",
];

function CapabilityIcon({ state }: { state: CompatibilityCapabilityState }) {
  if (state === "supported") return <CheckCircle2 size={16} />;
  if (state === "unsupported") return <XCircle size={16} />;
  return <CircleHelp size={16} />;
}

function DetectingValue({ label }: { label: string }) {
  return (
    <strong className="compatibility-detecting" role="status">
      <LoaderCircle className="spin" size={15} />
      {label}
    </strong>
  );
}

export function CompatibilityDialog({
  connection,
  onClose,
}: {
  connection: ConnectionSummary;
  onClose: () => void;
}) {
  const t = useTranslate();
  const [profile, setProfile] = useState<CompatibilityProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const detect = async (refresh = false) => {
    if (!window.janusGraphDesktop) return;
    setLoading(true);
    setMessage("");
    try {
      setProfile(await window.janusGraphDesktop.compatibility.get(connection.id, refresh));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void detect();
  }, [connection.id, connection.updatedAt]);

  const labels: Record<CompatibilityCapability, [string, string]> = {
    configuredGraphFactory: ["ConfiguredGraphFactory", "ConfiguredGraphFactory"],
    configurationManagementGraph: ["配置管理图", "Configuration Management Graph"],
    janusGraphManager: ["JanusGraph Manager", "JanusGraph Manager"],
    managementApi: ["Schema Management API", "Schema Management API"],
    jsonSchemaInitialization: ["官方 JSON Schema 初始化", "Official JSON Schema Initialization"],
    graphsonIo: ["GraphSON 整图 IO", "GraphSON Graph IO"],
    indexFieldStatus: ["索引字段状态", "Index Field Status"],
    indexStatusAwait: ["索引状态等待", "Index Status Await"],
    traversalExplain: ["Explain 遍历诊断", "Explain Traversal Diagnostics"],
    traversalProfile: ["Profile 遍历诊断", "Profile Traversal Diagnostics"],
    sessionedClient: ["Sessioned Client", "Sessioned Client"],
    serverCancellation: ["服务端会话中断", "Server Session Cancellation"],
    requestTimeout: ["请求级超时", "Request-level Timeout"],
  };
  const detectingLabel = t("探测中", "Detecting");

  return (
    <Modal
      title={t("服务器兼容能力", "Server Compatibility")}
      eyebrow="COMPATIBILITY PROFILE"
      onClose={onClose}
      width="wide"
    >
      <div className="compatibility-dialog" aria-busy={loading}>
        <header>
          <div className="compatibility-server-mark"><Cpu size={22} /></div>
          <div>
            <strong>{connection.name}</strong>
            <span>{connection.protocol.toUpperCase()} · {connection.clientMode.toUpperCase()}</span>
          </div>
          <button type="button" className="button secondary" disabled={loading} onClick={() => void detect(true)}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            {t("重新探测", "Detect again")}
          </button>
        </header>

        {message ? (
          <div className="inline-message error"><AlertTriangle size={17} /><span>{message}</span></div>
        ) : (loading || profile) && (
          <>
            <section className={`compatibility-versions${loading ? " is-loading" : ""}`}>
              <div>
                <span>JanusGraph</span>
                {loading ? <DetectingValue label={detectingLabel} /> : <strong>{profile?.janusGraphVersion}</strong>}
              </div>
              <div>
                <span>Apache TinkerPop</span>
                {loading ? <DetectingValue label={detectingLabel} /> : <strong>{profile?.tinkerPopVersion}</strong>}
              </div>
              <div>
                <span>{t("探测状态", "Detection status")}</span>
                {loading ? (
                  <DetectingValue label={detectingLabel} />
                ) : profile && (
                  <strong className={`is-${profile.status}`}>{profile.status === "ready" ? t("完整", "Complete") : profile.status === "partial" ? t("部分", "Partial") : t("不可用", "Unavailable")}</strong>
                )}
              </div>
            </section>
            {!loading && profile?.status === "unavailable" && (
              <div className="compatibility-warning">
                <AlertTriangle size={18} />
                <div><strong>{t("服务端能力探测不可用", "Server capability probe unavailable")}</strong><p>{profile.message}</p></div>
              </div>
            )}
            <section className={`compatibility-capabilities${loading ? " is-loading" : ""}`}>
              {capabilityOrder.map((capability) => {
                const state = profile?.capabilities[capability] ?? "unknown";
                return (
                  <div className={`compatibility-capability ${loading ? "is-loading" : `is-${state}`}`} key={capability}>
                    {loading ? <LoaderCircle className="spin" size={16} /> : <CapabilityIcon state={state} />}
                    <span>{t(...labels[capability])}</span>
                    <small>{loading ? detectingLabel : state === "supported" ? t("支持", "Supported") : state === "unsupported" ? t("不支持", "Unsupported") : t("未知", "Unknown")}</small>
                  </div>
                );
              })}
            </section>
            <footer>
              <span>{t("探测时间", "Detected at")}</span>
              {loading ? (
                <span className="compatibility-footer-loading"><LoaderCircle className="spin" size={13} />{detectingLabel}</span>
              ) : profile && (
                <time>{new Date(profile.detectedAt).toLocaleString()}</time>
              )}
              <p>{t(
                "能力探测只读取服务端类与版本，不会打开、修改或删除业务图。",
                "Capability detection only reads server classes and versions; it does not open, modify, or delete business graphs.",
              )}</p>
            </footer>
          </>
        )}
      </div>
    </Modal>
  );
}
