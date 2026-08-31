# Phase 1 执行提示词 — 工程脚手架

> 用法:将本文档全文作为执行会话的任务提示词。执行会话完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束
2. `docs/conventions.md` — 目录结构、命名、测试、Git 规范(本阶段的直接依据)
3. `docs/development-plan.md` — Phase 1 交付物与验收标准(本阶段的任务来源)
4. `docs/architecture.md` — 架构设计(了解即可,本阶段不实现业务逻辑)

## 硬性约束

- 代码、注释、提交信息、日志文案用**英文**;文档与报告用**简体中文**。
- 新增依赖必须 MIT 或 MIT 兼容许可,引入前确认 `license` 字段。
- **本阶段不涉及 Ember+,禁止连接真实 Fairlight 设备,禁止安装 emberplus-connection 之外阶段的任何设备通信代码**(该依赖留到 Phase 2+ 再引入)。
- 开发机为 Windows(PowerShell),所有脚本必须在 Windows 本机可运行;CI 跑在 Linux runner 上,两端都要兼容(注意脚本不要用平台特定语法,跨平台需求用 Node 或成熟工具解决)。
- 包管理器用 pnpm(workspaces),Node 22。

## 任务范围

按 `docs/development-plan.md` 的 Phase 1 搭建工程脚手架。只搭骨架,不实现任何业务逻辑(无 Ember、无混音功能)。

### 1. 仓库初始化

- `git init`,首个提交包含现有文档(AGENTS.md、CLAUDE.md、LICENSE、README.md、docs/、.cursor/)。
- `.gitignore`:`node_modules`、构建产物、覆盖率报告、`data/`(运行时配置不入库)。
- 提交信息遵循 Conventional Commits(英文),按逻辑单元分多次提交。

### 2. pnpm workspaces 单仓

按 `docs/conventions.md` 的目录结构创建四个包:

- `apps/server` — Fastify + TypeScript。最小可运行:提供 `GET /api/v1/health`,并能托管 `apps/web` 的构建产物(生产模式单端口同源,见 `docs/architecture.md` 部署一节)。
- `apps/web` — Vite + React + TypeScript。最小可运行:一个占位页面即可。
- `packages/shared` — 共享类型与 zod 契约包,先放一个最小导出(如 health 响应的 zod schema,供 server 使用,同时验证跨包引用链路)。
- `packages/test-utils` — 空骨架即可(Mock Provider 是 Phase 2 交付物),但包结构、tsconfig、测试配置就位。

跨包只通过 `packages/shared` 的导出通信,禁止深层相对路径引用其它包源码。

### 3. 工程配置

- `tsconfig.base.json`:`strict` 开启,各包继承;禁止 `any`。
- ESLint + Prettier 统一配置(根级共享,各包生效),lint 规则覆盖 TS 与 React。
- Vitest:各包配置 v8 覆盖率,门槛写入各包配置并强制(`apps/*` 行/分支/函数 ≥ 80%,`packages/shared` ≥ 90%),根目录 `pnpm test` 跑全部包。
- 每个包至少一个冒烟测试(前端用 React Testing Library),保证 `pnpm test` 通过且覆盖率统计正常输出。注意:门槛按现有代码计算,冒烟阶段就必须真实达标,不许临时调低门槛或排除源码文件蒙混。

### 4. 根脚本

- `pnpm dev` — 并行启动前后端(开发模式,web 走 Vite dev server)
- `pnpm build` — 构建全部包,产出 server 与 web 构建产物
- `pnpm lint` — ESLint + Prettier 检查全部包
- `pnpm test` — Vitest 全部包(含覆盖率)
- 另需 typecheck 脚本(CI 用,`tsc --noEmit` 全部包)

### 5. CI(GitHub Actions)

- Linux runner,push 与 PR 触发。
- 流水线:install → lint → typecheck → test(覆盖率门槛强制)→ build,任一失败即红。
- 流水线本身必须完整,后续阶段只增加用例、不改流水线结构。
- pnpm 与依赖缓存配置好,Node 22。

## 明确不做的事

- 不实现任何 Ember+ / socket.io / 混音业务代码(那是 Phase 2–3)。
- 不修改 `docs/` 下的既有文档(执行报告是新增文件,不算)。
- 不创建 GitHub 远程仓库、不推送(由用户本地完成,见下)。

## 验收自查

完成后逐条核对 `docs/development-plan.md` Phase 1 验收标准,在本机实际执行并记录结果:

1. 全部脚本(dev/build/lint/test)在 Windows 本机可运行 — 逐个跑一遍。
2. `pnpm build` 产出 server 与 web 构建产物,且 server 能托管 web 产物启动 — 实际启动并用 HTTP 请求验证页面与 `/api/v1/health` 可访问,验证后关闭进程。
3. `pnpm test` 通过,覆盖率统计正常输出且门槛生效。
4. CI 在 GitHub 上全绿 — **此条无法在执行会话内验证**(仓库尚未推送 GitHub),执行会话的责任是保证 workflow 文件完整正确、且本机按 CI 相同步骤(lint → typecheck → test → build)串行执行全绿;GitHub 上的最终验证与「故意不达标分支验证覆盖率红线」由用户完成,报告中列为待办移交。

## 执行报告要求

执行完成后,在 `docs/reports/phase-1-report.md` 产出执行报告(简体中文),包含以下章节:

1. **结果总览** — 一段话说明完成状态(全部完成 / 部分完成及原因)。
2. **验收标准逐条核对** — 对 Phase 1 每条验收标准:通过/未通过/移交用户,附实际执行的命令与关键输出摘要(如测试数、覆盖率数字、构建产物路径)。
3. **交付物清单** — 实际创建的包、配置文件、脚本、CI workflow 的清单与用途一句话说明。
4. **依赖清单与许可确认** — 所有新增 npm 依赖(含 dev)的名称、版本、许可证,逐一确认 MIT 兼容。
5. **关键决策与偏离** — 与计划/规范不一致的地方及理由;没有则明确写"无偏离"。
6. **遗留问题与移交事项** — 需要用户完成的步骤(创建 GitHub 仓库并推送、确认 CI 全绿、建临时分支验证覆盖率门槛会红),以及任何未解决的问题。
7. **提交记录** — `git log --oneline` 输出。

报告必须如实反映实际执行结果:测试失败、跳过的步骤、未验证的项都要写明,不许美化。

## 完成定义

- 上述任务范围全部落地,本机 lint / typecheck / test / build 串行全绿。
- 全部变更已按 Conventional Commits 提交到本地 git。
- `docs/reports/phase-1-report.md` 已产出。
