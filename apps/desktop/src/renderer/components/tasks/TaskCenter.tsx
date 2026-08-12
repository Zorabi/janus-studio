import type { BackgroundTask } from "@janusgraph/domain";
import {
  ArrowUpRight,
  Ban,
  Check,
  CheckCheck,
  Clock3,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useTranslate } from "../../lib/i18n";

type TaskCenterProps = {
  tasks: BackgroundTask[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onAcknowledgeAll: () => Promise<void>;
  onDismiss: (task: BackgroundTask) => Promise<void>;
  onCancel: (task: BackgroundTask) => Promise<void>;
  onRetry: (task: BackgroundTask) => Promise<void>;
  onOpenSource: (task: BackgroundTask) => void;
};

const terminalStatuses = new Set<BackgroundTask["status"]>([
  "succeeded",
  "failed",
  "interrupted",
]);

function TaskStatusIcon({ status }: { status: BackgroundTask["status"] }) {
  if (status === "succeeded") return <Check size={16} />;
  if (status === "failed") return <XCircle size={16} />;
  if (status === "interrupted") return <Ban size={16} />;
  if (status === "cancel_requested") return <Clock3 size={16} />;
  return <LoaderCircle className="spin" size={16} />;
}

function formatTaskTime(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale.startsWith("zh") ? "zh-CN" : "en", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatProgress(task: BackgroundTask, t: ReturnType<typeof useTranslate>): string {
  if (task.progressUnit === "byte") {
    const value = task.progressCurrent;
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }
  if (task.progressTotal > 0) {
    return `${task.progressCurrent.toLocaleString()} / ${task.progressTotal.toLocaleString()}`;
  }
  if (task.progressCurrent > 0) return task.progressCurrent.toLocaleString();
  return t("等待进度", "Waiting for progress");
}

export function TaskCenter({
  tasks,
  onClose,
  onRefresh,
  onAcknowledgeAll,
  onDismiss,
  onCancel,
  onRetry,
  onOpenSource,
}: TaskCenterProps) {
  const t = useTranslate();
  const active = tasks.filter((task) => !terminalStatuses.has(task.status));
  const recent = tasks.filter((task) => terminalStatuses.has(task.status));
  const unread = recent.filter((task) => !task.acknowledged).length;

  const renderTask = (task: BackgroundTask) => {
    const progress = task.progressTotal > 0
      ? Math.min((task.progressCurrent / task.progressTotal) * 100, 100)
      : task.status === "succeeded" ? 100 : 0;
    const action = task.kind === "schema"
      ? t("Schema 操作", "Schema operation")
      : task.kind === "maintenance"
        ? t("永久删除动态图", "Drop dynamic graph")
      : task.action === "import"
        ? t("整图导入", "Graph import")
        : task.action === "export"
          ? t("整图导出", "Graph export")
          : t("清空图数据", "Graph purge");
    return (
      <article
        className={`task-center-item is-${task.status} ${task.acknowledged ? "" : "is-unread"}`}
        key={task.id}
      >
        <div className="task-center-status"><TaskStatusIcon status={task.status} /></div>
        <div className="task-center-body">
          <header>
            <div>
              <span>{action}</span>
              <strong>{task.title}</strong>
            </div>
            <time>{formatTaskTime(task.updatedAt, document.documentElement.lang)}</time>
          </header>
          <div className="task-center-context">
            <span>{task.connectionName || t("未知连接", "Unknown connection")}</span>
            {task.graphName && <code>{task.graphName}</code>}
            <span>{task.stage}</span>
          </div>
          {(task.status === "running" || task.status === "cancel_requested" || task.progressCurrent > 0) && (
            <div className="task-center-progress">
              <span><i style={{ width: `${progress}%` }} /></span>
              <small>{formatProgress(task, t)}</small>
            </div>
          )}
          {task.message && <p title={task.message}>{task.message}</p>}
          <footer>
            <button type="button" onClick={() => onOpenSource(task)}>
              <ArrowUpRight size={15} />
              {task.kind === "schema"
                ? t("查看 Schema", "View Schema")
                : task.kind === "maintenance"
                  ? t("查看动态图", "View dynamic graph")
                  : t("查看迁移", "View transfer")}
            </button>
            {task.cancellable && (
              <button type="button" className="is-danger" onClick={() => void onCancel(task)}>
                <Ban size={15} />{t("停止", "Stop")}
              </button>
            )}
            {task.retriable && (
              <button type="button" onClick={() => void onRetry(task)}>
                <RotateCcw size={15} />{task.kind === "maintenance" ? t("前往重试", "Go to retry") : t("重试", "Retry")}
              </button>
            )}
            {terminalStatuses.has(task.status) && (
              <button
                type="button"
                className="task-center-dismiss"
                aria-label={t("移除记录", "Remove record")}
                title={t("移除记录", "Remove record")}
                onClick={() => void onDismiss(task)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </footer>
        </div>
      </article>
    );
  };

  return (
    <div className="task-center-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="task-center-panel" aria-label={t("任务中心", "Task Center")}>
        <header className="task-center-header">
          <div>
            <span className="eyebrow">TASK CENTER</span>
            <h2>{t("任务中心", "Task Center")}</h2>
            <p>{t("集中查看 Schema 与整图迁移任务", "Monitor Schema and graph transfer tasks in one place")}</p>
          </div>
          <div>
            <button type="button" title={t("刷新", "Refresh")} onClick={() => void onRefresh()}><RefreshCw size={17} /></button>
            <button type="button" title={t("关闭", "Close")} onClick={onClose}><X size={18} /></button>
          </div>
        </header>
        <div className="task-center-summary">
          <div><strong>{active.length}</strong><span>{t("进行中", "Active")}</span></div>
          <div><strong>{unread}</strong><span>{t("未读结果", "Unread results")}</span></div>
          <button type="button" disabled={unread === 0} onClick={() => void onAcknowledgeAll()}>
            <CheckCheck size={16} />{t("全部标为已读", "Mark all read")}
          </button>
        </div>
        <div className="task-center-scroll">
          {tasks.length === 0 ? (
            <div className="task-center-empty">
              <Check size={24} />
              <strong>{t("暂无后台任务", "No background tasks")}</strong>
              <span>{t("Schema 和整图迁移任务会显示在这里", "Schema and graph transfer tasks will appear here")}</span>
            </div>
          ) : (
            <>
              {active.length > 0 && <section><h3>{t("正在执行", "In progress")}</h3>{active.map(renderTask)}</section>}
              {recent.length > 0 && <section><h3>{t("最近完成", "Recent")}</h3>{recent.map(renderTask)}</section>}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
