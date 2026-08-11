# Contributing to Janus Studio

[English](CONTRIBUTING.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Thank you for helping improve Janus Studio. This guide explains where changes
belong, which project rules must remain true, and what to verify before opening
a pull request.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Discuss substantial product, protocol, storage, security, or architecture
  changes in an issue before implementation.
- Keep each change focused. Do not mix unrelated cleanup into a feature or fix.
- Never include passwords, encryption keys, complete authentication headers,
  certificates, local databases, real graph data, or unredacted screenshots in
  issues, logs, tests, commits, or pull requests.
- Do not use a real JanusGraph connection for routine validation.

## Why there are three workspaces

Janus Studio is one product split into three pnpm workspace packages. They are
architectural layers, not three separately deployed applications.

```text
@janusgraph/domain
        ↑
@janusgraph/application
        ↑
@janusgraph/desktop
```

`@janusgraph/desktop` also imports shared contracts directly from
`@janusgraph/domain`. Dependencies must point inward; `domain` must never depend
on `application` or `desktop`, and `application` must never depend on `desktop`.

| Workspace | Responsibility | Put changes here when... |
| --- | --- | --- |
| `packages/domain` (`@janusgraph/domain`) | Framework-independent domain types, request/result models, and the typed `DesktopApi` contract shared across Electron processes | A connection, query, history, schema, file, security, or IPC contract changes |
| `packages/application` (`@janusgraph/application`) | Reusable application rules and pure transformations that depend only on domain contracts | Logic can be tested without Electron, React, SQLite, the file system, or a live server |
| `apps/desktop` (`@janusgraph/desktop`) | The shipped Electron application: main-process services and storage, preload bridge, React renderer, Monaco editor, graph canvas, styles, packaging, and native integration | A change touches UI, IPC implementation, persistence, Gremlin transport, files, credentials, or platform behavior |

The repository root is the workspace orchestrator. Its scripts run commands
across the three packages; it is not another runtime layer or a publishable npm
package. The internal `@janusgraph/*` package names are technical identifiers,
not separate products.

### Desktop process boundaries

- `apps/desktop/src/main` owns privileged operations: windows, IPC handlers,
  Gremlin clients, SQLite, files, and credential storage.
- `apps/desktop/src/preload` exposes the smallest safe API required by the
  renderer. Keep Electron context isolation intact.
- `apps/desktop/src/renderer` owns React UI and presentation logic. It must use
  the typed preload API instead of importing Node or Electron privileges.

When adding a cross-process capability, update the domain contract first, then
the main-process implementation and validation, the preload bridge, and finally
the renderer consumer.

## Development setup

Prerequisites:

- Node.js 22.x (`22.17.0` is pinned in `.nvmrc`)
- pnpm 8.11.0
- Git

```bash
git clone <repository-url>
cd janusgraph-desktop-manager
pnpm install
pnpm dev
```

Starting the application is not required for ordinary type, unit, integration,
or package verification. Only use a real JanusGraph instance when the test is
explicitly intended to exercise live compatibility.

## Development workflow

1. Fork the repository and create a focused branch.
2. Put the change in the narrowest correct workspace and preserve the dependency
   direction described above.
3. Add or update tests for changed behavior.
4. Add every user-visible string to i18n and run `pnpm i18n:generate`.
5. Update documentation when behavior, configuration, architecture, security,
   compatibility, or user workflows change.
6. Run the checks appropriate to the change.
7. Open a pull request that explains the problem, solution, verification,
   screenshots for visible UI changes, and any migration or compatibility impact.

## Verification

Run at least:

```bash
pnpm typecheck
pnpm test
```

Additional checks:

| Change | Required verification |
| --- | --- |
| User-visible text or locale catalogs | `pnpm i18n:generate`, `pnpm typecheck`, and i18n tests |
| Pure domain or application logic | Relevant tests under `tests/unit` |
| SQLite, repositories, IPC, files, or credentials | Relevant unit and integration tests |
| Packaged runtime, Forge, preload, native modules, or production assets | `pnpm build` and, when applicable, `pnpm test:e2e` |
| JanusGraph protocol compatibility | `pnpm test:compat` in an explicitly configured test environment |

Four live integration tests are skipped when no real JanusGraph environment is
configured. A skipped live test is expected during routine local validation.

## Project invariants

- Use Lucide for all interface icons; do not add emoji icons.
- Do not represent selection with a left vertical border, line, or inset shadow.
- Keep the top slogan on one complete line and maintain usable responsive layouts.
- Menus, dialogs, command palettes, context menus, and Monaco overlays must use
  the Janus Studio visual system.
- Verify feature UI in both the main window and relevant full-screen modes.
- Keep new user-visible strings in i18n. Language names must be localized when
  the interface is Chinese.
- Preserve sessionless/sessioned semantics and tab-to-connection isolation.
- Keep structured results normalized while leaving the raw response complete.
- On macOS, credentials must stay in the current-user-only AES-256-GCM vault.
  Do not initialize `safeStorage`, Keychain, or Electron cookie encryption.
- Never print secrets or complete authentication headers in logs or errors.
- Do not silently modify graph schema during data import.

## Commit style

Use a focused Conventional Commit:

```text
type(scope): concise description
```

Common types are `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, and
`chore`. Useful scopes include `desktop`, `domain`, `application`, `query`,
`schema`, `graph`, `settings`, `i18n`, and `release`.

Examples:

```text
feat(query): add traversal diagnostics
fix(domain): align schema job result contract
docs: explain workspace boundaries
```

## Pull request checklist

- [ ] The change is focused and placed in the correct workspace.
- [ ] New behavior has relevant test coverage.
- [ ] User-visible strings and documentation are updated.
- [ ] `pnpm typecheck` and relevant tests pass.
- [ ] Packaging was verified when production behavior can be affected.
- [ ] No credentials, private graph data, or generated release artifacts are included.
- [ ] The pull request describes migration, security, and compatibility impact.

## License

By contributing, you agree that your contributions are licensed under the
repository's [GNU Affero General Public License v3.0 only](LICENSE).
