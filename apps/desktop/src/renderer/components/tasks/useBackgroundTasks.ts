import type { BackgroundTask } from "@janusgraph/domain";
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../lib/presentation";
import type { ToastState } from "../../features/query/query-workspace";

type UseBackgroundTasksInput = {
  translate: (chinese: string, english?: string) => string;
  notify: (toast: ToastState) => void;
  navigate: (kind: BackgroundTask["kind"]) => void;
};

export function useBackgroundTasks({ translate, notify, navigate }: UseBackgroundTasksInput) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [open, setOpen] = useState(false);
  const refresh = useCallback(async () => {
    if (!window.janusGraphDesktop) return;
    setTasks(await window.janusGraphDesktop.tasks.list(200));
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_500);
    const refreshAfterTaskUpdate = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.open === true) setOpen(true);
      window.setTimeout(() => void refresh(), 120);
    };
    window.addEventListener("janus-studio:background-task", refreshAfterTaskUpdate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("janus-studio:background-task", refreshAfterTaskUpdate);
    };
  }, [refresh]);

  const cancel = async (task: BackgroundTask) => {
    if (!window.janusGraphDesktop) return;
    try {
      if (task.kind === "schema") {
        await window.janusGraphDesktop.schemaJobs.cancel(task.connectionId);
      } else if (task.kind === "transfer") {
        await window.janusGraphDesktop.dataTransfers.cancel(task.id);
      }
      await refresh();
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const retry = async (task: BackgroundTask) => {
    if (!window.janusGraphDesktop) return;
    navigate(task.kind);
    setOpen(false);
    if (task.kind === "schema") {
      void window.janusGraphDesktop.schemaJobs.retry(task.id)
        .catch((error) => notify({ tone: "error", message: errorMessage(error) }))
        .finally(() => void refresh());
    } else if (task.kind === "transfer") {
      void window.janusGraphDesktop.dataTransfers.retry(task.id)
        .catch((error) => notify({ tone: "error", message: errorMessage(error) }))
        .finally(() => void refresh());
    }
  };

  const dismiss = async (task: BackgroundTask) => {
    if (!window.janusGraphDesktop) return;
    try {
      if (task.kind === "schema") await window.janusGraphDesktop.schemaJobs.dismiss(task.id);
      else await window.janusGraphDesktop.tasks.dismiss(task.id);
      await refresh();
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const acknowledgeAll = async () => {
    await window.janusGraphDesktop?.tasks.acknowledge();
    await refresh();
  };

  const openSource = (task: BackgroundTask) => {
    navigate(task.kind);
    setOpen(false);
  };

  const activeCount = tasks.filter(
    (task) => task.status === "running" || task.status === "cancel_requested",
  ).length;
  const unreadCount = tasks.filter(
    (task) => !task.acknowledged && task.status !== "running" && task.status !== "cancel_requested",
  ).length;

  return {
    tasks,
    open,
    setOpen,
    refresh,
    cancel,
    retry,
    dismiss,
    acknowledgeAll,
    openSource,
    activeCount,
    unreadCount,
  };
}
