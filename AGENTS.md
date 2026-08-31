# AGENTS.md

Fairlight Live Web Controller:通过 Ember+ 协议远程控制 Blackmagic Design Fairlight Live 的 Web 应用(Fastify 后端 + React 前端)。

## 技术栈

- 后端:Node.js + TypeScript + Fastify + socket.io,Ember+ 用 `emberplus-connection`(Sofie)
- 前端:React + TypeScript + Vite + zustand + socket.io-client
- 共享:`packages/shared` 存放类型与消息契约(zod)
- 测试:Vitest(前端加 React Testing Library),覆盖率门槛见 `docs/conventions.md`
- 工程:pnpm workspaces

## 目录结构

```
apps/server      后端:REST、socket.io 网关、Ember+ 客户端(TreeMapper 树发现)
apps/web         前端:混音页、配置页
packages/shared  共享类型与 zod 消息契约
docs/            详细文档(中文)
data/            运行时配置持久化(不入库)
```

## 关键约束

1. **本地测试安全**:开发机连接的是真实 Fairlight Live。只允许改动 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子;**禁止删改任何通道、禁止动其它通道的任何参数**。自动化测试一律使用 Mock Ember+ Provider,禁止连真实设备。云端 Agent 无法访问真实 Fairlight,只能依赖 Mock Provider 与 `docs/tree-dumps/` 的树 dump;真机验收由本地执行(见 `docs/development-plan.md` 云端开发边界)。
2. **Ember+ 树以运行时实际结构为准**:Ember+ 是自描述协议,无官方路径文档。官方手册附录的路径表面向 OSC,与 Ember+ 树不一致,勿作为编码依据。参见 `docs/fairlight-ember.md`。
3. **语言**:代码、注释、提交信息、PR 标题与正文用英文;Agent 文档与对话用简体中文。
4. **许可**:项目将以 MIT 开源,新增依赖必须是 MIT 或兼容许可。
5. **文档维护**:文档只描述项目当前状态,不留历史决策变更;踩坑记录例外,写入 `docs/fairlight-ember.md` 的踩坑章节。

## 文档索引

- `docs/architecture.md` — 架构与数据流
- `docs/development-plan.md` — 分阶段开发计划与验收标准
- `docs/conventions.md` — 编码/测试/提交规范
- `docs/fairlight-ember.md` — Fairlight Ember+ 参考与踩坑记录
- `docs/prompts.md` — 各阶段 Agent 提示词模板

## Cursor Cloud specific instructions

- 标准命令见 `package.json` 根 scripts:`pnpm dev`(server 3000 + web 5173,web 通过 `/api` 代理到 3000)、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
- Vite 开发服务器只监听 IPv6 的 `localhost`(`::1`)。用 `http://localhost:5173` 访问前端;`http://127.0.0.1:5173` 会连接失败。后端 Fastify 监听 `127.0.0.1:3000`,两种写法均可。
- 云端 Agent 无法连接真实 Fairlight。当前后端启动不需要设备(仅 `/api/v1/health` 与静态托管);Ember+ host/port 为运行时配置。自动化测试一律用 Mock Provider(见 `packages/test-utils`)。
- `pnpm dev` 会先 build `@flwc/shared` 再并行起 server/web;若改了 `packages/shared` 需重跑该构建(或 `pnpm --filter @flwc/shared build`)其它包才能拿到最新类型。
