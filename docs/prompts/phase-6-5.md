# Phase 6.5 执行提示词 — 健壮性

> 用法:将本文档全文作为执行会话的任务提示词。**本批次的执行会话运行在用户的本地开发机上**(Windows 11),开发机正连着真实 Fairlight Live。任务来源是 `docs/development-plan.md` 的 6.5 一节,细节以本文档为准;两者冲突时以本文档为准并在报告里指出。工作在远端分支与 PR 上进行,你要跟进 GitHub CI 与 Cursor Bugbot 的评审意见(见「本地执行边界」与「分支、PR 与评审监控」)。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,对真实 Fairlight 的长时间运行验收由用户完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(**第一条「本地测试安全」在本批次直接适用于你**;新增依赖的许可要求)
2. `docs/development-plan.md` — Phase 6 总述、6.5 一节全文,以及「云端 Agent 开发边界」(其中「真机手动验收始终是本地步骤」这一条对你同样成立:验收由用户做,不由你做)
3. `docs/architecture.md` — 「后端分层职责」(`EmberService` 的重连与 keepalive、`MixerStateStore` 的连接态)、「前后端通信」(四个下行事件的时机、volatile 电平帧)、「前端结构」里「断线」「常亮与全屏」两条(常亮跟随台子在线状态,是本批次重连用例要顺带断言的东西);本批次要在这份文档里追加内容
4. `docs/conventions.md` — 目录结构、命名、**测试边界场景清单**(后端「Ember 断线/重连/超时」与前端「WS 断线重连 UI 态」正是本批次要补齐的两条)、覆盖率门槛、Git 规范
5. `docs/reports/phase-6-4-report.md` — 上一批次执行报告,重点第 10 节(Bugbot 评审意见的处理与记录方式)、第 15.3 节(**用 `io.engine.close()` 而不是服务端 `socket.disconnect()` 模拟断机的原因**:后者让客户端收到 `io server disconnect` 而不再自动重连,前者才是真实关机时客户端看到的传输层断开;本批次的服务端用例用更精确的 `socket.conn.close(true)`)、第 5 节与 6.3 报告第 14 节(在这台开发机上做浏览器实测的端口与数据源安排)
6. `docs/prompts/phase-6-4.md` — 上一批次的提示词,本批次沿用其「硬性约束」「本地执行边界」与「分支、PR 与评审监控」,下面只写差异

## 代码现状(已确认,直接复用)

- **后端重连链路已经在,缺的是用例。** `apps/server/src/ember/ember-service.ts`:`bindClient` 的 `onDisconnected` 把状态置 `reconnecting` 并 `scheduleReconnect()`(退避 `reconnectInitialMs` → `reconnectMaxMs`,默认 1 s → 30 s);`safeClose()` 里 `resetWatches()` 清空订阅集;`connectOnce()` 成功后 `expandTree → watchStructure → 'connected' → publishTree`。`apps/server/src/runtime.ts` 的 `onTree` 走 `mapper.sync → store.applySync → subscribeMapped`(逐节点顺序 `await` 订阅)。`apps/server/src/state/mixer-state-store.ts` 的 `setConnection` 在状态变为 `connected` 时置 `snapshotDueAfterConnect`,下一次 `applySync` 即使树没变也发一次快照——这是 6.1 修的,重连用例要把它锁住。`emberplus-connection` 会吞掉 ECONNREFUSED 自行重拨,所以「Provider 不在」在本服务表现为 `Timeout after <timeoutMs>ms: connect`,`lastError` 由此而来,连上后清空。
- **网关**(`apps/server/src/ws/gateway.ts`):每个新 socket 连接上来就发一次 `mixer:snapshot` 与 `system:status`;`meters:frame` 用 `io.volatile.emit`;`store` 的 `snapshot` / `patch` / `status` 事件广播给所有 socket。
- **既有服务端集成测试**(`apps/server/tests/mixer.integration.test.ts`,6 例):`startStack()` 起 Mock Provider + `start()`(`timeoutMs: 3000, disconnectTimeoutMs: 500, reconnectInitialMs: 50, reconnectMaxMs: 100, treeRefreshDebounceMs: 20, busDirectoryPollMs: 0`,`configDir` 是临时目录里写好的 `config.json`),`connectClient()` 用真的 `socket.io-client`(`transports: ['websocket'], autoConnect: false`)等到首个快照,`waitFor()` / `emitAck()` 两个小工具。它覆盖了**换端口**(PUT 到另一个 Provider)与**死端口**(PUT 到没人听的端口)两种,**没有「Provider 掉线后在同一端口回来」**,也没有 socket 传输层断开、两者叠加与服务端整体重启。`describe` 级超时 15 s,允许等一次 3 s 的 connect 超时。
- **Mock Provider**(`packages/test-utils/src/mock-ember-provider.ts`):`MockEmberProvider.fromDump(dump, { port })` 可指定端口(用来在同一端口重开),`fromDumpFile()` 按 `docs/tree-dumps/` 里最新的 dump 建树(当前 `fairlight-live-2026-08-31.json`:channel 9、main 1、aux 10,另有 monitor / talkback / afv / cueplayer 等本项目不映射的根);`listen()` / `close()`(`close()` 调 `EmberServer.discard()`,会切断所有客户端 TCP 连接);`pushParameter(identifierPath, value)` 推一次参数更新(电平表路径形如 `channel/channelN/meter`、`main/mainN/meter`、`aux/auxN/meter`,响度 `system/loudness/integrated` / `true-peak`,见 `docs/fairlight-ember.md`);`assertNotLiveFairlightPort()` 拒绝 9000。`@flwc/test-utils` 是 `apps/server` 的 devDependency,所以 soak 驱动可以直接用它。
- **socket.io 的两条库行为(已核实源码,本批次的设计以此为准)**:
  - `socket.io-client` 在 socket 未连接时会把**非 volatile 的 emit 缓冲进 `sendBuffer`,重连后原样补发**(`build/esm/socket.js` 的 `emit`:`isConnected` 为假即 `this.sendBuffer.push(packet)`,`onconnect` 时全部 `packet()` 出去)。只有通过 `socket.timeout(ms).emit(...)` 发出的包在超时时会从 `sendBuffer` 里删掉(`_registerAckCallback`)。**这意味着推子拖动中 socket 掉线、松手时发出的 `control:set-level` 会在重连后补发到台子**,而前端自己的 5 s 超时早已把 UI 回滚——一条过期的电平命令会在操作员不知情的时候动台子。这是本批次要修的缺陷(第 3 节)。
  - 服务端 `Socket#conn` 是 engine.io 的 socket,`conn.close(true)` 丢弃传输层,客户端收到 `transport close` 后**自动重连**;服务端 `socket.disconnect()` 则让客户端收到 `io server disconnect`,**不重连**。客户端默认 `reconnectionDelay` 1 s、`reconnectionDelayMax` 5 s、无限次;测试里把两个值调小。
- **前端**:`apps/web/src/lib/socket.ts` 的 `MixerSocket` 接口(`connected` / `on` / `off` / `emit` / `connect` / `disconnect`),`createBrowserSocket()` 包装 `io({ autoConnect: false })`,`bindMixerSocket()` 挂四个事件并在 `connect` / `disconnect` 上写 `socketConnected`,`emitWithAck()` 自带 `ACK_TIMEOUT_MS = 5000` 的超时回执(`TIMEOUT`)与 `INVALID_ACK`。`apps/web/src/store/mixer-store.ts`:`replaceMixerSnapshot` 在「已加载清单 + 空快照 + 非 connected」时保留缓存清单(`shouldRetainCachedInventory`),否则整体替换并清空 `pendingLevels` / `pendingOns`;`finishLevelInteraction` 取 `remoteValue ?? (ack.ok ? 本地值 : baseline)`,失败时把 `ack.error.message` 写进 `notice`;`controlsAvailable = socketConnected && emberStatus === 'connected'`。`features/mixer/use-pager.ts` 只在 `activeViewId` 变化时回到第一页;`use-channel-presence.ts` 按 id 保持条带、退出动画 180 ms;`use-wake-lock.ts` 的 `enabled` 就是 `controlsAvailable`。
- **既有前端用例**里与重连有关的:`tests/mixer.integration.test.tsx` 的「recovers from a disconnected empty state with a fresh snapshot」(socket 掉线 → `SOCKET OFFLINE` → 推子禁用 → 重连后新快照)、「keeps the loaded strips through a reconnect instead of falling back to an empty state」(Ember `reconnecting` 时条带保留、控件禁用)、「lets the tablet sleep once the mixer is gone…」(常亮跟随);`tests/views.integration.test.tsx` 的「keeps the loaded inventory through Ember reconnect without a new snapshot」与「retains cached inventory through an empty reconnect handshake」;`src/lib/socket.test.ts` 5 例(用 `vi.mock('socket.io-client')` 给的 `socketIoMock` **没有 `timeout` 方法**,第 3 节要补)。**没有**:翻页位置 / view / CONTROL LOCK 在 socket 重连后保持、拖动中掉线、两者叠加的两种顺序、服务端重启的 `connecting` 空快照形态。
- **测试基建**:`tests/fake-socket.ts`(`connect()` / `disconnect()` 翻转 `connected` 并派发事件,`serverEmit()`,`emitted` 记录,`acknowledgements` 定制回执,ack 同步回调);`vitest.setup.ts` 的默认分页视口是 350 px(一个标题栏 + 两条通道条),`tests/stub-mixer-layout.ts` 的 `resizePager()` 可改;推子拖动用 `fireEvent.pointerDown/Move/Up` 带 `pointerId`(见 `src/components/Fader.test.tsx`);`HTMLMediaElement.play/pause` 已 stub。
- **工具脚本的先例**:`apps/server/src/tools/dump-tree.ts` 与 `verify-ember.ts` 用 `tsx` 跑(`package.json` 的 `dump-tree` / `verify-ember` 脚本),参数解析用 `src/tools/cli-args.ts` 的 `parseFlagArgs()`;这两个驱动在 `apps/server/vitest.config.ts` 的覆盖率 `exclude` 里,纯逻辑拆在有单测的模块里(`allowed-channels.ts`、`cli-args.ts`)。soak 驱动照这个样子做。
- **运行环境事实**:Node 22.14(全局 `WebSocket` 可用,`process.getActiveResourcesInfo()` 可用);本机 Chrome 在 `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,另有 Chrome Beta 在 `C:\Program Files\Google\Chrome Beta\Application\chrome.exe`;GitHub 的 `ubuntu-latest` runner 预装 Chrome,路径在环境变量 `CHROME_BIN`。`apps/server/src/server.ts` 的 `start()` 接受 `staticRoot`(默认 `apps/web/dist`)、`configDir`、`port`、`silent` 与全部 Ember 时序参数,`StartedServer` 暴露 `app` / `runtime` / `io`。
- **基线**(改动前,本地实跑):typecheck 0 error;测试 shared 44 / test-utils 22 / server 143 / web 487 全绿;覆盖率 server 92.51 / 85.77 / 96.28 / 92.46,web 96.93 / 92.44 / 98.92 / 96.89。
- **6.4 的一处遗留**:`apps/web/index.html` 里 manifest 上方的注释末句「It is in place for the day the desk is served over https」与现状不符——本项目**不做 HTTPS**。本批次顺手改掉这一句(只删或改那一句,其余注释保留)。

## 本地执行边界

沿用 `docs/prompts/phase-6-4.md` 的「本地执行边界」全文,补充以下几条:

- 本批次改 `apps/server`(测试与 `src/tools/`)、`apps/web`(`lib/socket.ts` 与测试)、`.github/workflows/`(**只新增** `soak.yml`,`ci.yml` 一字不动)、`.gitignore` 与文档;不改 `packages/shared`、`packages/test-utils`。
- **不新增依赖**,`pnpm-lock.yaml` 不应有改动。soak 的浏览器驱动是自写的极简 CDP 客户端(第 4 节),不装 `playwright-core`、不装 `puppeteer`、不装 `ws`。
- **soak 的两种模式都不得碰真实台子**:默认模式自己起 Mock Provider 与 server,端口一律 `findFreePort()`;附着模式(`--url`)只开浏览器采样,**永远不发任何 `control:*` 事件**。你自己跑 soak 时只用默认模式;附着模式对着真实台子的那一小时由用户跑。
- 端口 3000 与 5173 上跑着用户自己的 `pnpm dev`,照旧不占、不重启、不杀。soak 起的 server 与 Provider 端口都是临时的。
- 一小时的 soak 实跑放在后台进行,期间继续做别的任务;不要为了省时间把时长缩到一小时以下就当作实跑结果(短跑只算冒烟,报告里分开写)。

## 分支、PR 与评审监控

沿用 `docs/prompts/phase-6-4.md` 的同名一节,分支名如 `claude/phase-6-5-<随机后缀>`,报告文件为 `docs/reports/phase-6-5-report.md`。

## 硬性约束

- `docs/prompts/phase-6-4.md` 的「硬性约束」全部沿用:自动化测试一律基于 Mock 或夹具;代码、注释、提交信息、固定 UI 文案英文,文档与报告简体中文;不调低覆盖率门槛;按逻辑单元分多次提交(建议:服务端测试夹具抽取 → 服务端重连用例 → 前端重连用例 → 离线命令不排队 → CDP 客户端 → soak 统计与判定模块 → soak 驱动、脚本与 `.gitignore` → `soak.yml` → 文档与 `index.html` 注释)。
- **覆盖率排除只允许新增一项**:`src/tools/soak.ts`(驱动)。`cdp.ts`、`soak-report.ts`、`soak-signal.ts` 三个模块必须有单测并计入覆盖率。
- **不改 6.3 / 6.4 的任何语义与数值**:分页、滚轮、手指翻页、常亮、全屏、防误触一条不动;`page-layout.ts`、`page-wheel.ts`、`fader-wheel.ts`、`wheel-gesture.ts`、`dnd-config.ts` 里的常量一个不动。
- **重连的既有行为不改写,只补用例**:`EmberService`、`MixerStateStore`、`gateway.ts`、`mixer-store.ts` 若因用例发现缺陷才可以改,且先写失败用例、再修、报告里单列;没有缺陷就一行不动。
- **既有用例只允许增,断言意图不得删改**;`socket.test.ts` 的 mock 补 `timeout` 方法属于夹具调整,不算改写。
- **离线命令的语义一刀切**:socket 未连接时任何控制命令立即失败,不缓冲、不重试;这一条不做「重连后自动重放」——重放过期电平是事故,不是功能。
- 数值一律做成导出常量并在报告的「数值初值清单」逐个列出;你不得自行调整初值。
- 不改 `docs/development-plan.md` 的任务描述与验收框;`docs/fairlight-ember.md` 只由用户回写。

## 任务范围

五项改动,按下面的顺序做。第 1–2 项是测试,第 3 项是一处修复,第 4–5 项是 soak 工具与它的 CI 入口。

### 1. 后端重连集成测试

新建 `apps/server/tests/reconnect.integration.test.ts`,Mock Provider + 真 `socket.io-client`。先把 `mixer.integration.test.ts` 里的 `writeConfig` / `startStack` / `connectClient` / `waitFor` / `emitAck` 抽到 `apps/server/tests/mixer-stack.ts`,两个文件共用;既有 6 例只改 import,断言一字不动。`startStack` 增加可选项:`httpPort`(指定端口,服务端重启用)、`providerPort`(指定 Provider 端口,同端口重开用)、`clientOptions`(透传给 `io()`,重连用例给 `reconnectionDelay: 50, reconnectionDelayMax: 100`)。

用例(每条都要断言**最终状态**,不只断言中间事件):

1. **Ember 掉线后在同一端口回来**:`provider.close()` → `store.connection` 变 `reconnecting`、客户端收到 `system:status { ember: 'reconnecting' }`;等到至少一次 connect 超时(`lastError` 匹配 `/^Timeout after \d+ms: connect$/`,这一步允许用较小的 `timeoutMs`,但要写明);`MockEmberProvider.fromDump(dump, { port: 同一端口 }).listen()` → 服务端**自行**重连(不发任何 PUT)→ 客户端收到 `connection: 'connected'` 的快照(树没变也要有,锁住 `snapshotDueAfterConnect`)且通道数不变 → `system:status { ember: 'connected' }` 不带 `lastError` → `GET /api/v1/connection` 无 `lastError` → **电平帧恢复**(`pushParameter` 一次 meter,客户端在帧里看到)→ **写入恢复**(`control:set-level` 的 ack 为 `ok`,新 Provider 上的参数值变了)。
2. **socket 传输层断开后客户端自动重连**:对服务端 `server.io.of('/').sockets` 里的每个 socket 调 `socket.conn.close(true)` → 客户端 `disconnect` 事件的 reason 是 `transport close` → 客户端自行重连(不调 `connect()`)→ 收到新的 `mixer:snapshot`(`connected`,通道齐全)与 `system:status` → 随后的 meter 推送到达。期间 Ember 一直在线。
3. **两者叠加,socket 先回来**:`provider.close()` 且 `conn.close(true)` → 客户端重连时服务端还在 `reconnecting`,收到的快照 `connection: 'reconnecting'` 且**通道仍在**(服务端不清清单)→ Provider 同端口重开 → connected 快照 → 电平与写入恢复。
4. **两者叠加,Ember 先回来**:`provider.close()` 且 `conn.close(true)`,把客户端的重连延迟设得比 Ember 重连慢(或先等 `store.connection` 回到 `connected` 再让客户端重连)→ 客户端重连后第一份快照就是 `connected`。两种顺序的**终态断言相同**:通道数、`connection`、无 `lastError`、电平帧与写入都通。
5. **服务端整体重启**:`await server.app.close()`(`onClose` 钩子会 `runtime.stop()`)→ 客户端进入重连循环(端口没人听,`reconnect_error`)→ 用**同一个 `httpPort` 与 `configDir`** 再 `start()` → 客户端连上新实例。新实例在 `app.listen` 之后、`runtime.start()` 完成之前就接受连接,所以客户端可能先收到 `connecting` / 空通道的快照——断言**最终**收到 `connected` 且通道齐全的快照,且这份快照不是靠客户端重新 `connect()` 得到的。
6. **多轮断连不重复订阅、不泄漏监听器**:记下 `server.runtime.ember.listenerCount('status')`、`listenerCount('tree')`、`store.listenerCount('patch')`、`store.listenerCount('snapshot')`;连做 5 轮「`provider.close()` → 同端口重开 → 等 connected 快照」;之后 `pushParameter` 改一次某通道的 `level`,断言客户端**恰好收到一条** `mixer:patch`(用 200 ms 静默窗口收集),`pushParameter` 一次 meter 后下一帧里该通道**恰好出现一次**;四个监听器计数与开始时相同。
7. **断线期间的控制命令**:Ember `reconnecting` 时 `control:set-level` 的 ack 为 `{ ok: false, error: { code: 'PROTOCOL' } }`(既有 `requireClient` 抛 `EmberProtocolError`),Provider 上的值没变;这条是服务端的兜底,前端的兜底在第 3 节。

超时:`describe` 级 20 s,单条用例内需要等 connect 超时的地方注明原因。所有 Provider 与 server 在 `afterEach` 里关干净(既有写法),不得留下打开的句柄让 vitest 挂住。

### 2. 前端重连集成测试

新建 `apps/web/tests/reconnect.integration.test.tsx`(`FakeSocket` + `App`),不要把 `mixer.integration.test.tsx` 撑得更大。快照用 3 个以上的通道,配合默认 350 px 视口得到 2 页(或用 `resizePager()`),这样翻页位置才有东西可验。

用例:

1. **socket 重连后操作状态保持**:加载快照 → 选中某个 view(`viewsClient` 用 `tests/fake-views-client.ts`)、翻到第 2 页、把 CONTROL LOCK 切到 `FADERS` → `socket.disconnect()` → `SOCKET OFFLINE`、推子 `aria-disabled`、电平表 `is-frozen`、`data-wake-lock` 为 `idle` → `socket.connect()` + 相同快照 + `system:status connected` → `MIXER ONLINE`;`Mixer view` 下拉仍是那个 view、页码仍是 `2 / 2`、CONTROL LOCK 仍是 `FADERS`(推子仍禁用而 ON 可用——这是锁定,不是断线)、电平表不再 `is-frozen`、之后一帧 `meters:frame` 更新到读数、`data-wake-lock` 回到 `active`。条带的 DOM 节点在重连前后是**同一个**(`article` 引用相等),没有重新入场。
2. **拖动中掉线**:`pointerDown` 推子帽并移动几十像素(`onInteractionStart` 已触发、pending 态)→ `socket.disconnect()` → 推子禁用、指针再移动不改值 → `pointerUp` → commit 走第 3 节的离线路径:`emitted` 里**没有**新的 `control:set-level`,电平回到拖动前的基线,`notice`(`role="alert"`)显示离线文案,`pendingLevels` 清空(用 `mixerStore.getState()` 断言)→ 重连并收到快照后推子可用、值是快照的值。
3. **Ember 掉线时条带不重挂、回来后不重挂**:`system:status reconnecting` → 控件禁用、`EMBER RECONNECTING`、电平表冻结、`data-wake-lock` 为 `idle`;`system:status connected` + 相同快照 → 控件可用,`article` 节点同一,页码不变。
4. **叠加,socket 先回来**:`system:status reconnecting` → `socket.disconnect()` → `socket.connect()` → 服务端重启形态的快照 `{ channels: [], connection: 'connecting' }` → 条带**仍在**、`EMBER CONNECTING`、无 `MIXER NOT CONNECTED` → `connected` 快照 → 全部恢复。
5. **叠加,Ember 先回来**:`socket.disconnect()`(此时 UI 已是 `SOCKET OFFLINE`,看不到 Ember 的变化)→ `socket.connect()` 后第一份快照就是 `connected` → 直接恢复,中间没有闪过空态(用 `queryByText('MIXER NOT CONNECTED')` 与 `queryByText('BACKEND OFFLINE')` 在恢复后为空,并在 `socket.connect()` 与快照之间断言空态没有出现——`FakeSocket.connect()` 同步派发 `connect`,快照紧随其后)。
6. **重连后的 ack 不串**:断线前发出一条 `control:set-on`(`acknowledgements` 里不设,让它悬着——`FakeSocket` 会同步回 ack,所以这条要用一个不回 ack 的 socket 双替或把 `emit` 改成只记录),断线,重连;5 s 后(`vi.useFakeTimers`)它以 `TIMEOUT` 收场并回滚,重连后收到的快照不被这次回滚覆盖。

每条用例断言的可访问名与既有约定一致:`MIXER ONLINE` / `SOCKET OFFLINE` / `EMBER RECONNECTING` / `EMBER CONNECTING`、`<name> level` 滑块、`<name> on/off`、`Mixer view`、`Page` 输出、`FADERS` 单选。

### 3. 离线命令不排队

`apps/web/src/lib/socket.ts`:

- 把 `ACK_TIMEOUT_MS` 改为导出常量。
- `emitWithAck()` 开头检查 `socket.connected`:为假时**同步**返回 `{ ok: false, error: { code: 'OFFLINE', message: 'The mixer is offline.' } }`,**不调用 `emit`**。
- `createBrowserSocket().emit()`:最后一个参数是函数时改走 `socket.timeout(ACK_TIMEOUT_MS).emit(event, ...args, callback)`。注意 `timeout()` 版本的 ack 签名是 `(err, ...response)`:超时时 `err` 是 `Error`、`response` 为空;成功时 `err` 为 `null`。包装层把它翻回既有的单参数 ack:`err` 非空 → 交给 `emitWithAck` 的回执解析(它会因为不是合法 `ControlAck` 而给出 `INVALID_ACK`——**不要这样**,包装层要显式把 `err` 翻成 `{ ok: false, error: { code: 'TIMEOUT', message: 'The mixer did not respond.' } }`);否则原样传 `response[0]`。这样一条在传输层断开前刚发出的命令,超时时会被库从 `sendBuffer` 里删掉,重连后不补发。`emitWithAck` 自己的 5 s 计时器保留(它同时服务于没有 `timeout()` 的 socket 双替),谁先到谁算,结果一致。
- 不带回调的 `emit`(目前没有调用点)保持原样。

测试(`src/lib/socket.test.ts` 新增;`socketIoMock` 补 `timeout: vi.fn(() => socketIoMock)`):

1. `connected` 为假时 `setLevel` / `setOn` / `resetLoudness` 立即得到 `OFFLINE`,`emit` 未被调用;
2. 浏览器包装层对带回调的 `emit` 调用了 `timeout(ACK_TIMEOUT_MS)`,并把 `(err)` 翻成 `TIMEOUT` 回执、把 `(null, ack)` 原样透传;
3. 既有「times out commands that never receive an acknowledgement」不变。

`mixer-store.ts` 不需要改:`finishLevelInteraction` / `finishOnInteraction` 对 `ok: false` 的处理已经是回滚 + `notice`。第 2 节第 2 条用例是这条修复的端到端锁。

### 4. soak 工具

四个文件,全部在 `apps/server/src/tools/`,`package.json` 加脚本 `"soak": "tsx src/tools/soak.ts"`,`.gitignore` 加 `soak-reports/`。

**4.1 `cdp.ts` — 极简 CDP 客户端(有单测,计入覆盖率)**

- `connectCdp(webSocketUrl, { WebSocket?: typeof WebSocket })` 返回 `{ send(method, params?): Promise<result>, on(event, listener), close() }`;`send` 按自增 id 关联响应,`error` 字段翻成 `Error`;事件按 `method` 分发。
- `launchChrome({ executable, url, args, userDataDir })`:用 `node:child_process.spawn` 起 Chrome,参数固定为 `--headless=new --remote-debugging-port=0 --user-data-dir=<临时目录> --no-first-run --no-default-browser-check --window-size=1920,1080 <url>` 再拼上 `args`;从 stderr 里解析 `DevTools listening on ws://…`,`GET http://127.0.0.1:<port>/json/list` 取 `type === 'page'` 的 `webSocketDebuggerUrl`;返回 `{ pageSocketUrl, kill() }`。启动超时 `SOAK_BROWSER_LAUNCH_TIMEOUT_MS`(初值 15 000)。
- `resolveChromeExecutable(explicit?, env, platform)`:顺序为 `--browser` → `CHROME_PATH` → `CHROME_BIN` → 平台候选(win32:`C:\Program Files\Google\Chrome\Application\chrome.exe`、`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`、`%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`、`C:\Program Files\Google\Chrome Beta\Application\chrome.exe`;linux:`google-chrome`、`google-chrome-stable`、`chromium`、`chromium-browser`;darwin:`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`),取第一个存在的;都没有就抛出带提示的错误。
- 单测:用注入的假 `WebSocket`(构造后手动触发 `open` / `message`)验证 id 关联、错误翻译、事件分发、`close()`;`resolveChromeExecutable` 注入 `existsSync` 双替验证优先级;`launchChrome` 的 stderr 解析拆成纯函数 `parseDevToolsUrl(text)` 单测,spawn 本身不测。

**4.2 `soak-signal.ts` — 电平信号(有单测)**

- `meterSignal(t, channelIndex)`:返回 −60 … 0 dB 的值,慢正弦(周期按通道错开)加小噪声,每通道每约 20 s 有一段 ≥ 0 dB 的峰(让 `clipping` 与峰值保持都跑到),其余时间落在 −40 … −6。纯函数,噪声用注入的 `random`。
- `loudnessSignal(t)`:integrated 在 −26 … −20 缓慢漂移,true-peak 跟随最大电平。
- 单测锁范围、周期与峰段。

**4.3 `soak-report.ts` — 统计与判定(有单测)**

样本类型:

```ts
export interface SoakSample {
  atMs: number;                 // since run start
  browser: {
    jsHeapUsedBytes: number; jsHeapTotalBytes: number;
    domNodes: number; jsEventListeners: number; documents: number; frames: number;
    layoutCount: number; taskDurationS: number;
    wakeLock: string | null; pageLabel: string | null; strips: number; videos: number;
    online: boolean;            // header reads MIXER ONLINE
  };
  server: { rssBytes: number; heapUsedBytes: number; activeHandles: number; listeners: Record<string, number> };
  churn?: { kind: 'ember' | 'socket'; recoveredMs: number | null };
}
```

- `summarize(samples, options)`:热身 `SOAK_WARMUP_MINUTES`(初值 10)之后取第一个 `SOAK_WINDOW_MINUTES`(初值 10)窗口为基准、最后一个同长窗口为终点,各取均值;给出每个指标的基准、终点、差值与比例,JS 堆的最小二乘斜率(bytes/min,基于热身后的全部样本),churn 的次数、恢复时间的最大值与失败次数。
- `verdict(summary)`:全部满足才 `pass`:JS 堆增长 ≤ `SOAK_HEAP_GROWTH_MAX_BYTES`(初值 10 MiB)**且** ≤ `SOAK_HEAP_GROWTH_MAX_RATIO`(初值 0.2);DOM 节点与事件监听数的变化比例 ≤ `SOAK_DRIFT_MAX_RATIO`(初值 0.05);服务端 heapUsed 增长 ≤ `SOAK_SERVER_HEAP_GROWTH_MAX_BYTES`(初值 20 MiB);服务端 `activeHandles` 变化 ≤ `SOAK_HANDLE_DRIFT_MAX`(初值 4);每次 churn 都在 `SOAK_CHURN_RECOVERY_MS`(初值 30 000)内恢复。样本不够两个窗口时 `inconclusive`(短跑、冒烟),但 churn 未恢复在任何时长下都直接 `fail`。
- `renderMarkdown(summary, verdict, meta)`:`report.md` 的正文——运行参数、指标表(基准 / 终点 / 变化)、斜率、churn 表、判定与不满足的条目。
- 单测:窗口切分(样本不足、恰好够、有余)、斜率、每条阈值的边界(恰好等于阈值通过、超一点失败)、`inconclusive` 与 churn 失败的优先级、markdown 里含判定与每个不满足项。

**4.4 `soak.ts` — 驱动(覆盖率排除)**

参数(`parseFlagArgs`):`--minutes`(初值 `SOAK_DEFAULT_MINUTES = 60`)、`--sample-seconds`(`SOAK_SAMPLE_INTERVAL_S = 30`)、`--page-seconds`(`SOAK_PAGE_TURN_INTERVAL_S = 5`)、`--churn-minutes`(`SOAK_CHURN_INTERVAL_MINUTES = 10`,`0` 关闭)、`--meter-hz`(`SOAK_METER_HZ = 20`)、`--browser`、`--browser-args`(空格分隔,追加)、`--out`(默认 `soak-reports/<ISO 时间戳>/`,相对仓库根)、`--url`(附着模式)、`--dump`(dump 文件,默认最新)。

默认模式的流程:

1. 检查 `apps/web/dist/index.html` 存在,否则退出并提示先 `pnpm build`。
2. `MockEmberProvider.fromDumpFile(dump).listen()`(自由端口)→ 临时 `configDir` 写好 `config.json` → `start({ port: findFreePort(), staticRoot: web dist, configDir, silent: true })`(Ember 时序参数用**默认值**,包括 2 s 的总线目录轮询——真机就是这样跑的,探针客户端的建立与销毁正是要 soak 的东西)。
3. 电平喂送:从 dump 里收集全部映射通道的 `meter` 路径(`channel/*/meter`、`main/*/meter`、`aux/*/meter`),每 `1000 / meterHz` ms 对每条 `pushParameter(path, meterSignal(t, i))`;每 1 s 推一次两个响度参数。
4. `launchChrome` 指向 `http://127.0.0.1:<port>/`,连 CDP,`Performance.enable`、`HeapProfiler.enable`、`Runtime.enable`;等页头出现 `MIXER ONLINE`(`Runtime.evaluate` 轮询,超时 `SOAK_CHURN_RECOVERY_MS`)。
5. 操作员循环:每 `pageSeconds` 秒用 `Input.dispatchKeyEvent`(`keyDown` + `keyUp`,`key: 'PageDown'`,`windowsVirtualKeyCode: 34`)翻一页,到末页改发 `PageUp`(33)往回;**每次按键前用 `Runtime.evaluate` 确认 `document.activeElement === document.body`**,不是就跳过这一次(推子聚焦时 PageUp/PageDown 是 ±10 dB)。
6. 采样:每 `sampleSeconds` 秒先 `HeapProfiler.collectGarbage`,再 `Performance.getMetrics`(取 `JSHeapUsedSize`、`JSHeapTotalSize`、`Nodes`、`JSEventListeners`、`Documents`、`Frames`、`LayoutCount`、`TaskDuration`)与一段 `Runtime.evaluate` 读页面(`.mixer-shell` 的 `data-wake-lock`、`output[aria-label="Page"]` 的文本、`.channel-strip` 数量、`video` 数量、页头是否 `MIXER ONLINE`);服务端 `process.memoryUsage()`、`process.getActiveResourcesInfo().length`、`runtime.ember` / `runtime.store` 的 `listenerCount`(`status`、`tree`、`patch`、`snapshot`)。追加写入 `samples.json`(每次采样都落盘,中途被杀也有数据)。
7. churn(`churnMinutes > 0`):每到时交替执行——`ember`:`provider.close()`,5 s 后同端口重开;`socket`:对 `server.io.of('/').sockets` 每个 `conn.close(true)`。随后轮询页头,记录回到 `MIXER ONLINE` 的耗时;超过 `SOAK_CHURN_RECOVERY_MS` 记 `recoveredMs: null` 并继续跑(判定阶段会 `fail`)。
8. 到时:停操作员与喂送、`kill()` 浏览器、关 server 与 Provider、删临时目录;`summarize` → `verdict` → 写 `report.md`;控制台打印判定与报告路径;`fail` 退出码 1、`pass` 与 `inconclusive` 退出码 0。
9. `SIGINT` / `SIGTERM`:走同一套收尾,已有样本照样出报告。

附着模式(`--url`):跳过 2、3、7,只做 4、5、6、8;`server` 段的字段全部为 `null`,判定只看浏览器指标与 `online` 从未变假(变假一次即 `fail`,记录时间)。这是用户对真实台子做一小时验收的工具:**它只翻页、只读 DOM,没有任何写入路径**——在代码注释里写明,并在报告的验收清单里写明。

**4.5 实跑要求**

- 先跑一次 3 分钟、`--sample-seconds 10 --churn-minutes 1` 的冒烟,确认两种 churn 都恢复、报告为 `inconclusive`。
- 再跑**完整 60 分钟默认参数**(后台),把 `report.md` 的指标表与判定原样贴进执行报告;`samples.json` 不进仓库。若判定不是 `pass`,如实写明,并按「先写失败用例、再修」的规矩处理能定位的泄漏;定位不了的写进遗留。
- 记录实跑机器的 Chrome 版本(`--version`)与运行时间。

### 5. CI 手动触发

新建 `.github/workflows/soak.yml`:

```yaml
name: Soak
on:
  workflow_dispatch:
    inputs:
      minutes:
        description: 'Run length in minutes'
        default: '60'
        required: true
jobs:
  soak:
    runs-on: ubuntu-latest
    timeout-minutes: 150
    steps:
      - checkout / pnpm / node 22(与 ci.yml 相同的三步)
      - pnpm install --frozen-lockfile
      - pnpm build
      - pnpm --filter @flwc/server soak -- --minutes ${{ inputs.minutes }} --browser "$CHROME_BIN" --browser-args "--no-sandbox" --out soak-reports/ci
      - actions/upload-artifact@v4(if: always(),name soak-report,path soak-reports/ci,retention-days 30)
```

`ci.yml` 不动。本批次**不要求**在 CI 上真的跑满一小时,但要用 `gh workflow run soak.yml -f minutes=3` 触发一次短跑并 `gh run watch` 到结束,确认 runner 上的 Chrome 能起、报告 artifact 能下载;结果写进报告。

### 6. 文档

- `docs/architecture.md`:「前端结构」的「断线」一条扩写为当前行为——socket 重连后服务端补发快照与状态、前端保留页码 / view / 锁定、离线命令立即失败不排队、`timeout()` 让传输层断开前的命令不补发;新增一节「长时间运行(soak)」放在「部署」之前:工具做什么、两种模式、采什么、判定阈值是初值、CI 手动触发与报告去向。
- `docs/conventions.md`:「Git」一节的不提交清单加 `soak-reports/`;「测试」一节加一句 soak 的命令与「附着模式对真实台子只读」。
- `apps/web/index.html`:改掉「等 https」那一句注释。
- 不改 `docs/development-plan.md`。

## 测试要求

- 单元测试与被测代码同目录,集成测试放各包 `tests/`;第 1–4 节的测试项全部落地;既有测试只允许增加。
- 覆盖率:`apps/server` 与 `apps/web` ≥ 80%(维持既有门槛);`packages/shared`、`packages/test-utils` 本批次不改。新增的三个 soak 模块各自 ≥ 90% 行覆盖。
- 时钟相关的前端用例用 `vi.useFakeTimers`(5 s ack 超时);服务端集成用例用真实计时但把重连延迟调小。
- 服务端集成用例全程只连 Mock Provider;`afterEach` 关干净所有 Provider、server 与 socket,`vitest run` 结束后进程自行退出。

## 明确不做的事

- 不做「重连后重放离线期间的命令」;不做前端的命令队列。
- 不改 socket.io 客户端的重连参数(1 s → 5 s,无限次)与 `EmberService` 的退避参数(1 s → 30 s)。
- 不把 `playwright-core` / `puppeteer` / `ws` 装成依赖;不新增任何依赖;不改 `ci.yml`。
- 不做 Phase 7:Docker、环境变量种子值、README。
- 不做电平表性能预算(6.3 已做);soak 只看内存与恢复,不看帧率。
- 不给 soak 加电平以外的 Ember 参数变化(通道增删、改名)——那是 `EmberService` 用例的领域,已有覆盖。
- 不改 6.3 / 6.4 的任何东西;6.3 的触控板复测仍由用户另行安排,与本批次无关。

## 验收自查

完成后逐条核对,在本地实际执行并记录结果:

1. 后端:7 条重连用例全绿;第 6 条的四个监听器计数与 patch 计数是真实断言不是 `toBeDefined`;`mixer.integration.test.ts` 既有 6 例改 import 后全绿。
2. 前端:6 条重连用例全绿;第 1 条断言了 `article` 节点同一;第 2 条断言了 `emitted` 里没有离线期间的 `control:set-level`。
3. 离线命令:`socket.test.ts` 新增 3 条全绿;`createBrowserSocket` 对带回调的 `emit` 确实调用了 `timeout()`。
4. soak:三个模块单测全绿且各 ≥ 90% 行覆盖;3 分钟冒烟两种 churn 都恢复;**60 分钟实跑完成**,报告表格与判定在执行报告里;`soak-reports/` 已忽略,仓库里没有样本文件。
5. CI:`soak.yml` 手动触发 3 分钟短跑成功,artifact 可下载;`ci.yml` 无 diff。
6. 全量质量门:串行 lint → typecheck → test → build 全绿,远端 CI 全绿,lockfile 无 diff,`apps/server/vitest.config.ts` 只多了 `src/tools/soak.ts` 一项排除。
7. 全程没有碰真实 Fairlight,没有动 3000 / 5173。

## 执行报告要求

在 `docs/reports/phase-6-5-report.md` 产出执行报告(简体中文),章节与 `docs/reports/phase-6-4-report.md` 相同:结果总览、验收标准逐条核对(对上述七条)、实现摘要(每节一段;soak 一节要写清两种模式各做什么、附着模式为什么是只读)、**soak 实跑结果**(冒烟与 60 分钟各一张表:运行参数、Chrome 版本、指标基准 / 终点 / 变化、斜率、churn 恢复时间、判定;CI 短跑的 run 链接)、数值初值清单(本批次新增的全部常量,逐个列名称、值、含义、文件)、真机验收操作清单(移交用户,含:① 在开发机上对着自己的 `pnpm dev` 跑附着模式一小时的命令与看什么;② 平板照常使用一小时,期间拔一次台子网线或重启一次 `pnpm dev`,观察 `MIXER ONLINE` 自行恢复、推子可用、常亮跟随;③ 一小时后触屏与鼠标操作是否仍然跟手;**安全约束照抄 6.4 报告第 6 节**,附着模式对台子只读,拔线验收期间不要操作推子)、交付物清单、依赖清单(应为「无新增依赖,lockfile 无 diff」)、关键决策与偏离、被改写的既有用例清单(预期只有 `mixer.integration.test.ts` 的 import 与 `socket.test.ts` 的 mock 夹具)、遗留问题与移交事项、提交记录。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤、soak 未跑满、判定不通过、定位不了的泄漏都要写明,不许美化。

## 完成定义

- 五项任务全部落地,测试要求全部满足。
- 本地串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,`pnpm-lock.yaml` 无改动。
- PR 已开,远端 CI 全绿,Bugbot 的每一条 finding 都已修复或已在线程里回复理由,且最后一轮轮询没有新 finding。
- 60 分钟 soak 实跑完成且结果在报告里;`soak.yml` 短跑成功一次。
- 全部变更已按 Conventional Commits 提交并推送。
- `docs/reports/phase-6-5-report.md` 已产出,真机验收清单可直接交用户执行。
