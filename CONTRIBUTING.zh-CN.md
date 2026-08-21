# 参与 Janus Studio 开发

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

感谢你帮助改进 Janus Studio。本指南说明代码应放在哪一层、哪些项目约束必须保持，以及
提交 Pull Request 前需要完成哪些验证。

## 开始之前

- 新建 Issue 前先搜索已有 Issue 和 Pull Request。
- 重大产品、协议、存储、安全或架构调整应先通过 Issue 讨论。
- 每次改动保持聚焦，不要在功能或修复中混入无关清理。
- 不得在 Issue、日志、测试、Commit 或 Pull Request 中包含密码、加密密钥、完整认证
  Header、证书、本地数据库、真实图数据或未经脱敏的截图。
- 常规验证不得访问真实 JanusGraph 连接。

## 为什么有三个 workspace

Janus Studio 是一个产品，拆分为三个 pnpm workspace 包。它们是架构分层，不是三个需要
分别部署的应用。

```text
@janusgraph/domain
        ↑
@janusgraph/application
        ↑
@janusgraph/desktop
```

`@janusgraph/desktop` 也会直接使用 `@janusgraph/domain` 中的共享契约。依赖只能由外向内：
`domain` 不得依赖 `application` 或 `desktop`，`application` 不得依赖 `desktop`。

| Workspace | 职责 | 哪些改动放在这里 |
| --- | --- | --- |
| `packages/domain`（`@janusgraph/domain`） | 与框架无关的领域类型、请求/结果模型，以及 Electron 各进程共享的强类型 `DesktopApi` 契约 | 连接、查询、历史、Schema、文件、安全或 IPC 契约发生变化 |
| `packages/application`（`@janusgraph/application`） | 只依赖领域契约的可复用应用规则和纯数据转换 | 逻辑可以脱离 Electron、React、SQLite、文件系统和真实服务器进行测试 |
| `apps/desktop`（`@janusgraph/desktop`） | 最终交付的 Electron 应用：主进程服务与存储、preload 桥接、React renderer、Monaco 编辑器、图画布、样式、打包和原生集成 | 改动涉及 UI、IPC 实现、持久化、Gremlin 传输、文件、凭据或平台行为 |

仓库根目录负责统一编排三个包的脚本，不是另一个运行时分层，也不是要发布的 npm 包。
内部 `@janusgraph/*` 包名只是技术标识，不代表多个独立产品。

### Desktop 进程边界

- `apps/desktop/src/main` 负责特权操作：窗口、IPC Handler、Gremlin Client、SQLite、
  文件和凭据存储。
- `apps/desktop/src/preload` 只向 renderer 暴露必要的最小安全 API，必须保持 Electron
  Context Isolation。
- `apps/desktop/src/renderer` 负责 React UI 和展示逻辑；应使用强类型 preload API，
  不得直接引入 Node 或 Electron 特权。

新增跨进程能力时，应依次修改领域契约、主进程实现与输入校验、preload 桥接，最后修改
renderer 调用方。

## 开发环境

环境要求：

- Node.js 22.x（`.nvmrc` 固定为 `22.17.0`）
- pnpm 8.11.0
- Git

```bash
git clone <repository-url>
cd janus-studio
pnpm install
pnpm dev
```

常规类型检查、单元测试、集成测试和打包验证不要求启动应用。只有明确验证真实兼容性时，
才应使用专门配置的 JanusGraph 测试环境。

## 开发流程

1. Fork 仓库并创建职责单一的分支。
2. 将改动放入最窄且正确的 workspace，并保持上述依赖方向。
3. 为行为变化新增或更新测试。
4. 所有新增用户可见字符串都应进入 i18n，并运行 `pnpm i18n:generate`。
5. 行为、配置、架构、安全、兼容性或用户流程变化时同步更新文档。
6. 按改动范围完成相应验证。
7. 创建 Pull Request，说明问题、解决方案、验证结果、可见 UI 改动截图，以及迁移或兼容性影响。

## 验证要求

至少运行：

```bash
pnpm typecheck
pnpm test
```

其他验证：

| 改动 | 必需验证 |
| --- | --- |
| 用户可见文字或语言目录 | `pnpm i18n:generate`、`pnpm typecheck` 和 i18n 测试 |
| 纯领域或应用逻辑 | `tests/unit` 下的相关测试 |
| SQLite、Repository、IPC、文件或凭据 | 相关单元测试与集成测试 |
| 打包运行时、Forge、preload、原生模块或生产资源 | `pnpm build`，必要时运行 `pnpm test:e2e` |
| JanusGraph 协议兼容性 | 在显式配置的测试环境中运行 `pnpm test:compat` |

未配置真实 JanusGraph 环境时，4 项在线集成测试会自动跳过；常规本地验证中出现该跳过属于
预期行为。

## 项目不变量

- 所有界面图标使用 Lucide，不得添加表情符号图标。
- 不得用左侧竖线、边框或 inset 阴影表示选中状态。
- 顶部 Slogan 必须完整保持单行，并保证窗口缩放后的可用布局。
- 菜单、弹窗、命令面板、右键菜单和 Monaco 浮层必须使用 Janus Studio 视觉体系。
- 功能 UI 应同时验证主窗口和相关全屏模式。
- 新增用户可见字符串必须进入 i18n；中文界面中的语言名称也应本地化。
- 保持 Sessionless/Sessioned 语义和查询标签页与连接的隔离。
- 结构化结果应去除驱动层元数据，原始响应必须保持完整。
- macOS 凭据必须使用仅限当前用户访问的 AES-256-GCM 本地凭据库；不得初始化
  `safeStorage`、Keychain 或 Electron Cookie Encryption。
- 日志和错误信息不得输出凭据或完整认证 Header。
- 数据导入过程中不得隐式修改图 Schema。

## Commit 格式

使用职责单一的 Conventional Commit：

```text
type(scope): 简明描述
```

常用 type 包括 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci` 和 `chore`；
常用 scope 包括 `desktop`、`domain`、`application`、`query`、`schema`、`graph`、
`settings`、`i18n` 和 `release`。

示例：

```text
feat(query): 增加遍历诊断
fix(domain): 对齐 Schema 任务结果契约
docs: 说明 workspace 分层
```

## Pull Request 检查清单

- [ ] 改动范围聚焦，并放在正确的 workspace。
- [ ] 新行为具有相关测试覆盖。
- [ ] 用户可见字符串和文档已同步更新。
- [ ] `pnpm typecheck` 和相关测试通过。
- [ ] 可能影响生产行为时已验证打包。
- [ ] 未包含凭据、私有图数据或生成的发行制品。
- [ ] Pull Request 已说明迁移、安全和兼容性影响。

## 开源协议

提交贡献即表示你同意贡献内容按照仓库的
[GNU Affero General Public License v3.0 only](LICENSE) 授权。
