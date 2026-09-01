# Phase 5 执行提示词 — Views 配置

> 用法:将本文档全文作为执行会话的任务提示词。执行会话运行在 Cursor 云端环境(配置见 `.cursor/environment.json`),无法访问真实 Fairlight Live。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,真机验收由用户在本地完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(含云端 dev server 的 IPv6 localhost 注意事项)
2. `docs/architecture.md` — 架构设计(本阶段重点:REST views CRUD、「View 与失配处理」、持久化格式、前端 `viewStore`)
3. `docs/development-plan.md` — Phase 5 交付物与验收标准(本阶段的任务来源),以及「云端 Agent 开发边界」一节
4. `docs/conventions.md` — 目录结构、命名、REST/错误响应规范、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/reports/phase-4-report.md` — Phase 4 执行报告(前端现状:store 拆分、通道条带结构、`channel-colors.ts` palette、`--channel-accent` 覆盖入口、`TYPE ROWS` 布局开关、控制锁)
6. `docs/reports/phase-3-report.md` — Phase 3 执行报告(后端模块能力、REST connection 路由与 `data/` 持久化现状)

## 代码现状(已确认,直接复用)

- `packages/shared` 的 `config.ts` 已定义 `viewSchema` / `viewChannelRefSchema`(`channelId` + `lastKnownName`)与 `appConfigSchema`(`version: 1`,含 `views` 数组);`data/config.json` 的加载/原子写入/损坏回退已由 Phase 3 实现。
- REST 目前只有 `/api/v1/connection` 与 `/api/v1/health`,views CRUD 路由尚未实现。
- 前端 `apps/web/src/features/mixer/channel-colors.ts` 已有统一 palette(`green` / `red` / `teal` / `navy` / `lime` / `purple` 六个 key)与类型默认色映射(Input Green、Main Red、Sub Teal、Aux Navy、Mix Minus Lime、Matrix Purple);每个通道条带的颜色通过 CSS 变量 `--channel-accent` 注入,Phase 4 已为单通道覆盖预留该入口。
- 前端尚无配置页与路由;混音页默认渲染快照中的全部通道。

## 云端执行边界

- 你运行在云端,**无法连接真实 Fairlight Live**。后端联调用 `packages/test-utils` 的 Mock Ember+ Provider + 既有 `apps/server`;树结构参考 `docs/tree-dumps/` 与 `docs/fairlight-ember.md`。
- 验收标准中「本地手动验收:view 切换流畅,失配占位展示正确」由用户本地执行,你在报告中标注**移交用户**,并给出一份可直接照做的真机验收操作清单(启动命令、页面操作步骤、预期结果、安全注意事项)。
- 在独立分支上开发并推送,保持远端 CI(GitHub Actions:lint + typecheck + test + build)全绿;不得改动 CI 流水线结构。
- 云端手动冒烟可用 `pnpm dev`(server 3000 + web 5173):web 端必须用 `http://localhost:5173` 访问(Vite 只监听 IPv6 `::1`,`127.0.0.1:5173` 连不上);可在本地起 Mock Provider 让 server 连接,形成端到端数据流。
- 改动 `packages/shared` 后需重跑 `pnpm --filter @flwc/shared build`,其它包才能拿到新类型。

## 硬性约束

- 自动化测试(vitest,前端加 React Testing Library)一律基于 Mock(Mock Provider / mock socket / 临时 `data/` 目录),**禁止任何连接真实设备的逻辑与硬编码真机地址**。
- 代码、注释、提交信息、日志与固定 UI 文案用**英文**;仅设备或应用带入的动态文本(如通道名称、view 名称)可保留原文;文档与报告用**简体中文**。
- 新增依赖必须 MIT 或 MIT 兼容许可,引入前确认 `license` 字段,记入报告。本阶段原则上不需要新增运行时依赖;**禁止引入 UI 组件库与拖拽排序库**,排序交互自绘(上移/下移按钮即可满足要求,自绘指针拖拽可选);view id 用 Node 内置 `crypto.randomUUID()`。
- 提交遵循 Conventional Commits,按逻辑单元分多次提交;不得破坏已有的 lint / typecheck / test / build 全绿与覆盖率门槛(不许为凑覆盖率调低门槛)。
- **前端与 view 数据不接触任何原始 Ember 路径**,通道引用一律使用逻辑通道 id(`channelId`,形如 `channel/3`)。`docs/development-plan.md` 中「Ember 路径 + 最后已知名称」的表述即映射为既有 `viewChannelRefSchema` 的 `channelId + lastKnownName`,不得在 view 模型中新增原始路径字段。
- REST 与 socket 契约**只使用/扩展 `packages/shared` 的导出**;若发现契约缺口或 bug,可做最小修正并在报告「关键决策与偏离」中说明。
- 复用既有全局深色设计 token,新页面不得引入主题切换或浅色样式;动效遵循 Phase 4 建立的克制短动效与 `prefers-reduced-motion` 基线。
- 不改动 `docs/` 下与本阶段无关的文档;`docs/fairlight-ember.md` 只由用户回写,你只在报告中提出建议。

## 任务范围

按 `docs/development-plan.md` 的 Phase 5 与 `docs/architecture.md` 的「View 与失配处理」实现 views 配置。本阶段**不做深度视觉打磨、触屏专项与性能验证**(Phase 6)。

### 1. View 模型扩展(`packages/shared`)

- 在 `viewChannelRefSchema` 上增加可选的通道颜色字段,取值为统一 palette 的 key(zod enum:`green` / `red` / `teal` / `navy` / `lime` / `purple`);palette key 的唯一权威定义放在 `packages/shared`,前端 `channel-colors.ts` 改为从 shared 导入 key 类型、只保留 key → 色值与类型默认色映射。
- 未配置颜色时回退到通道类型默认色(Input Green、Main Red、Sub Teal、Aux Navy、Mix Minus Lime、Matrix Purple)。
- 兼容既有持久化数据:旧 `config.json` 中无颜色字段的 view 必须能通过校验并正常加载(可选字段即可,不引入新 `version`)。
- 如需要,补充 views REST 请求/响应的 zod schema(创建/更新负载),供 server 校验与 web 复用。

### 2. REST views CRUD(`apps/server/src/api/`)

- 按 `docs/architecture.md` 实现:`GET /api/v1/views`、`POST /api/v1/views`、`PUT /api/v1/views/:id`、`DELETE /api/v1/views/:id`;资源名复数、kebab-case,统一错误响应 `{ error: { code, message } }`。
- 复用 Phase 3 的配置持久化(`data/config.json`,zod 校验,临时文件 + rename 原子写入);id 由服务端生成(`crypto.randomUUID()`)。
- 校验与错误:body 经 zod 校验后才进入业务层;未知 `:id` 返回 404;非法负载(空名称、非法颜色 key、`channels` 结构错误)返回 400。**服务端不校验 `channelId` 是否存在于当前树**——view 引用暂时缺失的通道是合法状态(见失配处理)。
- 后端不自动修改任何 view(不清理、不改名、不同步 `lastKnownName`);所有变更只来自 REST 写入。

### 3. 配置页(`apps/web/src/features/settings/`)

- 新增配置页与主页/配置页间的导航入口;不引入路由库也可(简单页面切换即可),如需路由库须为 MIT 且在报告说明理由。
- View 管理:创建(命名)、重命名、删除(删除需防误触确认)。
- 通道勾选:从当前 `mixer:snapshot` 的通道清单(经 `mixerStore`)勾选/取消通道,展示通道名称与类型,不显示 Ember 编号;保存时将当前快照中的名称写入 `lastKnownName`。
- 排序:view 内通道顺序可调整(上移/下移按钮即可),渲染顺序以 view 内顺序为准。
- 颜色:view 内每个通道可从统一 palette 中选色,可清除回到类型默认色;色板 UI 需体现六个颜色的名称或色块。
- 失配警告:view 中引用了当前快照不存在的通道时,配置页对这些条目给出明显警告(显示 `lastKnownName` + 缺失标记),并提供**一键清理失效引用**(用户主动触发,经确认后 PUT 更新该 view)。
- 编辑通过 REST 完成并处理失败态(错误提示,不静默丢弃);保存成功后前端状态与服务端一致。

### 4. 主页 view 切换(`apps/web/src/features/mixer/`、`apps/web/src/store/`)

- 新增 `viewStore`:views 列表(来自 REST)与当前激活 view;激活选择持久化到 `localStorage`(前端本地偏好,不写入后端配置),刷新后恢复;被删除的激活 view 自动回退到全部通道。
- 混音页提供 view 切换控件(含「全部通道」/ "All Channels" 选项);**无任何 view 时默认显示全部通道**,不出现空页面。
- 激活 view 后:只渲染 view 引用的通道,按 view 内顺序平铺渲染(不按类型分区;`TYPE ROWS` 开关仅对全部通道模式生效,view 模式下隐藏或禁用该开关,处理方式在报告说明)。
- 通道颜色:view 中配置了颜色的通道以该色覆盖 `--channel-accent`;未配置的用类型默认色。
- view 切换需平滑(复用既有条带增删动效),不整页闪烁;推子/ON/电平表/控制锁等既有行为在 view 模式下不变。

### 5. 失配处理(混音页)

- 激活 view 中引用的通道不在当前快照时,按 view 顺序渲染**占位卡片**:显示 `lastKnownName` 与英文缺失提示(如 "Missing"),无推子/ON/电平表交互,不阻塞其它通道的正常渲染与控制。
- 树变化(patch/snapshot 导致通道消失或恢复)时占位与真实条带能相互切换,状态即时更新。
- 前端不自动修改 view;清理只能由用户在配置页主动触发。

## 测试要求

- 单元测试与被测代码同目录,集成测试放各包 `tests/`;server 集成测试用 Mock Provider 与临时 `data/` 目录,web 测试用 mock socket 与 mock fetch(或 msw 类工具,须 MIT)。
- 必须覆盖 Phase 5 验收标准点名场景 + `docs/conventions.md` 边界清单中本阶段适用项:
  - views CRUD 全流程(创建/读取/更新/删除、404、非法负载 400、持久化往返、配置文件损坏/缺失时 views 的恢复);
  - 通道颜色配置与默认回退(含非法颜色 key 拒绝、旧数据无颜色字段的兼容加载);
  - view 引用已删除通道(占位渲染、`lastKnownName` 展示、不影响其它通道控制);
  - 树变化后的失配标记与一键清理(清理只删失效引用、保留有效引用与顺序、经用户确认才执行);
  - 空 view(零通道)与空配置(零 view,回退全部通道);
  - view 切换与激活态持久化(含激活 view 被删除后的回退);
  - view 内排序在渲染与持久化中的一致性。
- 覆盖率:`apps/server`、`apps/web` 行/分支/函数 ≥ 80%,`packages/shared` ≥ 90%,全部维持既有门槛。

## 明确不做的事

- 不做 Ember 连接配置 UI(架构图中配置页含 Ember 地址编辑,但 `docs/development-plan.md` 未将其列入 Phase 5,留待后续安排;REST `/api/v1/connection` 已可用)。
- 不做深度视觉打磨、触屏专项优化、长时间运行性能验证(Phase 6)。
- 不改 Ember 层(`EmberService` / `TreeMapper` / `MixerStateStore` / `MeterHub`)与 socket 事件契约(契约最小修正除外,须在报告说明)。
- 不改 CI 流水线结构(`.github/workflows/ci.yml`)。
- 不连接、不模拟连接真实 Fairlight;不硬编码真机地址。
- 不实现 view 的自动同步/自动清理(后端与前端都不得自动改写 view 内容)。
- 不改动 `docs/` 下与本阶段无关的文档。

## 验收自查

完成后逐条核对 `docs/development-plan.md` Phase 5 验收标准,在云端实际执行并记录结果:

1. 集成测试覆盖:views CRUD、通道颜色配置与默认回退、view 引用已删除通道、树变化后的失配标记与清理、空 view/空配置 — 以测试文件与通过记录为证。
2. 本地手动验收(view 切换流畅、失配占位展示正确)— **移交用户**,附可照做的验收操作清单。
3. 覆盖率达标 — 附 `apps/server`、`apps/web`、`packages/shared` 覆盖率数字。
4. 全量质量门:串行 lint → typecheck → test(覆盖率门槛)→ build 全绿,远端 CI 全绿;另附一次 `pnpm dev` + Mock Provider 的端到端冒烟结果(创建 view → 勾选通道并配色排序 → 主页切换 → 模拟通道消失出现占位 → 一键清理)。

## 执行报告要求

执行完成后,在 `docs/reports/phase-5-report.md` 产出执行报告(简体中文),包含以下章节:

1. **结果总览** — 一段话说明完成状态(全部完成 / 部分完成及原因)。
2. **验收标准逐条核对** — 对上述四条:通过/未通过/移交用户,附实际执行的命令与关键输出摘要。
3. **实现摘要** — shared 模型扩展(颜色字段与兼容策略)、REST CRUD(校验与错误码)、配置页(勾选/排序/配色/清理交互)、`viewStore` 与主页切换(激活态持久化、view 模式布局与 `TYPE ROWS` 的处理)、失配占位各自的关键设计点,以及与 `docs/architecture.md` 不一致之处。
4. **真机验收操作清单(移交用户)** — 启动命令、页面操作步骤与预期结果(view 切换流畅、失配占位展示正确、清理生效)。**必须写明安全约束:真机上只允许拖动 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子且测后复原;view 的创建/勾选/配色/排序/清理均为应用内配置操作,不写入 Fairlight,可放心操作;不得在真机上切 ON/mute、不得动其它通道;失配验收建议通过切换 view 引用或使用 Mock Provider 制造缺失,不得为制造缺失而删改真机通道。**
5. **交付物清单** — 新增/修改的主要源码与测试文件路径及一句话用途。
6. **依赖清单与许可确认** — 新增 npm 依赖的名称、版本、许可证;无则写明。
7. **关键决策与偏离** — 与计划/规范/架构文档不一致的地方及理由(含覆盖率排除项);没有则明确写"无偏离"。
8. **遗留问题与移交事项** — 契约缺口、建议回写文档的条目、留给 Phase 6 的事项、需要用户完成的步骤。
9. **提交记录** — 本阶段新增提交的 `git log --oneline` 输出与分支名。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤都要写明,不许美化。

## 完成定义

- 上述任务范围全部落地,测试要求全部满足。
- 云端串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,分支推送后远端 CI 全绿。
- `pnpm dev` + Mock Provider 端到端冒烟通过(views 全流程)。
- 全部变更已按 Conventional Commits 提交。
- `docs/reports/phase-5-report.md` 已产出,真机验收清单可直接交用户执行。
