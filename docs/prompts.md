# Agent 提示词模板

供后续开发各阶段直接使用或改编。每个提示词默认要求 Agent 先阅读 `AGENTS.md`、`docs/conventions.md` 与相关文档,再开始工作。

## 通用前置(拼在每个提示词开头)

```
请先阅读 AGENTS.md、docs/conventions.md、docs/architecture.md 与 docs/fairlight-ember.md。
严格遵守:代码/注释/提交信息用英文;本地真实 Fairlight 只允许动 MIC-REVERB、BASS、
Anagram-Wet、Anagram-Dry 四个输入通道的推子,禁止删改通道;自动化测试只用 Mock Provider;
新增依赖必须 MIT 兼容。
```

## Phase 1 — 工程脚手架

```
按 docs/development-plan.md 的 Phase 1 搭建 pnpm workspaces 单仓:
apps/server(Fastify + TS)、apps/web(Vite + React + TS)、packages/shared、packages/test-utils。
配置 tsconfig.base.json(strict)、ESLint + Prettier、Vitest(v8 覆盖率,门槛见 docs/conventions.md)、
根脚本 dev/build/lint/test、.gitignore、GitHub Actions 占位。
完成后逐条核对 Phase 1 验收标准并汇报结果。
```

## Phase 2 — Ember+ 树发现

```
按 docs/development-plan.md 的 Phase 2:
1. 在 apps/server 写一个树 dump 脚本,用 emberplus-connection 连接本地 Fairlight Live
   (host/port 由命令行参数传入),递归展开完整树,输出 JSON 到 docs/tree-dumps/(带日期)。
2. 分析 dump,把所有所需节点(通道/总线的 level、mute、name、meter,system/loudness 下的
   integrated、true-peak、reset)的实际路径模式、类型、范围、单位回写 docs/fairlight-ember.md。
3. 在 packages/test-utils 实现 Mock Ember+ Provider,树结构复刻 dump 结果。
4. 验证写入:仅对允许的四个通道之一写推子值,确认生效后复原。
不确定的结构不要猜,以 dump 为准;发现与文档预期不符的地方写入踩坑记录。
```

## Phase 3 — 后端核心

```
按 docs/development-plan.md 的 Phase 3 与 docs/architecture.md 实现后端:
EmberService(连接生命周期/订阅/写入/function 调用)、TreeMapper(运行时树发现与逻辑模型映射,
除它以外任何代码不接触原始 Ember 路径)、MixerStateStore、MeterHub(50ms 节流)、
socket.io 网关(事件契约在 packages/shared,zod 校验 + ack)、REST 配置 API 与 data/ JSON 持久化。
集成测试基于 Mock Provider,必须覆盖 docs/conventions.md 列出的后端边界场景清单,覆盖率达标。
```

## Phase 4 — 前端混音页

```
按 docs/development-plan.md 的 Phase 4 实现混音页:
socket.io 接入与 zustand 状态(电平帧独立 store,避免整页重渲)、按通道类型分区、
推子(dB 刻度、拖动本地回显优先)、ON 开关(mute 取反)、电平表(峰值保持、颜色分段)、
响度区(LUFS/dBTP 读数 + reset)。样式简洁、贴近真实调音台直觉、少解释性文本。
组件单测覆盖 docs/conventions.md 的前端边界场景清单,覆盖率达标。
```

## Phase 5 — Views 配置

```
按 docs/development-plan.md 的 Phase 5 实现 views:
shared 中的 View 模型(channelId + lastKnownName)、REST CRUD 与持久化、配置页(勾选通道、排序)、
主页切换、失配处理(占位渲染 + 配置页一键清理,不自动改动 view)。
集成测试覆盖 CRUD、失配、空配置场景,覆盖率达标。
```

## Phase 6 — UX 打磨

```
按 docs/development-plan.md 的 Phase 6 打磨:暗色主题、触屏推子体验、错误态/空态、
断线重连端到端恢复、电平帧渲染性能。长时间运行验证无泄漏、无断连不恢复。
```

## Phase 7 — 打包交付

```
按 docs/development-plan.md 的 Phase 7:多阶段 Dockerfile(node:22-alpine,data/ 挂卷)、
docker-compose 示例、Windows 启动脚本,补全 README 快速开始,全量核对文档与实际行为一致。
```

## 缺陷修复(通用)

```
修复以下问题:<描述>。
先写一个能复现问题的失败测试(用 Mock Provider),再修复使其通过;不要顺手重构无关代码。
若根因涉及 Fairlight Ember+ 树结构与预期不符,将结论写入 docs/fairlight-ember.md 踩坑记录。
```
