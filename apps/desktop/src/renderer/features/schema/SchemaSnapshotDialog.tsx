import { CheckCircle2, CircleAlert, CirclePlus, GitCompareArrows, RefreshCw } from "lucide-react";
import { Modal } from "../../components/ui";
import { formatSchemaArchiveTime } from "../../lib/schema-files";
import { useTranslate } from "../../lib/i18n";

type SchemaDiff = { added: string[]; changed: string[]; missing: string[] };

export function SchemaSnapshotDialog({
  graphName,
  currentCount,
  savedAt,
  baselineCount,
  diff,
  incomplete,
  onClose,
  onSave,
}: {
  graphName: string;
  currentCount: number;
  savedAt: string;
  baselineCount: number;
  diff: SchemaDiff | null;
  incomplete: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const t = useTranslate();
  const hasBaseline = Boolean(savedAt) || baselineCount > 0;
  const changes = diff
    ? [
        ...diff.added.map((key) => ({ key, status: "added" as const, label: t("新增", "Added"), icon: CirclePlus })),
        ...diff.changed.map((key) => ({ key, status: "changed" as const, label: t("变更", "Changed"), icon: RefreshCw })),
        ...diff.missing.map((key) => ({ key, status: "missing" as const, label: t("当前缺失", "Missing now"), icon: CircleAlert })),
      ]
    : [];

  return (
    <Modal eyebrow="SCHEMA BASELINE" title={t("Schema 快照基线", "Schema Snapshot Baseline")} onClose={onClose} width="wide">
      <div className="schema-snapshot-dialog">
        <header className="schema-snapshot-context">
          <GitCompareArrows size={22} />
          <div><span>{t("当前图", "Current graph")}</span><strong>{graphName}</strong></div>
          <div><span>{t("当前定义", "Current definitions")}</span><strong>{currentCount}</strong></div>
          <div><span>{t("基线定义", "Baseline definitions")}</span><strong>{hasBaseline ? baselineCount : "—"}</strong></div>
        </header>

        {!hasBaseline ? (
          <section className="schema-snapshot-empty">
            <GitCompareArrows size={34} />
            <strong>{t("尚未建立比较基线", "No comparison baseline yet")}</strong>
            <p>{t("保存当前 Schema 后，后续刷新会自动与该基线比较，无需再次手动触发比较。", "Save the current Schema once. Future refreshes will compare against it automatically.")}</p>
          </section>
        ) : (
          <>
            <section className="schema-snapshot-status">
              <div><span>{t("基线保存时间", "Baseline saved")}</span><strong>{savedAt ? formatSchemaArchiveTime(savedAt) : t("旧版本快照", "Legacy snapshot")}</strong></div>
              <div className="is-added"><span>{t("新增", "Added")}</span><strong>{incomplete ? "—" : `+${diff?.added.length ?? 0}`}</strong></div>
              <div className="is-changed"><span>{t("变更", "Changed")}</span><strong>{incomplete ? "—" : `~${diff?.changed.length ?? 0}`}</strong></div>
              <div className="is-missing"><span>{t("当前缺失", "Missing now")}</span><strong>{incomplete ? "—" : diff?.missing.length ?? 0}</strong></div>
            </section>
            {incomplete ? (
              <section className="schema-snapshot-incomplete">
                <CircleAlert size={22} />
                <span>
                  <strong>{t("本次读取不完整，已暂停差异计算", "Comparison paused because the latest read is incomplete")}</strong>
                  <small>{t(
                    "刷新并确保所有 Schema 分组读取成功后再比较或更新基线。",
                    "Refresh until every Schema group loads successfully before comparing or updating the baseline.",
                  )}</small>
                </span>
              </section>
            ) : (diff?.missing.length ?? 0) > 0 && (
              <p className="schema-snapshot-note">
                {t(
                  "“当前缺失”仅表示该定义存在于基线、但未出现在本次读取结果中；不代表 Janus Studio 支持删除这类 Schema 定义。",
                  "“Missing now” only means that the definition exists in the baseline but not in the latest read. It does not mean Janus Studio supports deleting that type of schema definition.",
                )}
              </p>
            )}
            {!incomplete && (changes.length === 0 ? (
              <section className="schema-snapshot-clean"><CheckCircle2 size={23} /><span><strong>{t("当前 Schema 与基线一致", "Current Schema matches the baseline")}</strong><small>{t("刷新后会继续自动比较。", "Automatic comparison continues after refresh.")}</small></span></section>
            ) : (
              <section className="schema-snapshot-changes">
                <header><strong>{t("变更明细", "Change details")}</strong><span>{changes.length}</span></header>
                <div>
                  {changes.map((change) => {
                    const Icon = change.icon;
                    const [group, ...name] = change.key.split(":");
                    return <article key={`${change.status}:${change.key}`} className={`is-${change.status}`}><Icon size={16} /><span><strong>{name.join(":")}</strong><small>{group}</small></span><b>{change.label}</b></article>;
                  })}
                </div>
              </section>
            ))}
          </>
        )}

        <footer className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>{t("关闭", "Close")}</button>
          <button type="button" className="button primary" onClick={onSave} disabled={incomplete}>
            {hasBaseline ? <RefreshCw size={17} /> : <GitCompareArrows size={17} />}
            {hasBaseline ? t("更新当前基线", "Update baseline") : t("以当前 Schema 建立基线", "Create baseline from current Schema")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
