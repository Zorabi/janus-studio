import { createContext, useContext, type ReactNode } from "react";
import type { AppLocale } from "./settings";
import generatedLocales from "./generated-locales.json";

type Dictionary = Record<string, string>;

const SUPPORTED_LOCALES: readonly AppLocale[] = [
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
];

const LANGUAGE_DISPLAY_CODES: Record<AppLocale, string> = {
  "zh-CN": "zh-Hans",
  "zh-TW": "zh-Hant",
  "en-US": "en",
  "ja-JP": "ja",
  "ko-KR": "ko",
  "de-DE": "de",
  "fr-FR": "fr",
  "es-ES": "es",
  "pt-BR": "pt-BR",
  "it-IT": "it",
  "ru-RU": "ru",
  "pl-PL": "pl",
  "tr-TR": "tr",
  "vi-VN": "vi",
};

const CHINESE_LANGUAGE_NAMES: Record<AppLocale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁体中文",
  "en-US": "英语",
  "ja-JP": "日语",
  "ko-KR": "韩语",
  "de-DE": "德语",
  "fr-FR": "法语",
  "es-ES": "西班牙语",
  "pt-BR": "葡萄牙语（巴西）",
  "it-IT": "意大利语",
  "ru-RU": "俄语",
  "pl-PL": "波兰语",
  "tr-TR": "土耳其语",
  "vi-VN": "越南语",
};

const NATIVE_LANGUAGE_NAMES: Record<AppLocale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "en-US": "English",
  "ja-JP": "日本語",
  "ko-KR": "한국어",
  "de-DE": "Deutsch",
  "fr-FR": "Français",
  "es-ES": "Español",
  "pt-BR": "Português (Brasil)",
  "it-IT": "Italiano",
  "ru-RU": "Русский",
  "pl-PL": "Polski",
  "tr-TR": "Türkçe",
  "vi-VN": "Tiếng Việt",
};

const EN: Dictionary = {
  "查询工作台": "Query Workbench",
  "执行 Gremlin 并查看结果": "Run Gremlin and inspect results",
  "连接管理": "Connections",
  "账号、协议与认证": "Profiles, protocols and credentials",
  "执行历史": "History",
  "本地查询记录": "Local query records",
  "类型与索引管理": "Types and indexes",
  "导入导出": "Data Transfer",
  "JSON 与 CSV": "JSON and CSV",
  "整图归档与结果导出": "Graph archive and result export",
  "偏好设置": "Preferences",
  "阅读与交互": "Readability and interaction",
  "新建连接": "New Connection",
  "当前连接": "Active connection",
  "未选择连接": "No connection selected",
  "连接已配置": "Connection configured",
  "等待连接": "Waiting for connection",
  "添加 JanusGraph Server": "Add a JanusGraph Server",
  "运行查询": "Run Query",
  "执行中": "Running",
  "下一步": "Next step",
  "拓扑": "Graph",
  "表格": "Table",
  "等待执行": "Waiting",
  "查询结果": "Query result",
  "尚未执行查询": "No query executed",
  "正在等待 JanusGraph 返回结果": "Waiting for JanusGraph",
  "查询会按照连接配置中的超时时间自动终止":
    "The query stops automatically at the configured timeout.",
  "查询执行失败": "Query failed",
  "重试": "Retry",
  "关闭详情": "Close details",
  "查询成功，结果为空": "Query succeeded with no results",
  "服务器返回了零条记录。": "The server returned zero records.",
  "结果显示方式": "Result view",
  "刷新 Schema": "Refresh Schema",
  "Schema 管理": "Schema Management",
  "尚未读取 Schema": "Schema not loaded",
  "Schema 操作失败": "Schema operation failed",
  "新建定义": "Create definition",
  "类型": "Type",
  "名称": "Name",
  "数据类型": "Data type",
  "创建": "Create",
  "导入与导出": "Import and Export",
  "导入顶点数据": "Import vertices",
  "导出查询结果": "Export query result",
  "选择 JSON 或 CSV 文件": "Choose JSON or CSV file",
  "没有可导出的结果": "No result to export",
  "先在查询工作台执行一次查询。": "Run a query in the workbench first.",
  "界面与可访问性": "Interface and Accessibility",
  "界面语言": "Interface language",
  "主题": "Theme",
  "深色": "Dark",
  "浅色": "Light",
  "跟随系统": "System",
  "界面字体": "UI font",
  "等宽字体": "Monospace",
  "系统字体": "System font",
  "界面字号": "UI font size",
  "编辑器字号": "Editor font size",
  "界面密度": "Interface density",
  "紧凑": "Compact",
  "舒适": "Comfortable",
  "减少动态效果": "Reduce motion",
  "拓扑渲染": "Graph Rendering",
  "顶点渲染上限": "Vertex render limit",
  "边渲染上限": "Edge render limit",
  "显示标签": "Show labels",
  "显示背景网格": "Show background grid",
  "默认结果视图": "Default result view",
  "自动选择": "Automatic",
  "历史记录上限": "History record limit",
  "安全存储": "Credential Storage",
  "系统密钥设施": "OS secure storage",
  "本地加密回退": "Local encrypted fallback",
  "恢复默认设置": "Restore Defaults",
  "设置保存在当前电脑并立即生效。": "Settings are stored locally and apply immediately.",
  "READY": "READY",
  "NO CONNECTION": "NO CONNECTION",
  "成功": "Success",
  "失败": "Failed",
  "载入": "Load",
  "删除": "Delete",
  "清空历史": "Clear history",
  "搜索查询或连接": "Search query or connection",
  "语言": "Language",
  "确认生产环境写操作": "Confirm Production Write",
  "仍要执行": "Run Anyway",
  "生产连接": "Production connection",
  "当前 Gremlin 语句可能修改图数据或 Schema；执行前请确认连接与语句均正确。":
    "This Gremlin statement may mutate graph data or schema; verify the connection and statement before continuing.",
  "连接级只读保护阻止了可能修改图数据或 Schema 的查询。请在连接设置中关闭只读保护后再试。":
    "Connection-level read-only protection blocked a query that may mutate graph data or schema. Disable it in the connection settings to continue.",
  "生产环境写操作需要先完成风险确认；当前入口未获得确认，已安全阻止执行。":
    "Production writes require risk confirmation. This action was blocked because its entry point did not obtain confirmation.",
};

const ZH_TW: Dictionary = {
  "查询工作台": "查詢工作台",
  "连接管理": "連線管理",
  "执行历史": "執行歷史",
  "导入导出": "匯入匯出",
  "偏好设置": "偏好設定",
  "新建连接": "新增連線",
  "当前连接": "目前連線",
  "运行查询": "執行查詢",
  "下一步": "下一步",
  "拓扑": "拓撲",
  "表格": "表格",
  "界面语言": "介面語言",
  "主题": "主題",
  "界面字体": "介面字型",
  "界面字号": "介面字級",
  "编辑器字号": "編輯器字級",
  "恢复默认设置": "還原預設值",
};

const JA: Dictionary = {
  "查询工作台": "クエリワークベンチ",
  "连接管理": "接続",
  "执行历史": "実行履歴",
  "导入导出": "インポート・エクスポート",
  "偏好设置": "設定",
  "新建连接": "新しい接続",
  "当前连接": "現在の接続",
  "运行查询": "クエリを実行",
  "下一步": "次のステップ",
  "拓扑": "グラフ",
  "表格": "テーブル",
  "界面语言": "表示言語",
  "主题": "テーマ",
  "界面字体": "UI フォント",
  "界面字号": "UI 文字サイズ",
  "编辑器字号": "エディター文字サイズ",
  "恢复默认设置": "初期設定に戻す",
};

const KO: Dictionary = {
  "查询工作台": "쿼리 워크벤치",
  "连接管理": "연결",
  "执行历史": "실행 기록",
  "导入导出": "가져오기 및 내보내기",
  "偏好设置": "환경설정",
  "新建连接": "새 연결",
  "当前连接": "현재 연결",
  "运行查询": "쿼리 실행",
  "下一步": "다음 단계",
  "拓扑": "그래프",
  "表格": "테이블",
  "界面语言": "인터페이스 언어",
  "主题": "테마",
  "界面字体": "UI 글꼴",
  "界面字号": "UI 글꼴 크기",
  "编辑器字号": "편집기 글꼴 크기",
  "恢复默认设置": "기본값 복원",
};

const DE: Dictionary = {
  "查询工作台": "Abfragebereich",
  "连接管理": "Verbindungen",
  "执行历史": "Verlauf",
  "导入导出": "Import und Export",
  "偏好设置": "Einstellungen",
  "新建连接": "Neue Verbindung",
  "当前连接": "Aktive Verbindung",
  "运行查询": "Abfrage ausführen",
  "下一步": "Nächster Schritt",
  "拓扑": "Graph",
  "表格": "Tabelle",
  "界面语言": "Sprache",
  "主题": "Darstellung",
  "界面字体": "UI-Schrift",
  "界面字号": "UI-Schriftgröße",
  "编辑器字号": "Editor-Schriftgröße",
  "恢复默认设置": "Standard wiederherstellen",
};

const FR: Dictionary = {
  "查询工作台": "Atelier de requêtes",
  "连接管理": "Connexions",
  "执行历史": "Historique",
  "导入导出": "Importer et exporter",
  "偏好设置": "Préférences",
  "新建连接": "Nouvelle connexion",
  "当前连接": "Connexion active",
  "运行查询": "Exécuter",
  "下一步": "Étape suivante",
  "拓扑": "Graphe",
  "表格": "Tableau",
  "界面语言": "Langue",
  "主题": "Thème",
  "界面字体": "Police de l’interface",
  "界面字号": "Taille de l’interface",
  "编辑器字号": "Taille de l’éditeur",
  "恢复默认设置": "Rétablir les valeurs",
};

const ES: Dictionary = {
  "查询工作台": "Área de consultas",
  "连接管理": "Conexiones",
  "执行历史": "Historial",
  "导入导出": "Importar y exportar",
  "偏好设置": "Preferencias",
  "新建连接": "Nueva conexión",
  "当前连接": "Conexión activa",
  "运行查询": "Ejecutar consulta",
  "下一步": "Siguiente paso",
  "拓扑": "Grafo",
  "表格": "Tabla",
  "界面语言": "Idioma",
  "主题": "Tema",
  "界面字体": "Fuente de interfaz",
  "界面字号": "Tamaño de interfaz",
  "编辑器字号": "Tamaño del editor",
  "恢复默认设置": "Restaurar valores",
};

const PT_BR: Dictionary = {
  "查询工作台": "Área de consultas",
  "连接管理": "Conexões",
  "执行历史": "Histórico",
  "导入导出": "Importar e exportar",
  "偏好设置": "Preferências",
  "新建连接": "Nova conexão",
  "当前连接": "Conexão ativa",
  "运行查询": "Executar consulta",
  "下一步": "Próximo passo",
  "拓扑": "Grafo",
  "表格": "Tabela",
  "界面语言": "Idioma",
  "主题": "Tema",
  "界面字体": "Fonte da interface",
  "界面字号": "Tamanho da interface",
  "编辑器字号": "Tamanho do editor",
  "恢复默认设置": "Restaurar padrões",
};

const IT: Dictionary = {
  "查询工作台": "Area query",
  "连接管理": "Connessioni",
  "执行历史": "Cronologia",
  "导入导出": "Importa ed esporta",
  "偏好设置": "Preferenze",
  "新建连接": "Nuova connessione",
  "当前连接": "Connessione attiva",
  "运行查询": "Esegui query",
  "下一步": "Passaggio successivo",
  "拓扑": "Grafo",
  "表格": "Tabella",
  "界面语言": "Lingua",
  "主题": "Tema",
  "界面字体": "Font interfaccia",
  "界面字号": "Dimensione interfaccia",
  "编辑器字号": "Dimensione editor",
  "恢复默认设置": "Ripristina valori",
};

const RU: Dictionary = {
  "查询工作台": "Редактор запросов",
  "连接管理": "Подключения",
  "执行历史": "История",
  "导入导出": "Импорт и экспорт",
  "偏好设置": "Настройки",
  "新建连接": "Новое подключение",
  "当前连接": "Активное подключение",
  "运行查询": "Выполнить запрос",
  "下一步": "Следующий шаг",
  "拓扑": "Граф",
  "表格": "Таблица",
  "界面语言": "Язык",
  "主题": "Тема",
  "界面字体": "Шрифт интерфейса",
  "界面字号": "Размер интерфейса",
  "编辑器字号": "Размер редактора",
  "恢复默认设置": "Восстановить значения",
};

const PL: Dictionary = {
  "查询工作台": "Obszar zapytań",
  "连接管理": "Połączenia",
  "执行历史": "Historia",
  "导入导出": "Import i eksport",
  "偏好设置": "Ustawienia",
  "新建连接": "Nowe połączenie",
  "当前连接": "Aktywne połączenie",
  "运行查询": "Uruchom zapytanie",
  "下一步": "Następny krok",
  "拓扑": "Graf",
  "表格": "Tabela",
  "界面语言": "Język",
  "主题": "Motyw",
  "界面字体": "Czcionka interfejsu",
  "界面字号": "Rozmiar interfejsu",
  "编辑器字号": "Rozmiar edytora",
  "恢复默认设置": "Przywróć wartości",
};

const TR: Dictionary = {
  "查询工作台": "Sorgu çalışma alanı",
  "连接管理": "Bağlantılar",
  "执行历史": "Geçmiş",
  "导入导出": "İçe ve dışa aktar",
  "偏好设置": "Tercihler",
  "新建连接": "Yeni bağlantı",
  "当前连接": "Etkin bağlantı",
  "运行查询": "Sorguyu çalıştır",
  "下一步": "Sonraki adım",
  "拓扑": "Graf",
  "表格": "Tablo",
  "界面语言": "Dil",
  "主题": "Tema",
  "界面字体": "Arayüz yazı tipi",
  "界面字号": "Arayüz boyutu",
  "编辑器字号": "Düzenleyici boyutu",
  "恢复默认设置": "Varsayılanları yükle",
};

const VI: Dictionary = {
  "查询工作台": "Không gian truy vấn",
  "连接管理": "Kết nối",
  "执行历史": "Lịch sử",
  "导入导出": "Nhập và xuất",
  "偏好设置": "Tùy chọn",
  "新建连接": "Kết nối mới",
  "当前连接": "Kết nối hiện tại",
  "运行查询": "Chạy truy vấn",
  "下一步": "Bước tiếp theo",
  "拓扑": "Đồ thị",
  "表格": "Bảng",
  "界面语言": "Ngôn ngữ",
  "主题": "Chủ đề",
  "界面字体": "Phông giao diện",
  "界面字号": "Cỡ giao diện",
  "编辑器字号": "Cỡ trình soạn thảo",
  "恢复默认设置": "Khôi phục mặc định",
};

const DICTIONARIES: Partial<Record<AppLocale, Dictionary>> = {
  "zh-TW": ZH_TW,
  "ja-JP": JA,
  "ko-KR": KO,
  "de-DE": DE,
  "fr-FR": FR,
  "es-ES": ES,
  "pt-BR": PT_BR,
  "it-IT": IT,
  "ru-RU": RU,
  "pl-PL": PL,
  "tr-TR": TR,
  "vi-VN": VI,
};

const GENERATED_DICTIONARIES = generatedLocales as Partial<Record<AppLocale, Dictionary>>;
const REQUIRED_TRANSLATION_KEYS = Object.keys(GENERATED_DICTIONARIES["zh-TW"] ?? {});

const LocaleContext = createContext<AppLocale>("zh-CN");

export function LocaleProvider({
  locale,
  children,
}: {
  locale: AppLocale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function translate(locale: AppLocale, chinese: string, english?: string): string {
  if (locale === "zh-CN") return chinese;
  if (locale === "en-US") return english ?? EN[chinese] ?? chinese;
  return DICTIONARIES[locale]?.[chinese]
    ?? GENERATED_DICTIONARIES[locale]?.[chinese]
    ?? english
    ?? EN[chinese]
    ?? chinese;
}

export function translationCoverage(): Record<string, string[]> {
  return Object.fromEntries(
    SUPPORTED_LOCALES
      .filter((locale) => locale !== "zh-CN" && locale !== "en-US")
      .map((locale) => [
        locale,
        REQUIRED_TRANSLATION_KEYS.filter((key) => !GENERATED_DICTIONARIES[locale]?.[key]),
      ]),
  );
}

export function localizedLanguageOptions(
  displayLocale: AppLocale,
): Array<{ value: AppLocale; label: string }> {
  let displayNames: Intl.DisplayNames | undefined;
  try {
    displayNames = new Intl.DisplayNames([displayLocale], {
      type: "language",
      fallback: "none",
      languageDisplay: "standard",
    });
  } catch {
    displayNames = undefined;
  }

  return SUPPORTED_LOCALES.map((value) => ({
    value,
    label:
      displayNames?.of(LANGUAGE_DISPLAY_CODES[value]) ??
      (displayLocale === "zh-CN"
        ? CHINESE_LANGUAGE_NAMES[value]
        : NATIVE_LANGUAGE_NAMES[value]),
  }));
}

export function useTranslate(): (chinese: string, english?: string) => string {
  const locale = useContext(LocaleContext);
  return (chinese: string, english?: string) => translate(locale, chinese, english);
}

export function useLocale(): AppLocale {
  return useContext(LocaleContext);
}
