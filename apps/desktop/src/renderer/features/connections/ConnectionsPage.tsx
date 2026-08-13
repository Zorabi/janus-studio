import { connectionEndpoint } from "@janusgraph/application";
import type { ConnectionSummary, ConnectionTestReport, DiagnosticIncidentContext } from "@janusgraph/domain";
import {
  Activity,
  AlertTriangle,
  Check,
  Cpu,
  Database,
  Edit3,
  Stethoscope,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { EmptyState, IconButton, PageHeader } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import { CompatibilityDialog } from "./CompatibilityDialog";

export interface ConnectionsPageProps {
  connections: ConnectionSummary[];
  activeConnectionId: string;
  onActivate: (id: string) => void;
  onAdd: () => void;
  onEdit: (connection: ConnectionSummary) => void;
  onDelete: (connection: ConnectionSummary) => void;
  onTest: (connection: ConnectionSummary) => Promise<ConnectionTestReport>;
  onOpenDiagnostics: (incident: DiagnosticIncidentContext) => void;
}

export function ConnectionsPage({
  connections,
  activeConnectionId,
  onActivate,
  onAdd,
  onEdit,
  onDelete,
  onTest,
  onOpenDiagnostics,
}: ConnectionsPageProps) {
  const t = useTranslate();
  const [testingId, setTestingId] = useState("");
  const [testFailures, setTestFailures] = useState<Record<string, ConnectionTestReport>>({});
  const [compatibilityConnection, setCompatibilityConnection] = useState<ConnectionSummary | null>(null);

  return (
    <div className="page-scroll">
      <PageHeader
        eyebrow="CONNECTIONS"
        title={t("连接管理")}
        description={t(
          "管理多个 JanusGraph Server 账号、协议、认证信息和超时设置。密码优先使用系统密钥设施，不可用时自动切换本地加密。",
          "Manage JanusGraph profiles, protocols, credentials and timeouts. Credentials use OS secure storage with an encrypted local fallback.",
        )}
        actions={
          <button type="button" className="button primary" onClick={onAdd}>
            <Plus size={17} />
            {t("添加连接", "Add Connection")}
          </button>
        }
      />
      {connections.length === 0 ? (
        <EmptyState
          icon={<Database size={32} />}
          title={t("还没有连接配置", "No connection profiles yet")}
          description={t(
            "添加 WS、WSS、HTTP 或 HTTPS 连接后即可执行真实查询。",
            "Add a WS, WSS, HTTP or HTTPS profile to run live queries.",
          )}
          action={
            <button type="button" className="button primary" onClick={onAdd}>
              <Plus size={17} />
              {t("添加第一个连接", "Add First Connection")}
            </button>
          }
        />
      ) : (
        <div className="connection-grid">
          {connections.map((connection) => {
            const active = connection.id === activeConnectionId;
            const environmentLabel = connection.environment === "prod"
              ? t("生产", "Production")
              : connection.environment === "test"
                ? t("测试", "Testing")
                : t("开发", "Development");
            return (
              <article
                className={`connection-profile environment-${connection.environment} ${active ? "is-active" : ""}`}
                key={connection.id}
              >
                <header>
                  <div className="connection-symbol">
                    <Server size={21} />
                  </div>
                  <div>
                    <div className="connection-title-line">
                      <h2>{connection.name}</h2>
                      <div className="connection-badges">
                        <span className={`badge environment ${connection.environment}`}>
                          {environmentLabel}
                        </span>
                        {connection.connectionReadOnly && (
                          <span className="badge read-only">
                            <LockKeyhole size={12} />
                            {t("只读", "Read-only")}
                          </span>
                        )}
                        {active && (
                          <span className="badge success">{t("当前连接")}</span>
                        )}
                      </div>
                    </div>
                    <code>{connectionEndpoint(connection)}</code>
                  </div>
                </header>
                <dl className="connection-meta">
                  <div>
                    <dt>{t("协议", "Protocol")}</dt>
                    <dd>{connection.protocol.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>{t("环境", "Environment")}</dt>
                    <dd>{environmentLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("访问模式", "Access mode")}</dt>
                    <dd>
                      {connection.connectionReadOnly
                        ? t("只读保护", "Read-only")
                        : t("允许写入", "Writes allowed")}
                    </dd>
                  </div>
                  <div>
                    <dt>Client</dt>
                    <dd>
                      {connection.clientMode === "sessioned"
                        ? "SESSIONED"
                        : "SESSIONLESS"}
                    </dd>
                  </div>
                  <div>
                    <dt>g Alias</dt>
                    <dd>{connection.traversalSource}</dd>
                  </div>
                  <div>
                    <dt>Management</dt>
                    <dd>{connection.graphBinding}</dd>
                  </div>
                  <div>
                    <dt>{t("账号", "Account")}</dt>
                    <dd>{connection.username || t("匿名", "Anonymous")}</dd>
                  </div>
                  <div>
                    <dt>{t("凭据", "Credential")}</dt>
                    <dd>
                      {connection.hasPassword
                        ? t("已加密保存", "Encrypted")
                        : t("未保存", "Not saved")}
                    </dd>
                  </div>
                </dl>
                <footer>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setCompatibilityConnection(connection)}
                  >
                    <Cpu size={16} />
                    {t("能力", "Capabilities")}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={testingId === connection.id}
                    onClick={async () => {
                      setTestingId(connection.id);
                      try {
                        const report = await onTest(connection);
                        setTestFailures((current) => report.success
                          ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== connection.id))
                          : { ...current, [connection.id]: report });
                      } catch (error) {
                        setTestFailures((current) => ({
                          ...current,
                          [connection.id]: {
                            success: false,
                            latencyMs: 0,
                            endpoint: connectionEndpoint(connection),
                            stage: "network",
                            message: error instanceof Error ? error.message : t("连接测试失败", "Connection test failed"),
                          },
                        }));
                      } finally {
                        setTestingId("");
                      }
                    }}
                  >
                    {testingId === connection.id ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Activity size={16} />
                    )}
                    {t("测试", "Test")}
                  </button>
                  {!active && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => onActivate(connection.id)}
                    >
                      <Check size={16} />
                      {t("设为当前", "Set Active")}
                    </button>
                  )}
                  <IconButton
                    label={`${t("编辑", "Edit")} ${connection.name}`}
                    onClick={() => onEdit(connection)}
                  >
                    <Edit3 size={17} />
                  </IconButton>
                  <IconButton
                    label={`${t("删除")} ${connection.name}`}
                    tone="danger"
                    onClick={() => onDelete(connection)}
                  >
                    <Trash2 size={17} />
                  </IconButton>
                </footer>
                {testFailures[connection.id] && (
                  <div className="connection-test-failure" role="alert">
                    <AlertTriangle size={16} />
                    <span><strong>{t("连接测试失败", "Connection test failed")}</strong><small>{testFailures[connection.id]!.message}</small></span>
                    <button type="button" className="button text" onClick={() => onOpenDiagnostics({
                      source: "connection",
                      title: t("连接测试失败", "Connection test failed"),
                      connectionName: connection.name,
                      stage: testFailures[connection.id]!.stage,
                      message: testFailures[connection.id]!.message,
                      occurredAt: new Date().toISOString(),
                    })}>
                      <Stethoscope size={15} />{t("生成诊断包", "Create diagnostic bundle")}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {compatibilityConnection && (
        <CompatibilityDialog
          key={`${compatibilityConnection.id}:${compatibilityConnection.updatedAt}`}
          connection={compatibilityConnection}
          onClose={() => setCompatibilityConnection(null)}
        />
      )}
    </div>
  );
}
