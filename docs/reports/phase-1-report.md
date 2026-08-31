# Phase 1 执行报告 — 工程脚手架

## 1. 结果总览

Phase 1 任务范围已在本机落地：pnpm workspaces 四个包、严格 TypeScript、ESLint + Prettier、Vitest 覆盖率门槛、根脚本与 GitHub Actions workflow 均已就位。本机串行执行 lint → typecheck → test → build 全绿；`pnpm build` 后 `node apps/server/dist/main.js` 可同时提供 `GET /api/v1/health` 与前端静态页。GitHub 上 CI 全绿与「故意不达标分支验红线」无法在本会话验证，已移交用户。

## 2. 验收标准逐条核对

| 验收标准 | 结果 | 实际执行与输出摘要 |
| --- | --- | --- |
| 全部脚本在 Windows 本机可运行 | 通过 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm dev` 均在 Windows / PowerShell / Node v22.14.0 / pnpm 11.17.0 下执行。 |
| `pnpm build` 产出 server 与 web 构建产物，server 可托管 web 产物启动 | 通过 | 构建产物：`apps/server/dist/main.js`、`apps/web/dist/index.html`、`apps/web/dist/assets/index-ChJOreNb.js`、`packages/shared/dist/`、`packages/test-utils/dist/`。`node apps/server/dist/main.js` 后：`GET /api/v1/health` → `200` `{"status":"ok"}`；`GET /` → `200` HTML（title: Fairlight Live Web Controller）。验证后已关闭进程。 |
| `pnpm test` 通过，覆盖率统计正常输出且门槛生效 | 通过 | 17 个测试全部通过（shared 3、test-utils 1、web 3、server 10）。覆盖率摘要：shared 100%（门槛 90%）；web 行/语句 100%、分支 100%（门槛 80%）；server 语句 92.85%、分支 94.44%、函数 100%、行 92.3%（门槛 80%）；test-utils 100%（规范未设门槛）。门槛写在各包 `vitest.config.ts` 的 `coverage.thresholds`，未排除源码、未调低门槛。 |
| CI 在 GitHub 上全绿，覆盖率门槛生效 | 移交用户 | workflow 已写好且本机按相同顺序 lint → typecheck → test → build 全绿。仓库尚未推送 GitHub，无法在 runner 上确认；故意不达标临时分支验红线亦未做。 |

补充：`pnpm dev` 可并行拉起 Vite（`http://localhost:5173/`，约 154ms ready）。验收过程中因先跑过生产 `node dist/main.js`，3000 端口曾被占用，tsx watch 打出 `EADDRINUSE`；清理后 Vite 与 `/api` 代理均返回 200（`GET http://127.0.0.1:5173/api/v1/health` → `{"status":"ok"}`）。无浏览器 MCP，页面仅用 HTTP 响应验证，未做点击操作。

本机串行命令结果：

```
pnpm lint        # eslint . && prettier --check .  通过
pnpm typecheck   # 四个包 tsc --noEmit 通过
pnpm test        # 17 passed
pnpm build       # shared / test-utils / web / server 通过
```

## 3. 交付物清单

| 路径 | 用途 |
| --- | --- |
| `.gitignore` | 忽略 `node_modules`、`dist`、`coverage`、`data/`、tsbuildinfo 等 |
| `pnpm-workspace.yaml` | workspaces（`apps/*`、`packages/*`）与 pnpm 11 `allowBuilds.esbuild` |
| `package.json` | 根脚本 `dev` / `build` / `lint` / `typecheck` / `test`；`packageManager=pnpm@11.17.0`；`engines.node>=22` |
| `tsconfig.base.json` | 共享严格 TS（`strict`、`noImplicitAny`、`verbatimModuleSyntax`） |
| `eslint.config.js` | 根级 flat config：TS strict + React + Prettier |
| `.prettierrc` / `.prettierignore` | 统一格式化；忽略 `docs`、`*.md`、构建产物，避免改既有文档 |
| `.nvmrc` | Node 22 |
| `.github/workflows/ci.yml` | push/PR：install → lint → typecheck → test → build |
| `packages/shared` | health 响应 zod schema，供 server 引用 |
| `packages/test-utils` | Phase 2 Mock Provider 空骨架 |
| `apps/server` | Fastify `GET /api/v1/health` + 生产托管 `apps/web/dist` |
| `apps/web` | Vite + React 占位页，dev 代理 `/api` → `:3000` |
| `pnpm-lock.yaml` | 锁定依赖 |

未创建空的 `ember/`、`state/`、`ws/` 目录。`data/` 由 `.gitignore` 约定，不入库。

## 4. 依赖清单与许可确认

下列为直接依赖的已安装版本与许可证（引入前通过 `npm view <pkg> license` 确认；Apache-2.0 视为 MIT 兼容）。

### 根

| 包 | 已安装版本 | 许可证 |
| --- | --- | --- |
| `@eslint/js` | 9.39.5 | MIT |
| `eslint` | 9.39.5 | MIT |
| `eslint-config-prettier` | 10.1.8 | MIT |
| `eslint-plugin-react` | 7.37.5 | MIT |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT |
| `globals` | 17.11.0 | MIT |
| `prettier` | 3.9.6 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |
| `typescript-eslint` | 8.68.0 | MIT |

### `@flwc/shared`

| 包 | 已安装版本 | 许可证 |
| --- | --- | --- |
| `zod` | 4.5.4 | MIT |
| `vitest` | 4.1.11 | MIT |
| `@vitest/coverage-v8` | 4.1.11 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |

### `@flwc/test-utils`

| 包 | 已安装版本 | 许可证 |
| --- | --- | --- |
| `vitest` | 4.1.11 | MIT |
| `@vitest/coverage-v8` | 4.1.11 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |

### `@flwc/server`

| 包 | 已安装版本 | 许可证 |
| --- | --- | --- |
| `fastify` | 5.12.1 | MIT |
| `@fastify/static` | 8.3.0 | MIT |
| `@flwc/shared` | workspace | — |
| `@types/node` | 22.20.1 | MIT |
| `tsx` | 4.23.13 | MIT |
| `vitest` | 4.1.11 | MIT |
| `@vitest/coverage-v8` | 4.1.11 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |

### `@flwc/web`

| 包 | 已安装版本 | 许可证 |
| --- | --- | --- |
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `@testing-library/dom` | 10.4.1 | MIT |
| `@testing-library/jest-dom` | 7.0.1 | MIT |
| `@testing-library/react` | 16.3.3 | MIT |
| `@types/react` | 19.2.18 | MIT |
| `@types/react-dom` | 19.2.5 | MIT |
| `@vitejs/plugin-react` | 6.1.1 | MIT |
| `jsdom` | 27.4.0 | MIT |
| `vite` | 8.2.2 | MIT |
| `vitest` | 4.1.11 | MIT |
| `@vitest/coverage-v8` | 4.1.11 | MIT |
| `typescript` | 5.9.3 | Apache-2.0 |

未安装 `emberplus-connection`、socket.io、zustand。传递依赖 `esbuild` 因需运行 postinstall，已在 `pnpm-workspace.yaml` 的 `allowBuilds` 中显式允许。

## 5. 关键决策与偏离

- **包名作用域 `@flwc/*`**：计划未指定 npm scope，采用短作用域；跨包只通过 `@flwc/shared` 的 `exports` 引用。
- **ESLint 9 而非 10**：当时最新 ESLint 为 10.9.1，但 `eslint-plugin-react@7.37.5` 的 peer 只到 `^9.7`。为保持 React lint 与无 peer 冲突，固定 ESLint / `@eslint/js` 9.39.5。这是对「用当前最新工具」的有意偏离，待 plugin 支持 ESLint 10 后再升。
- **TypeScript 5.9.3 而非 7.0.2**：npm 上最新 TypeScript 为 7.x（native preview），与 typescript-eslint 8 的稳定支持面不匹配，采用 5.9.3。
- **pnpm 11 `allowBuilds`**：`package.json` 的 `pnpm.onlyBuiltDependencies` 在 pnpm 11 已失效，改为写在 `pnpm-workspace.yaml`。
- **shared 的 `prepare` 脚本**：CI 顺序是 install → lint → typecheck → test → build。server 在 test/typecheck 阶段就要解析 `@flwc/shared` 的 `dist`，因此 shared 在 `pnpm install` 时编译，不改 CI 步骤顺序。
- **未预建空业务目录**：未创建 `ember/`、`state/`、`ws/` 等空文件夹。
- **无偏离验收口径**：覆盖率门槛按现有源码真实达标；未排除 `src` 源文件。

## 6. 遗留问题与移交事项

需要用户完成本地操作：

1. 创建 GitHub 远程仓库并推送（本会话按提示词不建远程、不 push）。
2. 确认 GitHub Actions 在 Linux runner 上全绿。
3. 建一个故意不达标的临时分支（例如把某包门槛调到 100% 或删掉一条测试）验证覆盖率红线会让 CI 变红，验证后删除该分支。
4. `pnpm dev` 与生产服务器都默认绑 `127.0.0.1:3000`。若本机该端口已被占用，设环境变量 `PORT` / `HOST`。

未解决问题：无。

## 7. 提交记录

`git log --oneline`：

```
2ce91a3 docs: fill Phase 1 getting started commands
d0673f2 ci: add GitHub Actions lint-typecheck-test-build workflow
b947c2e feat(web): add Vite React placeholder page
faf53ea feat(server): add health endpoint and static hosting
94a2708 chore(test-utils): add package skeleton
7840bf3 feat(shared): add health response zod schema
2592c9b chore: add pnpm workspace, TypeScript, ESLint, and Prettier
ee8d26e chore: initialize repository with project documentation
```

本报告将作为下一条 `docs: add Phase 1 execution report` 提交。
