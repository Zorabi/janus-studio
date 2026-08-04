# JanusGraph Observatory 开发记录与 Agent 约定

## 1. 项目定位

- 产品名称：JanusGraph Observatory。
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
- 下拉框、菜单、弹窗、命令面板、右键菜单必须使用统一的 Observatory 视觉体系，不能回退到浏览器或 Monaco 的默认视觉样式。
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
- 导入导出页面面向整图数据；查询结果导出位于查询结果工具栏，不应混入整图迁移页面。

### 4.6 偏好设置

- 设置内部按常规、外观与字体、图谱、编辑器、快捷键、安全分组。
- 支持深色、浅色和跟随系统主题，主题变量必须覆盖全部页面。
- 支持多语言、界面字号、代码字号、内置字体和用户自定义系统字体/CSS 字体列表。
- 支持图渲染数量、顶点/关系显示字段、布局模式与物理参数。
- 支持跨平台快捷键配置；macOS 使用 Command，Windows/Linux 使用 Control 对应操作。

## 5. 安全与凭据规则

- 不得因为常规开发验证而自动启动应用或访问真实连接。
- 用户明确反感反复弹出 macOS 钥匙串密码请求。除非用户明确要求启动或进行真实连接验证，否则只执行类型检查、测试和打包。
- 凭据读取必须使用会话缓存，不能在每次渲染、查询或 Schema 操作时重复解密。
- macOS `safeStorage` 或钥匙串不可用时，应使用项目已有的本地加密回退策略，并向用户明确说明状态；不能让保存连接或查询直接失效。
- 日志、错误提示和测试输出中不得打印密码、解密密钥或完整认证 Header。

## 6. 最近完成的修正

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
- i18n 消息目录已生成到每种语言 557 条。

## 7. 开发与验证命令

要求 Node.js 22.x 和 pnpm 8.11.0。

```bash
pnpm install
pnpm i18n:generate
pnpm typecheck
pnpm test
pnpm build
```

- `pnpm typecheck`：全部 workspace TypeScript 检查。
- `pnpm test`：当前 28 项测试，其中 24 项本地通过，4 项真实 JanusGraph 集成测试在未配置环境时跳过。
- `pnpm build`：Electron Forge 生产打包。
- macOS ARM64 打包输出：
  `apps/desktop/out/JanusGraph Observatory-darwin-arm64/JanusGraph Observatory.app`。
- 不要为了验证普通 UI 修改直接运行打包应用；如需启动，必须先得到用户明确要求。

## 8. 后续修改流程

1. 先定位现有实现，不要重复创建并行组件或原型页面。
2. 功能修改必须覆盖主窗口和全屏模式，特别是拓扑详情、菜单与响应式布局。
3. 新增文字后运行 `pnpm i18n:generate`。
4. 新增纯逻辑时补充 `tests/unit` 测试。
5. 至少运行 `pnpm typecheck` 和相关测试；影响生产包时运行 `pnpm build`。
6. 不得删除或覆盖用户的无关改动。当前仓库可能整体处于未跟踪状态，不能依赖 Git diff 判断哪些文件属于用户。
7. 最终回复应明确说明完成内容、验证结果、打包位置以及是否启动过应用。

## 9. 当前验证状态

- 最近一次 `pnpm typecheck`：通过。
- 最近一次 `pnpm test`：28 项，24 通过，4 个真实环境测试跳过，0 失败。
- 最近一次 `pnpm build`：通过。
- 最近一次打包时间：2026-08-04。
- 最近一次任务未启动应用，未触发钥匙串和真实 JanusGraph 连接。
