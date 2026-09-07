# Phase 6.1 执行报告 — 连接配置与错误态

## 1. 结果总览

Phase 6.1 云端范围已全部完成:后端实施了"最近一次连接失败原因"的最小扩展(`lastError`,可选、只读、向后兼容,不改状态枚举与退避逻辑、不新增 socket 事件);前端新增 `connection-api.ts`、两个页面头部可点击的连接状态灯与自绘 CONNECTION 模态面板(含 Ember 已连接时的 `CONFIRM RECONNECT` 二次确认),混音页与配置页的空态按 socket 离线 / Ember 未连接 / 树为空三种原因分流,Ember 未连接时提供 `CONFIGURE CONNECTION` 直达面板。冒烟过程中暴露并修复了两个既有服务端缺陷(重配端点时旧连接尝试的迟到失败会把新连接改回 `reconnecting`;重连后树结构未变时不重发快照,浏览器无法完成清单加载)。最终 HEAD 串行 lint / typecheck / test(覆盖率门槛)/ build 全绿,`pnpm dev` + Mock Provider 的 Playwright 端到端冒烟通过,远端 CI 状态见第 2 节。云端无法连接真实 Fairlight,真机验收按边界移交用户(第 4 节)。

## 2. 验收标准逐条核对

| 验收标准                                                                                              | 结果     | 实际执行与输出摘要                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 集成测试覆盖:面板读取与保存、校验失败提示(空 host、越界 port)、已连接时的二次确认、三种空态分流与 CTA | 通过     | `apps/web/src/features/connection/ConnectionPanel.test.tsx`(12 项:模态可访问性、GET 回填与焦点、实时状态与 `lastError`、GET 失败仍可编辑、空 host / port 0 / 70000 / 1.5 / 文本的就地校验、服务端 400 就地显示且保留输入、提交中禁用、已连接二次确认与 `KEEP CURRENT` 取消、非连接直接提交、Esc / 关闭键 / CANCEL / 背景关闭、Tab 环绕、关闭后忽略过期响应并焦点回归);`apps/web/tests/connection.integration.test.tsx`(5 项:混音页与配置页状态灯打开、焦点回到状态灯、连接态确认流程与 socket 状态实时反映、非连接直接提交、配置页 AVAILABLE CHANNELS 空态分流与 CTA);`apps/web/tests/mixer.integration.test.tsx` 新增 2 项(三种空态与 CTA 打开面板、已加载后 `reconnecting` 不回退空态);`apps/web/src/features/mixer/empty-state.test.ts`(判定矩阵)。`pnpm --filter @flwc/web test`:146 项全部通过。 |
| 本地:修改为正确地址后重连成功;修改为错误地址后空态正确且可从空态入口改回                              | 移交用户 | 云端无真机。同一流程已用 Mock Provider 在浏览器中完整走通(第 2 节末"端到端冒烟"),真机操作清单见第 4 节。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 覆盖率达标                                                                                            | 通过     | 最终 HEAD `pnpm test`(v8):`packages/shared` 语句/分支/函数/行 100%(门槛 90%);`apps/server` 语句 92.27%、分支 85.38%、函数 96.24%、行 92.22%(门槛 80%);`apps/web` 语句 96.19%、分支 91.43%、函数 97.68%、行 95.97%(门槛 80%);`packages/test-utils` 93.86% / 90.4% / 100% / 93.86%(门槛 90%)。未改任何 vitest 配置与排除项。                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 全量质量门与远端 CI                                                                                   | 通过     | 最终 HEAD 串行 `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` 四步退出码均为 0:eslint 与 prettier 无问题;四个包 `tsc --noEmit` 通过;shared 33、test-utils 22、server 137、web 146,共 338 项测试通过;Vite 生产构建与 server/shared/test-utils `tsc` 构建成功。远端 GitHub Actions `CI / ci` 在 `6987ffc`(第 9 节列出的最后一个代码提交)运行 #190 全绿(lint + typecheck + test + build,`conclusion: success`)。                                                                                                                                                                                                                                                                                                                                                                            |

**端到端冒烟(`pnpm dev` + Mock Provider,Playwright 驱动预装 Chromium)**:Mock Provider 以仓库最新树 dump 运行于 `127.0.0.1:9100`;后端按默认配置指向无人监听的 `127.0.0.1:9000`。实际记录(时间为云端 UTC):

```text
20:08:03 initial API {"host":"127.0.0.1","port":9000,"status":"reconnecting","lastError":"Could not connect to 127.0.0.1:9000 after a timeout of 5 seconds"}
20:08:03 empty state: MIXER NOT CONNECTED | EMBER RECONNECTING | Could not connect to 127.0.0.1:9000 after a timeout of 5 seconds | CONFIGURE CONNECTION
20:08:03 dialog aria-modal: true / host,port: 127.0.0.1 9000 / focused element: connection-host
20:08:03 validation: ['Enter a host name or IP address.', 'Port must be a whole number between 1 and 65535.']
20:08:04 after apply status: CONNECTED last error present: 0   API {"host":"127.0.0.1","port":9100,"status":"connected"}
20:08:04 lamp: MIXER ONLINE strips: 20
20:08:05 confirm text: The mixer is connected. Applying will disconnect the current device and reconnect to 127.0.0.1:9199.
20:08:05 KEEP CURRENT returned to APPLY; API still {"host":"127.0.0.1","port":9100,"status":"connected"}
20:08:10 after reconnect status: RECONNECTING | last error: Could not connect to 127.0.0.1:9199 after a timeout of 5 seconds
20:08:10 strips still rendered while reconnecting: 20 fader disabled: true
20:08:11 after reload empty state: MIXER NOT CONNECTED | EMBER RECONNECTING | Could not connect to 127.0.0.1:9199 after a timeout of 5 seconds | CONFIGURE CONNECTION
20:08:11 settings page opened dialog; ember status: RECONNECTING
20:08:11 SMOKE OK
```

即:错误地址 → 混音页 Ember 未连接空态 + CTA → 面板回填当前值并就地校验 → 改为 Mock Provider 地址后无需确认直接提交 → 面板内看到 `CONNECTED`、关闭后 20 条通道出现 → 改回错误端口触发 `CONFIRM RECONNECT`、`KEEP CURRENT` 可取消 → 确认后面板显示 `RECONNECTING` 与新的 `lastError` → 已加载的条带保留并禁用 → 刷新后空态与 `lastError` 正确 → 配置页状态灯同样可打开面板。全过程只写应用配置,未触碰任何通道参数。

## 3. 实现摘要

- **后端扩展(已实施)**:`EmberService` 新增 `lastError` 字段与 getter,`setStatus(status, lastError)` 按 `(status, lastError)` 对去重,因此原因变化时即使枚举值不变也会广播;连接尝试失败在 catch 中通过 `connectFailureReason()` 记录(展开 `AggregateError`、压成单行、空消息回退 `Connection failed`、截断 200 字符),重试期间保留上次原因,连接成功、`configure()` 重配端点、`stop()` 时清空。`MixerStateStore.setConnection(status, lastError?)` 同样按对去重并暴露 `connectionError`;`runtime` 透传第二个参数;网关用 `systemStatusPayload()` 构造 `{ ember, lastError? }`(无原因时不带键),并在每个 socket 连接建立后紧随快照再发一次 `system:status`(复用既有事件,快照本身不带原因,否则刷新页面后因去重永远拿不到 `lastError`);`GET/PUT /api/v1/connection` 响应都带 `lastError`,PUT 因 `updateEndpoint` 会等待对新地址的首次尝试,响应即反映该次结果。shared 侧 `connectionGetResponseSchema` 与 `systemStatusSchema` 各加 `lastError: z.string().optional()`,旧形状负载仍通过校验。
- **实际错误文案**:`emberplus-connection` 的 `S101Client._onError` 会吞掉 `ECONNREFUSED` 并自行重拨,`connect()` 只在库自身 5 秒超时后以 Error 解析;本服务 `withTimeout` 默认同为 5 秒,二者竞争,因此地址错误时 `lastError` 为 `Could not connect to <host>:<port> after a timeout of 5 seconds`(库先到)或 `Timeout after 5000ms: connect`(本服务先到,集成测试 3 秒超时下必为此形)。提示词中的 `ECONNREFUSED 10.0.0.8:9000` 示例在当前库版本下不会出现。
- **`connection-api.ts`**:`createConnectionClient(fetcher = fetch)` 提供 `get()` 与 `update(body)`,响应用 `connectionGetResponseSchema.parse`;与 `views-api.ts` 共用新抽出的 `lib/api-request.ts`(fetch 注入、JSON body 自动带 `content-type`、非 2xx 读取 `{ error: { code, message } }`,非 JSON 时回退 `Connection request failed with status N.`)。`App` 以与 `viewsClient` 相同的方式惰性创建并可注入。
- **面板交互与可访问性**:`ConnectionStatus` 外层保留 `role="status"` live region,内部改为 `<button aria-label="Connection settings" aria-haspopup="dialog">`;面板在 `App` 层渲染一次、跨路由存活,`open` 时挂载全新对话框(表单状态自然重置)。`useModalDialog` 负责:挂载时记住触发元素并聚焦对话框容器、`body.is-modal-open` 锁滚动、Tab / Shift+Tab 在可聚焦元素内环绕、`document` 层监听 Escape(APPLY 被禁用时焦点会掉到 body,冒烟中发现后修复)、卸载时焦点回到仍在文档中的触发元素。表单:打开时 `GET` 回填 host/port(GET 失败显示错误但仍可编辑,关闭后忽略过期响应),输入 `aria-invalid` + `aria-describedby` 指向就地错误文案,状态块 `aria-live="polite"` 实时显示 `EMBER <STATUS>` / `SOCKET OFFLINE` 与 `LAST ERROR`,提交中禁用输入与两个按钮,成功后保持打开并显示 `Settings applied. Watching the mixer reconnect.`,失败就地显示服务端 message 并保留输入。样式只用既有深色 token,`notice-in` 短动效经既有 reduced-motion 块自动降级;未引入任何依赖。
- **二次确认**:`emberStatus === 'connected'` 时首次提交只进入确认态——主按钮变为 `CONFIRM RECONNECT`、副按钮变为 `KEEP CURRENT`、显示 `The mixer is connected. Applying will disconnect the current device and reconnect to <host>:<port>.`;再次点击才发 PUT;修改任一输入即退出确认态,保证文案与值一致;非连接状态直接提交。
- **三种空态**(`features/mixer/empty-state.ts`,纯函数,配置页复用):按顺序判定 ①已加载且激活 View 引用数为 0 → `THIS VIEW HAS NO CHANNELS`(不变);②已加载且(View 模式或条带数 > 0)→ 渲染条带(已加载后 `reconnecting` 靠此保留条带,控件由 `controlsAvailable` 禁用);③`socketConnected === false` → `BACKEND OFFLINE`,无 CTA;④`emberStatus !== 'connected'` → `MIXER NOT CONNECTED` + `EMBER <STATUS>` + `lastError` + `CONFIGURE CONNECTION`;⑤已加载但 0 通道 → `NO CHANNELS ON THE MIXER`,无 CTA;⑥其余 → `WAITING FOR MIXER SNAPSHOT`(socket 已连、状态已 connected 但快照未到的瞬时态)。`channelInventoryLoaded` 的既有语义未改:仍只由已连接快照首次置为有效,缓存清单穿越 status-only reconnect 与空的非 connected 握手。
- **冒烟暴露并修复的服务端问题**:(a)`PUT` 切换端点时,对旧地址仍在等待超时的那次 `connectOnce` 在 5 秒后失败,其 catch 会把已经连上新地址的服务改回 `reconnecting`、带上旧地址的错误并触发一次多余重连——这是既有竞态,`lastError` 使其显形;现在 catch 先判断 `this.client !== client`,过期尝试只记 debug 日志直接返回。(b)重连后若树结构未变,store 只发 status 不发快照,在断线期间打开页面的浏览器只持有标记为非 connected 的快照,永远无法把清单置为已加载(架构文档本就承诺"重连后"发快照);现在 `MixerStateStore` 在状态变为 `connected` 后的首次树同步一律发快照。

## 4. 真机验收操作清单(移交用户)

**安全约束**:CONNECTION 面板只写应用配置(`data/config.json` 的 `ember.host/port`);修改地址会让后端断开当前 Ember+ 连接并重连真机,但**不会改动 Fairlight 的任何参数**,可放心操作。验收过程中如需操作推子,只允许 **MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry** 四个输入通道,并在测后精确复原;**不得切换 ON/mute、不得操作其它通道、不得删改任何通道**。

1. 仓库根目录 `pnpm install`,然后 `pnpm dev`(server `127.0.0.1:3000` + web `5173`)。若 `data/config.json` 尚不存在,后端默认指向 `127.0.0.1:9000`。
2. 只用 `http://localhost:5173` 打开前端。若默认地址不是真机地址,应看到 `MIXER NOT CONNECTED`、`EMBER CONNECTING/RECONNECTING`、一行红色的最近错误(形如 `Could not connect to 127.0.0.1:9000 after a timeout of 5 seconds`,首个错误最多需等 5 秒)与 `CONFIGURE CONNECTION` 按钮;页头状态灯显示 `EMBER CONNECTING`。
3. 点击 `CONFIGURE CONNECTION`(或页头状态灯):应弹出 `CONNECTION` 对话框,HOST/PORT 已回填当前值,焦点在 HOST;对话框内 `EMBER` 行与 `LAST ERROR` 行与页面一致。先试 Esc、点击背景、`CANCEL` 三种关闭方式,焦点应回到状态灯。
4. 再次打开面板,把 HOST 清空、PORT 填 `70000` 点 `APPLY`:应就地出现 `Enter a host name or IP address.` 与 `Port must be a whole number between 1 and 65535.`,不发请求。
5. 填入真实 Fairlight 的 host/port(常见 `127.0.0.1:9000`)点 `APPLY`(未连接时不会要求确认):应出现 `Settings applied. Watching the mixer reconnect.`,`EMBER` 行在数秒内从 `CONNECTING` 变为 `CONNECTED`,`LAST ERROR` 行消失;关闭面板后状态灯为 `MIXER ONLINE`,全部通道条带出现。`curl -s http://127.0.0.1:3000/api/v1/connection` 应返回 `"status":"connected"` 且没有 `lastError`。
6. 已连接状态下再次打开面板,把 PORT 改为一个无人监听的端口(如 `9199`)点 `APPLY`:主按钮应变为 `CONFIRM RECONNECT`、副按钮变为 `KEEP CURRENT`,并显示"将断开当前设备并重连到 …"的说明;先点 `KEEP CURRENT` 确认未发请求(`curl` 仍为原地址),再点 `APPLY` → `CONFIRM RECONNECT`。此时真机连接会被断开(不改任何参数)。
7. 确认后面板保持打开,`EMBER` 变为 `RECONNECTING`,约 5 秒后出现针对新端口的 `LAST ERROR`;关闭面板:已加载的条带应继续显示但推子与 ON 禁用(不要尝试点击)。刷新页面后应回到 `MIXER NOT CONNECTED` 空态并带 `lastError`。
8. 从空态的 `CONFIGURE CONNECTION` 打开面板改回真机地址并 `APPLY`(此时未连接,直接提交):状态应恢复 `CONNECTED`,通道重新出现。
9. 点击 `CONFIGURE VIEWS` 进入配置页,确认页头状态灯同样可打开面板;若在断线状态下进入,选中一个 View 后 `AVAILABLE CHANNELS` 区应显示同样的原因分流文案与 `CONFIGURE CONNECTION`。
10. 可选:停止后端进程,页面应显示 `BACKEND OFFLINE`(无 CTA);重启后自动恢复。
11. 如需确认推子行为未回归,只对上述四个允许通道之一记录原值、小幅移动后立即复原;不得点击 ON。

## 5. 交付物清单

| 路径                                                                                                                                                                                                 | 用途                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/connection.ts`、`packages/shared/src/mixer.ts`                                                                                                                                  | `connectionGetResponseSchema` 与 `systemStatusSchema` 的可选 `lastError`                                             |
| `packages/shared/src/connection.test.ts`、`packages/shared/src/mixer.test.ts`                                                                                                                        | 契约测试(带/不带 `lastError`、未知字段剥除、PUT body 越界拒绝、旧形状兼容)                                           |
| `apps/server/src/ember/ember-service.ts`                                                                                                                                                             | `lastError` 记录/保留/清空、`(status, lastError)` 去重、`connectFailureReason()`、过期连接尝试忽略                   |
| `apps/server/src/state/mixer-state-store.ts`                                                                                                                                                         | `connectionError`、按对去重、重连后首次同步必发快照                                                                  |
| `apps/server/src/runtime.ts`、`apps/server/src/ws/gateway.ts`、`apps/server/src/api/connection.ts`                                                                                                   | 状态透传、`system:status` 负载与连接时补发、REST 响应带 `lastError`                                                  |
| `apps/server/src/ember/ember-service.test.ts`、`state/mixer-state-store.test.ts`、`ws/gateway.test.ts`、`api/connection.test.ts`、`apps/server/tests/mixer.integration.test.ts`                      | 失败后出现 / 成功后清空 / 重配清空 / 过期尝试忽略 / 超时文案 / 网关与 REST 带出 / Mock Provider 空端口往返与重连快照 |
| `apps/web/src/lib/api-request.ts`                                                                                                                                                                    | views 与 connection client 共用的 fetch 包装与错误读取                                                               |
| `apps/web/src/lib/connection-api.ts`(+ `.test.ts`)                                                                                                                                                   | `ConnectionClient` GET/PUT 与响应校验;成功、400/500 message、非 JSON 兜底                                            |
| `apps/web/src/store/mixer-store.ts`、`apps/web/src/lib/socket.ts`(+ 测试)                                                                                                                            | `emberLastError` 与 `system:status` 解析                                                                             |
| `apps/web/src/components/ConnectionStatus.tsx`                                                                                                                                                       | 状态灯改为打开面板的按钮,live region 外置                                                                            |
| `apps/web/src/features/connection/connection-form.ts`(+ `.test.ts`)                                                                                                                                  | `parsePortInput`、`validateEndpoint` 与英文字段错误                                                                  |
| `apps/web/src/features/connection/use-modal-dialog.ts`                                                                                                                                               | 自绘模态行为(焦点进入/环绕/回归、Escape、滚动锁)                                                                     |
| `apps/web/src/features/connection/ConnectionPanel.tsx`(+ `.test.tsx`)                                                                                                                                | CONNECTION 面板与二次确认                                                                                            |
| `apps/web/src/features/mixer/empty-state.ts`(+ `.test.ts`)、`EmptyConsole.tsx`                                                                                                                       | 空态判定与渲染                                                                                                       |
| `apps/web/src/features/mixer/MixerPage.tsx`、`apps/web/src/features/settings/SettingsPage.tsx`、`apps/web/src/App.tsx`                                                                               | 面板接线、`onOpenConnection`、空态分流                                                                               |
| `apps/web/src/styles.css`                                                                                                                                                                            | 状态灯按钮、面板、空态与配置页空态样式                                                                               |
| `apps/web/tests/fake-connection-client.ts`、`apps/web/tests/connection.integration.test.tsx`、`apps/web/tests/mixer.integration.test.tsx`、`views.integration.test.tsx`、`apps/web/src/App.test.tsx` | 测试夹具与集成用例、既有断言按新文案更新                                                                             |
| `docs/architecture.md`                                                                                                                                                                               | 连接面板、`connection-api.ts`、`lastError`、`system:status` 时机、空态分流的当前状态描述                             |
| `docs/reports/phase-6-1-report.md`                                                                                                                                                                   | 本报告                                                                                                               |

## 6. 依赖清单与许可确认

无新增 npm 依赖。对话框、表单、按钮全部自绘,复用既有深色 token 与动效基线。云端冒烟用的 `playwright-core@1.52.0`(Apache-2.0)只安装在会话临时目录,不进入仓库;Mock Provider 启动脚本同样放在会话临时目录。

云端安装说明:本会话的 HTTPS 代理拒绝 `codeload.github.com`,`pnpm install --frozen-lockfile` 无法下载 `emberplus-connection` 依赖的 git-hosted `asn1`(`evs-broadcast/node-asn1`)tarball;本次通过 git 取得该提交并打成本地 tarball、临时改写 lockfile 指向本地文件完成安装,随后 `git checkout` 还原 lockfile,仓库无任何改动。GitHub Actions runner 不受此限制。

## 7. 关键决策与偏离

- **实施了后端扩展**,形状与提示词一致(可选字段、不改枚举与退避、不新增事件)。在此之外做了一项小延伸:网关在每个 socket 连接建立后紧随快照补发一次既有的 `system:status`——否则刷新页面后由于两层去重,`lastError` 在原因不变期间永远到不了前端,空态无法显示原因。
- **两处服务端修复超出"最小扩展"但属于验收所必需**(见第 3 节末):过期连接尝试的迟到失败会污染新连接的状态;重连后树未变不重发快照导致浏览器无法完成清单加载。前者是既有竞态,后者与 `architecture.md` 对 `mixer:snapshot` "重连后"发送的描述不符,均以独立 `fix(server)` 提交。
- **`lastError` 文案形态**:受库行为限制为超时文案而非 `ECONNREFUSED`(第 3 节)。未在本服务里拼接自定义文案,以保持"记录原始原因"的语义;面板与空态旁边都显示了当前 host/port。
- **`configure()` 不重置 `hasConnected`/`backoffMs`**(不动退避逻辑):曾成功连接过的服务改到错误地址后显示 `RECONNECTING` 而非 `CONNECTING`,文案上可接受,报告中如实说明。
- **面板开关状态放在 `App` 的 React state** 而非新建 zustand store:与既有 `onOpenSettings` prop 模式一致、两层传递、测试可注入,面板只渲染一次。
- **`ConnectionStatus` 的 live region**:按钮内容是其可访问名而非播报内容,因此 `role="status"` 移到外层包裹元素,旧的 `getByText('MIXER ONLINE')` 类断言不受影响。
- **配置页 `AVAILABLE CHANNELS` 空态**同步做了分流(提示词标注"可"),CTA 只打开面板。
- **`api-request.ts` 抽取**:为避免第三份 `readError`/`request` 复制,把 views client 的包装抽为共用模块,views 的错误文案保持不变。
- 无覆盖率排除项,未降低任何门槛;未改 `.github/workflows/ci.yml`;未改 `docs/development-plan.md` 与 `docs/fairlight-ember.md`。

## 8. 遗留问题与移交事项

- **用户需完成第 4 节真机验收**,重点确认:真机地址下 `lastError` 文案、`CONFIRM RECONNECT` 后真机断开重连不影响任何参数、重连后通道自动重新出现。
- **建议回写 `docs/fairlight-ember.md` 踩坑章节(由用户执行)**:`emberplus-connection@0.3.1` 的 `S101Client._onError` 静默吞掉 `ECONNREFUSED`,`connect()` 只会在库自身 `timeout`(秒,默认 5)后以 Error 解析;此外被 `discard()` 的客户端若正处于拨号中,其连接超时回调仍会调用 `connect()` 重新拨号(库内部 `connectTimeoutListener` 未检查 `_shouldBeConnected`),旧地址会在后台被周期性重拨,只是失败静默,无日志;本阶段只在服务层忽略过期尝试,未修改库。
- **契约缺口**:`mixer:snapshot` 不带 `lastError`,靠连接时补发的 `system:status` 弥补;`PUT /api/v1/connection` 的 400 message 是 zod 原始 issue 文本,可读性一般(前端已先行校验,正常操作不会触发);`system:status` 目前没有"配置已变更"的通知,其它已打开的页面只能通过状态变化间接得知地址已改。
- **Phase 7 环境变量种子值约定(本阶段未实现,复述)**:`EMBER_HOST` / `EMBER_PORT` 只在首次启动且 `data/` 无配置文件时作为种子值写入配置文件,之后一律以配置文件为准,UI 始终可改。
- **留给 6.2–6.5**:面板未做脏检测与导航守卫(6.2 范围);页头压缩为单行时(6.3)状态灯按钮的最小宽度与 hover 样式需一并调整,`:hover` 待 6.4 包进 `@media (hover: hover)`;6.5 的重连集成用例可直接复用本阶段的 `FakeConnectionClient`、`system:status` 补发与"重连后必发快照"行为。
- 初次加载且快照未到时,`emberStatus` 初值为 `disconnected`,`MIXER NOT CONNECTED` 可能在快照到达前闪现数十毫秒;冒烟中未观察到可见闪烁,如真机上明显可考虑为首个握手加"未知"态。

## 9. 提交记录

分支:`claude/phase-6-1-execution-emm7ad`。以下为本阶段新增提交(截至本报告落盘前,不含承载报告的提交):

```text
6987ffc fix(web): keep Escape and focus inside the connection panel while applying
ea7e00e fix(server): ignore stale connect attempts and resend a snapshot on reconnect
d3355ff docs: describe the connection panel and lastError
703e29b feat(web): split the mixer empty state by cause
1921319 feat(web): open a CONNECTION panel from the status lamp
991a356 feat(web): track the last Ember error in the mixer store
bf20b02 feat(web): add the connection REST client
9a24355 feat(server): expose the last Ember connect failure
ed4d340 feat(shared): add optional lastError to connection contracts
```

## 10. 评审与真机反馈后的修订

PR #13 的 Bugbot 评审与用户真机验收反馈后追加了以下修订(均已补测试并通过 CI):

- **Bugbot**:提交前清除过期的 `loadError`(否则 GET 失败的提示会盖住后续 PUT 的结果);提交期间把焦点停在对话框容器上,禁用 APPLY 不再让 Tab 逃出模态框。
- **真机反馈 1**:`Settings applied. Watching the mixer reconnect.` 改为琥珀 warning 样式——应用配置只是开始重连,结果未定,不再用绿色暗示成功。
- **真机反馈 1 补充**:该提示只在重连结果未定时显示,Ember 一旦 `connected` 即隐藏,再次掉线时重新出现。
- **真机反馈 2**:前端 host 校验加严(`isValidHost`):接受完整的 IPv4(每段 0–255)、IPv6 或 DNS 主机名(需含字母,标签只允许字母数字与连字符),`192.168.1`、`256.1.1.1` 之类直接就地报 `Enter a valid IP address or host name.`;端口仍须为 1–65535 的整数。服务端与 shared 契约保持 `host` 非空字符串,以免既有 `data/config.json` 因新规则加载失败回退默认值。
- **真机反馈 3(错误 IP 后改回正确 IP,首次 apply 停在重连、第二次才成功)**:云端用 Mock Provider + SYN 黑洞端口按同一序列(API 与浏览器面板两条路径)都能一次连上,未复现;但代码审读发现 `emberplus-connection@0.3.1` 对被 `discard()` 的客户端不会停止拨号:连接超时回调与 5 s 自动重连定时器都会再次调用 `connect()`,`disconnect()` 只 `end()` 不 `destroy()`,拨号中的 socket 完全不动。切换地址后,旧客户端会在后台继续拨真机,可能先于当前客户端占住 Fairlight 的连接并继续应答 keepalive,当前客户端的拨号因此挂起超时,直到旧连接被真机丢弃后的下一次尝试(或用户再点一次 apply)才成功。修订:`safeClose()` 与断线处理在 `discard()` 前捕获 S101 传输层,之后关闭其自动重连、把 `connect()` 置为空操作并 `destroy()` socket(`ember/retire-ember-client.ts`)。请用户在真机上重复该场景验证;若仍复现,请提供服务端日志中 `ember connect failed` 的 `err` 字段与两次 apply 的时间间隔。
