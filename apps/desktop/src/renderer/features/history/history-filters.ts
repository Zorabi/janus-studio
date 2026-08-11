import type {
  QueryHistoryEntry,
  QueryHistoryStatus,
} from "@janusgraph/domain";

export type HistoryStatusFilter = "all" | QueryHistoryStatus;
export type HistoryDateFilter = "all" | "today" | "7d" | "30d";

export type HistoryFilters = {
  search: string;
  connectionId: string;
  status: HistoryStatusFilter;
  date: HistoryDateFilter;
};

function dateCutoff(filter: HistoryDateFilter, now: Date): number | null {
  if (filter === "all") return null;
  if (filter === "today") {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
  }
  const days = filter === "7d" ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60 * 1_000;
}

export function filterQueryHistory(
  history: QueryHistoryEntry[],
  filters: HistoryFilters,
  now = new Date(),
): QueryHistoryEntry[] {
  const search = filters.search.trim().toLocaleLowerCase();
  const cutoff = dateCutoff(filters.date, now);
  return history.filter((entry) => {
    if (filters.connectionId && entry.connectionId !== filters.connectionId) {
      return false;
    }
    if (filters.status !== "all" && entry.status !== filters.status) return false;
    if (cutoff !== null && Date.parse(entry.createdAt) < cutoff) return false;
    if (!search) return true;
    return [entry.query, entry.connectionName, entry.errorMessage]
      .join(" ")
      .toLocaleLowerCase()
      .includes(search);
  });
}
