# Phase 6.1 执行提示词 — 连接配置与错误态

> 用法:将本文档全文作为执行会话的任务提示词。执行会话运行在 Cursor 云端环境(配置见 `.cursor/environment.json`),无法访问真实 Fairlight Live。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,真机验收由用户在本地完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(含云端 dev server 的 IPv6 localhost 注意事项)
2. `docs/development-plan.md` — Phase 6 总述与 Phase 6.1 交付物、验收标准(本阶段的任务来源),以及「云端 Agent 开发边界」一节;同时浏览 6.2–6.5 与 Phase 7,了解本阶段不该越界的内容
3. `docs/architecture.md` — 架构设计(本阶段重点:REST `/api/v1/connection`、socket `system:status` 事件、前端 `mixerStore` 与页面壳)
4. `docs/conventions.md` — 目录结构、命名、REST/错误响应规范、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/reports/phase-5-report.md` — Phase 5 执行报告(前端现状:路由、页面壳、`viewStore`、配置页工作台、`ConnectionStatus` 在两个页面头部的位置)
6. `docs/reports/phase-3-report.md` — Phase 3 执行报告(`EmberService` 连接生命周期与状态机、connection 路由与 `data/` 持久化)

## 代码现状(已确认,直接复用)

- 后端 `apps/server/src/api/connection.ts` 已实现 `GET /api/v1/connection`(返回 `host`、`port`、`status`)与 `PUT /api/v1/connection`(zod 校验后写入 `data/config.json` 并调用 `EmberService.configure()` 重连);契约在 `packages/shared/src/connection.ts`(`connectionGetResponseSchema`、`connectionPutBodySchema`),endpoint 形状在 `config.ts` 的 `emberEndpointSchema`(`host` 非空字符串,`port` 1–65535 整数),默认值 `127.0.0.1:9000`。
- 连接状态枚举 `connectionStatusSchema` 只有 `disconnected` / `connecting` / `connected` / `reconnecting`,**没有错误态**:地址填错时 `EmberService` 会在 `connecting` / `reconnecting` 之间退避重试,当前没有把最近一次失败原因暴露给前端。
- socket 网关在状态变化时广播 `system:status`(`{ ember: status }`);前端 `mixerStore` 维护 `socketConnected`、`emberStatus`、`channelInventoryLoaded`、`notice`,`controlsAvailable()` 要求 socket 已连且 Ember 为 `connected`。
- 前端 `apps/web/src/components/ConnectionStatus.tsx` 是一个只读状态灯(`MIXER ONLINE` / `EMBER <STATUS>` / `SOCKET OFFLINE`)加 4 秒自动消失的 notice,混音页与配置页头部都渲染它。
- 前端 REST 客户端范式见 `apps/web/src/lib/views-api.ts`(注入 `fetch`、zod 解析响应、统一读取 `{ error: { code, message } }`),连接配置客户端照此实现。
- 混音页 `MixerPage.tsx` 的空态目前只有两种文案:`WAITING FOR MIXER SNAPSHOT` 与 `THIS VIEW HAS NO CHANNELS`,不区分 socket 离线、Ember 未连接与树为空。
- 前端没有任何连接配置入口;Phase 5 真机验收清单要求用户直接调用 REST 配置地址,这正是本阶段要补的。

## 云端执行边界

- 你运行在云端,**无法连接真实 Fairlight Live**。后端联调用 `packages/test-utils` 的 Mock Ember+ Provider + 既有 `apps/server`;把面板指向 Mock Provider 的地址与一个无人监听的端口,即可分别制造「已连接」与「连不上」两种状态。
- 验收标准中标注「本地」的条目由用户本地执行,你在报告中标注**移交用户**,并给出一份可直接照做的真机验收操作清单(启动命令、页面操作步骤、预期结果、安全注意事项)。
- 在独立分支上开发并推送,保持远端 CI(GitHub Actions:lint + typecheck + test + build)全绿;不得改动 CI 流水线结构。
- 云端手动冒烟可用 `pnpm dev`(server 3000 + web 5173):web 端必须用 `http://localhost:5173` 访问(Vite 只监听 IPv6 `::1`,`127.0.0.1:5173` 连不上)。
- 改动 `packages/shared` 后需重跑 `pnpm --filter @flwc/shared build`,其它包才能拿到新类型。

## 硬性约束

- 自动化测试(vitest,前端加 React Testing Library)一律基于 Mock(Mock Provider / mock socket / mock fetch / 临时 `data/` 目录),**禁止任何连接真实设备的逻辑与硬编码真机地址**。
- 代码、注释、提交信息、日志与固定 UI 文案用**英文**;仅设备或应用带入的动态文本可保留原文;文档与报告用**简体中文**。
- 本阶段**不新增运行时依赖**;对话框、表单、按钮全部自绘,复用既有全局深色设计 token 与 Phase 4 建立的克制短动效和 `prefers-reduced-motion` 基线,不引入主题切换或浅色样式。
- 提交遵循 Conventional Commits,按逻辑单元分多次提交;不得破坏已有的 lint / typecheck / test / build 全绿与覆盖率门槛(不许为凑覆盖率调低门槛)。
- REST 与 socket 契约**只使用/扩展 `packages/shared` 的导出**;本阶段允许的契约扩展只有下文「后端最小扩展」一项,其余缺口只在报告中提出。
- 前端不接触任何原始 Ember 路径。
- 不改动 `docs/` 下与本阶段无关的文档;`docs/fairlight-ember.md` 只由用户回写,你只在报告中提出建议。

## 任务范围

按 `docs/development-plan.md` 的 Phase 6.1 实现连接配置入口与按原因分流的错误态。本阶段**不做**配置页 DnD 与脏检测(6.2)、混音页分页与安全区(6.3)、触屏审计(6.4)、重连与 soak(6.5),也**不实现**环境变量种子值(Phase 7,只需在报告中复述该约定)。

### 1. 后端最小扩展(可选但推荐):暴露最近一次连接失败原因

- 目的:地址填错时状态会永远停在 `connecting`,面板需要告诉用户「为什么连不上」。
- 做法:`EmberService` 记录最近一次连接失败的简短原因(如 `ECONNREFUSED 10.0.0.8:9000`、`timeout`),连接成功时清空;`GET /api/v1/connection` 响应与 `system:status` 负载各增加一个**可选**字段 `lastError?: string`(shared schema 用 `.optional()`,旧客户端与旧测试不受影响);`MixerStateStore` / 网关按现有状态广播路径一并带出。
- 约束:不改状态枚举,不改重连退避逻辑,不新增事件;只读、可选、向后兼容。若评估后认为改动面超出「最小」,可以不做,但必须在报告「关键决策与偏离」中说明,并让面板在无该字段时仍能正常工作。

### 2. 连接配置客户端(`apps/web/src/lib/connection-api.ts`)

- 照 `views-api.ts` 的范式实现 `ConnectionClient`:`get()` 与 `update(body)`,注入 `fetch`,响应用 `connectionGetResponseSchema` 解析,错误统一读取 `{ error: { code, message } }`。
- 在 `App` 中与 `viewsClient` 同样方式创建并向下传递(测试可注入 mock 客户端)。

### 3. CONNECTION 面板(`apps/web/src/features/connection/`)

- 入口:两个页面头部的 `ConnectionStatus` 状态灯改为可点击(语义为 `button`,可访问名如 `Connection settings`),点击打开面板;面板是自绘的模态对话框(`role="dialog"`、`aria-modal`、焦点进入面板、Esc 与背景点击关闭、关闭后焦点回到状态灯)。
- 内容:`HOST` 与 `PORT` 输入框(打开时从 `GET /api/v1/connection` 读入当前值)、当前 Ember 状态(实时取自 `mixerStore.emberStatus`,不轮询)、最近错误(有 `lastError` 时显示)、`APPLY` 与 `CANCEL`。
- 校验:提交前按 `emberEndpointSchema` 在前端校验(空 host、非整数或越界 port),就地显示英文错误;服务端 400 的 message 也就地显示;请求进行中禁用按钮。
- 二次确认:当前 `emberStatus === 'connected'` 时点击 `APPLY` 先进入确认态(按钮变为 `CONFIRM RECONNECT` 之类,并有一行文案说明将断开当前设备并重连),再次点击才发 PUT;非连接状态直接提交。
- 成功后:面板保持打开并显示新的状态变化(用户能看到从 `connecting` 到 `connected`),也可手动关闭;失败保留输入内容。
- `host` / `port` 只写入应用配置,与 Fairlight 通道数据无关;任何情况下不得触碰通道参数。

### 4. 混音页空态按原因分流(`MixerPage.tsx`)

- 把现有单一 `WAITING FOR MIXER SNAPSHOT` 拆为三种互斥空态,文案英文、风格沿用 `empty-console`:
  - socket 离线(`socketConnected === false`):说明后端不可达,提示检查服务是否在运行;无 CTA。
  - Ember 未连接(socket 已连且 `emberStatus !== 'connected'`,含 `connecting` / `reconnecting` / `disconnected`):显示当前状态与 `lastError`(若有),提供 `CONFIGURE CONNECTION` 按钮直达面板。
  - 树为空(Ember 已连接、快照已到达但通道数为 0):说明设备上没有可识别的通道,无 CTA。
- `channelInventoryLoaded` 的既有语义(只由已连接快照首次置为有效,缓存清单穿越 status-only reconnect)不得改变;已加载过清单后短暂 `reconnecting` 时应继续显示既有条带并禁用控件,而不是切回空态。
- 既有 `THIS VIEW HAS NO CHANNELS` 空态保持不变。
- 配置页的 `WAITING FOR MIXER SNAPSHOT` 面板文案可同步做同样的原因分流,但 CTA 只需打开面板。

### 5. 文档

- `docs/architecture.md`:在前端结构与 REST 表中补上连接面板、`connection-api.ts`,以及(如实现了)`lastError` 字段;只描述当前状态,不写变更历史。
- 不改 `docs/development-plan.md` 的任务描述,只在报告里逐条核对。

## 测试要求

- 单元测试与被测代码同目录,集成测试放各包 `tests/`;web 测试用 mock socket 与 mock fetch,server 测试用 Mock Provider 与临时 `data/` 目录。
- 必须覆盖 Phase 6.1 验收清单与 `docs/conventions.md` 边界清单中本阶段适用项:
  - `connection-api.ts`:成功解析、400/500 的错误消息读取、非 JSON 错误的兜底;
  - 面板:从两个页面的状态灯打开与关闭(Esc、背景、CANCEL、焦点回归)、打开时读取并回填当前值、前端校验(空 host、port 为 0 / 70000 / 非整数)、服务端 400 就地显示、已连接时二次确认与取消确认、非连接状态直接提交、提交中禁用、成功后状态变化实时反映;
  - 空态:三种原因分流与 CTA 的有无,已加载清单后 `reconnecting` 不回退到空态,`THIS VIEW HAS NO CHANNELS` 不受影响;
  - 若实现后端扩展:`lastError` 在连接失败后出现、连接成功后清空,`GET /api/v1/connection` 与 `system:status` 都带出,旧形状负载仍能通过 shared 校验。
- 覆盖率:`apps/server`、`apps/web` 行/分支/函数 ≥ 80%,`packages/shared` ≥ 90%,全部维持既有门槛。

## 明确不做的事

- 不做配置页 DnD、FLIP 动效、脏检测与导航守卫(6.2)。
- 不做混音页分页、页头压缩、安全区、滚轮方案(6.3);不做触屏审计(6.4);不做重连集成用例与 soak 脚本(6.5)。
- 不实现 `EMBER_HOST` / `EMBER_PORT` 环境变量种子值(Phase 7)。
- 不改状态枚举、不改 `EmberService` 的重连退避逻辑、不新增 socket 事件。
- 不引入路由、对话框或表单库;不新增独立路由。
- 不连接、不模拟连接真实 Fairlight;不硬编码真机地址。
- 不改 CI 流水线结构(`.github/workflows/ci.yml`)。

## 验收自查

完成后逐条核对 `docs/development-plan.md` Phase 6.1 验收标准,在云端实际执行并记录结果:

1. 集成测试覆盖:面板读取与保存、校验失败提示(空 host、越界 port)、已连接时的二次确认、三种空态分流与 CTA — 以测试文件与通过记录为证。
2. 本地(修改为正确地址后重连成功;修改为错误地址后空态正确且可从空态入口改回)— **移交用户**,附可照做的验收操作清单。
3. 覆盖率达标 — 附 `apps/server`、`apps/web`、`packages/shared` 覆盖率数字。
4. 全量质量门:串行 lint → typecheck → test(覆盖率门槛)→ build 全绿,远端 CI 全绿;另附一次 `pnpm dev` + Mock Provider 的端到端冒烟结果(启动时指向无人监听端口 → 混音页显示 Ember 未连接空态与 CTA → 打开面板改为 Mock Provider 地址 → 状态变为 connected、通道出现 → 再改回错误地址触发二次确认 → 空态与 `lastError` 正确)。

## 执行报告要求

执行完成后,在 `docs/reports/phase-6-1-report.md` 产出执行报告(简体中文),包含以下章节:

1. **结果总览** — 一段话说明完成状态(全部完成 / 部分完成及原因)。
2. **验收标准逐条核对** — 对上述四条:通过/未通过/移交用户,附实际执行的命令与关键输出摘要。
3. **实现摘要** — 后端扩展是否实施及形状、`connection-api.ts`、面板的交互与可访问性设计、二次确认逻辑、三种空态的判定条件与 `channelInventoryLoaded` 的兼容处理。
4. **真机验收操作清单(移交用户)** — 启动命令、页面操作步骤与预期结果。**必须写明安全约束:连接面板只写应用配置,修改地址会让后端断开并重连真机,但不会改动 Fairlight 任何参数,可放心操作;验收过程中如需操作推子,只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道并测后复原;不得切 ON/mute、不得动其它通道、不得删改任何通道。**
5. **交付物清单** — 新增/修改的主要源码与测试文件路径及一句话用途。
6. **依赖清单与许可确认** — 应为「无新增依赖」;若有,写明名称、版本、许可证与理由。
7. **关键决策与偏离** — 与计划/规范/架构文档不一致的地方及理由(含是否实施后端扩展、覆盖率排除项);没有则明确写"无偏离"。
8. **遗留问题与移交事项** — 契约缺口、建议回写文档的条目、留给 6.2–6.5 与 Phase 7 的事项(至少复述环境变量种子值约定)、需要用户完成的步骤。
9. **提交记录** — 本阶段新增提交的 `git log --oneline` 输出与分支名。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤都要写明,不许美化。

## 完成定义

- 上述任务范围全部落地,测试要求全部满足。
- 云端串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,分支推送后远端 CI 全绿。
- `pnpm dev` + Mock Provider 端到端冒烟通过(错误地址空态 → 面板改址 → 连接成功 → 改回错误地址的二次确认)。
- 全部变更已按 Conventional Commits 提交。
- `docs/reports/phase-6-1-report.md` 已产出,真机验收清单可直接交用户执行。
