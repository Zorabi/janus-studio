import type { AuthenticationProfile, AuthenticationProfileMode, SaveAuthenticationProfileInput } from "@janusgraph/domain";
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { IconButton, Modal } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";

const MODE_OPTIONS = ["basic", "janus-hmac", "bearer", "custom-headers"] as const;

export function AuthenticationProfilesDialog({ onClose, onConnectionsChanged }: { onClose: () => void; onConnectionsChanged: () => void }) {
  const t = useTranslate();
  const api = window.janusGraphDesktop!;
  const [profiles, setProfiles] = useState<AuthenticationProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<AuthenticationProfileMode>("basic");
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [message, setMessage] = useState("");
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;

  const reload = async (preferredId = selectedId) => {
    const next = await api.authProfiles.list();
    setProfiles(next);
    if (preferredId && next.some((profile) => profile.id === preferredId)) setSelectedId(preferredId);
  };

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    setMode(selected?.mode ?? "basic");
    setDeleteArmed(false);
    setMessage("");
  }, [selectedId]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const secret = String(data.get("secret") ?? "");
    const sensitiveHeaders = String(data.get("sensitiveHeaders") ?? "").trim();
    const input: SaveAuthenticationProfileInput = {
      id: selected?.id,
      name: String(data.get("name") ?? "").trim(),
      mode,
      username: String(data.get("username") ?? "").trim(),
      headerName: String(data.get("headerName") ?? "Authorization").trim(),
      secret: selected?.hasSecret && !secret ? undefined : secret,
      sensitiveHeaders: selected?.hasSensitiveHeaders && !sensitiveHeaders ? undefined : sensitiveHeaders || "{}",
    };
    setBusy(true);
    setMessage("");
    try {
      const saved = await api.authProfiles.save(input);
      await reload(saved.id);
      setMessage(t("认证方案已保存", "Authentication profile saved"));
      form.reset();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      setMessage(t("再次点击将删除方案，并解除所有连接对它的引用；连接本身不会删除。", "Click again to delete this profile and detach it from every connection. Connections are not deleted."));
      return;
    }
    setBusy(true);
    try {
      await api.authProfiles.remove(selected.id);
      onConnectionsChanged();
      setSelectedId("");
      await reload("");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
      setDeleteArmed(false);
    }
  };

  const modeDescription = mode === "basic"
    ? t("WS/WSS 使用 SASL PLAIN，HTTP/HTTPS 使用 Basic。JanusGraph 标准认证可直接使用。", "Uses SASL PLAIN for WS/WSS and Basic for HTTP/HTTPS. Works with standard JanusGraph authentication.")
    : mode === "janus-hmac"
      ? t("仅用于 HTTP/HTTPS + SaslAndHMACAuthenticator：先请求 /session，再发送 Authorization: Token。", "For HTTP/HTTPS with SaslAndHMACAuthenticator: obtains /session and then sends Authorization: Token.")
      : mode === "bearer"
        ? t("JanusGraph 默认不提供 Bearer；仅在反向代理、API Gateway 或自定义 Channelizer 支持时使用。", "JanusGraph does not provide Bearer by default. Use only with a reverse proxy, API gateway or custom Channelizer.")
        : t("适用于企业网关或自定义认证处理器。全部 Header 值均加密保存。", "For enterprise gateways or custom authentication handlers. All header values are encrypted.");

  return (
    <Modal title={t("认证方案", "Authentication Profiles")} eyebrow="CREDENTIAL VAULT" width="wide" onClose={onClose}>
      <div className="auth-profile-workspace">
        <aside className="auth-profile-list">
          <button type="button" className={`auth-profile-item ${selectedId === "" ? "is-active" : ""}`} onClick={() => setSelectedId("")}>
            <Plus size={17} /><span><strong>{t("新建认证方案", "New profile")}</strong><small>{t("创建可复用凭据", "Create reusable credentials")}</small></span>
          </button>
          {profiles.map((profile) => (
            <button type="button" key={profile.id} className={`auth-profile-item ${selectedId === profile.id ? "is-active" : ""}`} onClick={() => setSelectedId(profile.id)}>
              <KeyRound size={17} /><span><strong>{profile.name}</strong><small>{profile.mode === "janus-hmac" ? "JANUS HMAC" : profile.mode.toUpperCase()}</small></span>{selectedId === profile.id && <Check size={15} />}
            </button>
          ))}
        </aside>
        <form key={selected?.id ?? "new"} className="auth-profile-form" onSubmit={save}>
          <div className="auth-profile-intro"><ShieldCheck size={21} /><span><strong>{selected ? t("编辑认证方案", "Edit authentication profile") : t("创建认证方案", "Create authentication profile")}</strong><small>{t("敏感值仅在主进程按需解密，不会回显到界面。", "Secrets are decrypted only when needed in the main process and are never echoed back to the UI.")}</small></span></div>
          <div className="form-grid auth-profile-fields">
            <label className="field"><span>{t("方案名称", "Profile name")}</span><input name="name" defaultValue={selected?.name ?? ""} required maxLength={80} /></label>
            <label className="field"><span>{t("认证类型", "Authentication type")}</span><SelectControl name="mode" value={mode} onValueChange={(value) => setMode(value as AuthenticationProfileMode)} ariaLabel={t("认证类型", "Authentication type")} options={MODE_OPTIONS.map((value) => ({ value, label: value === "janus-hmac" ? "JanusGraph HMAC Token" : value === "custom-headers" ? t("自定义加密 Header", "Custom encrypted headers") : value === "basic" ? "Basic / SASL" : "Bearer Token" }))} /></label>
            <div className="auth-profile-capability field-span-2">{modeDescription}</div>
            {(mode === "basic" || mode === "janus-hmac") && <label className="field"><span>{t("账号", "Username")}</span><input name="username" defaultValue={selected?.username ?? ""} required /></label>}
            {mode === "bearer" && <label className="field"><span>{t("Header 名称", "Header name")}</span><input name="headerName" defaultValue={selected?.headerName || "Authorization"} required /></label>}
            {mode !== "custom-headers" && (
              <label className="field">
                <span>{mode === "bearer" ? "Token" : t("凭据", "Secret")}</span>
                <div className="password-field"><input name="secret" type={showSecret ? "text" : "password"} required={!selected?.hasSecret} placeholder={selected?.hasSecret ? t("留空以保留已加密凭据", "Leave blank to keep the encrypted secret") : ""} /><IconButton label={showSecret ? t("隐藏凭据", "Hide secret") : t("显示凭据", "Show secret")} onClick={() => setShowSecret((current) => !current)}>{showSecret ? <EyeOff size={17} /> : <Eye size={17} />}</IconButton></div>
              </label>
            )}
            {mode === "custom-headers" && <input type="hidden" name="username" value="" />}
            {mode !== "bearer" && <input type="hidden" name="headerName" value="Authorization" />}
            {(mode === "custom-headers" || mode === "bearer") && <label className="field field-span-2"><span>{t("加密请求头（JSON）", "Encrypted headers (JSON)")}</span><textarea name="sensitiveHeaders" spellCheck={false} placeholder={selected?.hasSensitiveHeaders ? t("留空以保留已加密请求头", "Leave blank to keep encrypted headers") : '{\n  "X-Tenant-Secret": "…"\n}'} /><small>{t("Bearer 会自动写入上方 Header；这里可补充网关要求的其他敏感 Header。", "Bearer is written to the header above; add any other sensitive gateway headers here.")}</small></label>}
          </div>
          {message && <div className="auth-profile-message" role="status">{message}</div>}
          <footer className="modal-actions">
            {selected && <button type="button" className={`button ${deleteArmed ? "danger" : "secondary"}`} onClick={() => void remove()} disabled={busy}><Trash2 size={16} />{deleteArmed ? t("再次点击删除", "Click again to delete") : t("删除方案", "Delete profile")}</button>}
            <span className="modal-action-spacer" />
            <button type="button" className="button secondary" onClick={onClose}>{t("关闭", "Close")}</button>
            <button type="submit" className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{t("保存方案", "Save profile")}</button>
          </footer>
        </form>
      </div>
    </Modal>
  );
}
