export type AppLocale =
  | "zh-CN"
  | "zh-TW"
  | "en-US"
  | "ja-JP"
  | "ko-KR"
  | "de-DE"
  | "fr-FR"
  | "es-ES"
  | "pt-BR"
  | "it-IT"
  | "ru-RU"
  | "pl-PL"
  | "tr-TR"
  | "vi-VN";
export type AppTheme = "dark" | "light" | "system";
export type AppDensity = "compact" | "comfortable";
export type AppFontFamily =
  | "mono"
  | "system"
  | "sans"
  | "humanist"
  | "technical"
  | "editorial"
  | "custom";
export type CodeFontFamily =
  | "jetbrains"
  | "fira-code"
  | "source-code"
  | "ibm-plex"
  | "system-mono"
  | "custom";
export type DefaultResultMode = "auto" | "graph" | "table" | "json";
export type QueryTabLayout = "scroll" | "wrap";
export type GraphLayoutMode = "force" | "radial" | "grid" | "hierarchical";
export type GraphLayoutConfiguration = {
  force: {
    repulsion: number;
    linkDistance: number;
    centerStrength: number;
    damping: number;
  };
  hierarchical: {
    direction: "top-down" | "left-right";
    levelGap: number;
    nodeGap: number;
  };
  radial: {
    ringGap: number;
    ringCapacity: number;
    startAngle: number;
  };
  grid: {
    columns: number;
    columnGap: number;
    rowGap: number;
  };
};
export type ShortcutAction =
  | "openSettings"
  | "saveQuery"
  | "runQuery"
  | "stopQuery"
  | "formatQuery"
  | "findReplace"
  | "beginTransaction"
  | "commitTransaction"
  | "rollbackTransaction"
  | "newQueryTab"
  | "duplicateQueryTab"
  | "closeQueryTab"
  | "restoreClosedTab"
  | "nextQueryTab"
  | "previousQueryTab"
  | "toggleSidebar"
  | "toggleSuggestions";
export type KeyboardShortcuts = Record<ShortcutAction, string>;

export type AppSettings = {
  locale: AppLocale;
  theme: AppTheme;
  density: AppDensity;
  fontFamily: AppFontFamily;
  customUiFont: string;
  codeFontFamily: CodeFontFamily;
  customCodeFont: string;
  uiFontSize: number;
  editorFontSize: number;
  reduceMotion: boolean;
  graphNodeLimit: number;
  graphEdgeLimit: number;
  graphShowLabels: boolean;
  graphShowGrid: boolean;
  graphLayout: GraphLayoutMode;
  graphLayoutConfiguration: GraphLayoutConfiguration;
  graphVertexLabelFields: string;
  graphEdgeLabelFields: string;
  defaultResultMode: DefaultResultMode;
  queryTabLayout: QueryTabLayout;
  querySuggestionsEnabled: boolean;
  historyLimit: number;
  sidebarCollapsed: boolean;
  keyboardShortcuts: KeyboardShortcuts;
};

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  openSettings: "Mod+,",
  saveQuery: "Mod+S",
  runQuery: "Mod+Enter",
  stopQuery: "Mod+.",
  formatQuery: "Mod+Shift+F",
  findReplace: "Mod+R",
  beginTransaction: "Mod+Alt+B",
  commitTransaction: "Mod+Alt+Enter",
  rollbackTransaction: "Mod+Alt+Backspace",
  newQueryTab: "Mod+T",
  duplicateQueryTab: "Mod+Shift+D",
  closeQueryTab: "Mod+W",
  restoreClosedTab: "Mod+Shift+T",
  nextQueryTab: "Mod+]",
  previousQueryTab: "Mod+BracketLeft",
  toggleSidebar: "Mod+B",
  toggleSuggestions: "Mod+Space",
};

export const DEFAULT_SETTINGS: AppSettings = {
  locale: "zh-CN",
  theme: "dark",
  density: "comfortable",
  fontFamily: "sans",
  customUiFont: "",
  codeFontFamily: "jetbrains",
  customCodeFont: "",
  uiFontSize: 16,
  editorFontSize: 18,
  reduceMotion: false,
  graphNodeLimit: 120,
  graphEdgeLimit: 240,
  graphShowLabels: true,
  graphShowGrid: true,
  graphLayout: "force",
  graphLayoutConfiguration: {
    force: {
      repulsion: 7200,
      linkDistance: 172,
      centerStrength: 6,
      damping: 86,
    },
    hierarchical: {
      direction: "top-down",
      levelGap: 150,
      nodeGap: 150,
    },
    radial: {
      ringGap: 132,
      ringCapacity: 28,
      startAngle: -90,
    },
    grid: {
      columns: 0,
      columnGap: 150,
      rowGap: 118,
    },
  },
  graphVertexLabelFields: "label,id",
  graphEdgeLabelFields: "label,id",
  defaultResultMode: "auto",
  queryTabLayout: "scroll",
  querySuggestionsEnabled: true,
  historyLimit: 500,
  sidebarCollapsed: false,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
};

const STORAGE_KEY = "janusgraph.settings.v8";
const LEGACY_STORAGE_KEYS = [
  "janusgraph.settings.v7",
  "janusgraph.settings.v6",
  "janusgraph.settings.v5",
  "janusgraph.settings.v4",
  "janusgraph.settings.v3",
];

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : fallback;
}

export function loadSettings(): AppSettings {
  try {
    const currentSettings = localStorage.getItem(STORAGE_KEY);
    const legacySettings = LEGACY_STORAGE_KEYS.map((key) =>
      localStorage.getItem(key),
    ).find(Boolean);
    const stored = JSON.parse(
      currentSettings ?? legacySettings ?? "{}",
    ) as Partial<AppSettings> & {
      graphRepulsion?: number;
      graphLinkDistance?: number;
      graphCenterStrength?: number;
      graphDamping?: number;
    };
    const migrateGraphCaptions = currentSettings === null && legacySettings === undefined;
    return {
      locale: oneOf(
        stored.locale,
        [
          "zh-CN",
          "zh-TW",
          "en-US",
          "ja-JP",
          "ko-KR",
          "de-DE",
          "fr-FR",
          "es-ES",
          "pt-BR",
          "it-IT",
          "ru-RU",
          "pl-PL",
          "tr-TR",
          "vi-VN",
        ],
        DEFAULT_SETTINGS.locale,
      ),
      theme: oneOf(stored.theme, ["dark", "light", "system"], DEFAULT_SETTINGS.theme),
      density: oneOf(
        stored.density,
        ["compact", "comfortable"],
        DEFAULT_SETTINGS.density,
      ),
      fontFamily: oneOf(
        stored.fontFamily,
        ["mono", "system", "sans", "humanist", "technical", "editorial", "custom"],
        DEFAULT_SETTINGS.fontFamily,
      ),
      customUiFont:
        typeof stored.customUiFont === "string"
          ? stored.customUiFont.slice(0, 180)
          : DEFAULT_SETTINGS.customUiFont,
      codeFontFamily: oneOf(
        stored.codeFontFamily,
        ["jetbrains", "fira-code", "source-code", "ibm-plex", "system-mono", "custom"],
        DEFAULT_SETTINGS.codeFontFamily,
      ),
      customCodeFont:
        typeof stored.customCodeFont === "string"
          ? stored.customCodeFont.slice(0, 180)
          : DEFAULT_SETTINGS.customCodeFont,
      uiFontSize: clamp(stored.uiFontSize, 11, 30, DEFAULT_SETTINGS.uiFontSize),
      editorFontSize: clamp(
        stored.editorFontSize,
        12,
        40,
        DEFAULT_SETTINGS.editorFontSize,
      ),
      reduceMotion: Boolean(stored.reduceMotion),
      graphNodeLimit: clamp(
        stored.graphNodeLimit,
        10,
        500,
        DEFAULT_SETTINGS.graphNodeLimit,
      ),
      graphEdgeLimit: clamp(
        stored.graphEdgeLimit,
        10,
        1_000,
        DEFAULT_SETTINGS.graphEdgeLimit,
      ),
      graphShowLabels:
        stored.graphShowLabels === undefined
          ? DEFAULT_SETTINGS.graphShowLabels
          : Boolean(stored.graphShowLabels),
      graphShowGrid:
        stored.graphShowGrid === undefined
          ? DEFAULT_SETTINGS.graphShowGrid
          : Boolean(stored.graphShowGrid),
      graphLayout: oneOf(
        stored.graphLayout,
        ["force", "radial", "grid", "hierarchical"],
        DEFAULT_SETTINGS.graphLayout,
      ),
      graphLayoutConfiguration: {
        force: {
          repulsion: clamp(
            stored.graphLayoutConfiguration?.force?.repulsion ?? stored.graphRepulsion,
            1_000,
            20_000,
            DEFAULT_SETTINGS.graphLayoutConfiguration.force.repulsion,
          ),
          linkDistance: clamp(
            stored.graphLayoutConfiguration?.force?.linkDistance ?? stored.graphLinkDistance,
            80,
            320,
            DEFAULT_SETTINGS.graphLayoutConfiguration.force.linkDistance,
          ),
          centerStrength: clamp(
            stored.graphLayoutConfiguration?.force?.centerStrength ?? stored.graphCenterStrength,
            1,
            20,
            DEFAULT_SETTINGS.graphLayoutConfiguration.force.centerStrength,
          ),
          damping: clamp(
            stored.graphLayoutConfiguration?.force?.damping ?? stored.graphDamping,
            70,
            96,
            DEFAULT_SETTINGS.graphLayoutConfiguration.force.damping,
          ),
        },
        hierarchical: {
          direction: oneOf(
            stored.graphLayoutConfiguration?.hierarchical?.direction,
            ["top-down", "left-right"],
            DEFAULT_SETTINGS.graphLayoutConfiguration.hierarchical.direction,
          ),
          levelGap: clamp(
            stored.graphLayoutConfiguration?.hierarchical?.levelGap,
            90,
            280,
            DEFAULT_SETTINGS.graphLayoutConfiguration.hierarchical.levelGap,
          ),
          nodeGap: clamp(
            stored.graphLayoutConfiguration?.hierarchical?.nodeGap,
            80,
            260,
            DEFAULT_SETTINGS.graphLayoutConfiguration.hierarchical.nodeGap,
          ),
        },
        radial: {
          ringGap: clamp(
            stored.graphLayoutConfiguration?.radial?.ringGap,
            80,
            240,
            DEFAULT_SETTINGS.graphLayoutConfiguration.radial.ringGap,
          ),
          ringCapacity: clamp(
            stored.graphLayoutConfiguration?.radial?.ringCapacity,
            8,
            64,
            DEFAULT_SETTINGS.graphLayoutConfiguration.radial.ringCapacity,
          ),
          startAngle: clamp(
            stored.graphLayoutConfiguration?.radial?.startAngle,
            -180,
            180,
            DEFAULT_SETTINGS.graphLayoutConfiguration.radial.startAngle,
          ),
        },
        grid: {
          columns: clamp(
            stored.graphLayoutConfiguration?.grid?.columns,
            0,
            24,
            DEFAULT_SETTINGS.graphLayoutConfiguration.grid.columns,
          ),
          columnGap: clamp(
            stored.graphLayoutConfiguration?.grid?.columnGap,
            80,
            260,
            DEFAULT_SETTINGS.graphLayoutConfiguration.grid.columnGap,
          ),
          rowGap: clamp(
            stored.graphLayoutConfiguration?.grid?.rowGap,
            70,
            220,
            DEFAULT_SETTINGS.graphLayoutConfiguration.grid.rowGap,
          ),
        },
      },
      graphVertexLabelFields:
        migrateGraphCaptions
          ? DEFAULT_SETTINGS.graphVertexLabelFields
          : typeof stored.graphVertexLabelFields === "string"
          ? stored.graphVertexLabelFields === "name,title,code,~label"
            ? DEFAULT_SETTINGS.graphVertexLabelFields
            : stored.graphVertexLabelFields
          : DEFAULT_SETTINGS.graphVertexLabelFields,
      graphEdgeLabelFields:
        migrateGraphCaptions
          ? DEFAULT_SETTINGS.graphEdgeLabelFields
          : typeof stored.graphEdgeLabelFields === "string"
          ? stored.graphEdgeLabelFields === "name,type,~label"
            ? DEFAULT_SETTINGS.graphEdgeLabelFields
            : stored.graphEdgeLabelFields
          : DEFAULT_SETTINGS.graphEdgeLabelFields,
      defaultResultMode: oneOf(
        stored.defaultResultMode,
        ["auto", "graph", "table", "json"],
        DEFAULT_SETTINGS.defaultResultMode,
      ),
      queryTabLayout: oneOf(
        stored.queryTabLayout,
        ["scroll", "wrap"],
        DEFAULT_SETTINGS.queryTabLayout,
      ),
      querySuggestionsEnabled:
        stored.querySuggestionsEnabled === undefined
          ? DEFAULT_SETTINGS.querySuggestionsEnabled
          : Boolean(stored.querySuggestionsEnabled),
      historyLimit: clamp(
        stored.historyLimit,
        100,
        2_000,
        DEFAULT_SETTINGS.historyLimit,
      ),
      sidebarCollapsed:
        stored.sidebarCollapsed === undefined
          ? DEFAULT_SETTINGS.sidebarCollapsed
          : Boolean(stored.sidebarCollapsed),
      keyboardShortcuts: Object.fromEntries(
        Object.entries(DEFAULT_KEYBOARD_SHORTCUTS).map(([action, fallback]) => [
          action,
          typeof stored.keyboardShortcuts?.[action as ShortcutAction] === "string"
            ? stored.keyboardShortcuts[action as ShortcutAction].slice(0, 48)
            : fallback,
        ]),
      ) as KeyboardShortcuts,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function resolvedTheme(theme: AppTheme): "dark" | "light" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applySettings(settings: AppSettings): void {
  const root = document.documentElement;
  root.lang = settings.locale;
  root.dataset.theme = resolvedTheme(settings.theme);
  root.dataset.density = settings.density;
  root.dataset.fontFamily = settings.fontFamily;
  root.dataset.codeFont = settings.codeFontFamily;
  root.dataset.reduceMotion = String(settings.reduceMotion);
  delete root.dataset.scale;
  root.style.setProperty("--user-font-size", `${settings.uiFontSize}px`);
  root.style.setProperty("--editor-font-size", `${settings.editorFontSize}px`);
  root.style.setProperty(
    "--custom-ui-font",
    settings.customUiFont.trim() || '"Noto Sans Variable"',
  );
  root.style.setProperty(
    "--custom-code-font",
    settings.customCodeFont.trim() || '"JetBrains Mono Variable"',
  );
}
