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
详细执行提示词只保存于本地(docs/prompts/phase-6-1.md,不入仓库)。集成测试覆盖 6.1 验收清单,覆盖率达标。
```

### 6.2 配置页 UX

```
按 docs/development-plan.md 的 Phase 6.2:引入 @dnd-kit/core + @dnd-kit/sortable(确认 MIT)实现
通道行/分组/可用通道的拖放(pointer、touch、keyboard 传感器),数据模型不变,新增纯函数
moveChannelTo 与 insertChannelAt,箭头按钮保留;自写 FLIP hook 让所有受影响的行平滑位移,
兼容 reduced-motion,删除 data-moved 动画;isViewDirty 脏检测、三处脏态提示、应用内确认对话框、
router 导航守卫(后退被拒时 history.forward())与 beforeunload。
拖放集成测试用键盘传感器;纯函数全覆盖;覆盖率达标。
详细执行提示词只保存于本地(docs/prompts/phase-6-2.md,不入仓库)。
```

### 6.2.1 配置页 UX 补充

```
按 docs/development-plan.md 的 Phase 6.2.1(6.2 真机验收后的补充批次):传感器改为 MouseSensor + TouchSensor(触屏长按
250ms 起拖,常量可调);FLIP 覆盖拖动期间的预览重排并整体加快(FLIP_DURATION_MS、DROP_ANIMATION_MS);
空 view 列表可作为投放目标;分组可折叠/展开(UI 状态,不持久化,拖入即展开);分组可设颜色,
通道条颜色支持 AUTO / GROUP / 自定义,进组时 AUTO 自动变 GROUP、出组时 GROUP 自动变 AUTO
(shared 增加 group.color 与 color: 'group',向后兼容)。不新增依赖,覆盖率达标。
详细执行提示词只保存于本地(docs/prompts/phase-6-2-1.md,不入仓库)。
```

### 6.2.2 配置页 UX 补充二

```
按 docs/development-plan.md 的 Phase 6.2.2(6.2.1 真机验收后的第二个补充批次):FLIP 补间可续接(测量改为
减去在途 translate 的自然位置,在途行不被触碰、再次推动时从当前视觉位置起步,dnd-kit droppable 用同一套几何,
先埋点复现再修);View 模型改为有序块
(View.items,组块自带 channels,空组有位置、可拖可落,配置版本升 2 并在 shared 读取时迁移);列表末尾
常驻占满空白区域的根级落槽,通道、AVAILABLE 条目与组头落入即追加到末尾;组色 AUTO 取成员类型众数。
不新增依赖,覆盖率达标。详细执行提示词只保存于本地(docs/prompts/phase-6-2-2.md,不入仓库)。
```

### 6.3 混音页分页

```
按 docs/development-plan.md 的 Phase 6.3:显式分页布局(ResizeObserver 算每页数量,分组允许跨页,
TYPE ROWS 改为每组一页起),通道条撑满 100dvh,页头压缩为单行,pageIndex + transform 翻页,
实体质感翻页按钮与页码、PageUp/PageDown、右侧安全区(粗指针常驻,区内无声音控件)。
严格按文档的"Fader 滚轮与翻页滚轮共存规则"实现两个纯函数 reducer、wheel-gesture 手势归属模块与原生非 passive 监听,
覆盖文档列出的全部归属边界情形。阈值与时间窗口按文档初值实现,不自行调整。
在 Mock Provider 下以 40 通道 20 Hz 实测电平表开销。单测与集成测试覆盖 6.3 验收清单,覆盖率达标。
详细执行提示词只保存于本地(docs/prompts/phase-6-3.md,不入仓库)。
```

### 6.4 触屏审计

```
按 docs/development-plan.md 的 Phase 6.4:全局防误触样式(overscroll-behavior、touch-action、
user-select、touch-callout、hover 媒体查询与样式回归测试、dvh)、Fader pointerId 过滤与多指并行、
手指翻页不从 ON 起手(6.3 的翻页语义与数值不动)、Screen Wake Lock(原生 + 静音视频降级,交互后触发)、
Fullscreen 页头按钮、web app manifest。不放大命中区、不加 user-scalable=no、不新增依赖。
单测覆盖 6.4 验收清单,覆盖率达标;平板与手机的真机验收由本地执行。
详细执行提示词只保存于本地(docs/prompts/phase-6-4.md,不入仓库)。
```

### 6.5 健壮性

```
按 docs/development-plan.md 的 Phase 6.5:后端(Mock Provider + 真 socket.io-client)与前端(FakeSocket)
的重连集成用例——Ember 同端口回来、socket 传输层断开、两者叠加两种顺序、服务端重启、多轮断连不重复订阅——
验证 UI 恢复到断线前状态(页码、view、锁定、条带节点);修掉 socket.io-client 把离线期间的控制命令缓冲到
重连后补发的缺陷(未连接即 OFFLINE 回执,浏览器层用 socket.timeout() 发命令);零依赖的 soak 工具
(Mock Provider + 真实 server + 自写 CDP 客户端驱动 headless Chrome,20 Hz 电平、翻页、周期性断连,
采内存与恢复时间出报告并判定,附着模式对真实台子只读)与 workflow_dispatch 的 soak.yml。
本地会话执行,60 分钟实跑结果进报告;真机 1 小时验收由用户执行。不新增依赖,覆盖率达标。
详细执行提示词只保存于本地(docs/prompts/phase-6-5.md,不入仓库)。
```

## Phase 7 — 打包交付

最终发布形态三态:控制台脚本直接启动、Docker 部署、Tauri 桌面安装包。拆成 7.1 与 7.2 两个 PR。

### 7.1 服务端收尾、控制台启动与 Docker

```
按 docs/development-plan.md 的 Phase 7.1:SIGINT/SIGTERM 优雅退出与 FLWC_EXIT_ON_STDIN_CLOSE 的 stdin 守护;
EMBER_HOST/EMBER_PORT 仅在配置文件不存在时作为种子写入文件、之后文件优先;FLWC_DATA_DIR/FLWC_WEB_ROOT 路径覆盖;
mock-provider 命令行工具;start.cmd/start.sh 控制台启动脚本;多阶段 Dockerfile(node:22-alpine,非 root,
HEALTHCHECK,/app/data 挂卷)、docker-compose.yml、scripts/docker-smoke.sh、docker.yml(PR 冒烟,main 与 v* 标签推 GHCR,
标签时离线镜像包挂 Release);README 按三态重写并全面核对文档。本地会话执行,不碰真实台子,不新增 npm 依赖,覆盖率排除只多
mock-provider.ts 一项。详细执行提示词只保存于本地(docs/prompts/phase-7-1.md,不入仓库)。
```

### 7.2 桌面启动器(Tauri,Windows)

```
按 docs/development-plan.md 的 Phase 7.2:apps/desktop 的 Tauri 2 壳 + React 窗口前端;安装包自带官方 Node 二进制
(sidecar,构建时下载校验、不入库)与铺平的服务端及 web 产物;窗口提供状态与地址、端口、局域网访问开关、Apply 重启、
Start with Windows、Start hidden、Open in browser/Hide to tray/Exit 与日志尾部;关闭即隐藏到托盘,单实例;
子进程按 7.1 合同设环境变量,进程边界靠 stdin 守护,不写平台专属保活;desktop.yml 在 windows-latest 构建 NSIS 安装包,
标签时挂到与 docker.yml 共用的 Release;ci.yml 不改。本批次只做 Windows,代码保持可移植。
详细执行提示词只保存于本地(docs/prompts/phase-7-2.md,不入仓库)。
```

## 缺陷修复(通用)

```
修复以下问题:<描述>。
先写一个能复现问题的失败测试(用 Mock Provider),再修复使其通过;不要顺手重构无关代码。
若根因涉及 Fairlight Ember+ 树结构与预期不符,将结论写入 docs/fairlight-ember.md 踩坑记录。
```
