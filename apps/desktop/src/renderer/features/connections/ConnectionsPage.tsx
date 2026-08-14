import { connectionEndpoint } from "@janusgraph/application";
import type { ConnectionSummary, ConnectionTestReport, DiagnosticIncidentContext } from "@janusgraph/domain";
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Cpu,
  Database,
  Edit3,
  FileDown,
  FileUp,
  Stethoscope,
  LoaderCircle,
  KeyRound,
  Layers3,
  LockKeyhole,
  Plus,
  Search,
  Server,
  Tags,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { SelectControl } from "../../components/SelectControl";
import { EmptyState, IconButton, PageHeader } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import { CompatibilityDialog } from "./CompatibilityDialog";
import { ConnectionTestStages } from "./ConnectionTestStages";
import { AuthenticationProfilesDialog } from "./AuthenticationProfilesDialog";
import { ConnectionWorkspaceImportDialog } from "./ConnectionWorkspaceImportDialog";
import {
  createConnectionWorkspaceArchive,
  parseConnectionWorkspaceArchive,
  planConnectionWorkspaceImport,
  type ConnectionImportPlanRow,
} from "../../lib/connection-workspace";
import { errorMessage } from "../../lib/presentation";

export interface ConnectionsPageProps {
  connections: ConnectionSummary[];
  activeConnectionId: string;
  onActivate: (id: string) => void;
  onAdd: () => void;
  onEdit: (connection: ConnectionSummary) => void;
  onDelete: (connection: ConnectionSummary) => void;
  onTest: (connection: ConnectionSummary, silent?: boolean) => Promise<ConnectionTestReport>;
  onOpenDiagnostics: (incident: DiagnosticIncidentContext) => void;
  onConnectionsChanged: () => void | Promise<void>;
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
  onConnectionsChanged,
}: ConnectionsPageProps) {
  const t = useTranslate();
  const [testingId, setTestingId] = useState("");
  const [testReports, setTestReports] = useState<Record<string, ConnectionTestReport>>({});
  const [compatibilityConnection, setCompatibilityConnection] = useState<ConnectionSummary | null>(null);
  const [showAuthenticationProfiles, setShowAuthenticationProfiles] = useState(false);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState<"import" | "export" | "">("");
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [importReview, setImportReview] = useState<{ sourceName: string; rows: ConnectionImportPlanRow[] } | null>(null);
  const [bulkTesting, setBulkTesting] = useState(false);

  const groups = useMemo(() => [...new Set(connections
    .map((connection) => connection.groupName?.trim() || "")
    .filter(Boolean))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })), [connections]);
  const visibleConnections = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return connections.filter((connection) => {
      if (groupFilter && (connection.groupName ?? "") !== groupFilter) return false;
      if (!needle) return true;
      return [
        connection.name,
        connection.host,
        String(connection.port),
        connection.protocol,
        connection.graphBinding,
        connection.traversalSource,
        connection.groupName ?? "",
        ...(connection.tags ?? []),
      ]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [connections, groupFilter, search]);

  useEffect(() => {
    void Promise.resolve(onConnectionsChanged()).catch(() => undefined);
    return window.janusGraphDesktop?.connections.onSshTunnelChanged(() => {
      void Promise.resolve(onConnectionsChanged()).catch(() => undefined);
    });
  }, [onConnectionsChanged]);

  useEffect(() => {
    if (groupFilter && !groups.includes(groupFilter)) setGroupFilter("");
  }, [groupFilter, groups]);

  const exportWorkspace = async () => {
    setWorkspaceBusy("export");
    setWorkspaceMessage("");
    try {
      const date = new Date();
      const suffix = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
      const path = await window.janusGraphDesktop!.files.saveConnectionArchive({
        suggestedName: `janus-studio-connections-${suffix}.json`,
        content: `${JSON.stringify(createConnectionWorkspaceArchive(connections), null, 2)}\n`,
      });
      if (path) setWorkspaceMessage(t("连接工作区已安全导出，归档不包含任何凭据。", "Connection workspace exported safely without credentials."));
    } catch (error) {
      setWorkspaceMessage(errorMessage(error));
    } finally {
      setWorkspaceBusy("");
    }
  };

  const inspectWorkspace = async () => {
    setWorkspaceBusy("import");
    setWorkspaceMessage("");
    try {
      const picked = await window.janusGraphDesktop!.files.pickConnectionArchive();
      if (!picked) return;
      const archive = parseConnectionWorkspaceArchive(picked.content);
      setImportReview({ sourceName: picked.name, rows: planConnectionWorkspaceImport(archive, connections) });
    } catch (error) {
      setWorkspaceMessage(errorMessage(error));
    } finally {
      setWorkspaceBusy("");
    }
  };

  const runConnectionTest = async (connection: ConnectionSummary, silent = false): Promise<boolean> => {
    setTestingId(connection.id);
    try {
      const report = await onTest(connection, silent);
      setTestReports((current) => ({ ...current, [connection.id]: report }));
      return report.success;
    } catch (error) {
      setTestReports((current) => ({
        ...current,
        [connection.id]: {
          success: false,
          latencyMs: 0,
          endpoint: connectionEndpoint(connection),
          stage: "tcp",
          message: error instanceof Error ? error.message : t("连接测试失败", "Connection test failed"),
          stages: [{
            stage: "tcp",
            status: "failed",
            durationMs: 0,
            message: error instanceof Error ? error.message : t("连接测试失败", "Connection test failed"),
          }],
        },
      }));
      return false;
    } finally {
      setTestingId("");
    }
  };

  const testVisibleConnections = async () => {
    setBulkTesting(true);
    setWorkspaceMessage("");
    let passed = 0;
    try {
      for (const connection of visibleConnections) {
        if (await runConnectionTest(connection, true)) passed += 1;
      }
      await onConnectionsChanged();
      setWorkspaceMessage(`${t("批量探测完成", "Batch diagnostics complete")}：${passed} / ${visibleConnections.length} ${t("通过", "passed")}`);
    } finally {
      setBulkTesting(false);
    }
  };

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
          <>
            <button type="button" className="button secondary" onClick={() => void inspectWorkspace()} disabled={Boolean(workspaceBusy)}>
              {workspaceBusy === "import" ? <LoaderCircle className="spin" size={17} /> : <FileUp size={17} />}{t("导入配置", "Import")}
            </button>
            <button type="button" className="button secondary" onClick={() => void exportWorkspace()} disabled={Boolean(workspaceBusy) || connections.length === 0}>
              {workspaceBusy === "export" ? <LoaderCircle className="spin" size={17} /> : <FileDown size={17} />}{t("导出配置", "Export")}
            </button>
            <button type="button" className="button secondary" onClick={() => setShowAuthenticationProfiles(true)}><KeyRound size={17} />{t("认证方案", "Authentication Profiles")}</button>
            <button type="button" className="button primary" onClick={onAdd}><Plus size={17} />{t("添加连接", "Add Connection")}</button>
          </>
        }
      />
      {workspaceMessage && <div className="connection-workspace-message" role="status">{workspaceMessage}</div>}
      {connections.length > 0 && (
        <section className="connection-organizer" aria-label={t("整理连接", "Organize connections")}>
          <label className="connection-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("搜索名称、地址、分组或标签", "Search name, host, group or tag")}
            />
          </label>
          <SelectControl
            value={groupFilter}
            onValueChange={setGroupFilter}
            ariaLabel={t("按连接分组筛选", "Filter by connection group")}
            className="connection-group-filter"
            options={[
              { value: "", label: t("全部分组", "All groups"), description: `${connections.length} ${t("个连接", "connections")}` },
              ...groups.map((group) => ({
                value: group,
                label: group,
                description: `${connections.filter((connection) => connection.groupName === group).length} ${t("个连接", "connections")}`,
              })),
            ]}
          />
          <button type="button" className="button secondary connection-bulk-test" disabled={bulkTesting || visibleConnections.length === 0} onClick={() => void testVisibleConnections()}>
            {bulkTesting ? <LoaderCircle className="spin" size={16} /> : <Activity size={16} />}
            {t("探测当前结果", "Test visible")}
          </button>
          <span className="connection-result-count">{visibleConnections.length} / {connections.length}</span>
        </section>
      )}
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
      ) : visibleConnections.length === 0 ? (
        <EmptyState
          icon={<Search size={30} />}
          title={t("没有匹配的连接", "No matching connections")}
          description={t("调整搜索词或分组筛选后重试。", "Change the search term or group filter and try again.")}
          action={<button type="button" className="button secondary" onClick={() => { setSearch(""); setGroupFilter(""); }}>{t("清除筛选", "Clear filters")}</button>}
        />
      ) : (
        <div className="connection-grid">
          {visibleConnections.map((connection) => {
            const active = connection.id === activeConnectionId;
            const tunnel = connection.sshTunnel;
            const tunnelTitle = tunnel?.status === "connected"
              ? `${t("本地转发端口", "Local forwarding port")}: ${tunnel.localPort ?? "-"}${tunnel.connectedAt ? ` · ${t("连接时间", "Connected")}: ${new Date(tunnel.connectedAt).toLocaleString()}` : ""}`
              : tunnel?.status === "connecting"
                ? t("正在建立 SSH Tunnel", "Establishing SSH Tunnel")
                : tunnel?.status === "reconnecting"
                  ? t("正在重新建立 SSH Tunnel", "Re-establishing SSH Tunnel")
                  : tunnel?.status === "disconnected"
                    ? tunnel.lastError || t("SSH Tunnel 已断开；下次使用时自动重连", "SSH Tunnel disconnected; it will reconnect on next use")
                    : tunnel?.status === "failed"
                      ? tunnel.lastError || t("SSH Tunnel 建立失败", "SSH Tunnel failed")
                      : t("首次使用时按需建立", "Established on first use");
            const tunnelLabel = tunnel?.status === "connected"
              ? t("SSH 已连接", "SSH connected")
              : tunnel?.status === "connecting"
                ? t("SSH 连接中", "SSH connecting")
                : tunnel?.status === "reconnecting"
                  ? t("SSH 重连中", "SSH reconnecting")
                  : tunnel?.status === "disconnected"
                    ? t("SSH 已断开", "SSH disconnected")
                    : tunnel?.status === "failed"
                      ? t("SSH 失败", "SSH failed")
                      : t("SSH 按需", "SSH on demand");
            const environmentLabel = connection.environment === "prod"
              ? t("生产", "Production")
              : connection.environment === "test"
                ? t("测试", "Testing")
                : t("开发", "Development");
            return (
              <article
                className={`connection-profile environment-${connection.environment} ${active ? "is-active" : ""}`}
                key={connection.id}
                style={{ "--connection-accent": connection.accentColor ?? "#c8ff55" } as CSSProperties}
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
                        {connection.tlsCaPath && (
                          <span className="badge transport">{t("自定义 CA", "Custom CA")}</span>
                        )}
                        {connection.tlsClientCertPath && connection.tlsClientKeyPath && (
                          <span className="badge transport">mTLS</span>
                        )}
                        {connection.proxyMode !== "direct" && (
                          <span className="badge transport">
                            {connection.proxyMode === "system" ? t("系统代理", "System proxy") : t("手动代理", "Manual proxy")}
                          </span>
                        )}
                        {connection.sshEnabled && (
                          <span
                            className={`badge transport tunnel-${connection.sshTunnel?.status ?? "inactive"}`}
                            title={tunnelTitle}
                          >
                            {(tunnel?.status === "connecting" || tunnel?.status === "reconnecting") && <LoaderCircle className="spin" size={12} />}
                            {tunnelLabel}
                            {tunnel?.reconnectCount ? <small>×{tunnel.reconnectCount}</small> : null}
                          </span>
                        )}
                        {connection.authProfileId && <span className="badge transport">{t("认证方案", "Auth profile")}</span>}
                        {connection.hasSensitiveHeaders && <span className="badge transport">{t("加密 Header", "Encrypted headers")}</span>}
                        {active && (
                          <span className="badge success">{t("当前连接")}</span>
                        )}
                      </div>
                    </div>
                    <code>{connectionEndpoint(connection)}</code>
                    <div className="connection-context-row">
                      <span className="connection-group-label"><Layers3 size={12} />{connection.groupName || t("未分组", "Ungrouped")}</span>
                      {(connection.tags ?? []).slice(0, 3).map((tag) => <span className="connection-tag" key={tag}><Tags size={11} />{tag}</span>)}
                      {(connection.tags?.length ?? 0) > 3 && <span className="connection-tag">+{(connection.tags?.length ?? 3) - 3}</span>}
                      {connection.lastTestStatus && connection.lastTestedAt && (
                        <span
                          className={`connection-health is-${connection.lastTestStatus}`}
                          title={`${new Date(connection.lastTestedAt).toLocaleString()} · ${connection.lastTestStage ?? ""}`}
                        >
                          {connection.lastTestStatus === "passed" ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          {t("上次探测", "Last test")} · {connection.lastTestLatencyMs ?? 0} ms
                        </span>
                      )}
                      {connection.lastUsedAt && <time dateTime={connection.lastUsedAt} title={new Date(connection.lastUsedAt).toLocaleString()}>{t("最近使用", "Recently used")}</time>}
                    </div>
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
                    <dd>{connection.authProfileId ? t("认证方案", "Auth profile") : connection.username || t("匿名", "Anonymous")}</dd>
                  </div>
                  <div>
                    <dt>{t("凭据", "Credential")}</dt>
                    <dd>
                      {connection.authProfileId
                        ? t("复用加密方案", "Encrypted profile")
                        : connection.hasPassword
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
                    disabled={bulkTesting || testingId === connection.id}
                    onClick={async () => {
                      await runConnectionTest(connection);
                      await onConnectionsChanged();
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
                {(testingId === connection.id || testReports[connection.id]) && (
                  <section className={`connection-test-report ${testReports[connection.id]?.success === false ? "is-failed" : ""}`}>
                    <header>
                      <span>
                        {testReports[connection.id]?.success === false ? <AlertTriangle size={16} /> : <Activity size={16} />}
                        <strong>{testingId === connection.id ? t("正在分阶段探测", "Running staged diagnostics") : testReports[connection.id]?.success ? t("连接诊断通过", "Connection diagnostics passed") : t("连接诊断未通过", "Connection diagnostics failed")}</strong>
                      </span>
                      {testReports[connection.id] && <small>{testReports[connection.id]!.latencyMs} ms</small>}
                    </header>
                    <ConnectionTestStages loading={testingId === connection.id} report={testReports[connection.id]} />
                    {testReports[connection.id]?.success === false && (
                      <footer>
                        <span>{testReports[connection.id]!.message}</span>
                        <button type="button" className="button text" onClick={() => onOpenDiagnostics({
                          source: "connection",
                          title: t("连接测试失败", "Connection test failed"),
                          connectionName: connection.name,
                          stage: testReports[connection.id]!.stage,
                          message: testReports[connection.id]!.message,
                          occurredAt: new Date().toISOString(),
                        })}>
                          <Stethoscope size={15} />{t("生成诊断包", "Create diagnostic bundle")}
                        </button>
                      </footer>
                    )}
                  </section>
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
      {showAuthenticationProfiles && <AuthenticationProfilesDialog onClose={() => setShowAuthenticationProfiles(false)} onConnectionsChanged={onConnectionsChanged} />}
      {importReview && (
        <ConnectionWorkspaceImportDialog
          sourceName={importReview.sourceName}
          rows={importReview.rows}
          onClose={() => setImportReview(null)}
          onImported={async () => {
            await onConnectionsChanged();
            setWorkspaceMessage(t("连接工作区导入完成。请为标记的连接补充本机凭据后再测试。", "Connection workspace imported. Add local credentials to marked connections before testing."));
          }}
        />
      )}
    </div>
  );
}
