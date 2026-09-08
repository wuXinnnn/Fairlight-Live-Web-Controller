# Agent 提示词模板

供后续开发各阶段直接使用或改编。每个提示词默认要求 Agent 先阅读 `AGENTS.md`、`docs/conventions.md` 与相关文档,再开始工作。

## 通用前置(拼在每个提示词开头)

```
请先阅读 AGENTS.md、docs/conventions.md、docs/architecture.md 与 docs/fairlight-ember.md。
严格遵守:代码/注释/提交信息/PR 标题与正文用英文,前端除设备或应用带入的动态文本外所有固定 UI 文本用英文;本地真实 Fairlight 只允许动 MIC-REVERB、BASS、
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

## Phase 6 — UX 打磨与健壮性

Phase 6 拆成五个 PR,每个 PR 一条提示词,按顺序执行;每个 PR 单独达标覆盖率后再开下一个。

### 6.1 连接配置与错误态

```
按 docs/development-plan.md 的 Phase 6.1:前端 connection-api 客户端(复用 shared zod schema)、
两个页面头部可点击的连接状态灯与 CONNECTION 面板(host/port/状态/APPLY,已连接时二次确认)、
混音页空态按 socket 离线 / Ember 未连接 / 树为空三种原因分流并提供 CONFIGURE CONNECTION 入口。
后端只允许一项最小扩展:连接响应与 system:status 增加可选的 lastError 字段;环境变量种子值留到 Phase 7。
详细执行提示词见 docs/prompts/phase-6-1.md。集成测试覆盖 6.1 验收清单,覆盖率达标。
```

### 6.2 配置页 UX

```
按 docs/development-plan.md 的 Phase 6.2:引入 @dnd-kit/core + @dnd-kit/sortable(确认 MIT)实现
通道行/分组/可用通道的拖放(pointer、touch、keyboard 传感器),数据模型不变,新增纯函数
moveChannelTo 与 insertChannelAt,箭头按钮保留;自写 FLIP hook 让所有受影响的行平滑位移,
兼容 reduced-motion,删除 data-moved 动画;isViewDirty 脏检测、三处脏态提示、应用内确认对话框、
router 导航守卫(后退被拒时 history.forward())与 beforeunload。
拖放集成测试用键盘传感器;纯函数全覆盖;覆盖率达标。
详细执行提示词见 docs/prompts/phase-6-2.md。
```

### 6.2.1 配置页 UX 补充

```
按 docs/development-plan.md 的 Phase 6.2.1(6.2 真机验收后的补充批次):传感器改为 MouseSensor + TouchSensor(触屏长按
250ms 起拖,常量可调);FLIP 覆盖拖动期间的预览重排并整体加快(FLIP_DURATION_MS、DROP_ANIMATION_MS);
空 view 列表可作为投放目标;分组可折叠/展开(UI 状态,不持久化,拖入即展开);分组可设颜色,
通道条颜色支持 AUTO / GROUP / 自定义,进组时 AUTO 自动变 GROUP、出组时 GROUP 自动变 AUTO
(shared 增加 group.color 与 color: 'group',向后兼容)。不新增依赖,覆盖率达标。
详细执行提示词见 docs/prompts/phase-6-2-1.md。
```

### 6.3 混音页分页

```
按 docs/development-plan.md 的 Phase 6.3:显式分页布局(ResizeObserver 算每页数量,分组允许跨页,
TYPE ROWS 改为每组一页起),通道条撑满 100dvh,页头压缩为单行,pageIndex + transform 翻页,
实体质感翻页按钮与页码、PageUp/PageDown、右侧安全区(粗指针常驻,区内无声音控件)。
严格按文档的"Fader 滚轮与翻页滚轮共存规则"实现两个纯函数 reducer、wheel-gesture 手势归属模块与原生非 passive 监听,
覆盖文档列出的全部归属边界情形。阈值与时间窗口按文档初值实现,不自行调整。
在 Mock Provider 下以 40 通道 20 Hz 实测电平表开销。单测与集成测试覆盖 6.3 验收清单,覆盖率达标。
```

### 6.4 触屏审计

```
按 docs/development-plan.md 的 Phase 6.4:全局防误触样式(overscroll-behavior、touch-action、
user-select、touch-callout、hover 媒体查询、100dvh)、Fader pointerId 过滤与多指并行、44px 命中区、
只在安全区与非控制表面识别的滑动翻页手势(纯函数 reducer)、dnd-kit touch 传感器延迟与容差、
Screen Wake Lock 与 Fullscreen 渐进增强。单测覆盖 6.4 验收清单,覆盖率达标;真机触屏验收由本地执行。
```

### 6.5 健壮性

```
按 docs/development-plan.md 的 Phase 6.5:socket 断线重连 / Ember 断线重连 / 两者叠加的
Mock Provider 集成用例,验证 UI 恢复到断线前状态;soak 脚本让 Mock Provider 持续推电平帧
不少于 1 小时并采样前端堆内存输出报告。真机 1 小时运行验收由本地执行。覆盖率达标。
```

## Phase 7 — 打包交付

```
按 docs/development-plan.md 的 Phase 7:多阶段 Dockerfile(node:22-alpine,data/ 挂卷)、
docker-compose 示例、Windows 启动脚本、EMBER_HOST/EMBER_PORT 环境变量仅在首次启动且无配置文件时作为种子值,补全 README 快速开始,全量核对文档与实际行为一致。
```

## 缺陷修复(通用)

```
修复以下问题:<描述>。
先写一个能复现问题的失败测试(用 Mock Provider),再修复使其通过;不要顺手重构无关代码。
若根因涉及 Fairlight Ember+ 树结构与预期不符,将结论写入 docs/fairlight-ember.md 踩坑记录。
```
