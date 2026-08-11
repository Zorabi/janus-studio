import type { QueryHistoryEntry } from "@janusgraph/domain";
import { X, Zap } from "lucide-react";
import { useMemo } from "react";
import { useTranslate } from "../../lib/i18n";

export type QuerySuggestion = {
  value: string;
  mode: "append" | "replace";
  source: "history" | "grammar";
  detail: string;
};

type HistorySuggestionModel = {
  recent: string[];
  nextByPrefix: Map<string, Array<{ value: string; count: number }>>;
};

export function appendQuerySuggestion(query: string, suggestion: string): string {
  const base = query.trimEnd();
  const normalizedSuggestion =
    base.endsWith(".") && suggestion.startsWith(".")
      ? suggestion.slice(1)
      : suggestion;
  return `${base}${normalizedSuggestion}`;
}

function buildHistorySuggestionModel(
  history: QueryHistoryEntry[],
): HistorySuggestionModel {
  const recent: string[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, Map<string, number>>();
  for (const entry of history) {
    if (entry.status !== "success" && entry.status !== "truncated") continue;
    const candidate = entry.query.trim();
    if (!candidate) continue;
    if (!seen.has(candidate) && recent.length < 8) {
      seen.add(candidate);
      recent.push(candidate);
    }
    const steps = [...candidate.matchAll(/\.[A-Za-z_][A-Za-z0-9_]*\([^)]*\)/g)];
    for (let index = 0; index < steps.length - 1; index += 1) {
      const current = steps[index]!;
      const next = steps[index + 1]!;
      if (current.index === undefined || next.index === undefined) continue;
      const prefix = candidate
        .slice(0, current.index + current[0].length)
        .trim();
      const nextStep = next[0];
      const frequency = counts.get(prefix) ?? new Map<string, number>();
      frequency.set(nextStep, (frequency.get(nextStep) ?? 0) + 1);
      counts.set(prefix, frequency);
    }
  }
  return {
    recent,
    nextByPrefix: new Map(
      [...counts.entries()].map(([prefix, frequency]) => [
        prefix,
        [...frequency.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 5)
          .map(([value, count]) => ({ value, count })),
      ]),
    ),
  };
}

export function QueryHints({
  query,
  history,
  visible,
  onApply,
  onClose,
}: {
  query: string;
  history: QueryHistoryEntry[];
  visible: boolean;
  onApply: (suggestion: QuerySuggestion) => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const historyModel = useMemo(
    () => buildHistorySuggestionModel(history),
    [history],
  );
  const hints = useMemo(() => {
    const trimmed = query.trim();
    const fromHistory: QuerySuggestion[] = (historyModel.nextByPrefix.get(trimmed) ?? [])
      .slice(0, 3)
      .map(({ value, count }) => ({
        value,
        mode: "append",
        source: "history",
        detail: t(
          `历史中使用 ${count} 次`,
          `Used ${count} time${count === 1 ? "" : "s"} in successful history`,
        ),
      }));

    let grammar: string[];
    if (!trimmed) {
      const recent = historyModel.recent
        .slice(0, 3)
        .map<QuerySuggestion>((value) => ({
          value,
          mode: "replace",
          source: "history",
          detail: t("最近成功执行", "Recently executed successfully"),
        }));
      const templates: QuerySuggestion[] = [
        "g.V().limit(50).elementMap()",
        "g.E().limit(50).elementMap()",
        "g.V().groupCount().by(label)",
      ].map((value) => ({
        value,
        mode: "replace",
        source: "grammar",
        detail: t("安全的只读模板", "Safe read-only template"),
      }));
      return [...recent, ...templates].slice(0, 5);
    }
    if (/\.V\(\)\s*$/.test(trimmed)) {
      grammar = [".limit(50).elementMap()", ".count()", ".groupCount().by(label)"];
    } else if (/\.E\(\)\s*$/.test(trimmed)) {
      grammar = [".limit(50).elementMap()", ".count()", ".hasLabel('label')"];
    } else if (/\.has(?:Label)?\([^)]*\)\s*$/.test(trimmed)) {
      grammar = [".limit(50).elementMap()", ".count()", ".out().dedup()"];
    } else if (/\.outE\([^)]*\)\s*$|\.inE\([^)]*\)\s*$|\.bothE\([^)]*\)\s*$/.test(trimmed)) {
      grammar = [".limit(50).elementMap()", ".otherV()", ".count()"];
    } else if (/\.out\([^)]*\)\s*$|\.in\([^)]*\)\s*$|\.both\([^)]*\)\s*$/.test(trimmed)) {
      grammar = [".dedup().limit(50).elementMap()", ".path().by(elementMap())", ".count()"];
    } else if (/\.groupCount\(\)\s*$/.test(trimmed)) {
      grammar = [".by(label)", ".by(values('name'))"];
    } else if (/\.path\(\)\s*$/.test(trimmed)) {
      grammar = [".by(elementMap())", ".limit(50)"];
    } else if (/\.limit\([^)]*\)\s*$/.test(trimmed)) {
      grammar = [".elementMap()", ".path().by(elementMap())", ".count()"];
    } else if (
      /\.elementMap\(\)\s*$|\.valueMap\([^)]*\)\s*$|\.count\(\)\s*$|\.next\(\)\s*$|\.toList\(\)\s*$|\.iterate\(\)\s*$/.test(
        trimmed,
      )
    ) {
      grammar = [];
    } else if (
      !trimmed.startsWith("g.") ||
      /[;\n={}]/.test(trimmed)
    ) {
      grammar = [];
    } else {
      grammar = [".limit(50)", ".elementMap()", ".count()"];
    }
    const grammarHints: QuerySuggestion[] = grammar.map((value) => ({
      value,
      mode: "append",
      source: "grammar",
      detail: t("与当前返回类型兼容", "Compatible with the current traversal shape"),
    }));
    return [...fromHistory, ...grammarHints]
      .filter(
        (suggestion, index, values) =>
          values.findIndex((candidate) => candidate.value === suggestion.value) === index,
      )
      .slice(0, 5);
  }, [historyModel, query, t]);

  if (!visible || hints.length === 0) return null;
  return (
    <div className="query-suggestion-popover" role="listbox" aria-label={t("下一步")}>
      <header>
        <span>
          <Zap size={15} />
          {t("下一步建议", "Next-step suggestions")}
        </span>
        <div className="query-suggestion-header-actions">
          <small>{t("基于成功历史与 Gremlin Step 兼容性", "Successful history + Gremlin step compatibility")}</small>
          <button
            type="button"
            className="query-suggestion-close"
            aria-label={t("关闭建议", "Close suggestions")}
            title={t("关闭建议", "Close suggestions")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="query-suggestion-list">
        {hints.map((hint) => (
          <button
            type="button"
            role="option"
            key={`${hint.mode}:${hint.value}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onApply(hint)}
          >
            <code>{hint.value}</code>
            <span>
              {hint.source === "history"
                ? t("历史", "History")
                : t("语法", "Grammar")}
            </span>
            <small>{hint.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

