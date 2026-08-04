import type { SecurityStorageStatus } from "@janusgraph/domain";
import {
  Code2,
  Keyboard,
  Languages,
  LockKeyhole,
  Network,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Waypoints,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { PageHeader } from "../../components/ui";
import { localizedLanguageOptions, useTranslate } from "../../lib/i18n";
import { shortcutFromEvent, shortcutLabel } from "../../lib/keyboard";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type GraphLayoutConfiguration,
  type ShortcutAction,
} from "../../lib/settings";

function SettingSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className={`switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

const SHORTCUT_OPTIONS: Array<{
  action: ShortcutAction;
  label: string;
  english: string;
}> = [
  { action: "openSettings", label: "打开偏好设置", english: "Open preferences" },
  { action: "saveQuery", label: "保存当前查询", english: "Save current query" },
  { action: "runQuery", label: "运行当前查询", english: "Run current query" },
  { action: "stopQuery", label: "停止当前查询", english: "Stop current query" },
  { action: "formatQuery", label: "格式化当前查询", english: "Format current query" },
  { action: "findReplace", label: "查找并替换", english: "Find and replace" },
  { action: "beginTransaction", label: "开启当前标签页事务", english: "Begin tab transaction" },
  { action: "commitTransaction", label: "提交当前标签页事务", english: "Commit tab transaction" },
  { action: "rollbackTransaction", label: "回滚当前标签页事务", english: "Rollback tab transaction" },
  { action: "newQueryTab", label: "新建查询标签页", english: "New query tab" },
  { action: "duplicateQueryTab", label: "复制当前标签页", english: "Duplicate current tab" },
  { action: "closeQueryTab", label: "关闭当前标签页", english: "Close current tab" },
  { action: "restoreClosedTab", label: "恢复关闭的标签页", english: "Reopen closed tab" },
  { action: "nextQueryTab", label: "切换到下一标签页", english: "Next query tab" },
  { action: "previousQueryTab", label: "切换到上一标签页", english: "Previous query tab" },
  { action: "toggleSidebar", label: "收起或展开侧栏", english: "Toggle sidebar" },
  { action: "toggleSuggestions", label: "显示或关闭输入建议", english: "Toggle suggestions" },
];

function ShortcutRecorder({
  label,
  value,
  conflict,
  onChange,
}: {
  label: string;
  value: string;
  conflict: boolean;
  onChange: (shortcut: string) => void;
}) {
  const t = useTranslate();
  const [recording, setRecording] = useState(false);
  return (
    <div className="shortcut-row">
      <div>
        <strong>{label}</strong>
        <small>
          {conflict
            ? t("与其他操作冲突，请重新输入", "Conflicts with another action")
            : t("点击后直接按下组合键", "Click, then press a key combination")}
        </small>
      </div>
      <button
        type="button"
        className={`shortcut-recorder ${recording ? "is-recording" : ""} ${conflict ? "has-conflict" : ""}`}
        aria-label={t(`设置${label}快捷键`, `Set shortcut for ${label}`)}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const shortcut = shortcutFromEvent(event.nativeEvent);
          if (!shortcut) return;
          onChange(shortcut);
          setRecording(false);
          event.currentTarget.blur();
        }}
      >
        <Keyboard size={16} />
        <kbd>{recording ? t("请按组合键", "Press shortcut") : shortcutLabel(value)}</kbd>
      </button>
    </div>
  );
}

export function SettingsPage({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const t = useTranslate();
  const [activeSection, setActiveSection] = useState<
    "general" | "typography" | "graph" | "behavior" | "shortcuts" | "security"
  >("general");
  const [security, setSecurity] = useState<SecurityStorageStatus | null>(null);
  const update = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ) => onChange({ ...settings, [key]: value });
  const updateLayoutConfiguration = <
    Mode extends keyof GraphLayoutConfiguration,
  >(
    mode: Mode,
    patch: Partial<GraphLayoutConfiguration[Mode]>,
  ) =>
    update("graphLayoutConfiguration", {
      ...settings.graphLayoutConfiguration,
      [mode]: {
        ...settings.graphLayoutConfiguration[mode],
        ...patch,
      },
    });
  const shortcutConflicts = new Set(
    Object.values(settings.keyboardShortcuts).filter(
      (shortcut, index, values) =>
        shortcut && values.indexOf(shortcut) !== index,
    ),
  );

  useEffect(() => {
    if (activeSection !== "security") return;
    let mounted = true;
    const loadSecurityStatus = async () => {
      try {
        const api = window.janusGraphDesktop;
        if (!api) throw new Error("Desktop API unavailable");
        const status = await api.security.status();
        if (mounted) setSecurity(status);
      } catch {
        if (mounted) {
          setSecurity({
            mode: "local-fallback",
            osEncryptionAvailable: false,
            fallbackKeyPresent: false,
            description: "",
          });
        }
      }
    };
    void loadSecurityStatus();
    return () => {
      mounted = false;
    };
  }, [activeSection]);

  return (
    <div className="page-scroll settings-page">
      <PageHeader
        eyebrow="PREFERENCES"
        title={t("偏好设置")}
        description={t(
          "设置保存在当前电脑并立即生效。",
          "Settings are stored on this computer and apply immediately.",
        )}
        actions={
          <button
            type="button"
            className="button secondary"
            onClick={() => onChange(DEFAULT_SETTINGS)}
          >
            <RotateCcw size={17} />
            {t("恢复默认设置")}
          </button>
        }
      />
      <div className="settings-layout">
      <nav className="settings-subnav" aria-label={t("偏好设置分类", "Preference categories")}>
        {([
          ["general", t("常规", "General"), t("语言、主题与界面密度", "Language, theme and density"), <Languages size={18} />],
          ["typography", t("外观与字体", "Appearance & type"), t("界面与代码字号", "UI and editor typography"), <SlidersHorizontal size={18} />],
          ["graph", t("图谱", "Graph"), t("渲染、标签与布局", "Rendering, captions and layouts"), <Network size={18} />],
          ["behavior", t("编辑器", "Editor"), t("查询、历史与建议", "Queries, history and suggestions"), <Code2 size={18} />],
          ["shortcuts", t("快捷键", "Shortcuts"), t("键盘操作映射", "Keyboard command map"), <Keyboard size={18} />],
          ["security", t("安全", "Security"), t("凭据与本地加密", "Credentials and local encryption"), <LockKeyhole size={18} />],
        ] as const).map(([id, label, description, icon]) => (
          <button
            type="button"
            key={id}
            className={activeSection === id ? "is-active" : ""}
            aria-current={activeSection === id ? "page" : undefined}
            onClick={() => setActiveSection(id)}
          >
            <span>{icon}</span>
            <span><strong>{label}</strong><small>{description}</small></span>
          </button>
        ))}
      </nav>
      <div className="settings-grid">
      <section className="settings-group settings-general" hidden={activeSection !== "general"}>
        <header>
          <Languages size={21} />
          <div>
            <span className="eyebrow">GENERAL</span>
            <h2>{t("界面与可访问性")}</h2>
          </div>
        </header>
        <div className="settings-fields">
          <label className="field">
            <span>{t("界面语言")}</span>
            <SelectControl
              ariaLabel={t("界面语言")}
              value={settings.locale}
              onValueChange={(value) =>
                update("locale", value as AppSettings["locale"])
              }
              options={localizedLanguageOptions(settings.locale)}
            />
          </label>
          <label className="field">
            <span>{t("主题")}</span>
            <SelectControl
              ariaLabel={t("主题")}
              value={settings.theme}
              onValueChange={(value) =>
                update("theme", value as AppSettings["theme"])
              }
              options={[
                { value: "dark", label: t("深色") },
                { value: "light", label: t("浅色") },
                { value: "system", label: t("跟随系统") },
              ]}
            />
          </label>
          <div className="field settings-font-field">
            <span>{t("界面字体")}</span>
            <SelectControl
              ariaLabel={t("界面字体")}
              value={settings.fontFamily}
              onValueChange={(value) =>
                update(
                  "fontFamily",
                  value as AppSettings["fontFamily"],
                )
              }
              options={[
                {
                  value: "sans",
                  label: t("多语言无衬线", "Multilingual Sans"),
                  description: "Noto / PingFang / Segoe UI",
                },
                { value: "system", label: t("系统字体") },
                { value: "mono", label: t("等宽字体") },
                {
                  value: "humanist",
                  label: t("人文无衬线", "Humanist Sans"),
                  description: "Avenir Next / Segoe UI",
                },
                {
                  value: "technical",
                  label: t("技术展示体", "Technical Display"),
                  description: "Lexend + Noto multilingual fallback",
                },
                {
                  value: "editorial",
                  label: t("编辑无衬线", "Editorial Sans"),
                  description: "Aptos / Inter / Noto Sans",
                },
                {
                  value: "custom",
                  label: t("用户自定义字体", "Custom font"),
                  description: t("使用当前系统已安装字体", "Use a font installed on this system"),
                },
              ]}
            />
            {settings.fontFamily === "custom" && (
              <label className="font-custom-field">
                <span>{t("自定义界面字体", "Custom UI font")}</span>
                <input
                  value={settings.customUiFont}
                  onChange={(event) => update("customUiFont", event.target.value)}
                  placeholder='"HarmonyOS Sans SC", Inter'
                />
                <small>
                  {t(
                    "输入系统字体名称或 CSS 字体列表，修改后立即预览。",
                    "Enter an installed font name or CSS font list. Changes preview immediately.",
                  )}
                </small>
              </label>
            )}
          </div>
          <div className="field settings-font-field">
            <span>{t("代码与编辑器字体", "Code and editor font")}</span>
            <SelectControl
              ariaLabel={t("代码与编辑器字体", "Code and editor font")}
              value={settings.codeFontFamily}
              onValueChange={(value) =>
                update("codeFontFamily", value as AppSettings["codeFontFamily"])
              }
              options={[
                {
                  value: "jetbrains",
                  label: "JetBrains Mono",
                  description: t("清晰区分 0/O、1/l/I，默认推荐", "Clear 0/O and 1/l/I distinction; recommended"),
                },
                { value: "fira-code", label: "Fira Code", description: t("支持编程连字", "Programming ligatures") },
                { value: "source-code", label: "Source Code Pro", description: t("宽松、耐读", "Open and highly readable") },
                { value: "ibm-plex", label: "IBM Plex Mono" },
                { value: "system-mono", label: t("系统等宽字体", "System monospace") },
                { value: "custom", label: t("用户自定义字体", "Custom font") },
              ]}
            />
            {settings.codeFontFamily === "custom" && (
              <label className="font-custom-field">
                <span>{t("自定义代码字体", "Custom code font")}</span>
                <input
                  value={settings.customCodeFont}
                  onChange={(event) => update("customCodeFont", event.target.value)}
                  placeholder='"Maple Mono", "Cascadia Code"'
                />
                <small>
                  {t(
                    "可输入当前系统已安装的任意等宽字体。",
                    "Use any monospace font installed on this system.",
                  )}
                </small>
              </label>
            )}
          </div>
          <label className="field">
            <span>{t("界面密度")}</span>
            <SelectControl
              ariaLabel={t("界面密度")}
              value={settings.density}
              onValueChange={(value) =>
                update("density", value as AppSettings["density"])
              }
              options={[
                { value: "comfortable", label: t("舒适") },
                { value: "compact", label: t("紧凑") },
              ]}
            />
          </label>
        </div>
      </section>

      <section className="settings-group settings-typography" hidden={activeSection !== "typography"}>
        <header>
          <SlidersHorizontal size={21} />
          <div>
            <span className="eyebrow">DYNAMIC TYPE</span>
            <h2>{t("任意字体大小", "Flexible font sizing")}</h2>
          </div>
        </header>
        <label className="range-field">
          <span>
            <strong>{t("界面字号")}</strong>
            <output>{settings.uiFontSize}px</output>
          </span>
          <input
            type="range"
            min="11"
            max="30"
            step="1"
            value={settings.uiFontSize}
            onChange={(event) => update("uiFontSize", Number(event.target.value))}
          />
          <small>{t("支持 11–30px，所有布局随字号重新计算。", "11–30px. Layout dimensions adapt with the type scale.")}</small>
        </label>
        <label className="range-field">
          <span>
            <strong>{t("编辑器字号")}</strong>
            <output>{settings.editorFontSize}px</output>
          </span>
          <input
            type="range"
            min="12"
            max="40"
            step="1"
            value={settings.editorFontSize}
            onChange={(event) =>
              update("editorFontSize", Number(event.target.value))
            }
          />
          <small>{t("查询编辑器独立缩放，范围 12–40px。", "Independent editor scale from 12–40px.")}</small>
        </label>
      </section>

      <section className="settings-group settings-graph" hidden={activeSection !== "graph"}>
        <header>
          <Waypoints size={21} />
          <div>
            <span className="eyebrow">GRAPH CANVAS</span>
            <h2>{t("拓扑渲染")}</h2>
          </div>
        </header>
        <label className="field graph-layout-field">
          <span>{t("默认拓扑布局", "Default graph layout")}</span>
          <SelectControl
            ariaLabel={t("默认拓扑布局", "Default graph layout")}
            value={settings.graphLayout}
            onValueChange={(value) =>
              update("graphLayout", value as AppSettings["graphLayout"])
            }
            options={[
              {
                value: "force",
                label: t("力导向布局", "Force-directed"),
                description: t("适合探索关系与聚类", "Best for relationship exploration"),
              },
              {
                value: "hierarchical",
                label: t("层级布局", "Hierarchical"),
                description: t("按关系方向自上而下排列", "Top-down by edge direction"),
              },
              {
                value: "radial",
                label: t("环形布局", "Radial"),
                description: t("均匀展示全局结构", "Balanced overview of the graph"),
              },
              {
                value: "grid",
                label: t("网格布局", "Grid"),
                description: t("适合逐项比较顶点", "Best for scanning vertices"),
              },
            ]}
          />
        </label>
        <label className="range-field">
          <span>
            <strong>{t("顶点渲染上限")}</strong>
            <output>{settings.graphNodeLimit}</output>
          </span>
          <input
            type="range"
            min="10"
            max="500"
            step="10"
            value={settings.graphNodeLimit}
            onChange={(event) =>
              update("graphNodeLimit", Number(event.target.value))
            }
          />
        </label>
        {settings.graphLayout === "force" && (
          <div className="graph-layout-settings" data-layout="force">
            <div className="graph-layout-settings-header">
              <span className="graph-layout-token">F</span>
              <div>
                <strong>{t("力导向参数", "Force parameters")}</strong>
                <small>{t("控制物理聚类、关系张力和收敛速度。", "Tune clustering, link tension, and convergence.")}</small>
              </div>
            </div>
            <label className="range-field">
              <span>
                <strong>{t("节点斥力", "Node repulsion")}</strong>
                <output>{settings.graphLayoutConfiguration.force.repulsion}</output>
              </span>
              <input
                type="range"
                min="1000"
                max="20000"
                step="500"
                value={settings.graphLayoutConfiguration.force.repulsion}
                onChange={(event) =>
                  updateLayoutConfiguration("force", { repulsion: Number(event.target.value) })
                }
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("关系长度", "Link distance")}</strong>
                <output>{settings.graphLayoutConfiguration.force.linkDistance}</output>
              </span>
              <input
                type="range"
                min="80"
                max="320"
                step="4"
                value={settings.graphLayoutConfiguration.force.linkDistance}
                onChange={(event) =>
                  updateLayoutConfiguration("force", { linkDistance: Number(event.target.value) })
                }
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("中心引力", "Center gravity")}</strong>
                <output>{settings.graphLayoutConfiguration.force.centerStrength}</output>
              </span>
              <input
                type="range"
                min="1"
                max="20"
                step="1"
                value={settings.graphLayoutConfiguration.force.centerStrength}
                onChange={(event) =>
                  updateLayoutConfiguration("force", { centerStrength: Number(event.target.value) })
                }
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("运动阻尼", "Motion damping")}</strong>
                <output>{settings.graphLayoutConfiguration.force.damping}%</output>
              </span>
              <input
                type="range"
                min="70"
                max="96"
                step="1"
                value={settings.graphLayoutConfiguration.force.damping}
                onChange={(event) =>
                  updateLayoutConfiguration("force", { damping: Number(event.target.value) })
                }
              />
            </label>
          </div>
        )}
        {settings.graphLayout === "hierarchical" && (
          <div className="graph-layout-settings" data-layout="hierarchical">
            <div className="graph-layout-settings-header">
              <span className="graph-layout-token">H</span>
              <div>
                <strong>{t("层级布局参数", "Hierarchy parameters")}</strong>
                <small>{t("控制关系方向、层级深度和同层节点密度。", "Control flow direction, depth, and sibling density.")}</small>
              </div>
            </div>
            <label className="field graph-layout-direction">
              <span>{t("关系方向", "Flow direction")}</span>
              <SelectControl
                ariaLabel={t("层级关系方向", "Hierarchy direction")}
                value={settings.graphLayoutConfiguration.hierarchical.direction}
                onValueChange={(value) =>
                  updateLayoutConfiguration("hierarchical", {
                    direction: value as GraphLayoutConfiguration["hierarchical"]["direction"],
                  })
                }
                options={[
                  { value: "top-down", label: t("从上到下", "Top to bottom"), description: t("适合流程与依赖链", "Best for flows and dependency chains") },
                  { value: "left-right", label: t("从左到右", "Left to right"), description: t("适合宽屏和长路径", "Best for wide screens and long paths") },
                ]}
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("层级间距", "Level gap")}</strong>
                <output>{settings.graphLayoutConfiguration.hierarchical.levelGap}px</output>
              </span>
              <input
                type="range"
                min="90"
                max="280"
                step="5"
                value={settings.graphLayoutConfiguration.hierarchical.levelGap}
                onChange={(event) => updateLayoutConfiguration("hierarchical", { levelGap: Number(event.target.value) })}
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("同层节点间距", "Sibling gap")}</strong>
                <output>{settings.graphLayoutConfiguration.hierarchical.nodeGap}px</output>
              </span>
              <input
                type="range"
                min="80"
                max="260"
                step="5"
                value={settings.graphLayoutConfiguration.hierarchical.nodeGap}
                onChange={(event) => updateLayoutConfiguration("hierarchical", { nodeGap: Number(event.target.value) })}
              />
            </label>
          </div>
        )}
        {settings.graphLayout === "radial" && (
          <div className="graph-layout-settings" data-layout="radial">
            <div className="graph-layout-settings-header">
              <span className="graph-layout-token">R</span>
              <div>
                <strong>{t("环形布局参数", "Radial parameters")}</strong>
                <small>{t("控制每圈容量、圈层距离和起始方向。", "Control ring capacity, spacing, and starting direction.")}</small>
              </div>
            </div>
            <label className="range-field">
              <span>
                <strong>{t("圈层间距", "Ring gap")}</strong>
                <output>{settings.graphLayoutConfiguration.radial.ringGap}px</output>
              </span>
              <input type="range" min="80" max="240" step="4" value={settings.graphLayoutConfiguration.radial.ringGap} onChange={(event) => updateLayoutConfiguration("radial", { ringGap: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("每圈顶点数", "Vertices per ring")}</strong>
                <output>{settings.graphLayoutConfiguration.radial.ringCapacity}</output>
              </span>
              <input type="range" min="8" max="64" step="2" value={settings.graphLayoutConfiguration.radial.ringCapacity} onChange={(event) => updateLayoutConfiguration("radial", { ringCapacity: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("起始角度", "Start angle")}</strong>
                <output>{settings.graphLayoutConfiguration.radial.startAngle}°</output>
              </span>
              <input type="range" min="-180" max="180" step="15" value={settings.graphLayoutConfiguration.radial.startAngle} onChange={(event) => updateLayoutConfiguration("radial", { startAngle: Number(event.target.value) })} />
            </label>
          </div>
        )}
        {settings.graphLayout === "grid" && (
          <div className="graph-layout-settings" data-layout="grid">
            <div className="graph-layout-settings-header">
              <span className="graph-layout-token">G</span>
              <div>
                <strong>{t("网格布局参数", "Grid parameters")}</strong>
                <small>{t("控制列数以及横向、纵向阅读节奏。", "Control columns and horizontal / vertical rhythm.")}</small>
              </div>
            </div>
            <label className="range-field">
              <span>
                <strong>{t("固定列数", "Fixed columns")}</strong>
                <output>{settings.graphLayoutConfiguration.grid.columns === 0 ? t("自动", "Auto") : settings.graphLayoutConfiguration.grid.columns}</output>
              </span>
              <input type="range" min="0" max="24" step="1" value={settings.graphLayoutConfiguration.grid.columns} onChange={(event) => updateLayoutConfiguration("grid", { columns: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("列间距", "Column gap")}</strong>
                <output>{settings.graphLayoutConfiguration.grid.columnGap}px</output>
              </span>
              <input type="range" min="80" max="260" step="5" value={settings.graphLayoutConfiguration.grid.columnGap} onChange={(event) => updateLayoutConfiguration("grid", { columnGap: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("行间距", "Row gap")}</strong>
                <output>{settings.graphLayoutConfiguration.grid.rowGap}px</output>
              </span>
              <input type="range" min="70" max="220" step="5" value={settings.graphLayoutConfiguration.grid.rowGap} onChange={(event) => updateLayoutConfiguration("grid", { rowGap: Number(event.target.value) })} />
            </label>
          </div>
        )}
        <label className="field graph-label-field">
          <span>{t("顶点显示字段", "Vertex caption fields")}</span>
          <input
            value={settings.graphVertexLabelFields}
            onChange={(event) =>
              update("graphVertexLabelFields", event.target.value)
            }
            placeholder="label,id"
          />
          <small>
            {t(
              "按顺序使用第一个非空字段；label 和 id 代表模型标签与元素 ID。",
              "The first non-empty field wins. label and id reference the model label and element ID.",
            )}
          </small>
        </label>
        <label className="field graph-label-field">
          <span>{t("关系显示字段", "Edge caption fields")}</span>
          <input
            value={settings.graphEdgeLabelFields}
            onChange={(event) =>
              update("graphEdgeLabelFields", event.target.value)
            }
            placeholder="label,id"
          />
          <small>
            {t(
              "支持关系属性或 label、id，字段以逗号分隔。",
              "Use edge properties or label / id, separated by commas.",
            )}
          </small>
        </label>
        <label className="range-field">
          <span>
            <strong>{t("边渲染上限")}</strong>
            <output>{settings.graphEdgeLimit}</output>
          </span>
          <input
            type="range"
            min="10"
            max="1000"
            step="10"
            value={settings.graphEdgeLimit}
            onChange={(event) =>
              update("graphEdgeLimit", Number(event.target.value))
            }
          />
        </label>
        <div className="setting-row">
          <div>
            <strong>{t("显示标签")}</strong>
            <small>
              {t(
                "显示按字段优先级生成的顶点与关系标题。",
                "Show vertex and edge captions generated from the configured field priority.",
              )}
            </small>
          </div>
          <SettingSwitch
            label={t("显示标签")}
            checked={settings.graphShowLabels}
            onChange={(value) => update("graphShowLabels", value)}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>{t("显示背景网格")}</strong>
            <small>{t("辅助拖动和手工排布。", "Helps with manual positioning.")}</small>
          </div>
          <SettingSwitch
            label={t("显示背景网格")}
            checked={settings.graphShowGrid}
            onChange={(value) => update("graphShowGrid", value)}
          />
        </div>
      </section>

      <section className="settings-group settings-behavior" hidden={activeSection !== "behavior"}>
        <header>
          <Settings2 size={21} />
          <div>
            <span className="eyebrow">BEHAVIOR</span>
            <h2>{t("查询与历史", "Query and History")}</h2>
          </div>
        </header>
        <label className="field">
          <span>{t("查询标签页排列", "Query tab layout")}</span>
          <SelectControl
            ariaLabel={t("查询标签页排列", "Query tab layout")}
            value={settings.queryTabLayout}
            onValueChange={(value) =>
              update("queryTabLayout", value as AppSettings["queryTabLayout"])
            }
            options={[
              {
                value: "scroll",
                label: t("同行滚动", "Single row with scrolling"),
                description: t("保持编辑器高度，并显示横向滚动条", "Preserves editor height with a visible scrollbar"),
              },
              {
                value: "wrap",
                label: t("自动换行", "Wrap to multiple rows"),
                description: t("标签较多时分行展示", "Shows more tabs across multiple rows"),
              },
            ]}
          />
        </label>
        <label className="field">
          <span>{t("默认结果视图")}</span>
          <SelectControl
            ariaLabel={t("默认结果视图")}
            value={settings.defaultResultMode}
            onValueChange={(value) =>
              update(
                "defaultResultMode",
                value as AppSettings["defaultResultMode"],
              )
            }
            options={[
              { value: "auto", label: t("自动选择") },
              { value: "graph", label: t("拓扑") },
              { value: "table", label: t("表格") },
              { value: "json", label: "JSON" },
            ]}
          />
        </label>
        <label className="range-field">
          <span>
            <strong>{t("历史记录上限")}</strong>
            <output>{settings.historyLimit}</output>
          </span>
          <input
            type="range"
            min="100"
            max="2000"
            step="100"
            value={settings.historyLimit}
            onChange={(event) => update("historyLimit", Number(event.target.value))}
          />
        </label>
        <div className="setting-row">
          <div>
            <strong>{t("下一步建议", "Next-step suggestions")}</strong>
            <small>{t("根据当前语句与历史记录显示可继续执行的 Gremlin 建议。", "Show compatible Gremlin continuations based on the query and execution history.")}</small>
          </div>
          <SettingSwitch
            label={t("下一步建议", "Next-step suggestions")}
            checked={settings.querySuggestionsEnabled}
            onChange={(value) => update("querySuggestionsEnabled", value)}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>{t("减少动态效果")}</strong>
            <small>{t("关闭非必要过渡和扫描动画。", "Disable non-essential transitions and scan effects.")}</small>
          </div>
          <SettingSwitch
            label={t("减少动态效果")}
            checked={settings.reduceMotion}
            onChange={(value) => update("reduceMotion", value)}
          />
        </div>
      </section>

      <section className="settings-group settings-shortcuts" hidden={activeSection !== "shortcuts"}>
        <header>
          <Keyboard size={21} />
          <div>
            <span className="eyebrow">KEYBOARD MAP</span>
            <h2>{t("快捷键", "Keyboard shortcuts")}</h2>
          </div>
        </header>
        <div className="shortcut-list">
          {SHORTCUT_OPTIONS.map(({ action, label, english }) => (
            <ShortcutRecorder
              key={action}
              label={t(label, english)}
              value={settings.keyboardShortcuts[action]}
              conflict={shortcutConflicts.has(settings.keyboardShortcuts[action])}
              onChange={(shortcut) =>
                update("keyboardShortcuts", {
                  ...settings.keyboardShortcuts,
                  [action]: shortcut,
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="settings-group security-note" hidden={activeSection !== "security"}>
        <LockKeyhole size={25} />
        <div>
          <span className="eyebrow">CREDENTIAL VAULT</span>
          <h2>{t("安全存储")}</h2>
          <p>
            {!security
              ? t("正在检测凭据存储方式…", "Detecting credential storage…")
              : security.mode === "os"
                ? t(
                    "当前使用操作系统密钥设施保护连接密码。",
                    "Connection passwords are protected by the operating system credential store.",
                  )
                : t(
                    "当前使用仅限本机用户访问的 AES-256-GCM 本地加密，不会访问系统钥匙串。",
                    "AES-256-GCM local encryption restricted to this user is active. The system credential store is not accessed.",
                  )}
          </p>
          {security && (
            <span className={`security-mode ${security.mode}`}>
              {security.mode === "os"
                ? t("系统密钥设施")
                : t("本地加密", "Local encryption")}
            </span>
          )}
        </div>
      </section>
      </div>
      </div>
    </div>
  );
}


