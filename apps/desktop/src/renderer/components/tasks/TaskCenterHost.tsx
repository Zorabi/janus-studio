import { ListTodo } from "lucide-react";
import { useTranslate } from "../../lib/i18n";
import { TaskCenter } from "./TaskCenter";
import type { useBackgroundTasks } from "./useBackgroundTasks";

type TaskCenterState = ReturnType<typeof useBackgroundTasks>;

export function TaskCenterHost({ center }: { center: TaskCenterState }) {
  const t = useTranslate();
  return (
    <>
      <button
        type="button"
        className={`task-center-trigger ${center.open ? "is-active" : ""}`}
        onClick={() => center.setOpen((current) => !current)}
      >
        <ListTodo size={14} />
        <span>{t("任务", "Tasks")}</span>
        {(center.unreadCount > 0 || center.activeCount > 0) && (
          <b>{center.unreadCount || center.activeCount}</b>
        )}
      </button>
      {center.open && (
        <TaskCenter
          tasks={center.tasks}
          onClose={() => center.setOpen(false)}
          onRefresh={center.refresh}
          onAcknowledgeAll={center.acknowledgeAll}
          onDismiss={center.dismiss}
          onCancel={center.cancel}
          onRetry={center.retry}
          onOpenSource={center.openSource}
          onOpenDiagnostics={center.openDiagnostics}
        />
      )}
    </>
  );
}
