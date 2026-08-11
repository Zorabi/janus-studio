import type { ConnectionSummary, SaveConnectionInput } from "@janusgraph/domain";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { IconButton, Modal } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";

const EMPTY_CONNECTION: Omit<SaveConnectionInput, "id"> = {
  name: "",
  protocol: "ws",
  host: "127.0.0.1",
  port: 8182,
  path: "/gremlin",
  username: "",
  password: "",
  environment: "dev",
  connectionReadOnly: false,
  clientMode: "sessionless",
  traversalSource: "g",
  graphBinding: "graph",
  connectTimeoutMs: 10_000,
  queryTimeoutMs: 60_000,
  tlsRejectUnauthorized: true,
  enableCompression: false,
  customHeaders: "{}",
};

function connectionFromForm(
  form: HTMLFormElement,
  editing: ConnectionSummary | null,
): SaveConnectionInput {
  const data = new FormData(form);
  const password = String(data.get("password") ?? "");
  return {
    id: editing?.id,
    name: String(data.get("name") ?? "").trim(),
    protocol: String(data.get("protocol") ?? "ws") as SaveConnectionInput["protocol"],
    host: String(data.get("host") ?? "").trim(),
    port: Number(data.get("port")),
    path: String(data.get("path") ?? "").trim(),
    username: String(data.get("username") ?? ""),
    password: editing?.hasPassword && password === "" ? undefined : password,
    environment: String(
      data.get("environment") ?? "dev",
    ) as SaveConnectionInput["environment"],
    connectionReadOnly: data.get("connectionReadOnly") === "on",
    clientMode: String(
      data.get("clientMode") ?? "sessionless",
    ) as SaveConnectionInput["clientMode"],
    traversalSource: String(data.get("traversalSource") ?? "").trim(),
    graphBinding: String(data.get("graphBinding") ?? "").trim(),
    connectTimeoutMs: Number(data.get("connectTimeoutMs")),
    queryTimeoutMs: Number(data.get("queryTimeoutMs")),
    tlsRejectUnauthorized: data.get("tlsRejectUnauthorized") === "on",
    enableCompression: data.get("enableCompression") === "on",
    customHeaders: String(data.get("customHeaders") ?? "{}").trim() || "{}",
  };
}

export interface ConnectionDialogProps {
  editing: ConnectionSummary | null;
  onClose: () => void;
  onSaved: (connection: ConnectionSummary) => void;
}

export function ConnectionDialog({
  editing,
  onClose,
  onSaved,
}: ConnectionDialogProps) {
  const t = useTranslate();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const defaults = editing ?? EMPTY_CONNECTION;

  const readInput = (): SaveConnectionInput | null => {
    const form = formRef.current;
    if (!form?.reportValidity()) return null;
    return connectionFromForm(form, editing);
  };

  const test = async () => {
    const input = readInput();
    if (!input || !window.janusGraphDesktop) return;
    setBusy("test");
    setMessage(null);
    try {
      const report = await window.janusGraphDesktop.connections.test(input);
      setMessage({
        tone: report.success ? "success" : "error",
        text: report.success
          ? `${report.message}，延迟 ${report.latencyMs} ms`
          : report.message,
      });
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = readInput();
    if (!input || !window.janusGraphDesktop) return;
    setBusy("save");
    setMessage(null);
    try {
      const saved = await window.janusGraphDesktop.connections.save(input);
      onSaved(saved);
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={
        editing
          ? t("编辑连接", "Edit Connection")
          : t("添加 JanusGraph 连接", "Add JanusGraph Connection")
      }
      eyebrow="CONNECTION PROFILE"
      onClose={onClose}
    >
      <form ref={formRef} className="connection-form" onSubmit={save}>
        <div className="form-grid">
          <label className="field">
            <span>{t("连接名称", "Connection name")}</span>
            <input name="name" defaultValue={defaults.name} required maxLength={80} />
          </label>
          <label className="field">
            <span>{t("环境", "Environment")}</span>
            <SelectControl
              name="environment"
              ariaLabel={t("连接环境", "Connection environment")}
              defaultValue={defaults.environment}
              options={[
                {
                  value: "dev",
                  label: t("开发", "Development"),
                  description: t("本地开发与功能调试", "Local development and feature work"),
                },
                {
                  value: "test",
                  label: t("测试", "Testing"),
                  description: t("共享测试或预发布环境", "Shared testing or staging environment"),
                },
                {
                  value: "prod",
                  label: t("生产", "Production"),
                  description: t("写操作需要额外确认", "Writes require an additional confirmation"),
                },
              ]}
            />
          </label>
          <label className="field">
            <span>{t("协议", "Protocol")}</span>
            <SelectControl
              name="protocol"
              ariaLabel={t("协议", "Protocol")}
              defaultValue={defaults.protocol}
              options={[
                { value: "ws", label: "WS", description: "Gremlin WebSocket" },
                { value: "wss", label: "WSS", description: "TLS WebSocket" },
                { value: "http", label: "HTTP", description: "HTTP endpoint" },
                { value: "https", label: "HTTPS", description: "TLS HTTP endpoint" },
              ]}
            />
          </label>
          <label className="field">
            <span>{t("端口", "Port")}</span>
            <input
              name="port"
              type="number"
              min={1}
              max={65535}
              defaultValue={defaults.port}
              required
            />
          </label>
          <label className="field field-span-2">
            <span>{t("主机", "Host")}</span>
            <input name="host" defaultValue={defaults.host} required />
          </label>
          <label className="field field-span-2">
            <span>{t("Gremlin 路径", "Gremlin path")}</span>
            <input name="path" defaultValue={defaults.path} required />
          </label>
          <label className="field">
            <span>{t("用户名", "Username")}</span>
            <input name="username" defaultValue={defaults.username} autoComplete="username" />
          </label>
          <label className="field">
            <span>{t("密码", "Password")}</span>
            <div className="password-field">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder={
                  editing?.hasPassword
                    ? t(
                        "留空以保留已保存密码；迁移失败时请重新输入",
                        "Leave blank to keep it; re-enter after a credential migration error",
                      )
                    : t("可选", "Optional")
                }
                autoComplete="current-password"
              />
              <IconButton
                label={
                  showPassword
                    ? t("隐藏密码", "Hide password")
                    : t("显示密码", "Show password")
                }
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </IconButton>
            </div>
          </label>
          <label className="field">
            <span>{t("客户端模式", "Client mode")}</span>
            <SelectControl
              name="clientMode"
              ariaLabel={t("客户端模式", "Client mode")}
              defaultValue={defaults.clientMode}
              options={[
                {
                  value: "sessionless",
                  label: t("非 Sessioned", "Sessionless"),
                  description: t(
                    "默认；每次查询独立，适合大多数场景",
                    "Default; isolated requests for most workloads",
                  ),
                },
                {
                  value: "sessioned",
                  label: "Sessioned",
                  description: t(
                    "跨查询保留变量和事务，仅支持 WS/WSS",
                    "Keeps variables and transactions across WS/WSS queries",
                  ),
                },
              ]}
            />
          </label>
          <label className="check-field connection-safety field-span-2">
            <input
              type="checkbox"
              name="connectionReadOnly"
              defaultChecked={defaults.connectionReadOnly}
            />
            <LockKeyhole size={18} />
            <span>
              <strong>{t("连接级只读保护", "Connection-level read-only protection")}</strong>
              <small>
                {t(
                  "阻止此连接执行可能修改图数据或 Schema 的 Gremlin 语句，适用于所有工作区。",
                  "Block Gremlin statements that may mutate graph data or schema across every workspace.",
                )}
              </small>
            </span>
          </label>
          <label className="field">
            <span>Traversal Source</span>
            <input name="traversalSource" defaultValue={defaults.traversalSource} required />
            <small>
              {t(
                "编辑器中的 g 会映射到此服务器 Traversal Source。",
                "The editor alias g maps to this server Traversal Source.",
              )}
            </small>
          </label>
          <label className="field">
            <span>Graph Binding</span>
            <input name="graphBinding" defaultValue={defaults.graphBinding} required />
            <small>
              {t(
                "仅用于 Management API，例如 graph1；通常与 *_traversal 前缀一致。",
                "Used by Management API, for example graph1; usually matches the *_traversal prefix.",
              )}
            </small>
          </label>
          <label className="field">
            <span>{t("连接超时（ms）", "Connection timeout (ms)")}</span>
            <input
              name="connectTimeoutMs"
              type="number"
              min={500}
              max={120000}
              defaultValue={defaults.connectTimeoutMs}
              required
            />
          </label>
          <label className="field">
            <span>{t("查询超时（ms）", "Query timeout (ms)")}</span>
            <input
              name="queryTimeoutMs"
              type="number"
              min={500}
              max={86400000}
              defaultValue={defaults.queryTimeoutMs}
              required
            />
            <small>{t("大型 GraphSON 迁移可按需提高，最高 24 小时。", "Large GraphSON transfers can use up to 24 hours when needed.")}</small>
          </label>
          <details className="connection-advanced field-span-2">
            <summary>
              <SlidersHorizontal size={17} />
              <span>
                <strong>{t("高级网络设置", "Advanced network settings")}</strong>
                <small>{t("TLS 验证、WebSocket 压缩与自定义请求头", "TLS validation, WebSocket compression and custom headers")}</small>
              </span>
              <ChevronDown size={17} />
            </summary>
            <div>
              <label className="check-field">
                <input type="checkbox" name="tlsRejectUnauthorized" defaultChecked={defaults.tlsRejectUnauthorized} />
                <span>
                  <strong>{t("验证 TLS 证书", "Verify TLS certificates")}</strong>
                  <small>{t("WSS/HTTPS 默认开启；仅在受控测试环境中关闭", "Enabled for WSS/HTTPS; disable only in controlled test environments")}</small>
                </span>
              </label>
              <label className="check-field">
                <input type="checkbox" name="enableCompression" defaultChecked={defaults.enableCompression} />
                <span>
                  <strong>{t("WebSocket 压缩", "WebSocket compression")}</strong>
                  <small>{t("启用 per-message deflate，适合大型响应", "Enable per-message deflate for larger responses")}</small>
                </span>
              </label>
              <label className="field field-span-2">
                <span>{t("自定义请求头（JSON）", "Custom headers (JSON)")}</span>
                <textarea
                  name="customHeaders"
                  defaultValue={defaults.customHeaders}
                  spellCheck={false}
                  placeholder={'{\n  "X-Tenant": "graph-team"\n}'}
                />
                <small>{t("请求头以明文保存在本机数据库中，请勿在此填写密码或 Token。", "Headers are stored locally in plain text. Do not place passwords or tokens here.")}</small>
              </label>
            </div>
          </details>
        </div>
        {message && (
          <div className={`inline-message ${message.tone}`} role="status">
            {message.tone === "success" ? (
              <CheckCircle2 size={17} />
            ) : (
              <AlertTriangle size={17} />
            )}
            <span>{message.text}</span>
          </div>
        )}
        <footer className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {t("取消", "Cancel")}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={test}
            disabled={busy !== null}
          >
            {busy === "test" ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Activity size={17} />
            )}
            {t("测试连接", "Test Connection")}
          </button>
          <button type="submit" className="button primary" disabled={busy !== null}>
            {busy === "save" ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Save size={17} />
            )}
            {t("保存连接", "Save Connection")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
