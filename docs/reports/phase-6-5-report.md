# Phase 6.5 执行报告 — 健壮性

## 1. 结果总览

| 项 | 状态 |
| --- | --- |
| 1. 后端重连集成用例(7 条) | 完成 |
| 2. 前端重连集成用例(6 条) | 完成 |
| 3. 离线命令不排队(修复 + 3 条单测) | 完成 |
| 4. soak 工具(`cdp.ts` / `soak-signal.ts` / `soak-report.ts` / `soak.ts`) | 完成 |
| 5. `.github/workflows/soak.yml` | 完成,CI 短跑成功,见第 6 节 |
| 6. 文档(`architecture.md` / `conventions.md` / `index.html`) | 完成 |
| 3 分钟冒烟 | 完成,两种 churn 都恢复,判定 `inconclusive` |
| 60 分钟实跑 | 见第 5 节 |
| 计划外的修复:总线目录探针泄漏定时器 | 完成,soak 发现,见第 4.6 节 |
| 计划外的修复:CI 上的浏览器参数解析 | 完成,CI 短跑发现,见第 4.7 节 |
| 真机长时间运行验收 | **移交用户**,清单见第 8 节 |

本批次全程在用户开发机上执行,没有连过真实 Fairlight,没有占用 3000 与 5173。

质量门(串行,全部实际跑过):

```
pnpm lint (eslint . && prettier --check .)                        成功
pnpm typecheck (shared + test-utils + server + web)               0 error
pnpm test (shared 44 / test-utils 22 / server 235 / web 496)      全绿
pnpm build                                                        成功
git status --short pnpm-lock.yaml                                 无改动
```

用例数变化:

| 包 | 改动前 | 改动后 | 净增 |
| --- | ---: | ---: | ---: |
| `packages/shared` | 44 | 44 | 0 |
| `packages/test-utils` | 22 | 22 | 0 |
| `apps/server` | 143 | 235 | +92 |
| `apps/web` | 487 | 496 | +9 |

覆盖率:

| 包 | 指标 | 改动前 | 改动后 |
| --- | --- | ---: | ---: |
| `apps/server` | Statements | 92.51% | **94.59%** |
| | Branches | 85.77% | **86.68%** |
| | Functions | 96.28% | **97.16%** |
| | Lines | 92.46% | **94.53%** |
| `apps/web` | Statements | 96.93% | 96.94% |
| | Branches | 92.44% | 92.47% |
| | Functions | 98.92% | 98.92% |
| | Lines | 96.89% | 96.90% |

三个新增 soak 模块各自的行覆盖(要求 ≥ 90%):`cdp.ts` **100%**、`soak-signal.ts` **100%**、`soak-report.ts` **99.54%**。覆盖率排除项只多了 `src/tools/soak.ts` 一条。

## 2. 验收标准逐条核对

| # | 标准 | 结果 |
| --- | --- | --- |
| 1 | 后端 7 条重连用例全绿;第 6 条的四个监听器计数与 patch 计数是真实断言;既有 6 例改 import 后全绿 | **通过**。第 6 条先断言绝对值 `{status:1, tree:1, patch:1, snapshot:1}` 再断言 5 轮后相等;patch 用 200 ms 静默窗口断言恰好一条。既有 6 例断言一字未改 |
| 2 | 前端 6 条重连用例全绿;第 1 条断言 `article` 节点同一;第 2 条断言 `emitted` 里没有离线期间的 `control:set-level` | **通过**。四条用例都断言了节点同一,并实际验证过它们能红(第 3 节) |
| 3 | `socket.test.ts` 新增 3 条全绿;`createBrowserSocket` 对带回调的 `emit` 确实调用了 `timeout()` | **通过** |
| 4 | 三个 soak 模块单测全绿且各 ≥ 90% 行覆盖;3 分钟冒烟两种 churn 都恢复;60 分钟实跑完成;`soak-reports/` 已忽略 | **通过**,见第 1、5 节。仓库里没有样本文件 |
| 5 | `soak.yml` 手动触发 3 分钟短跑成功,artifact 可下载;`ci.yml` 无 diff | **通过**,但触发方式与提示词不同,见第 6 节 |
| 6 | 全量质量门全绿,远端 CI 全绿,lockfile 无 diff,覆盖率排除只多一项 | **通过** |
| 7 | 全程没有碰真实 Fairlight,没有动 3000 / 5173 | **通过**。所有 Provider 与 server 都用 `findFreePort()`;开始前确认过 3000/5173 空闲,全程未占用 |

## 3. 实现摘要

### 3.1 后端夹具抽取(`apps/server/tests/mixer-stack.ts`)

`writeConfig` / `waitFor` / `emitAck` 没有闭包依赖,做成模块级导出;`startStack` / `connectClient` / `cleanup` 用 `createStackHarness()` 工厂,并**把 `providers` / `servers` / `sockets` 三个数组原样暴露**——既有第 4、5 例自己往里 `push`,暴露之后它们的函数体一个字都不用动。

`StartStackOptions` 是既有 `{ incompleteStripRetryMs? }` 的全可选超集,三个既有调用点在结构化类型下天然兼容。新增 `httpPort`(同端口重启)、`providerPort`(同端口重开)、`clientOptions`(调小重连延迟)、`timeoutMs`(见第 7 节偏离 1)与 `busDirectoryPollMs`(探针用例需要)。

`cleanup()` 用 `Promise.allSettled` 而不是既有的 `Promise.all`:重启用例会在测试中途自己关掉一个 server,teardown 再关一次不能因此放弃后面的清理。

### 3.2 后端重连用例(`apps/server/tests/reconnect.integration.test.ts`)

7 条,`describe` 级超时 20 s(**是每条用例的超时,不是整块预算**;实际单条最长约 3 s,整文件约 7 s)。

有两件事必须比看上去更小心地建模,两条都不是产品缺陷而是模拟方式的问题——与 6.4 报告 15.3 节踩的是同一类坑:

- **Provider 关掉不等于 Provider 消失。** `MockEmberProvider.close()` 走到 `S101Server.discard()`,它只关监听套接字;按 Node 的规则,已经建立的连接原封不动。服务端会继续握着一条通往「已经不在」的 Provider 的活 socket,永远不会重连。`unplugProvider()` 先把连接拔掉再停监听,这才是掉电的样子。
- **服务端关掉也不等于服务端消失**,至少浏览器不这么认为。`app.close()` 是优雅关闭,Socket.IO 把它读作「别等我」:客户端把它记成自己主动断开(`io client disconnect`),**按设计不再重拨**。所以重启用例先丢弃传输层、再关服务端,这才是机器断电的顺序。

用例 2 与 5 用 `socket.io.on('reconnect')` 计数做「不是靠客户端重新 `connect()` 得到的」的精确锁:Manager 的这个事件只为客户端自己发起的重拨而发,手工 `connect()` 不发。

用例 4 取的是提示词给的第二个选项(`reconnection: false`,等 `store.connection` 回到 `connected` 后手工 `connect()`),确定且零 flake;「自动重连」本身由用例 2 与 5 证明。

**用例 6 的断言边界必须说清楚。** 提示词要求「`pushParameter` 一次 meter 后下一帧里该通道恰好出现一次」,最初就是这么写的,在本地全绿——**CI 上红了**:同一个值被投递了两次,跨越了 `MeterHub` 50 ms 的 flush 边界,于是收到两帧。这暴露了断言本身的问题:`MeterHub` 按 id 存 Map 并在每次 flush 后清空,**同一通道在一帧里永远不可能出现两次,重复订阅会被这层 Map 吃掉而不是暴露出来**;一次推送产生几帧则纯粹取决于机器快慢,数帧数就是在测时钟。改成断言「电平仍在到达」+「没有任何一帧携带同一通道两次」,并在注释里写明它能证明什么、不能证明什么。真正拦住重复订阅的是 `safeClose()` 里的 `resetWatches()`,看得见的证据是那四个 `listenerCount`;patch 的「恰好一条」断言则是稳的,因为 `patchChannel` 按值去重。

### 3.3 前端重连用例(`apps/web/tests/reconnect.integration.test.tsx`)

6 条,4 个同 kind 通道恰好两页(见第 7 节偏离 2),每条用例加载完先断言 `1 / 2` 当哨兵。

四条用例用 `toBe()` 断言条带是**同一个** `article` 元素,不是同名的另一个。**三组回归锁都实际验证过能红**:

- 把 `emitWithAck` 的离线短路改成恒假 → 「拖动中掉线」那条变红;
- 给无 view 路径的 `key` 加随机数强制重挂 → 四条变红;
- 给 view 路径的 `key` 加随机数 → 第 1 条变红。

用例 2 不用假定时器:离线短路不创建 5 s 计时器,`findByRole('alert')` 的 1 s 默认超时远在 notice 的 4 s 自动清除之前。用例 6 用本文件内的 `SilentAckSocket`(选定事件只记录不回 ack),不碰被十几个文件共用的 `tests/fake-socket.ts`。

### 3.4 离线命令不排队(`apps/web/src/lib/socket.ts`)

缺陷是两件事叠起来的:socket.io-client 在未连接时把 emit 缓冲进 `sendBuffer` 并在重连后原样补发(已核对 4.8.3 源码 `socket.js:262-271`);而 `Fader.tsx` 的 `handlePointerMove` 在 `disabled` 时会退出,`finishPointer`(L336-359)**却不检查 `disabled`**,松手照样 `onCommit`。合起来:推子拖动中 socket 掉线、松手,那条 `control:set-level` 进了缓冲,前端自己的 5 s 超时早把 UI 回滚了,而命令会在重连后**在没人碰平板的时候真的动台子**。

修法两处:`emitWithAck` 在 `socket.connected` 为假时直接以 `OFFLINE` 回执失败,不调 `emit`;`createBrowserSocket().emit` 对带回调的调用走 `socket.timeout(ACK_TIMEOUT_MS)`,超时的包会被库从 `sendBuffer` 里删掉。**不做重连后重放**——重放过期电平是事故,不是功能。

`emitWithAck` 自己的 5 s 计时器保留:`MixerSocket` 是接口,`FakeSocket` 与手写双替都没有 `timeout()`,两个计时器覆盖的是不同实现、保证的是不同的事(库的计时器删包,promise 的计时器保证调用方拿到回执),结果一致、`settled` 防重复。

### 3.5 soak 工具

四个文件,零新增依赖。

- **`cdp.ts`** — 极简 CDP 客户端。soak 只需要浏览器做四件事:读堆与 DOM 计数、读页面、按一个键、先收一次垃圾。这是一个 WebSocket 上的几个调用,Node 22 自带 `WebSocket`,不值得为此装一个浏览器自动化库。`WebSocket` / `spawn` / `fetch` / `exists` 都是可选注入点,默认指向真实实现,驱动一个都不传。两处是承重的:响应按自增 id 关联(协议允许乱序应答),以及**关闭时一律 reject 待决 Promise、关闭后的 `send` 立即 reject**,这样收尾时在途的采样调用会结束而不是把进程吊住。
- **`soak-signal.ts`** — 合成节目。soak 值不值这一小时,取决于 UI 是不是在做演出现场会做的事,所以信号要走到电平表的每个分支:安静的主体、警告带、以及能让削波指示**锁存**的峰。峰是 0.6 s 的平台不是尖峰,因为 `meter-store.ts:45-47` 要连续两帧 ≥ 0 才置 `clipping`,20 Hz 下是 100 ms。周期与峰位按通道错开,否则 20 条通道会同步重绘,渲染成本等于一条。
- **`soak-report.ts`** — 统计与判定。soak 问的不是「用了多少内存」,而是「一小时后它还是不是同一个程序」,所以每个指标都读作两个等长窗口的比较。三条判定规则值得写明:断连没恢复在**任何**时长下都是 `fail`(时长不能为「混音台一直黑着」开脱);短到装不下两个窗口的运行是 `inconclusive` 而不是 `pass`;所有阈值都是排他的,**恰好等于阈值算通过**。
- **`soak.ts`** — 驱动(唯一新增的覆盖率排除项)。单循环 250 ms tick 调度采样、翻页、churn 三个 job,每个都 `await` 到位,慢的往返只会推迟下一拍而不会堆叠;只有电平喂送用 `setInterval`(纯同步、极廉价)。

**附着模式为什么是只读的**(这是它敢对着真实台子跑的全部理由):它不构造 control client、不发任何 socket 事件;只碰 `Performance` / `HeapProfiler` / `Runtime` / `Input` 四个 CDP 域;页面探针是一段**没有任何插值**的固定字符串,只读 `dataset`、`textContent` 和 `querySelectorAll().length`,不调用应用自己的任何函数;唯一注入的输入是翻页键,且**每次按键前**都确认 `document.activeElement === document.body`——推子聚焦时 PageUp/PageDown 是 ±10 dB。从这里到 `control:*` 没有任何通路。这段话同时写在 `soak.ts` 的模块注释里。

### 3.6 计划外修复一:总线目录探针泄漏定时器

**soak 的第一次冒烟就找到了一个真实缺陷。** 服务端 `activeHandles` 每 10 秒精确 +5,3 分钟里从 21 涨到 102,完全线性——每 2 秒 +1,正好是 `DEFAULT_BUS_DIRECTORY_POLL_MS`。

根因:`reconcileMixerStripsIfConnected` 的 `finally` 只在 `disconnect()` 失败时才 `discard()`。而 `EmberClient` 在构造函数里起了一个重发 interval(`Ember/Client/index.js:57`),**只有 `discard()` 会清**(第 114 行)。于是每个干净断开的探针都留下一个活定时器,生产的 2 秒轮询下一小时 1800 个。

按「先写失败用例、再修」的规矩处理:`tests/strip-probe.integration.test.ts` 数的是**定时器**不是 socket(socket 数始终不变,泄漏的从来不是它),在修复前的代码上 10 轮探针恰好多 10 个定时器而变红。修法是无论 `disconnect()` 成功与否都 `discard()`,并像 `safeClose()` 那样走 `retireEmberTransport`。修复后冒烟里句柄恒定在 15。

### 3.7 计划外修复二:CI 上的浏览器参数解析

`soak.yml` 的第一次 CI 运行失败,报 `--browser-args needs a value`。shell 在传参时剥掉了引号,`--browser-args "--no-sandbox"` 到达进程时是两个普通 token,而 `parseFlagArgs` 把「下一个 token 以 `--` 开头」读作「本标志没有值」。本地从没传过这个参数,所以只有 CI 能发现。

修法:`--browser-args` 按位置取值。soak 的参数解析同时从 `soak.ts` 移到 `cli-args.ts`,和 `parseDumpTreeArgs` / `parseVerifyEmberArgs` 放在一起——驱动本身是覆盖率排除项,这种逻辑该待在有测试的地方。补了 9 条单测,其中一条就是 CI 上失败的那个 argv。

## 4. 数值初值清单

本批次新增的全部常量。**这些是实测后定的初值,不是规范**;调整它们是用户的事,本批次没有自行调过任何一个。

### `apps/server/src/tools/soak-report.ts` — 判定阈值

| 名称 | 值 | 含义 |
| --- | ---: | --- |
| `SOAK_WARMUP_MINUTES` | 10 | 热身多久之后才开始相信数字 |
| `SOAK_WINDOW_MINUTES` | 10 | 用来比较的两个窗口各多长 |
| `SOAK_HEAP_GROWTH_MAX_BYTES` | 10 MiB | 浏览器 JS 堆允许的绝对增长 |
| `SOAK_HEAP_GROWTH_MAX_RATIO` | 0.2 | 浏览器 JS 堆允许的相对增长 |
| `SOAK_DRIFT_MAX_RATIO` | 0.05 | DOM 节点数与事件监听数允许的双向漂移 |
| `SOAK_SERVER_HEAP_GROWTH_MAX_BYTES` | 20 MiB | 服务端堆允许的增长 |
| `SOAK_HANDLE_DRIFT_MAX` | 4 | 服务端活动句柄数允许的变化(计数差,非比例) |
| `SOAK_CHURN_RECOVERY_MS` | 30 000 | 一次断连之后必须在多久内回到 `MIXER ONLINE` |

### `apps/server/src/tools/cli-args.ts` — 运行节奏(全部可由命令行覆盖)

| 名称 | 值 | 命令行 | 含义 |
| --- | ---: | --- | --- |
| `SOAK_DEFAULT_MINUTES` | 60 | `--minutes` | 运行时长 |
| `SOAK_SAMPLE_INTERVAL_S` | 30 | `--sample-seconds` | 采样间隔 |
| `SOAK_PAGE_TURN_INTERVAL_S` | 5 | `--page-seconds` | 翻页间隔 |
| `SOAK_CHURN_INTERVAL_MINUTES` | 10 | `--churn-minutes` | 断连间隔,`0` 关闭 |
| `SOAK_METER_HZ` | 20 | `--meter-hz` | 电平喂送频率 |

### `apps/server/src/tools/soak.ts` — 驱动内部

| 名称 | 值 | 含义 |
| --- | ---: | --- |
| `SOAK_EMBER_OUTAGE_MS` | 5 000 | Ember churn 时 Provider 离开多久再回到原端口 |
| `SOAK_TICK_MS` | 250 | 主循环多久醒一次看有没有到期的任务 |
| `SOAK_RECOVERY_POLL_MS` | 500 | 多久问一次页面「回来了没有」 |
| `SOAK_OUTAGE_OBSERVE_MS` | 4 000 | 一次断连有多长时间可以「上屏」,超过就记为没观测到 |

### `apps/server/src/tools/cdp.ts`

| 名称 | 值 | 含义 |
| --- | ---: | --- |
| `SOAK_BROWSER_LAUNCH_TIMEOUT_MS` | 15 000 | Chrome 多久内必须打印出调试地址 |

### `apps/server/src/tools/soak-signal.ts` — 合成节目

| 名称 | 值 | 含义 |
| --- | ---: | --- |
| `SOAK_SIGNAL_MIN_DB` / `SOAK_SIGNAL_MAX_DB` | −60 / 0 | 信号允许的取值范围 |
| `SOAK_SIGNAL_PERIOD_S` | 20 | 一个通道多久走完一个周期 |
| `SOAK_SIGNAL_PERIOD_STAGGER_S` | 0.7 | 每条通道周期比上一条长多少 |
| `SOAK_SIGNAL_PEAK_STAGGER_S` | 1.3 | 每条通道的峰比上一条晚多少 |
| `SOAK_SIGNAL_PEAK_WINDOW_S` | 0.6 | 峰持续多久(20 Hz 下 12 帧,削波锁存只要 2 帧) |
| `SOAK_SIGNAL_PEAK_DB` | 0 | 峰的高度,恰好是削波点 |
| `SOAK_SIGNAL_FLOOR_DB` / `SOAK_SIGNAL_CEILING_DB` | −40 / −6 | 非峰段扫过的区间 |
| `SOAK_SIGNAL_NOISE_DB` | 1.5 | 叠在扫描上的峰峰值噪声 |
| `SOAK_LOUDNESS_PERIOD_S` | 120 | 响度漂移一个来回的周期 |
| `SOAK_LOUDNESS_MIN_LUFS` / `SOAK_LOUDNESS_MAX_LUFS` | −26 / −20 | integrated 的漂移区间 |

### `apps/web/src/lib/socket.ts`

| 名称 | 值 | 含义 |
| --- | ---: | --- |
| `ACK_TIMEOUT_MS` | 5000 | 本批次把它**导出**,值未改;现在同时用于传输层超时与 promise 超时 |

### 测试内部常量(不影响产品)

`reconnect.integration.test.ts` 的 `SHORT_EMBER_TIMEOUT_MS = 1000`(等一次拨号放弃)、`QUIET_WINDOW_MS = 200`(静默窗口)、`FAST_CLIENT` 的 `reconnectionDelay: 50 / reconnectionDelayMax: 100`;`strip-probe.integration.test.ts` 的 `PROBE_INTERVAL_MS = 200`。

## 5. soak 实跑结果

<!-- 60 分钟实跑数据待填 -->

## 6. CI 短跑

提示词要求用 `gh workflow run soak.yml -f minutes=3` 触发。**这条路在合并前走不通**:GitHub 要求 `workflow_dispatch` 的 workflow 文件先存在于**默认分支**才能被 API 看到,在 PR 分支上触发一律 404。

为了让这项验收真的完成(而不是留到合并后),做法是:临时给 `soak.yml` 加一个只匹配自身路径的 `push` 触发器,在分支上跑一次,验证通过后再用一个提交把触发器移除,最终状态与提示词要求的纯 `workflow_dispatch` 一致。三个提交在历史里都有,原因写在提交信息里。

这条临时路径立刻兑现了价值——**第一次运行就抓到了 3.7 节那个参数解析缺陷**,否则它会一直留到用户合并之后第一次手动触发时才炸。

修复后的运行结果:

| 项 | 结果 |
| --- | --- |
| Run | [34886486952](https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/34886486952) |
| Runner | `ubuntu-latest` |
| 浏览器 | `/usr/bin/google-chrome`(由 `$CHROME_BIN` 指定) |
| 上线耗时 | 814 ms |
| 运行时长 | 3 分钟,6 个样本 |
| 判定 | `inconclusive`(预期:不足 30 分钟),退出码 0 |
| Artifact | `soak-report`,已实际下载验证,含 `report.md` 与 `samples.json` |

`ci.yml` 一字未改(`git diff main -- .github/workflows/ci.yml` 为空)。

## 7. 关键决策与偏离

1. **`startStack` 多了一个 `timeoutMs` 选项**(提示词只列了三个)。用例 1 必须等一次 connect 拨号放弃才有 `lastError`,默认的 3000 ms 太贵;重连用例用 1000 ms,默认值不变,既有调用点行为零变化。
2. **前端分页视口是 299 px 不是提示词写的 350 px**(`stub-mixer-layout.ts`:`2×125 + 1 + 2×24`)。内容盒 251 恰好是两条同 kind 的 125 px 条带加 1 px 间隙;跨 kind 要多付 `SEGMENT_GAP_PX = 14` 就溢出。所以用 4 个 `kind: 'channel'` 的通道得到确定的两页,并在每条用例开头断言 `1 / 2` 当哨兵,而不是依赖「默认视口给 2 页」。
3. **`MockEmberProvider.port` 在 `close()` 后会抛**,同端口重开一律先把端口存进变量。
4. **用例 7 的「Provider 上的值没变」改了写法**:`close()` 之后 `getParameter()` 一律返回 `undefined`,照字面写不出来。改成断言「`store` 的电平未动」+「同端口复活后 Provider 上仍是原值」,后者同时证明了没有命令排在失败后面。
5. **前端用例 6 按实际行为断言**。提示词说「5 s 后它以 `TIMEOUT` 收场并回滚」,但按提示词给的顺序,重连快照先清了 `pendingOns`,迟到的 `TIMEOUT` 让 `finishOnInteraction` 直接早退——**根本不会回滚、也不写 notice**。终态正是提示词想要的(快照胜出),断言按代码实际行为写。
6. **`soak.yml` 的命令用 `run` 且不带 `--`**。实测 `pnpm --filter @flwc/server soak -- --minutes 3 --browser-args "--no-sandbox"` 会吞掉第一个标志(只剩 `["3", "--browser-args", "--no-sandbox"]`);`pnpm --filter @flwc/server run soak --minutes 3 ...` 原样转发全部 token。
7. **`report.md` 输出英文**(用户拍板)。源码字符串一律英文,`soak-reports/` 不进仓库,本报告引用它的表格。
8. **`renderMarkdown` 区分「翻页看到的页码」与「采样时刻的页码」**。采样间隔是翻页间隔的整数倍时,每次采样都落在同一相位、永远报同一个页码——这是采样别名不是分页卡死,所以驱动另外记录翻页实际到过的页,报告里分开说。
9. **churn 的恢复时间从「中断上屏」起算**。客户端察觉传输层断开需要一点时间,断完立刻读页面会看到页头还是 `MIXER ONLINE`,socket churn 因此一度记成 1 ms——那测的是轮询不是混音台。现在先等中断出现再计时,并把「是否真的看到中断」如实记进报告。
10. **`summarize` 对过短运行的退化处理**(提示词未规定):样本全落在热身内时,用首样本与末样本顶替两个窗口,`complete` 为假。这样 3 分钟冒烟也有数字可看,而判定与报告都写明「这不是窗口均值」。
11. **`cleanup` 用 `Promise.allSettled`** 而非既有的 `Promise.all`,理由见 3.1。

## 8. 真机验收操作清单(移交用户)

**安全约束**(照抄 6.4 报告第 6 节):本批次改的是重连行为、一条离线命令的语义与一个测量工具,不会主动改动 Fairlight 任何参数;验收过程中**不要操作混音页推子**;如确需操作,**只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子并测后复原**;不得切 ON/mute、不得动其它通道、不得删改任何通道。凡是要按 ON 的地方**一律不要真的按**——只看有没有被误触发,误按了立刻按回去并记下来。

**附着模式对台子是只读的**:它不发任何控制事件,只翻页与读 DOM(理由见第 3.5 节)。但**拔线验收期间请不要操作推子**——那段时间正是要观察「无人干预时它自己怎么恢复」。

### ① 用附着模式对自己的 `pnpm dev` 跑一小时

在开发机上,先照常起服务:

```
pnpm install --frozen-lockfile
pnpm build           # 附着模式看的是 5173 的 dev server,这步只是确保依赖装好
pnpm dev             # server 3000 + web 5173,连着真机
```

另开一个终端跑附着模式(它不起任何服务,只开一个 headless Chrome 看着 5173):

```
pnpm --filter @flwc/server run soak --minutes 60 --url http://localhost:5173/ --out soak-reports/desk
```

注意 `--url` 用 `localhost` 而不是 `127.0.0.1`:Vite 只监听 IPv6 的 `localhost`(`AGENTS.md` 的 Cursor Cloud 一节)。

一小时后看 `soak-reports/desk/report.md`:

| 看什么 | 期望 |
| --- | --- |
| 顶部 `Verdict` | `pass`。若是 `fail`,「Failed checks」会逐条列出原因 |
| `JS heap used` 的 Change | 增长不超过 10 MiB 且不超过 20% |
| `DOM nodes` / `JS event listeners` 的 Change % | 绝对值不超过 5% |
| `JS heap slope` | 接近 0。持续为正且可观,说明有泄漏 |
| Server 一节 | 显示 `n/a` —— 附着模式不测别人的服务端,这是预期 |
| `Wake lock states seen` | 在局域网地址下应当是 `active`(走视频降级路径);`localhost` 是安全上下文,会走原生 API |
| 有没有 offline 样本 | 判定里若出现「the desk read offline at …」,说明这一小时里台子掉过线,需要看时间点对应发生了什么 |

### ② 平板照常使用一小时,期间断一次

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 平板打开 `http://<开发机 IP>:5173`,确认页头 `MIXER ONLINE`,照常翻页使用 | 一小时里操作始终跟手 |
| 2 | 中途**拔一次台子的网线**(或重启一次 `pnpm dev`) | 页头变为 `EMBER RECONNECTING` 或 `SOCKET OFFLINE`;**条带不消失**、页码不变、当前 view 不变;推子与 ON 变为禁用;电平表冻结;常亮随之放手 |
| 3 | 插回网线(或等 `pnpm dev` 起来),**不要碰平板** | 自己回到 `MIXER ONLINE`;推子重新可用;电平表恢复跳动;常亮自己接管;**页码、view、CONTROL LOCK 都还是断线前的那个** |
| 4 | 断线期间试着拖一下推子(只在那四个允许的通道上) | 推子禁用拖不动;若松手时正好断线,应当看到一行 `The mixer is offline.` 提示,电平回到拖动前的值,**台子上的值不动**。恢复后也**不应该**突然跳到断线时拖到的位置——这正是本批次修的那个缺陷 |
| 5 | 一小时后 | 触屏与鼠标操作是否仍然跟手?有没有变卡、变迟钝 |

第 4 条是本批次修复的端到端验证,也是唯一需要碰推子的一条:**做完请把电平复原到验收前的值**。

## 9. 被改写的既有用例清单

| 文件 | 改动 | 是否触及断言意图 |
| --- | --- | --- |
| `apps/server/tests/mixer.integration.test.ts` | 只改顶部 import 与 `afterEach` 接线,6 例函数体一字未动 | 否 |
| `apps/server/src/tools/cdp.test.ts` | 本批次新建,期间给假 child process 补了 `destroy` / `unref`,以跟上 `kill()` 释放 stderr 管道的改动 | 否(夹具跟进) |
| `apps/web/src/lib/socket.test.ts` | `socketIoMock` 补 `timeout: vi.fn(() => socketIoMock)`;5 条既有用例一字未动 | 否(夹具调整) |

`apps/server/src/tools/soak-report.test.ts` 有一条用例在加入 `outageObserved` 时改了断言,但那是本批次自己的用例,不是既有用例。

## 10. 评审后的修订

Cursor Bugbot 在 `8016d4a` 上给出 **1 条 finding**,成立,已修。

### 10.1 Chrome leaks if target list fails(Medium)

**finding**:`launchChrome` 在 `/json/list` 没有 page 时会 kill 掉 Chrome,但 `fetch` 或 `json()` 抛异常时不会——而此时进程已经 spawn;`soak.ts` 又只在 `launchChrome` 返回之后才拿到 `kill` 句柄,所以收尾也够不着那个子进程。

**判断**:成立,两半都对。被遗弃在这里的浏览器是**永久**遗弃——没有任何其它东西知道它的存在;在 Windows 上它还会一直占着自己的 profile 目录不放,而 soak 的收尾正要删那个目录。

**复现用例(先写,确认变红)**:`cdp.test.ts` 新增两条——「target list 取不到」(假 `fetch` 抛 `ECONNREFUSED`)与「target list 不是可解析的 JSON」(`json()` 抛)。两条在修复前的代码上都以 `expected "vi.fn()" to be called at least once` 变红。

**改法**:spawn 之后的所有步骤包进 `try/catch`,异常时先 `child.kill()` 再原样抛出。注释写明了为什么这里必须自己收尾:调用方在函数返回前没有句柄。

**回归锁**:上面那两条用例。`cdp.ts` 行覆盖仍为 100%,用例数 30 → 32。

处理完之后又等了一轮,没有新的 finding。

## 11. 依赖清单

**无新增依赖,`pnpm-lock.yaml` 无 diff。** CDP 客户端用 Node 22 内建的 `WebSocket` 与 `node:child_process` 自写;没有装 `playwright-core`、`puppeteer` 或 `ws`。

## 12. 遗留问题与移交事项

1. **60 分钟实跑的判定见第 5 节**;若为 `fail`,处理情况写在那一节。
2. **真机长时间运行验收移交用户**,清单见第 8 节。这是开发计划 6.5 验收框里「本地对真实 Fairlight 长时间运行(≥1 小时)无内存泄漏、无断连不恢复」与「触屏与鼠标操作均流畅」两条。
3. **soak 的阈值是初值**。第 4 节的 8 个判定阈值基于本机一次 60 分钟实跑定下,换机器或换浏览器版本可能需要调整。调整方式是改 `soak-report.ts` 的导出常量,不是放宽判定逻辑。
4. **`workflow_dispatch` 要合并后才能用**。`soak.yml` 进入默认分支之后,`gh workflow run soak.yml -f minutes=60` 才会工作(原因见第 6 节)。合并后建议手动触发一次 60 分钟的跑,确认 runner 上的长跑也通过。
5. **探针泄漏修复值得在真机上复核**。第 3.6 节的修复是对着 Mock Provider 验证的;真机的总线目录更大、探针耗时更长,建议在附着模式那一小时结束后看一眼 `pnpm dev` 那个 server 进程的内存有没有异常增长。
6. **6.3 的触控板复测仍未安排**,与本批次无关,继续挂着。

## 13. 提交记录

| # | 提交 | 内容 |
| --- | --- | --- |
| 1 | `test(server): extract the mixer integration stack harness` | `tests/mixer-stack.ts`,既有文件只改 import |
| 2 | `test(server): cover Ember and socket reconnection end to end` | 7 条重连用例 |
| 3 | `fix(web): fail control commands while the socket is down` | 离线短路 + `timeout()` 包装 + 3 条单测 |
| 4 | `test(web): cover reconnect state retention and offline commits` | 6 条前端用例 |
| 5 | `feat(server): add a minimal CDP client for the soak driver` | `cdp.ts` + 单测 |
| 6 | `feat(server): add the soak level and loudness signal` | `soak-signal.ts` + 单测 |
| 7 | `feat(server): add soak statistics and the pass/fail verdict` | `soak-report.ts` + 单测 |
| 8 | `fix(server): discard the strip probe client instead of only disconnecting it` | 定时器泄漏修复 + 失败用例 |
| 9 | `feat(server): add the soak driver` | `soak.ts`、脚本、覆盖率排除、`.gitignore` |
| 10 | `fix(server): time a churn recovery from when the outage reached the screen` | churn 测量修正 |
| 11 | `ci: add a manually triggered soak workflow` | `soak.yml` |
| 12 | `docs: describe reconnect behaviour and the soak tool` | 三份文档 |
| 13–14 | `ci: temporarily run the soak workflow on push …` / `… widen the temporary soak trigger …` | 临时触发器,见第 6 节 |
| 15 | `fix(server): read the browser arguments by position, not as a flag value` | CI 发现的参数解析缺陷 |
| 16 | `ci: restore the soak workflow to dispatch only` | 移除临时触发器 |
