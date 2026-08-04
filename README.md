# JanusGraph Observatory

面向 macOS、Windows 与 Linux 的 JanusGraph 桌面工作台。应用采用 Electron + React + TypeScript 工作区架构，界面和数据均由真实连接、查询与本地持久化状态驱动，不包含默认图数据。

## 项目位置

当前开发目录：

```text
<repository-root>
```

原目录 `<legacy-repository-root>` 暂时保留为迁移回退副本。

## 本地运行

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm build
```

生成当前平台的可分发制品：

```bash
pnpm make
```

仓库内置三平台 CI：macOS 生成 ZIP，Windows 生成 Squirrel 安装包，Linux
生成 DEB/RPM。未配置发布证书时，macOS 制品会使用可启动的 ad-hoc 签名，其余制品为
未签名测试包；这些制品仅供开发验证。正式分发前仍需分别配置 Apple Developer ID、
公证、Windows 代码签名和发行渠道。

若所在网络访问 Electron 官方下载源较慢，可只为当前命令指定镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm install
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ pnpm build
```

### 旧凭据迁移

应用移动目录、重新打包或 macOS Keychain 授权变化后，旧版 `safeStorage`
密文可能无法继续解密。此时进入“连接管理”编辑对应连接并重新输入一次密码；
新密码会写入带版本标记的凭据格式。系统密钥设施可用时仍优先使用它，否则自动
使用权限限制为当前操作系统用户的 AES-256-GCM 本地密钥。

## 工作区结构

```text
apps/desktop/           Electron 主进程、preload 与 React renderer
packages/domain/        连接、查询等领域模型与桌面 API 契约
packages/application/   协议地址、输入规范化等应用层逻辑
docs/                   需求分析与架构设计
design-system/          视觉规范与页面覆盖规则
```

## 已实现能力

- 多连接新增、编辑、删除、测试和切换，支持 WS/WSS/HTTP/HTTPS
- WS/WSS 连接支持 Sessionless 与持久 Sessioned Client，默认使用 Sessionless
- `Traversal Source` 会实际映射编辑器中的 `g`；`Graph Binding` 独立用于 Management API
- 用户名、密码及超时设置；macOS 默认使用当前用户专属的 AES-256-GCM 本地保险库，避免本地/ad-hoc 构建反复请求钥匙串；Windows/Linux 优先使用系统密钥设施并支持本地加密回退
- 高级网络配置支持 TLS 证书校验、WebSocket 压缩和自定义请求头；WSS/HTTPS 默认严格验证证书
- 真实 Gremlin 查询工作台与浮层式下一 Step 提示；优先复用成功历史并过滤不兼容 Step
- 查询标签页分别绑定连接与 Sessioned 会话，切换标签不会误用其他连接或共享服务器变量
- 查询标签页内容、显示模式、当前连接与激活状态会在应用重启后恢复
- 查询标签页支持双击重命名、复制、保存为 Gremlin 文件、关闭其他/右侧标签页、恢复最近关闭，并自动滚动定位当前标签
- 支持执行编辑器选中内容或完整查询；WS/HTTP 查询均可主动停止，并提供可配置的跨平台快捷键
- Monaco Gremlin 编辑器支持行号、语法高亮、括号匹配、代码折叠、查找/替换、查询格式化，以及基于当前 Vertex Label、Edge Label、Property Key 的 Schema 感知补全
- JanusGraph 服务端错误会映射为 Monaco 行列诊断标记，便于直接定位失败语句
- 每个标签页支持 JSON 参数绑定、只读写操作保护、`.gremlin` 脚本打开/保存、可命名和重命名的查询收藏，以及 Sessioned 事务开启/状态/提交/回滚
- 查询可一键追加 `explain()` 或 `profile()`，用于查看遍历策略和 Step 执行指标
- 真实结果支持拓扑、表格、结构化 JSON 与 Gremlin Console `==>` 原始行输出四种显示模式
- 表格支持虚拟滚动、排序、全局/逐列筛选、列宽、列显隐/重排、密度、行选择复制，以及结构化/控制台双模式行详情
- 表格支持标准 ARIA Grid 语义、方向键/Home/End 单元格导航及 `Cmd/Ctrl+C` 单元格复制
- 拓扑顶点与关系曲线可独立拖动，画布可自由平移、缩放和全屏；点击元素查看原始属性详情
- 拓扑支持力导向、层级、环形、网格布局，按 Label 自动配色并提供图例、搜索、邻居展开、布局保存和 SVG 导出
- 顶点/关系标题支持按属性优先级配置，并可分别设置 10–500 顶点、10–1,000 条边的渲染上限
- SQLite 查询历史，支持重新载入、单条删除和清空
- 以无横向滚动的卡片视图结构化展示 Property Key、Vertex Label、Edge Label、Graph Index
- 创建 Property Key 时可同时创建 Composite 与 Mixed Index，也支持为已有属性补建两类索引
- Graph Index 支持注册、启用、重建、禁用和删除；长任务写入 SQLite 审计记录，异常退出后标记中断并支持显式重试，同时可保存/比较 Schema 结构快照
- Observatory v1 整图 JSON 归档支持预览、批次设置、停止、失败继续、来源 ID 冲突策略和失败日志；查询结果单独导出 JSON/JSONL/CSV
- 14 种区域语言选项；12 个非中英文语言包各覆盖 539 条 UI 文案，语言名称会随当前界面语言本地化显示
- WS 大结果按 Gremlin Server 响应批次流式消费，界面内存保留上限为 10,000 条并显示真实总数；截断结果可重新执行只读查询并流式导出完整 JSON Lines 文件
- 深色/浅色/跟随系统主题；系统、等宽、多语言、人文、技术展示五类字体栈
- 11–30px 界面字号、12–40px 编辑器字号、密度、默认结果视图、历史上限与减少动态效果设置
- Lucide 图标体系、键盘导航与 Reduced Motion
- 稳定桌面布局，不使用会覆盖业务内容的浮动导航
- 单元/SQLite 集成、官方 JanusGraph 1.1.0/1.0.0 协议兼容和打包应用 E2E 冒烟测试；标签发布支持三平台制品、签名、公证、SHA-256 校验与自动更新

## 查询格式化与事务

点击编辑器工具栏中的“格式化”，或按 `Cmd/Ctrl + Shift + F`，可以将顶层 Gremlin
Step 排成纵向管道；字符串、注释与嵌套遍历内容不会被错误拆分。快捷键可在“偏好设置 →
快捷键”中修改。

跨查询事务仅适用于 WS/WSS 的 Sessioned Client。先在“连接管理”把 Client 模式设为
Sessioned，然后在查询标签页点击“事务 → 开启事务”。该标签页后续查询会复用同一服务端
Session，直到点击“提交”“回滚”或关闭标签页。Sessionless 与 HTTP(S) 查询是独立请求，
不能保留跨查询事务。

## 数据迁移边界

桌面端整图导入导出面向中小规模迁移，单个归档上限为 200 MB。批次停止发生在当前服务器请求完成后，已提交批次不会自动回滚。生产级或超大规模迁移仍应使用 JanusGraph Bulk Loading、Hadoop/ETL 或集群侧作业。

“按来源 ID 跳过已有顶点”模式依赖图中已经存在对应的 Property Key（默认 `_observatorySourceId`）。应用不会在数据导入过程中隐式修改 Schema。

## 文档

- [需求分析与架构设计](docs/需求分析与架构设计.md)
- [设计系统](design-system/janusgraph-desktop/MASTER.md)
- [工作台设计覆盖规则](design-system/janusgraph-desktop/pages/workbench.md)
- [发布、签名与自动更新](docs/发布与签名.md)
