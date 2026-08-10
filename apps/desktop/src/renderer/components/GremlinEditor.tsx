import Editor, { loader, type BeforeMount, type OnMount } from "@monaco-editor/react";
import * as monacoApi from "monaco-editor";
import type {
  editor as MonacoEditor,
  IDisposable,
  Position,
} from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import {
  Activity,
  AlignLeft,
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Command,
  Copy,
  CornerDownLeft,
  GitBranch,
  Play,
  Redo2,
  Replace,
  Scissors,
  Search,
  Sparkles,
  Square,
  Undo2,
  X,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  EMPTY_SCHEMA_CATALOG,
  schemaCompletions,
  type GremlinSchemaCatalog,
} from "../lib/gremlin-completion";
import { formatGremlin } from "../lib/gremlin-format";
import { useTranslate } from "../lib/i18n";

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: () => Worker;
    };
  }
}

window.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco: monacoApi });

const GREMLIN_STEPS = [
  "V", "E", "addV", "addE", "mergeV", "mergeE", "has", "hasLabel",
  "hasId", "hasKey", "hasValue", "out", "in", "both", "outE", "inE",
  "bothE", "outV", "inV", "bothV", "otherV", "values", "valueMap",
  "elementMap", "propertyMap", "properties", "property", "id", "label",
  "key", "value", "path", "simplePath", "cyclicPath", "dedup", "where",
  "filter", "not", "and", "or", "is", "limit", "range", "skip", "tail",
  "count", "sum", "min", "max", "mean", "group", "groupCount", "order",
  "by", "select", "project", "match", "choose", "coalesce", "optional",
  "union", "repeat", "until", "emit", "times", "local", "barrier", "fold",
  "unfold", "inject", "constant", "math", "sample", "coin", "aggregate",
  "store", "cap", "sideEffect", "subgraph", "tree", "profile", "explain",
  "drop", "iterate", "next", "toList", "read", "write",
];

const SCHEMA_BY_MODEL = new Map<string, GremlinSchemaCatalog>();

function applyDiagnostic(
  editor: MonacoEditor.IStandaloneCodeEditor,
  message?: string,
) {
  const model = editor.getModel();
  if (!model) return;
  if (!message) {
    monacoApi.editor.setModelMarkers(model, "janusgraph-server", []);
    return;
  }
  const match =
    /line\s+(\d+)\s*[,;:]?\s*column\s+(\d+)/i.exec(message) ??
    /line\s+(\d+)/i.exec(message) ??
    /(?:script|query)[^\n]*?:(\d+):(\d+)/i.exec(message);
  const requestedLine = Number(match?.[1] ?? 1);
  const lineNumber = Math.min(
    model.getLineCount(),
    Math.max(1, Number.isFinite(requestedLine) ? requestedLine : 1),
  );
  const requestedColumn = Number(match?.[2] ?? 1);
  const column = Math.min(
    model.getLineMaxColumn(lineNumber),
    Math.max(1, Number.isFinite(requestedColumn) ? requestedColumn : 1),
  );
  monacoApi.editor.setModelMarkers(model, "janusgraph-server", [{
    severity: monacoApi.MarkerSeverity.Error,
    source: "JanusGraph Server",
    message,
    startLineNumber: lineNumber,
    startColumn: column,
    endLineNumber: lineNumber,
    endColumn: Math.min(model.getLineMaxColumn(lineNumber), column + 1),
  }]);
}

function normalizedShortcut(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key =
    event.code === "Space"
      ? "Space"
      : event.code === "BracketLeft" || event.code === "BracketRight"
        ? event.code
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key;
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) return null;
  return [...parts, key].join("+");
}

function displayShortcut(shortcut: string): string {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return shortcut
    .replace("Mod", isMac ? "⌘" : "Ctrl")
    .replaceAll("+", isMac ? "" : "+")
    .replace("Shift", isMac ? "⇧" : "Shift")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]");
}

interface EditorContextMenuState {
  x: number;
  y: number;
  selectedText: string;
  canUndo: boolean;
  canRedo: boolean;
}

type SuggestWidgetInternals = {
  element: { size?: { width: number; height: number } };
  _layout: (size?: { width: number; height: number }) => void;
  onDidShow: (listener: () => void) => IDisposable;
  onDidHide: (listener: () => void) => IDisposable;
};

function lockSuggestWidgetViewport(
  editor: MonacoEditor.IStandaloneCodeEditor,
  visibleRows: number,
  rowHeight: number,
  onVisibilityChange: (visible: boolean) => void,
): IDisposable | null {
  // Monaco 0.56 removed the public maxVisibleSuggestions option. Constrain the
  // widget's own virtual-list layout so keyboard navigation scrolls only its
  // five-row viewport instead of moving or growing the surrounding overlay.
  const controller = editor.getContribution(
    "editor.contrib.suggestController",
  ) as unknown as {
    widget?: { value?: SuggestWidgetInternals };
  } | null;
  const widget = controller?.widget?.value;
  if (!widget) return null;
  const originalLayout = widget._layout.bind(widget);
  widget._layout = (size) => {
    originalLayout({
      width: size?.width || widget.element.size?.width || 430,
      height: visibleRows * rowHeight,
    });
  };
  const showSubscription = widget.onDidShow(() => onVisibilityChange(true));
  const hideSubscription = widget.onDidHide(() => onVisibilityChange(false));
  widget._layout();
  return {
    dispose: () => {
      showSubscription.dispose();
      hideSubscription.dispose();
      onVisibilityChange(false);
      widget._layout = originalLayout;
    },
  };
}

const configureMonaco: BeforeMount = (monaco) => {
  if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === "gremlin")) {
    monaco.languages.register({ id: "gremlin", extensions: [".gremlin", ".groovy"] });
    monaco.languages.setMonarchTokensProvider("gremlin", {
      defaultToken: "",
      tokenPostfix: ".gremlin",
      keywords: ["def", "as", "in", "true", "false", "null", "new", "return", "try", "catch", "finally"],
      tokenizer: {
        root: [
          [/\/\/.*$/, "comment"],
          [/\/\*/, "comment", "@comment"],
          [/'([^'\\]|\\.)*'/, "string"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/[{}()[\]]/, "@brackets"],
          [/[<>]=?|==|!=|&&|\|\||[+*/%-]/, "operator"],
          [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[lLdDfF]?/, "number"],
          [/[A-Za-z_$][\w$]*/, {
            cases: {
              "@keywords": "keyword",
              "@default": "identifier",
            },
          }],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
      },
    });
    monaco.languages.setLanguageConfiguration("gremlin", {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: "'", close: "'" },
        { open: "\"", close: "\"" },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: "'", close: "'" },
        { open: "\"", close: "\"" },
      ],
      folding: { markers: { start: /^\s*\/\/\s*#?region\b/, end: /^\s*\/\/\s*#?endregion\b/ } },
    });
    monaco.languages.registerCompletionItemProvider("gremlin", {
      triggerCharacters: [".", "(", "'", '"'],
      provideCompletionItems: (
        model: MonacoEditor.ITextModel,
        position: Position,
      ) => {
        const textBeforeCursor = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const schemaSuggestions = schemaCompletions(
          textBeforeCursor,
          SCHEMA_BY_MODEL.get(model.uri.toString()) ?? EMPTY_SCHEMA_CATALOG,
        );
        const word = model.getWordUntilPosition(position);
        const prefix = word.word.toLocaleLowerCase();
        const matchingSteps = prefix
          ? GREMLIN_STEPS.filter((step) => step.toLocaleLowerCase().startsWith(prefix))
          : GREMLIN_STEPS;
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: position.column,
        };
        return {
          suggestions: schemaSuggestions.length > 0
            ? schemaSuggestions.map((entry) => ({
                label: entry.label,
                kind: entry.category === "propertyKey"
                  ? monaco.languages.CompletionItemKind.Field
                  : monaco.languages.CompletionItemKind.EnumMember,
                detail: entry.detail,
                documentation: `Defined in the active JanusGraph schema.`,
                insertText: entry.insertText,
                range,
                sortText: `0-${entry.label}`,
              }))
            : matchingSteps.map((step) => ({
          label: step,
          kind: monaco.languages.CompletionItemKind.Method,
          detail: "Gremlin traversal step",
          documentation: `Insert ${step}() into the current traversal.`,
          insertText: `${step}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
        };
      },
    });
    monaco.languages.registerDocumentFormattingEditProvider("gremlin", {
      provideDocumentFormattingEdits: (model: MonacoEditor.ITextModel) => [{
        range: model.getFullModelRange(),
        text: formatGremlin(model.getValue()),
      }],
    });
  }
  monaco.editor.defineTheme("janusgraph-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "69736B", fontStyle: "italic" },
      { token: "keyword", foreground: "C8FF55" },
      { token: "string", foreground: "E5AA58" },
      { token: "number", foreground: "8FD6FF" },
      { token: "identifier", foreground: "E9E9E2" },
    ],
    colors: {
      "editor.background": "#0D100E00",
      "editor.foreground": "#E9E9E2",
      "editorLineNumber.foreground": "#586159",
      "editorLineNumber.activeForeground": "#C8FF55",
      "editorCursor.foreground": "#C8FF55",
      "editor.selectionBackground": "#6F8F314D",
      "editor.inactiveSelectionBackground": "#6F8F312B",
      "editor.lineHighlightBackground": "#F0EFE707",
      "editorIndentGuide.background1": "#303631",
      "editorIndentGuide.activeBackground1": "#69736B",
      "editorBracketMatch.background": "#C8FF5520",
      "editorBracketMatch.border": "#C8FF5580",
      "editorWidget.background": "#111612",
      "editorWidget.border": "#3D473F",
      "editorSuggestWidget.background": "#111612",
      "editorSuggestWidget.selectedBackground": "#243018",
      "editorSuggestWidget.highlightForeground": "#C8FF55",
    },
  });
  monaco.editor.defineTheme("janusgraph-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A746C", fontStyle: "italic" },
      { token: "keyword", foreground: "557C00", fontStyle: "bold" },
      { token: "string", foreground: "A05A00" },
      { token: "number", foreground: "006C91" },
      { token: "identifier", foreground: "202720" },
    ],
    colors: {
      "editor.background": "#FFFFFF00",
      "editor.foreground": "#202720",
      "editorLineNumber.foreground": "#8A948C",
      "editorLineNumber.activeForeground": "#557C00",
      "editorCursor.foreground": "#557C00",
      "editor.selectionBackground": "#A4D24655",
      "editor.lineHighlightBackground": "#48620009",
      "editorWidget.background": "#F8FAF6",
      "editorWidget.border": "#C7CEC8",
      "editorSuggestWidget.background": "#F8FAF6",
      "editorSuggestWidget.selectedBackground": "#E4EED5",
      "editorSuggestWidget.highlightForeground": "#557C00",
    },
  });
};

export function GremlinEditor({
  modelId,
  value,
  onChange,
  onSelectionChange,
  onRun,
  onStop,
  onFormat,
  onExplain,
  onProfile,
  onFocus,
  onSuggestionVisibilityChange,
  canRun,
  runShortcut,
  stopShortcut,
  formatShortcut,
  findReplaceShortcut,
  fontSize,
  readOnly,
  diagnosticMessage,
  schemaCatalog = EMPTY_SCHEMA_CATALOG,
  placeholder,
  ariaLabel,
}: {
  modelId: string;
  value: string;
  onChange: (value: string) => void;
  onSelectionChange: (value: string) => void;
  onRun: (selection?: string) => void;
  onStop: () => void;
  onFormat: () => void;
  onExplain: (selection?: string) => void;
  onProfile: (selection?: string) => void;
  onFocus?: () => void;
  onSuggestionVisibilityChange?: (visible: boolean) => void;
  canRun: boolean;
  runShortcut: string;
  stopShortcut: string;
  formatShortcut: string;
  findReplaceShortcut: string;
  fontSize: number;
  readOnly: boolean;
  diagnosticMessage?: string;
  schemaCatalog?: GremlinSchemaCatalog;
  placeholder: string;
  ariaLabel: string;
}) {
  const t = useTranslate();
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const commandListRef = useRef<HTMLDivElement | null>(null);
  const subscriptionsRef = useRef<IDisposable[]>([]);
  const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null);
  const [searchMode, setSearchMode] = useState<"find" | "replace" | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const callbacksRef = useRef({ onRun, onStop, onFormat, onSuggestionVisibilityChange, runShortcut, stopShortcut, formatShortcut, findReplaceShortcut });
  const diagnosticRef = useRef(diagnosticMessage);
  callbacksRef.current = { onRun, onStop, onFormat, onSuggestionVisibilityChange, runShortcut, stopShortcut, formatShortcut, findReplaceShortcut };
  diagnosticRef.current = diagnosticMessage;

  const mount = useCallback<OnMount>((editor) => {
    editorRef.current = editor;
    applyDiagnostic(editor, diagnosticRef.current);
    subscriptionsRef.current.forEach((subscription) => subscription.dispose());
    const suggestViewport = lockSuggestWidgetViewport(
      editor,
      5,
      32,
      (visible) => callbacksRef.current.onSuggestionVisibilityChange?.(visible),
    );
    subscriptionsRef.current = [
      ...(suggestViewport ? [suggestViewport] : []),
      editor.onDidChangeCursorSelection(() => {
        const selection = editor.getSelection();
        const model = editor.getModel();
        onSelectionChange(selection && model ? model.getValueInRange(selection) : "");
      }),
      editor.onDidFocusEditorText(() => onFocus?.()),
      editor.onContextMenu((event) => {
        event.event.preventDefault();
        event.event.stopPropagation();
        const selection = editor.getSelection();
        const model = editor.getModel();
        setContextMenu({
          x: event.event.posx,
          y: event.event.posy,
          selectedText: selection && model ? model.getValueInRange(selection) : "",
          canUndo: model?.canUndo() ?? false,
          canRedo: model?.canRedo() ?? false,
        });
      }),
      editor.onKeyDown((event) => {
        const shortcut = normalizedShortcut(event.browserEvent);
        if (shortcut === "Mod+F") {
          event.preventDefault();
          event.stopPropagation();
          setSearchMode("find");
        } else if (shortcut === callbacksRef.current.findReplaceShortcut) {
          event.preventDefault();
          event.stopPropagation();
          setSearchMode("replace");
        } else if (shortcut === "F1") {
          event.preventDefault();
          event.stopPropagation();
          setCommandPaletteOpen(true);
        } else if (shortcut === callbacksRef.current.runShortcut) {
          event.preventDefault();
          event.stopPropagation();
          const selection = editor.getSelection();
          const model = editor.getModel();
          const selected = selection && model ? model.getValueInRange(selection) : "";
          callbacksRef.current.onRun(selected.trim() ? selected : undefined);
        } else if (shortcut === callbacksRef.current.stopShortcut) {
          event.preventDefault();
          event.stopPropagation();
          callbacksRef.current.onStop();
        } else if (shortcut === callbacksRef.current.formatShortcut) {
          event.preventDefault();
          event.stopPropagation();
          callbacksRef.current.onFormat();
        }
      }),
    ];
  }, [onFocus, onSelectionChange]);

  useEffect(() => () => {
    subscriptionsRef.current.forEach((subscription) => subscription.dispose());
  }, []);

  useEffect(() => {
    setContextMenu(null);
    setSearchMode(null);
    setCommandPaletteOpen(false);
  }, [modelId]);

  useEffect(() => {
    if (!searchMode) return;
    const frame = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [searchMode]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    setCommandQuery("");
    setActiveCommandIndex(0);
    const frame = requestAnimationFrame(() => commandInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", closeOnEscape);
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!contextMenu || !menu) return;
    const bounds = menu.getBoundingClientRect();
    const edge = 12;
    const nextX = Math.max(edge, Math.min(contextMenu.x, window.innerWidth - bounds.width - edge));
    const nextY = Math.max(edge, Math.min(contextMenu.y, window.innerHeight - bounds.height - edge));
    if (nextX !== contextMenu.x || nextY !== contextMenu.y) {
      setContextMenu((current) => current ? { ...current, x: nextX, y: nextY } : null);
    }
  }, [contextMenu]);

  useEffect(() => {
    if (editorRef.current) applyDiagnostic(editorRef.current, diagnosticMessage);
  }, [diagnosticMessage, modelId]);

  useEffect(() => {
    const uri = `janusgraph://query/${modelId}.gremlin`;
    SCHEMA_BY_MODEL.set(uri, schemaCatalog);
    return () => { SCHEMA_BY_MODEL.delete(uri); };
  }, [modelId, schemaCatalog]);

  const fontFamily = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-code")
    .trim();
  const theme = document.documentElement.dataset.theme === "light"
    ? "janusgraph-light"
    : "janusgraph-dark";

  const triggerEditorAction = (actionId: string) => {
    editorRef.current?.trigger("gremlin-context-menu", actionId, null);
    setContextMenu(null);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const openSearch = (mode: "find" | "replace") => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    const selected = selection && model ? model.getValueInRange(selection) : "";
    if (selected && !selected.includes("\n")) setFindQuery(selected);
    setContextMenu(null);
    setCommandPaletteOpen(false);
    setSearchMode(mode);
  };

  const findMatches = () => {
    const model = editorRef.current?.getModel();
    if (!model || !findQuery) return [];
    return model.findMatches(
      findQuery,
      false,
      false,
      matchCase,
      null,
      false,
      10_000,
    );
  };

  const currentMatchIndex = (matches = findMatches()) => {
    const selection = editorRef.current?.getSelection();
    if (!selection) return -1;
    return matches.findIndex(({ range }) =>
      range.startLineNumber === selection.startLineNumber &&
      range.startColumn === selection.startColumn &&
      range.endLineNumber === selection.endLineNumber &&
      range.endColumn === selection.endColumn,
    );
  };

  const revealMatch = (direction: 1 | -1) => {
    const editor = editorRef.current;
    const matches = findMatches();
    if (!editor || matches.length === 0) return;
    const current = currentMatchIndex(matches);
    const next = current < 0
      ? direction === 1 ? 0 : matches.length - 1
      : (current + direction + matches.length) % matches.length;
    editor.setSelection(matches[next]!.range);
    editor.revealRangeInCenterIfOutsideViewport(matches[next]!.range);
    editor.focus();
  };

  const replaceCurrent = () => {
    const editor = editorRef.current;
    const matches = findMatches();
    if (!editor || matches.length === 0) return;
    const index = currentMatchIndex(matches);
    const match = matches[index < 0 ? 0 : index]!;
    editor.executeEdits("janus-studio-find-replace", [{
      range: match.range,
      text: replaceValue,
      forceMoveMarkers: true,
    }]);
    requestAnimationFrame(() => revealMatch(1));
  };

  const replaceAll = () => {
    const editor = editorRef.current;
    const matches = findMatches();
    if (!editor || matches.length === 0) return;
    editor.executeEdits(
      "janus-studio-find-replace-all",
      matches.slice().reverse().map(({ range }) => ({
        range,
        text: replaceValue,
        forceMoveMarkers: true,
      })),
    );
    editor.focus();
  };

  const runContextAction = (action: () => void) => {
    action();
    setContextMenu(null);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const navigateContextMenu = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [],
    );
    if (!items.length) return;
    const active = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (active + 1 + items.length) % items.length
          : (active - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const hasSelection = Boolean(contextMenu?.selectedText.trim());
  const contextTarget = contextMenu?.selectedText.trim() || value;
  const editorSelection = () => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    const selected = selection && model ? model.getValueInRange(selection) : "";
    return selected.trim() ? selected : undefined;
  };
  const openCommandPalette = () => {
    setContextMenu(null);
    setSearchMode(null);
    setCommandPaletteOpen(true);
  };
  const commandItems = [
    {
      id: "run",
      category: t("查询", "Query"),
      label: t("运行当前查询", "Run current query"),
      detail: t("运行选中语句；未选择时运行全文", "Run the selection or the entire query"),
      shortcut: displayShortcut(runShortcut),
      icon: <Play size={17} fill="currentColor" />,
      disabled: !canRun || !value.trim(),
      action: () => onRun(editorSelection()),
    },
    {
      id: "format",
      category: t("编辑", "Edit"),
      label: t("格式化 Gremlin", "Format Gremlin"),
      detail: t("整理缩进与 Traversal Step", "Arrange indentation and traversal steps"),
      shortcut: displayShortcut(formatShortcut),
      icon: <AlignLeft size={17} />,
      disabled: readOnly || !value.trim(),
      action: onFormat,
    },
    {
      id: "explain",
      category: t("分析", "Analyze"),
      label: "Explain",
      detail: t("查看遍历策略优化计划", "Inspect traversal strategy optimization"),
      shortcut: "",
      icon: <GitBranch size={17} />,
      disabled: !canRun || !value.trim(),
      action: () => onExplain(editorSelection()),
    },
    {
      id: "profile",
      category: t("分析", "Analyze"),
      label: "Profile",
      detail: t("分析每个 Step 的实际耗时", "Measure execution time for every step"),
      shortcut: "",
      icon: <Activity size={17} />,
      disabled: !canRun || !value.trim(),
      action: () => onProfile(editorSelection()),
    },
    {
      id: "find",
      category: t("导航", "Navigate"),
      label: t("查找", "Find"),
      detail: t("在当前查询中定位文本", "Locate text in the current query"),
      shortcut: displayShortcut("Mod+F"),
      icon: <Search size={17} />,
      disabled: false,
      action: () => openSearch("find"),
    },
    {
      id: "replace",
      category: t("编辑", "Edit"),
      label: t("查找并替换", "Find and replace"),
      detail: t("替换当前匹配或全部匹配", "Replace the current match or every match"),
      shortcut: displayShortcut(findReplaceShortcut),
      icon: <Replace size={17} />,
      disabled: false,
      action: () => openSearch("replace"),
    },
    {
      id: "suggest",
      category: t("编辑", "Edit"),
      label: t("触发代码补全", "Trigger suggestions"),
      detail: t("显示 Schema 与 Gremlin Step 建议", "Show Schema and Gremlin step suggestions"),
      shortcut: displayShortcut("Mod+Space"),
      icon: <Sparkles size={17} />,
      disabled: false,
      action: () => triggerEditorAction("editor.action.triggerSuggest"),
    },
  ];
  const normalizedCommandQuery = commandQuery.trim().toLocaleLowerCase();
  const filteredCommands = commandItems.filter((item) =>
    `${item.label} ${item.detail} ${item.category} ${item.id}`.toLocaleLowerCase().includes(normalizedCommandQuery),
  );
  const executeCommand = (index: number) => {
    const command = filteredCommands[index];
    if (!command || command.disabled) return;
    setCommandPaletteOpen(false);
    command.action();
  };
  const moveCommandSelection = (direction: 1 | -1) => {
    setActiveCommandIndex((current) => {
      if (!filteredCommands.length) return 0;
      for (let offset = 1; offset <= filteredCommands.length; offset += 1) {
        const next = (current + direction * offset + filteredCommands.length) % filteredCommands.length;
        if (!filteredCommands[next]?.disabled) return next;
      }
      return current;
    });
  };

  useEffect(() => {
    if (!commandPaletteOpen) return;
    const handleCommandKeys = (event: KeyboardEvent) => {
      if (!["Escape", "ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        requestAnimationFrame(() => editorRef.current?.focus());
      } else if (event.key === "ArrowDown") {
        moveCommandSelection(1);
      } else if (event.key === "ArrowUp") {
        moveCommandSelection(-1);
      } else {
        executeCommand(activeCommandIndex);
      }
    };
    window.addEventListener("keydown", handleCommandKeys, true);
    return () => window.removeEventListener("keydown", handleCommandKeys, true);
  }, [activeCommandIndex, commandPaletteOpen, filteredCommands]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    commandListRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${activeCommandIndex}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeCommandIndex, commandPaletteOpen]);
  const searchMatches = findMatches();
  const selectedMatchIndex = currentMatchIndex(searchMatches);
  const menu = contextMenu && createPortal(
    <div
      ref={menuRef}
      className="gremlin-context-menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      role="menu"
      aria-label={t("Gremlin 编辑器操作", "Gremlin editor actions")}
      onKeyDown={navigateContextMenu}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="gremlin-context-menu-header">
        <div>
          <span>GREMLIN ACTIONS</span>
          <strong>{t("编辑器操作", "Editor actions")}</strong>
        </div>
        <div className="gremlin-context-menu-context">
          {hasSelection
            ? t("操作选中内容", "Selection scope")
            : t("操作当前查询", "Query scope")}
        </div>
        <button
          type="button"
          className="gremlin-context-menu-close"
          onClick={() => setContextMenu(null)}
          aria-label={t("关闭菜单", "Close menu")}
        >
          <X size={15} />
        </button>
      </header>

      <div className="gremlin-context-menu-group is-featured" role="group">
        {readOnly ? (
          <button type="button" role="menuitem" className="gremlin-context-menu-item is-danger" onClick={() => runContextAction(onStop)}>
            <span className="gremlin-context-menu-icon"><Square size={15} fill="currentColor" /></span>
            <span><strong>{t("停止正在运行的查询", "Stop running query")}</strong><small>{t("请求停止服务器执行", "Request server cancellation")}</small></span>
            <kbd>{displayShortcut(stopShortcut)}</kbd>
          </button>
        ) : (
          <button
            type="button"
            role="menuitem"
            className="gremlin-context-menu-item is-primary"
            disabled={!canRun || !contextTarget.trim()}
            onClick={() => runContextAction(() => onRun(hasSelection ? contextMenu.selectedText : undefined))}
          >
            <span className="gremlin-context-menu-icon"><Play size={16} fill="currentColor" /></span>
            <span>
              <strong>{hasSelection ? t("运行选中内容", "Run selection") : t("运行当前查询", "Run current query")}</strong>
              <small>{canRun ? t("发送至当前 JanusGraph 连接", "Send to the active JanusGraph connection") : t("请先选择可用连接", "Select an active connection first")}</small>
            </span>
            <kbd>{displayShortcut(runShortcut)}</kbd>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className="gremlin-context-menu-item"
          disabled={readOnly || !value.trim()}
          onClick={() => runContextAction(onFormat)}
        >
          <span className="gremlin-context-menu-icon"><AlignLeft size={16} /></span>
          <span><strong>{t("格式化 Gremlin", "Format Gremlin")}</strong><small>{t("整理缩进与 Traversal Step", "Arrange indentation and traversal steps")}</small></span>
          <kbd>{displayShortcut(formatShortcut)}</kbd>
        </button>
      </div>

      <div className="gremlin-context-menu-group is-analysis" role="group" aria-label={t("查询分析", "Query analysis")}>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" disabled={!canRun || !contextTarget.trim()} onClick={() => runContextAction(() => onExplain(hasSelection ? contextMenu.selectedText : undefined))}>
          <span className="gremlin-context-menu-icon"><GitBranch size={16} /></span>
          <span><strong>Explain</strong><small>{t("查看遍历策略优化计划", "Inspect traversal strategy optimization")}</small></span>
        </button>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" disabled={!canRun || !contextTarget.trim()} onClick={() => runContextAction(() => onProfile(hasSelection ? contextMenu.selectedText : undefined))}>
          <span className="gremlin-context-menu-icon"><Activity size={16} /></span>
          <span><strong>Profile</strong><small>{t("分析每个 Step 的实际耗时", "Measure execution time for every step")}</small></span>
        </button>
      </div>

      <div className="gremlin-context-menu-group is-compact" role="group" aria-label={t("编辑操作", "Editing actions")}>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" disabled={!contextMenu.canUndo} onClick={() => triggerEditorAction("undo")}><span className="gremlin-context-menu-icon"><Undo2 size={15} /></span><strong>{t("撤销", "Undo")}</strong><kbd>{displayShortcut("Mod+Z")}</kbd></button>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" disabled={!contextMenu.canRedo} onClick={() => triggerEditorAction("redo")}><span className="gremlin-context-menu-icon"><Redo2 size={15} /></span><strong>{t("重做", "Redo")}</strong><kbd>{displayShortcut("Mod+Shift+Z")}</kbd></button>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" disabled={readOnly || !hasSelection} onClick={() => triggerEditorAction("editor.action.clipboardCutAction")}><span className="gremlin-context-menu-icon"><Scissors size={15} /></span><strong>{t("剪切", "Cut")}</strong><kbd>{displayShortcut("Mod+X")}</kbd></button>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" disabled={!hasSelection} onClick={() => triggerEditorAction("editor.action.clipboardCopyAction")}><span className="gremlin-context-menu-icon"><Copy size={15} /></span><strong>{t("复制", "Copy")}</strong><kbd>{displayShortcut("Mod+C")}</kbd></button>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" disabled={readOnly} onClick={() => triggerEditorAction("editor.action.clipboardPasteAction")}><span className="gremlin-context-menu-icon"><ClipboardPaste size={15} /></span><strong>{t("粘贴", "Paste")}</strong><kbd>{displayShortcut("Mod+V")}</kbd></button>
      </div>

      <div className="gremlin-context-menu-group is-compact" role="group" aria-label={t("导航与命令", "Navigation and commands")}>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" onClick={() => openSearch("find")}><span className="gremlin-context-menu-icon"><Search size={15} /></span><strong>{t("查找", "Find")}</strong><kbd>{displayShortcut("Mod+F")}</kbd></button>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" onClick={() => openSearch("replace")}><span className="gremlin-context-menu-icon"><Replace size={15} /></span><strong>{t("查找并替换", "Find and replace")}</strong><kbd>{displayShortcut(findReplaceShortcut)}</kbd></button>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" onClick={() => triggerEditorAction("editor.action.triggerSuggest")}><span className="gremlin-context-menu-icon"><Sparkles size={15} /></span><strong>{t("触发代码补全", "Trigger suggestions")}</strong><kbd>{displayShortcut("Mod+Space")}</kbd></button>
        <button type="button" role="menuitem" className="gremlin-context-menu-item" onClick={openCommandPalette}><span className="gremlin-context-menu-icon"><Command size={15} /></span><strong>{t("命令面板", "Command palette")}</strong><kbd>F1</kbd></button>
      </div>
    </div>,
    document.body,
  );

  return (
    <div className="gremlin-editor" aria-label={ariaLabel}>
      {!value && <span className="gremlin-editor-placeholder">{placeholder}</span>}
      <Editor
        path={`janusgraph://query/${modelId}.gremlin`}
        language="gremlin"
        value={value}
        beforeMount={configureMonaco}
        onMount={mount}
        onChange={(next) => onChange(next ?? "")}
        theme={theme}
        options={{
          ariaLabel,
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          contextmenu: false,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          find: { addExtraSpaceOnTop: false },
          folding: true,
          foldingHighlight: true,
          fontFamily,
          fontLigatures: true,
          fontSize,
          formatOnPaste: true,
          glyphMargin: false,
          lineDecorationsWidth: 10,
          lineHeight: Math.round(fontSize * 1.65),
          lineNumbers: "on",
          lineNumbersMinChars: 3,
          matchBrackets: "always",
          minimap: { enabled: false },
          padding: { top: 18, bottom: 18 },
          readOnly,
          renderLineHighlight: "line",
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          stickyScroll: { enabled: false },
          suggest: {
            preview: true,
            showInlineDetails: false,
            showStatusBar: false,
            showWords: false,
          },
          suggestFontSize: Math.min(fontSize, 16),
          suggestLineHeight: 32,
          tabSize: 2,
          wordWrap: "on",
          wrappingIndent: "indent",
        }}
      />
      {searchMode && (
        <section
          className={`gremlin-search-panel ${searchMode === "replace" ? "has-replace" : ""}`}
          aria-label={searchMode === "replace" ? t("查找并替换", "Find and replace") : t("查找", "Find")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setSearchMode(null);
              editorRef.current?.focus();
            } else if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
              event.preventDefault();
              revealMatch(event.shiftKey ? -1 : 1);
            }
          }}
        >
          <div className="gremlin-search-title">
            <span>SEARCH / QUERY</span>
            <strong>{searchMode === "replace" ? t("查找与替换", "Find & replace") : t("查找当前查询", "Find in query")}</strong>
          </div>
          <div className="gremlin-search-row">
            <Search size={17} />
            <input
              ref={searchInputRef}
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              placeholder={t("输入要查找的内容", "Find text")}
              aria-label={t("查找内容", "Find text")}
            />
            <div className="gremlin-search-controls">
              <button
                type="button"
                className={matchCase ? "is-active" : ""}
                onClick={() => setMatchCase((current) => !current)}
                title={t("区分大小写", "Match case")}
                aria-pressed={matchCase}
              >
                <CaseSensitive size={18} />
              </button>
              <output>{searchMatches.length === 0 ? "0 / 0" : `${Math.max(1, selectedMatchIndex + 1)} / ${searchMatches.length}`}</output>
              <button type="button" onClick={() => revealMatch(-1)} disabled={!searchMatches.length} aria-label={t("上一个匹配", "Previous match")}><ChevronUp size={18} /></button>
              <button type="button" onClick={() => revealMatch(1)} disabled={!searchMatches.length} aria-label={t("下一个匹配", "Next match")}><ChevronDown size={18} /></button>
              <button type="button" onClick={() => {
                setSearchMode(null);
                editorRef.current?.focus();
              }} aria-label={t("关闭查找", "Close search")}><X size={18} /></button>
            </div>
          </div>
          {searchMode === "replace" && (
            <div className="gremlin-search-row gremlin-replace-row">
              <Replace size={17} />
              <input
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.target.value)}
                placeholder={t("替换为", "Replace with")}
                aria-label={t("替换内容", "Replacement text")}
              />
              <div className="gremlin-search-controls is-replace">
                <button type="button" className="search-text-action" onClick={replaceCurrent} disabled={!searchMatches.length}>{t("替换", "Replace")}</button>
                <button type="button" className="search-text-action" onClick={replaceAll} disabled={!searchMatches.length}>{t("全部替换", "Replace all")}</button>
              </div>
            </div>
          )}
        </section>
      )}
      {commandPaletteOpen && createPortal(
        <div
          className="gremlin-command-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setCommandPaletteOpen(false);
          }}
        >
          <section
            className="gremlin-command-palette"
            role="dialog"
            aria-modal="true"
            aria-label={t("命令面板", "Command palette")}
          >
            <header>
              <div>
                <span>COMMAND / GREMLIN</span>
                <strong>{t("命令面板", "Command palette")}</strong>
                <small>{t(
                  `${commandItems.length} 个可用命令 · 输入关键词筛选`,
                  `${commandItems.length} available commands · Type to filter`,
                )}</small>
              </div>
              <kbd>F1</kbd>
            </header>
            <label className="gremlin-command-search">
              <Search size={18} />
              <input
                ref={commandInputRef}
                value={commandQuery}
                onChange={(event) => {
                  setCommandQuery(event.target.value);
                  setActiveCommandIndex(0);
                }}
                placeholder={t("搜索操作，例如运行、格式化或查找", "Search run, format, find, and more")}
              />
            </label>
            <div ref={commandListRef} className="gremlin-command-list" role="listbox">
              {filteredCommands.map((item, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeCommandIndex}
                  data-command-index={index}
                  className={index === activeCommandIndex ? "is-active" : ""}
                  key={item.id}
                  disabled={item.disabled}
                  onPointerMove={() => setActiveCommandIndex(index)}
                  onFocus={() => setActiveCommandIndex(index)}
                  onClick={() => executeCommand(index)}
                >
                  <span className="command-icon">{item.icon}</span>
                  <span><b>{item.category}</b><strong>{item.label}</strong><small>{item.detail}</small></span>
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                  <CornerDownLeft className="command-enter" size={15} />
                </button>
              ))}
              {!filteredCommands.length && (
                <p>{t("没有匹配的命令", "No matching commands")}</p>
              )}
            </div>
            <footer>
              <span><kbd>↑↓</kbd>{t("选择", "Select")}</span>
              <span><kbd>Enter</kbd>{t("执行", "Run")}</span>
              <span><kbd>Esc</kbd>{t("关闭", "Close")}</span>
            </footer>
          </section>
        </div>,
        document.body,
      )}
      {menu}
    </div>
  );
}
