# Janus Studio 开发记录与 Agent 约定

## 1. 项目定位

- 产品名称：Janus Studio。
- Slogan：`A Modern Desktop IDE for JanusGraph & Apache TinkerPop`。
- 项目目录：`<repository-root>`。
- 产品形态：基于 Electron 的 JanusGraph/TinkerPop 跨平台桌面 IDE，目标平台为 macOS、Windows 和 Linux。
- 当前版本：`0.2.0`。
- 本文件是后续 Agent 的项目级上下文。开始开发前先阅读本文件，再检查当前代码，不能仅凭历史描述判断实现状态。

## 2. 不可违背的产品与设计约束

- 全部界面图标统一使用 Lucide，禁止使用表情符号。
- 界面质量以 Awwwards、FWA、CSS Design Awards 级别为目标，同时优先保证桌面工具的可读性、可操作性和稳定性。
- 不得使用左侧竖线、边框竖线或 `inset ... 0` 阴影表示当前选中项。选中状态应使用完整卡片背景、完整边框、色彩和轻量阴影表达。
- 默认字号不能过小；中文、英文和代码字体必须分别考虑阅读体验。
- 所有页面必须适配窗口缩放，避免文本覆盖、控件越界、错位和不可点击。
- 下拉框、菜单、弹窗、命令面板、右键菜单必须使用统一的 Janus Studio 视觉体系，不能回退到浏览器或 Monaco 的默认视觉样式。
- 设置项的二级导航滚动时应保持在可视区域内。
- 顶部 Slogan 保持单行完整显示，不能随意截断或换行。
- 所有新增用户可见字符串必须进入 i18n；当前语言为中文时，语言选项名称也应以中文显示。

## 3. 技术架构

- Monorepo：pnpm workspace。
- 桌面端：Electron Forge + Vite + React + TypeScript。
- 编辑器：Monaco Editor，Gremlin 自定义语言配置和补全提供器。
- 图渲染：SVG 交互画布与物理力导向布局，支持多种布局模式。
- 图标：`lucide-react`。
- Gremlin 驱动：`gremlin`，支持 WS/WSS 和 HTTP/HTTPS。
- 本地存储：SQLite、localStorage 和安全凭据存储适配层。
- 主要目录：
  - `apps/desktop/src/main`：Electron 主进程、IPC、客户端与文件操作。
  - `apps/desktop/src/preload`：安全的渲染进程 API 桥接。
  - `apps/desktop/src/renderer`：React UI、编辑器、拓扑图和设置。
  - `apps/desktop/src/renderer/features`：按 query、connections、history、schema、transfer、settings 划分的页面与功能模块。
  - `apps/desktop/src/renderer/components/ui`：跨功能复用的无业务 UI 组件。
  - `apps/desktop/src/renderer/styles`：按基础、查询工作区、功能页、设置与浮层、主题和最终覆盖拆分的有序样式模块。
  - `packages/domain`：领域类型与契约。
  - `packages/application`：连接、查询和存储应用逻辑。
  - `tests`：单元、集成、兼容与打包应用测试。
  - `docs/需求分析与架构设计.md`：完整需求和架构设计。

## 4. 当前功能基线

### 4.1 连接管理

- 支持多个连接配置的新增、编辑、删除、测试和切换。
- 支持 WS、WSS、HTTP、HTTPS、用户名和密码。
- 支持 Sessionless 和 Sessioned 客户端，默认使用 Sessionless。
- 支持显式输入并使用 Traversal Source、Graph Binding、超时、TLS、Headers 等高级配置。
- 支持直连、系统代理和连接专用 HTTP/HTTPS 代理；WS/WSS 与 HTTP/HTTPS 查询、流式导出和连接测试使用同一网络路径。代理密码独立进入凭据库，不得写入连接普通字段。
- 连接测试按 DNS、TCP、代理、TLS、认证、Gremlin、Schema 权限分阶段展示；Node 22 主进程必须让 Gremlin 3.7.x 使用 `ws` 传输，不能回退到会忽略 Agent、自定义 CA 和 mTLS 选项的全局 WebSocket。
- 连接可使用分组、识别色和标签组织；列表支持名称、地址、图、分组和标签搜索，以及分组筛选。识别色只用于工作区辨识，不得覆盖生产环境、只读或连接状态等安全语义。真实使用连接后记录最近使用时间，并优先展示最近连接。
- Sessioned 模式支持显式事务开启、提交和回滚；提交或回滚后当前显式事务状态结束，后续是否重新开启由用户操作决定。

### 4.2 Gremlin 编辑器

- 支持多个查询标签页、标签重命名、复制、关闭、关闭其他标签和恢复关闭标签。
- 标签内容、连接、结果状态和保存状态能够持久化并在应用重启后恢复。
- 已保存与未保存状态有独立视觉标识。
- 支持打开和保存 Gremlin 文件；保存对话框中的最终文件名会同步更新当前标签名称。
- 已保存或手动重命名的标签不会在执行查询后被语句内容自动覆盖。
- 支持格式化、运行选中语句或全文、停止、只读、参数绑定、收藏、Explain、Profile、事务操作、查找替换、右键菜单和命令面板。
- 参数绑定只有在参数功能启用时才参与执行，内容为 JSON 对象，例如：

  ```json
  {"vertexId": 123, "limit": 20}
  ```

  查询中直接使用变量：`g.V(vertexId).limit(limit)`。
- 智能补全包含完整 Gremlin Step 和当前 Schema 项，不截断候选集合；补全窗口固定显示 5 行，其他候选在窗口内部滚动。
- 下一步建议可以在偏好设置中启用或关闭。

### 4.3 查询结果

- 支持拓扑、表格、结构化 JSON、Gremlin 控制台、原始响应等结果视图。
- 结构化表格和 JSON 会移除 GraphSON/驱动层属性元数据，优先显示直接的 `label: value`。
- 原始响应保留驱动层类型包装和完整字段。
- 表格列和结构化详情按固定元数据优先级及自然字母数字顺序排列，例如 `cp0、cp1、cp2、cp12`。
- 支持查询结果 JSON、JSONL、CSV 导出以及完整结果流式导出。
- Profile、Explain、`printSchema()` 等文本报告使用 Gremlin Console 风格的等宽原始输出展示。
- 创建 Property Key、Vertex Label、Edge Label 和 Composite/Mixed Graph Index（包括创建 Property Key 时同步建索引）前必须输入完整目标图名进行二次确认，避免在错误的静态图或动态图上下文中修改 Schema。
- Schema 表单中的 Vertex Label 与 Edge Label 选项使用自然数字排序，例如 `v1、v2、v10、v111`。

### 4.4 拓扑图

- 使用物理力导向图，并支持层级、径向、网格等布局与相应参数配置。
- 不同顶点 Label 自动使用不同颜色；标签有碰撞间距，避免默认重叠。
- 支持节点、关系和画布拖动、缩放、搜索、重置布局、暂停物理模拟、全屏和详情检查。
- 点击顶点或关系后加载完整属性；详情始终按 `ID、LABEL、FROM、TO、自然属性顺序` 展示。
- 顶点与关系支持详情查看；不提供运行时“展开/收起相邻元素”入口。该功能因不同 JanusGraph 返回结构下无法形成可靠交互闭环，已从产品中移除。
- “保存布局”保存当前图的顶点坐标、关系控制点和缩放视角；当前可见顶点 ID 集合、关系 ID 与方向集合、布局模式和布局参数一致时判定为相同图，返回顺序与属性值不参与图身份判定。
- “重置布局”会清除相同图的已保存布局并重新计算。
- 拓扑下载支持 PNG、JPG、SVG 和包含图数据及布局坐标的 JSON。
- 顶点和关系默认显示字段来自设置，默认值应包含 `label, id`，自定义字段必须真实生效。

### 4.5 Schema 与数据迁移

- Schema 页面展示 Vertex Label、Edge Label、Property Key 和 Graph Index。
- 支持 Composite Index 和 Mixed Index，属性创建流程支持同步创建两类索引。
- Schema 读取需兼容完整 JanusGraph `printSchema()` 输出与 Management API 查询。
- 支持 `janus-studio.schema/v1` 声明式 Schema 导入导出、快照、差异比较、变更计划、分批执行、操作历史和失败详情。
- Schema 导入必须幂等：相同定义跳过，缺失定义创建，不兼容定义阻止；索引按 `REGISTER_INDEX → REGISTERED → REINDEX → ENABLED` 生命周期推进。
- Schema 导入、历史和动态图上下文必须联动；切换连接或动态图后，页面标题、Graph Binding、Traversal Source、历史归属和执行目标必须保持一致。
- 导入导出页面面向整图数据；查询结果导出位于查询结果工具栏，不应混入整图迁移页面。
- 整图迁移同时支持 Janus Studio JSON 归档和服务端原生 TinkerPop adjacency-list GraphSON。大文件不得要求用户手工切割。
- 服务端 GraphSON 支持本机 Docker 临时文件中转和服务器绝对路径，导出文件名使用可读本地日期，例如 `graph2-20260811.graphson`。
- 动态图导入可临时启用 `storage.batch-loading` 并保存原配置；结束、中断或失败后必须恢复原配置。恢复失败只能由用户在任务条中显式重试，禁止进入页面后自动修改服务器配置。
- 整图清空按每批最多 100 个顶点执行，显示总数、已删除、剩余和批次；Schema 始终保留。
- WS/WSS 整图导入导出使用专用 Gremlin Session；停止时关闭底层传输以中断服务端 Session。HTTP 只能停止客户端等待，界面不得宣称服务端任务已经终止。
- 服务端导出使用隐藏临时文件并在完成后原子改名；任务条持续显示临时文件已写入字节数，失败或中断后清理不完整文件。

### 4.6 查询资产

- “查询资产”统一承载执行历史、Snippet、文件夹、标签和内置模板，不得维护一套并行的 Renderer 收藏数据源。
- 执行历史事实字段保持只读；星标、备注和标签独立保存。历史列表使用主进程分页、搜索和筛选，不能只过滤前端已加载的子集。
- Snippet 保存 Gremlin、Bindings、连接、Graph Binding、Traversal Source、文件夹、标签和星标；打开历史或 Snippet 始终新建查询标签页，不能覆盖当前未保存标签。
- 文件夹允许嵌套和拖拽归类；删除文件夹只解除归类，删除标签只解除关联，均不能级联删除历史或 Snippet。
- 旧版 localStorage 收藏只能由用户显式确认迁移；迁移成功后才清理旧存储。

### 4.7 偏好设置

- 设置内部按常规、外观与字体、图谱、编辑器、快捷键、安全分组。
- 支持深色、浅色和跟随系统主题，主题变量必须覆盖全部页面。
- 支持多语言、界面字号、代码字号、内置字体和用户自定义系统字体/CSS 字体列表。
- 支持图渲染数量、顶点/关系显示字段、布局模式与物理参数。
- 支持跨平台快捷键配置；macOS 使用 Command，Windows/Linux 使用 Control 对应操作。

### 4.8 ConfiguredGraphFactory 动态图

- 动态图管理是独立功能模块，不与单图 Schema 页面混为同一个概念。
- 支持读取和编辑 Template Configuration、使用模板创建图、创建和更新单图 Configuration、敏感值遮罩及配置 JSON 导入导出。
- 支持立即加载图引用、重新加载图引用、关闭图、查看当前/其他 JanusGraph 实例、清除单个残留实例和清除全部其他实例。
- `ConfiguredGraphFactory.close(graphName)` 只关闭当前节点引用，不删除配置或后端数据；Configuration 仍存在时 JanusGraphManager 可能再次自动加载，界面必须准确解释此语义。
- 只读能力探测、图列表刷新和实例列表读取不得调用 `ConfiguredGraphFactory.open()`；只有立即加载、进入查询/Schema 图上下文或明确需要图对象的操作才能打开图。
- Drop 必须先打开当前节点图引用并读取实例列表；存在其他实例时阻止执行。Drop 后必须验证 Graph Name 与 Configuration 都已消失。
- Drop、清空图数据、生产写入等不可逆操作必须要求用户输入完整图名称确认，不能只使用普通“确认”按钮。
- 图名称和所有配置参数必须通过 Gremlin bindings 传输，禁止拼接进脚本文本。
- 多节点 Binding 传播、真实 Drop、残留实例处理和关闭后自动重开语义已由用户完成验收，不再列为待回归功能。

### 4.8 查询诊断、结果与历史

- 单一标量结果（如 `count()`）使用标量结果视图，不套用完整数据表格。
- Explain/Profile 优先展示结构化诊断，但必须同时保留完整 Gremlin Console 文本；解析失败时只退化为控制台输出，不影响查询。
- “控制台”指服务端对象的 Gremlin Console 文本表示，不是结构化 JSON 字符串，也不是驱动传输包装。
- 执行历史支持成功、失败、取消、截断状态及连接、状态、日期、全文组合筛选。
- 查询标签页支持临时超时覆盖；连接配置改变后，已打开标签页在未设置覆盖时应使用最新连接超时。

## 5. 安全与凭据规则

- 不得因为常规开发验证而自动启动应用或访问真实连接。
- 用户明确反感反复弹出 macOS 钥匙串密码请求。除非用户明确要求启动或进行真实连接验证，否则只执行类型检查、测试和打包。
- 凭据读取必须使用会话缓存，不能在每次渲染、查询或 Schema 操作时重复解密。
- macOS 始终使用仅限当前用户访问的 AES-256-GCM 本地凭据库；不得初始化 `safeStorage`、Keychain 或 Electron Cookie Encryption Fuse。Windows/Linux 可优先使用系统密钥设施，不可用时回退到本地加密。
- 日志、错误提示和测试输出中不得打印密码、解密密钥或完整认证 Header。
- 连接级只读是最终防线：数据写入、Schema 变更和 ConfiguredGraphFactory 变更均必须经过共享 mutation detector；读取 Schema、rollback 和只读诊断不得被误拦截。
- 生产环境写操作必须在渲染层和主进程双重校验确认标记，任何新入口都不得绕过主进程校验。
- 诊断、历史和任务记录只能保存脱敏连接摘要；密码、Token、自定义认证 Header 和敏感图配置值不得持久化到这些记录。

## 6. 交互与长任务约定

- 页面顶部只放当前上下文和高频主操作；与当前图强相关的操作应靠近图上下文，不把关键状态藏在页面最下方。
- 同一长任务只使用一个持久任务条作为状态主入口，禁止同时弹出重复的生命周期 Toast。文件选择失败等任务开始前错误可以使用 Toast。
- 长任务成功、失败、中断后状态不能自动消失；统一任务中心会持久化记录，直到用户显式移除。
- 停止、重试和安全恢复均由用户显式触发。进入页面、切换菜单、刷新列表不得自动重试写操作。
- 任务状态必须绑定固定的 `connectionId + graphName + graphAccess + executionId`。切换页面、连接或动态图不得改变正在执行任务的显示目标。
- 中断必须准确表达能力边界：WS/WSS 专用 Session 可中断服务端执行；HTTP Abort 不能保证服务端停止。
- 导入/导出、清空、Drop 等操作开始前使用居中确认弹窗；运行中和完成后使用任务条，不再增加右侧重复悬浮框。
- 下拉选项的主名称和辅助信息必须可完整查看；空间不足时允许弹层扩宽或内容换行，不能只留下无法区分的省略名称。
- 日期时间面向用户显示本地可读格式，不直接展示含 `T`、`Z` 的原始 ISO 字符串。
- 错误详情不能只依赖浏览器原生 `title`；需要可点击/可滚动的详情区域和可用的复制按钮。

## 7. 工程实现约定

- 先定位现有实现，不重复创建平行页面、组件或状态源。业务状态只有一个事实来源，派生视图不得自行猜测连接、图或任务目标。
- Renderer 负责交互和展示；凭据、文件系统、Docker、SQLite、长时间连接与任务执行放在主进程；跨进程契约先定义在 `packages/domain` 并使用 Zod 校验 IPC 输入。
- Graph Binding 与 Traversal Source override 是查询标签页和 Schema 图上下文的一部分，不能通过改写用户 Gremlin 文本来切换图。
- 所有服务端管理脚本必须使用 bindings，必须显式 commit/rollback/close Management Transaction，并对最终状态做回读验证。
- 只读探测不得产生隐藏副作用，尤其不得隐式打开动态图、更新配置、恢复任务或清理实例。
- 不使用轮询伪造进度。能够读取文件大小、批次数、索引状态等真实指标时展示真实指标；无法观测时明确显示当前阶段和最后进展时间。
- 大型任务不得依赖 React 组件是否挂载。统一任务中心完成前，新增长任务至少要把会话状态保存在主进程或既有任务存储中。
- 使用共享 `ConfirmDialog`、`SelectControl`、按钮、字段和任务状态样式，不引入浏览器原生控件视觉。
- 修改共享文件时保持窄范围合并；不得覆盖用户或其他 Agent 的无关改动。

## 8. 最近完成的修正

- 顶点和关系详情首次点击即使用自然排序，不再依赖异步属性回填后的对象顺序。
- 相邻图扩展从永久合并改为“执行结果 + 顶点 ID”独立存储，支持当前选中顶点的展开与收起。
- 拓扑下载由单一 SVG 扩展为 PNG、JPG、SVG 和 JSON。
- 文件打开或保存后，标签名称同步为实际文件名；执行查询不会改写已命名标签。
- 设置二级菜单改为 sticky，并移除选中项左侧竖线。
- Monaco 补全窗口通过编辑器内部布局约束固定为 `5 × 32px = 160px`，完整候选仅在窗口内部滚动，不再调用 DOM `scrollIntoView` 带动整个下拉层或页面移动。
- 移除编辑器补全选中项和连接上下文中的竖线式强调。
- Monaco 补全显示时会暂时隐藏“下一步建议”浮层，并移除补全项右侧的详情展开箭头，避免两个建议系统重叠。
- 已移除不可靠的相邻顶点展开/收起功能及相关状态和测试代码。
- 拓扑导出通过 Electron 主进程保存 PNG、JPG、SVG 和 JSON，并提供渲染、编码、保存三个阶段的加载反馈。
- 拓扑图片导出会计算全部已渲染顶点、关系、曲线、自环和标签边界，不受当前相机平移缩放影响；箭头按关系 Label 着色并随导出比例增强可见度。
- macOS 凭据存储已完全隔离系统钥匙串：`safeStorage` 延迟加载、Cookie Encryption Fuse 关闭，并使用会话密码缓存避免重复解密。
- Renderer 已完成首轮生产级无行为拆分：`App.tsx` 仅保留应用壳与跨页面协调，各业务页面进入 `features/*`，共享弹窗和空状态进入 `components/ui`，单体 CSS 按原级联顺序拆为 9 个职责模块。
- 已完成 0.3.0 初始能力切片：生产连接保护、Explain/Profile 诊断、完整执行历史状态、Schema 导入导出和 ConfiguredGraphFactory 管理。
- Schema 导入支持变更计划、Gremlin 批次、后台执行、取消、失败详情、索引注册与启用生命周期。
- ConfiguredGraphFactory 支持模板和单图配置、立即加载/重新加载/关闭、实例清理与带预检和结果验证的 Drop。
- 服务端 GraphSON 迁移支持 Docker/服务器路径、显式图名确认、会话级任务状态、服务端 Session 中断、批量加载配置恢复和导出临时文件真实字节进度。
- 统一任务中心已提供 SQLite 持久化、异常退出中断恢复、未读状态，以及 Schema、GraphSON 迁移、清空和动态图 Drop 的统一展示。
- 批量清除其他 JanusGraph 实例注册和 Drop 都必须输入完整图名确认；Drop 开始后自动进入任务中心且不会自动重试。
- JanusGraph 兼容层已提供按连接签名缓存的只读版本/能力探测，并在连接管理中支持用户主动查看和刷新；版本读取依次使用 JanusGraph/TinkerPop 官方 Manifest 键、Package、Maven 元数据和 JAR 文件名回退。
- Schema Management、索引生命周期、ConfiguredGraphFactory、GraphSON 迁移和 Explain/Profile 已通过集中式 `CompatibilityProfile` 路由；明确不支持的入口在脚本执行前阻止，未知能力保留为未验证而不伪装支持。
- JanusGraph 1.1 官方 JSON Schema 可由 `JsonSchemaInitStrategy` 按类型分批原样导入；TTL、单向边、参数化索引和 Vertex-Centric Index 会在审阅页列为官方专属项。1.0 仅对可无损转换的文件回退到 Management API，不允许静默丢字段。
- Schema 页面区分两种导出：Janus Studio 迁移归档携带来源、时间、`officialSchema` 和首选导入器；JanusGraph 官方 JSON 仅包含纯 `JsonSchemaDefinition`，可直接交给 `JsonSchemaInitStrategy.initializeSchemaFromFile/String`。Studio 归档的 `exportedAt` 使用本地 `YYYY-MM-DD HH:mm:ss`，实际导入策略会显示在审阅、进度、完成提示与操作历史中。
- Schema 导入先完成计划审阅，再使用与 Drop、清空图一致的标准确认弹窗输入完整目标图名；取消确认应返回原审阅计划，不得丢失上下文。动态图使用 ConfiguredGraphFactory 图名，连接默认图使用 Graph Binding。Schema 工具栏只展示导入、导出、快照基线和刷新；导出通过格式选择弹窗并列展示官方 JSON 与 Studio 归档，不可用格式保留可见并说明禁用原因。
- 发起危险操作的按钮名称表达最终动作（例如“导入”“Drop”“清空全部图数据”），二次确认由随后弹出的确认框承担；禁止使用“下一步”“继续确认”等流程性按钮名称造成同类操作不一致。
- Schema 快照以当前图为独立基线，首次建立后每次刷新自动比较；工作区显示基线时间、定义数量和新增/变更/当前缺失逐项明细，并由用户显式更新基线。“当前缺失”只表达基线中存在但本次未读取到，不得暗示 Janus Studio 支持删除通用 Schema 定义。旧版数组快照需兼容迁移。
- Schema 导入审阅统一分为创建、跳过、冲突、人工审阅和高影响五类；概览展示五类数量，顶部使用完整可读的“五类影响审阅”和“归档转换预览”标签，必要说明放在对应标签页内，禁止重复使用占据内容区的大型入口卡。冲突阻止执行，高影响项明确展示索引 REGISTER/REINDEX/ENABLED 生命周期。导入弹窗可在官方 JSON 与 Studio 归档之间切换转换预览；官方专属字段必须通过 `officialSchema` 原文保留，禁止静默丢失。
- 大型 Schema 归档的官方 JSON 与 Studio 文本必须一次生成并缓存；格式切换使用低优先级文本更新和虚拟化只读文本视图，DOM 只渲染当前滚动区域附近的行。禁止在每次切换时同步序列化，或把完整文本放入大型 `<pre>`/`textarea` 触发整份内容排版。
- Schema 创建脚本不得使用 `key` 作为 Groovy 顶层变量名，避免与 TinkerPop `T.key` 冲突。同步创建 Composite/Mixed Index 或为已有属性创建索引时可选择 Vertex/Edge Label，通过官方 `indexOnly(schemaLabel)` 限定索引；读取、Studio/官方导出和导入规划必须保留并校验该约束。
- 服务端 GraphSON 导入、导出和每批 100 顶点清空由主进程 `GraphTransferService` 编排，任务输入、目标图、进度和批量加载恢复载荷存入 SQLite；Renderer 不得使用 `sessionStorage` 或组件生命周期作为任务事实来源。取消、显式重试和安全配置恢复统一通过任务 IPC。
- 查询资产工作台已完成两阶段合并：SQLite v11 保存标签、层级文件夹、Snippet、历史整理元数据及 Graph Binding/Traversal Source；支持统一搜索、服务端分页、星标/备注/标签、批量操作、内置模板、编辑器选区保存和显式旧收藏迁移。
- 诊断能力第一阶段已完成：主进程使用 500 条固定容量结构化环形日志；密码、Token、认证 Header、私钥、URL 凭据、查询正文与字符串绑定在写入时统一脱敏；Renderer 仅能通过只读 IPC 获取运行时摘要和筛选后的日志副本。
- 问题诊断闭环已完成：问题诊断作为状态栏低频工具入口而非日常主工作区，页面首先说明适用场景并提供“生成诊断包”；文件选择和逐文件预览默认收进高级选项。主进程复用同一文档构造生成 ZIP，包含 `summary.json`、`tasks.json`、`logs.ndjson` 和 `README.txt`，写盘前再次执行安全扫描。任务中心的失败/中断记录可直接进入问题诊断。凭据、认证 Header、私钥、查询正文和字符串绑定属于固定排除项，不得提供用户开关。
- 诊断包任务记录的 `createdAt`、`updatedAt`、`completedAt` 使用本地 `YYYY-MM-DD HH:mm:ss.SSS`，不输出带 `T`/`Z` 的 ISO UTC 文本。交互式查询若仅执行 `m = graph.openManagement()`，必须保留服务端变量赋值并返回可序列化摘要；若直接执行 `graph.openManagement()`，返回摘要后必须回滚不可复用的临时 Management。禁止直接返回 `ManagementSystem` 导致 GraphSON 递归序列化后端驱动对象。
- 连接测试失败、Schema 读取/历史失败、ConfiguredGraphFactory 能力或实例读取失败，以及任务中心失败/中断记录，统一提供“生成诊断包”入口；入口必须携带来源、连接、图、阶段、时间和异常摘要。问题诊断页展示当前故障上下文，主进程再次校验和脱敏后写入 `summary.json`，禁止仅靠 Renderer 隐藏敏感信息。
- 问题诊断使用确定性规则引擎，不调用外部 AI 或上传诊断数据；结论必须包含严重度、置信度、证据和可执行建议。首批识别实例 ID 冲突、GraphSON 序列化、evaluationTimeout、Elasticsearch 分片上限、Schema 重名、索引生命周期、ConfiguredGraphFactory 残留和能力探测失败。ZIP 必须包含 `diagnostic-report.md`；离线复诊仅接受带 `summary.json` 的 ZIP，并限制压缩包大小、文件数量、单项和总解压体积。
- 自动诊断和离线复诊结果通过 SQLite v12 `diagnostic_records` 持久化；同一故障刷新按来源、故障时间和结论指纹去重，不得重复累加。记录状态由用户显式在未读、已确认、已解决之间推进，支持重新打开与二次确认删除。默认保留最近 200 条且不超过 90 天，查看记录本身不得自动更改状态。
- i18n 消息目录当前为每种语言 1272 条，并会在生成时清理已从源码移除的废弃文案。翻译服务不可用时生成脚本保留英文 fallback 并正常完成，不能因远端限流阻断本地构建。

## 9. 开发与验证命令

要求 Node.js 22.x 和 pnpm 8.11.0。

```bash
pnpm install
pnpm i18n:generate
pnpm typecheck
pnpm test
pnpm build
```

- `pnpm typecheck`：全部 workspace TypeScript 检查。
- `pnpm test`：当前 191 项测试，其中 187 项本地通过，4 项真实 JanusGraph 集成测试在未配置环境时跳过。
- `pnpm build`：Electron Forge 生产打包。
- macOS ARM64 打包输出：
  `apps/desktop/out/Janus Studio-darwin-arm64/Janus Studio.app`。
- 不要为了验证普通 UI 修改直接运行打包应用；如需启动，必须先得到用户明确要求。

## 10. 后续修改流程

1. 先定位现有实现，不要重复创建并行组件或原型页面。
2. 功能修改必须覆盖主窗口和全屏模式，特别是拓扑详情、菜单与响应式布局。
3. 新增文字后运行 `pnpm i18n:generate`。
4. 新增纯逻辑时补充 `tests/unit` 测试。
5. 至少运行 `pnpm typecheck` 和相关测试；影响生产包、主进程、IPC、依赖或发布产物时运行 `pnpm build`。
6. 真实 JanusGraph/Docker 验证必须先说明目标、查询和是否会写入；用户明确授权后才能执行。
7. 用户已明确完成的人工验收应记录为已验收，不要反复列为未完成；自动化覆盖与人工验收需要分别描述。
8. 不得删除或覆盖用户的无关改动。当前仓库可能存在其他修改，必须先检查 `git status` 和目标文件差异。
9. 提交前运行 `git diff --check`，确认没有凭据、临时路径、生成物或无关文件进入提交。
10. 最终回复应明确说明完成内容、验证结果、打包位置、是否启动应用以及修改是否已提交。

## 11. 当前验证状态

- 当前代码基线：查询资产、诊断闭环、发布验收第二切片、企业连接基础设施和连接工作区组织均已实现；以仓库最新提交为准。
- 最近一次 `pnpm typecheck`：通过。
- 最近一次 `pnpm test`：191 项，187 通过，4 个真实环境测试跳过，0 失败。
- 最近一次 `pnpm build`：macOS ARM64 生产包生成成功。
- 最近一次打包时间：2026-08-14。
- 多节点 Binding 传播、真实 Drop、残留实例处理和关闭后自动重开语义已由用户验收。
- 当前 macOS ARM64 生产包已重新生成并由用户启动验证；已在用户授权下对本地 JanusGraph 1.1.0 完成只读 WS/HTTP/认证/Binding/Management 与 CONNECT 代理回归，未修改图、Schema、容器或 Elasticsearch。

## 12. 后续路线

- 统一长任务中心、JanusGraph 兼容层、官方 Schema JSON 路由、GraphSON 主进程编排、查询资产管理和问题诊断闭环已经完成。
- 连接基础设施实现切片已经完成：mTLS、自定义 CA、直连/系统/专用代理、SSH Tunnel、Bearer/HMAC、敏感 Header 凭据化、认证 Profile 和分阶段连接测试均已贯通；运行时生成的本地证书 fixture 已覆盖 HTTPS、WSS、SSH Tunnel 与 HTTP CONNECT 代理下的 mTLS。Tunnel 生命周期状态、断线后的按需重建、并发建连合并和 Renderer 实时通知已完成，企业网络 fixture 已进入四平台 CI；剩余工作是对应真实基础设施的跨平台验收。
- 详细分期、依赖和验收标准见 `docs/剩余功能迭代计划.md`。
