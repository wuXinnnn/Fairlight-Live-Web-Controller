# Phase 6.4 执行提示词 — 触屏审计

> 用法:将本文档全文作为执行会话的任务提示词。**本批次的执行会话运行在用户的本地开发机上**(Windows 11,不是以往的云端环境),开发机正连着真实 Fairlight Live,而你没有任何触屏设备。任务来源是 `docs/development-plan.md` 的 6.4 一节,细节以本文档为准;两者冲突时以本文档为准并在报告里指出。工作在远端分支与 PR 上进行,你要跟进 GitHub CI 与 Cursor Bugbot 的评审意见(见「本地执行边界」与「分支、PR 与评审监控」)。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,平板与手机上的真机验收由用户完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(**第一条「本地测试安全」在本批次直接适用于你**;新增依赖的许可要求)
2. `docs/development-plan.md` — Phase 6 总述、6.4 一节全文,以及「云端 Agent 开发边界」(其中「真机手动验收始终是本地步骤」这一条对你同样成立:验收由用户做,不由你做);同时浏览 6.3(本批次建立在它的分页、安全区与手指翻页之上,**不得改动其语义**)与 6.5(重连与 soak 不属于本批次)
3. `docs/architecture.md` — 「前端结构」里「混音页分页」「滚轮」「触摸翻页」「推子拖动」「电平表绘制」五段,以及配置页 DnD 与 FLIP 的描述;本批次要在这一节追加内容
4. `docs/conventions.md` — 目录结构、命名、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/reports/phase-6-3-report.md` — 上一批次执行报告,重点第 5 节(真机验收清单的写法与安全约束)、第 10 节(Bugbot 评审意见的处理与记录方式)、第 6 节与第 14 节(合成电平服务与 Playwright 浏览器实测的做法,**第 14 节正是在这台开发机上做的**,端口、浏览器与数据源的安排本批次照搬)、第 11 节(遗留)与第 12.7 节(手指翻页的三条安全性质,本批次不得破坏)
6. `docs/prompts/phase-6-3.md` — 上一批次的提示词,本批次沿用其「硬性约束」;它的「云端执行边界」由下面的「本地执行边界」取代

## 代码现状(已确认,直接复用)

- **分页与手指翻页(6.3 已完成,本批次不重开)**:`MixerPage.tsx` 在 `.mixer-deck` 上挂 `touchstart` / `touchmove`(passive)与 `touchend` / `touchcancel`(非 passive),手指位移喂进与滚轮共用的 `reducePageWheel` 累加器,阈值、静默与冷却全部沿用滚轮常量,没有第二套节奏;安全区 `.page-rail` 上的手指永远直接翻页,通道条区在页可滚时先滚到底再翻;`touchstart` 只受理单指、且起点不在 `[data-wheel="level"]` 内的触摸;翻过页的手势在 `touchend` 上 `preventDefault`,免得顺手按下松手处的 ON 或翻页键。这三条安全性质各有一条用例(`apps/web/tests/mixer-touch.integration.test.tsx`,八例)。`PageRail.tsx` 的 `[data-swipe-surface]` 轨道已经是手指翻页的一部分,不再是空接口。**计划里「最小位移与速度阈值」「一次手势只翻一页」这两句已被 6.3 的决策取代**:手指与滚轮共用首翻 60px / 同手势续翻 120px / 静默 150 ms / 冷却 180 ms,同一手势可以续翻;本批次不加速度阈值,不改这些数。
- **滚轮**:`lib/wheel-gesture.ts` 归属模块、`lib/fader-wheel.ts` 与 `lib/page-wheel.ts` 两个 reducer、`wheel-gestures` 2.3.0(MIT,6.3 本地收尾时有意引入,用于触控板惯性判定)。触控板翻页的真机复测仍是 6.3 的未完项,由用户在拿到笔记本后做,与本批次无关;`PAGE_WHEEL_REPEAT_THRESHOLD_PX` 是唯一的调参旋钮,本批次不动。
- **推子**(`components/Fader.tsx`):指针拖帽走 `onPointerDown` / `onPointerMove` / `onPointerUp` / `onPointerCancel`,`handlePointerDown` 只认 `.fader__cap` 上的按下,调用 `setPointerCapture(event.pointerId)`,`capGrabRef` 记起点与起始比例,超过 `CAP_DRAG_THRESHOLD_PX`(3px)才 `onInteractionStart`;`isCapDoubleClick` 用 `event.detail >= 2` 或 500 ms 内同一位置的两次按下判定双击回 0 dB;`finishPointer` 释放捕获并 `onCommit`。**没有任何 pointerId 过滤**:拖动中第二根手指落在同一个帽上会重置 `capGrabRef` 的起点,而且落在 500 ms 内会被当成双击直接跳到 0 dB;第二根手指的 `pointerup` 会结束第一根手指的拖动并 commit。多个推子各自持有状态与 pointer capture,同时拖两个推子本身已经可行。`dragging` 为真时给 `document.documentElement` 加 `fader-cap-dragging` 类(全局 `ns-resize` 光标),由 `useEffect` 清理——两个推子同时拖时,先松手的那个会把类摘掉。`.fader__track` 已有 `touch-action: none; user-select: none`。`Fader.test.tsx` 现有 22 例,指针用例都带 `pointerId`。
- **ON 按钮**(`components/OnButton.tsx`):`button.on-button`,可访问名 `<name> on/off`,`aria-pressed`;`min-height: 2.65rem`。**手指翻页目前可以从它上面起手**(只有推子轨道被排除),靠 `touchend` 的 `preventDefault` 防止翻页后误按。
- **全局样式**(`apps/web/src/styles.css`,约 3070 行):没有全局 `overscroll-behavior`(只有 `.mixer-page` 的 `contain`)、没有全局 `touch-action`(只有推子轨道、安全区、`.page-rail__track`、拖动把手的 `none`)、没有 `user-select` 与 `-webkit-touch-callout` 的全局规则;`-webkit-tap-highlight-color: transparent` 只给了 `button`。`100vh` 尚有 4 处:`body { min-height: 100vh }`、`.connection-dialog { max-height: calc(100vh - 2rem) }`、`.settings-shell { height: 100vh }` 与窄屏媒体查询里的 `.settings-shell { min-height: 100vh }`;另有一处 `max-height: 60vh`(窄屏下的 `.channel-checklist, .view-channel-list`)。混音页外壳已是 `height: 100dvh`。
- **`:hover` 规则**:26 条,全部裸露在媒体查询之外,行号(改动前)与选择器:`158 .connection-status:hover`、`172 .connection-status.is-online:hover`、`334 .control-lock__options button:hover`(与另一个选择器合写)、`617 .reset-button:hover:not(:disabled)`、`806 .page-rail__step:hover:not(:disabled)`、`848 .page-rail__jump:hover:not(:disabled)`、`1145 .fader__cap:hover`(**与 `.fader.is-dragging .fader__cap` 合写**)、`1254 .fader__readout button:hover:not(:disabled)`、`1435 .on-button:hover:not(:disabled)`、`1567 .console-brand__action:hover`、`1608 .console-back:hover`、`1613 .console-back:hover svg`、`1893–1895 .new-view-form button / .utility-button / .missing-warning button` 的 `:hover:not(:disabled)`、`1906 .primary-button:hover:not(:disabled)`、`1977 .view-list > button:hover`(合写)、`2184 .channel-checklist label:hover`(合写)、`2372 .group-toolbar button:hover:not(:disabled)`、`2538 .drag-handle:hover:not(:disabled)`(合写)、`2580 .delete-button:hover:not(:disabled)`、`2619 .row-menu:hover:has(select:enabled)`(合写)、`2656 .group-collapse:hover:not(:disabled)`、`2873–2874 .order-buttons button:hover:not(:disabled), .palette-control button:hover`(合写)。合写的选择器里,非 `:hover` 的那一半必须留在媒体查询之外。
- **配置页 DnD 的 touch 传感器(6.2.1 已完成,本批次不改)**:`features/settings/dnd-config.ts` 的 `TOUCH_ACTIVATION_DELAY_MS = 100`、`TOUCH_ACTIVATION_TOLERANCE_PX = 8`(用户手调过),`.drag-handle` 已有 `touch-action: none`。计划里「设置按压延迟与容差」这一条只剩真机复核。
- **页头**:`MixerPage.tsx` 的 `header.console-header` 是 `flex-wrap: wrap` 的单行,`div.console-brand` 内依次是 eyebrow `FAIRLIGHT LIVE`、`h1 CONTROL DESK`、`button.console-brand__action CONFIGURE VIEWS`。配置页头部是 `header.console-header.settings-header`(返回按钮 + 面包屑 + 连接状态)。
- **入口与静态资源**:`apps/web/index.html` 只有 charset、viewport(`width=device-width, initial-scale=1.0`)、`theme-color #111318`、一个 data-URI SVG favicon 与标题;**没有 `apps/web/public/` 目录、没有 manifest、没有 Apple 的 web app meta**。生产环境由 `apps/server/src/app.ts` 的 `@fastify/static` 托管 `apps/web/dist`,未命中的 GET 回 `index.html`;`.webmanifest` 的 MIME(`application/manifest+json`)在 mime-db 里,静态托管不需要改。
- **偏好类 hook 的错误处理先例**:`use-control-lock-preference.ts` / `use-type-row-preference.ts` 在 `localStorage` 失败时 `console.warn` 一次并降级,这是前端「不吞错」的既定写法。
- **测试基建**:`vitest.setup.ts` stub 了 `scrollTo`、`scrollIntoView`、`Element.prototype.animate`、`ResizeObserver`(`tests/stub-resize-observer.ts`)与混音页布局(`tests/stub-mixer-layout.ts`),`afterEach` 重置 `wheelGestureTracker`。**jsdom 的 `HTMLMediaElement.prototype.play()` 未实现**——调用会向虚拟控制台报 `Not implemented` 并返回 `undefined`,本批次的媒体降级要先在 setup 里 stub `play` / `pause`。`navigator.wakeLock`、`document.fullscreenEnabled`、`requestFullscreen` 在 jsdom 里都不存在,正好用来测「不可用」分支;「可用」分支用 `Object.defineProperty` 装假实现。集成测试的写法见 `tests/mixer-touch.integration.test.tsx`(`FakeSocket` + `App`,`fireEvent.touchStart` 用普通对象充当 `Touch`)。覆盖率门槛 80%,当前 web 约 97%。
- **已知的平台事实(写进代码注释与报告,不是可以绕开的东西)**:
  - Screen Wake Lock API 只在**安全上下文**暴露:`http://localhost` 有 `navigator.wakeLock`,`http://<局域网 IP>:5173` 下它是 `undefined`。用户的平板正是走后者访问的,所以原生路径在目标设备上默认不可用;可行的运维办法是在专用平板的 Chrome 里把该源加入 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,或等 Phase 7 的 HTTPS。
  - Chrome for Android 只为**正在播放、带视频轨、在文档内可见**的 `<video>` 持有「阻止息屏」锁;纯音频播放拿到的是「阻止应用挂起」的 CPU 锁,屏幕照样熄灭。所以降级方案是静音视频循环,不是音频循环。
  - PWA 安装(manifest 生效、无浏览器边框)同样要求安全上下文;在 `http://<局域网 IP>` 下「添加到主屏幕」只会得到一个在浏览器标签页里打开的书签。manifest 本批次照加,它在 Chrome 标志或 HTTPS 就位后即生效;隐藏平板顶部状态栏的进一步方案用户另行考虑,不在本批次。

## 本地执行边界

- 你运行在用户的开发机上,这台机器**连着真实的 Fairlight Live**。`AGENTS.md` 第一条对你直接生效:自动化测试与浏览器冒烟一律用 Mock 或合成数据,**你自己不得向真实设备发送任何控制命令**,不得连它做任何「顺手验证」;真机验收由用户在平板与手机上完成,你在报告中标注**移交用户**并给出可直接照做的操作清单。
- **端口 3000 与 5173 上常年跑着用户自己的 `pnpm dev`**(server 连着真机,web 是 Vite)。不要占用、不要重启、不要杀掉这两个进程;你的一切本地实验另起端口(6.3 本地收尾批次用的是合成电平服务 3100 + `vite preview`/`vite --port` 的其它端口,照搬)。
- 本批次是纯前端改动(`apps/web`),不改 `apps/server`、`packages/shared`、`packages/test-utils`。
- **本批次不新增依赖**,`pnpm-lock.yaml` 不应有改动。第 5 节的媒体数据是从 nosleep.js 的发布包里**摘取**字符串,不是把它装成依赖。
- 安装:仓库根目录 `pnpm install --frozen-lockfile`(本地四个包都装得上);质量门用根脚本 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 串行跑。Windows 上 prettier 对换行符敏感,仓库 `.gitattributes` 已定 `eol=lf`,新建文件保持 LF。
- 浏览器冒烟:本机已装 Chrome,`playwright-core` 只装在会话临时目录,用 `chromium.launch({ channel: 'chrome' })` 驱动(6.3 报告第 14 节的做法,不下载浏览器);被测的是 `pnpm --filter @flwc/web build` 的生产构建,数据源是临时目录里的合成电平服务(40 通道、20 Hz,复用 `apps/server/node_modules` 里的 `socket.io`,不另装)。平板用 `hasTouch: true, isMobile: true` 的上下文模拟(此时 Chromium 报 `(hover: none)` 与 `(pointer: coarse)`)。这台机器的 rAF 跑约 360 fps,帧间隔类指标没有区分度,本批次不做性能预算,不必量。
- 你没有触屏设备。所有触屏手感与真机行为(下拉刷新、缩放、长按菜单、多指、常亮、全屏、安装)只能由用户验收,不要用模拟结果冒充。

## 分支、PR 与评审监控

- 从最新的 `origin/main` 开分支(命名沿用既有习惯,如 `claude/phase-6-4-<随机后缀>`),按逻辑单元多次提交并推送到远端;用 `gh pr create` 开 PR,标题与正文英文,正文按 6.3 PR 的样式概述改动、列出验收自查结果与移交项。**PR 由用户合并,你不得合并、不得 force-push 到 main。**
- **CI**:每次推送后用 `gh pr checks --watch`(或轮询 `gh pr checks`)等到 GitHub Actions 结束;红了就修,修好再推,直到全绿。CI 用 `pnpm install --frozen-lockfile`,lockfile 有 diff 会直接红。
- **Cursor Bugbot**:PR 打开与每次推送后几分钟内,`cursor[bot]` 会以 review 的形式在 PR 上留行内评论。用 `gh api repos/{owner}/{repo}/pulls/<N>/reviews` 与 `.../pulls/<N>/comments` 轮询(建议每 2–3 分钟一次,推送后至少等 10 分钟,没有新评论且 CI 已绿才算这一轮结束);对每一条 finding:成立的先写复现用例、再修、再推;不成立的在该评论线程下用英文回复理由(`gh api` 对 `.../pulls/<N>/comments/<id>/replies` 发 POST)。全部处理完再等一轮,确认没有新的 finding。处理过程与结论写进报告的「评审后的修订」一节(格式见 6.3 报告第 10 节:逐条列 finding、判断、改法与回归锁)。
- 报告 `docs/reports/phase-6-4-report.md` 与其它改动在同一个 PR 里;评审修订后更新报告再推一次。
- 全部结束后在最终回复里给出 PR 链接、CI 状态、Bugbot 处理清单与移交用户的验收清单入口。

## 硬性约束

- `docs/prompts/phase-6-3.md` 的「硬性约束」全部沿用:自动化测试一律基于 Mock 或夹具;代码、注释、提交信息、固定 UI 文案英文,文档与报告简体中文;不改 CI;不调低覆盖率门槛、不新增覆盖率排除项;按逻辑单元分多次提交(建议:全局防误触样式与 `dvh` → `:hover` 媒体查询与样式回归测试 → 推子 pointerId 过滤与拖动计数 → ON 按钮不起手 → Wake Lock(原生 + 媒体降级)→ Fullscreen 与页头按钮 → manifest 与 meta → 文档)。
- **不改任何数值初值**:`page-layout.ts`、`page-wheel.ts`、`fader-wheel.ts`、`wheel-gesture.ts`、`dnd-config.ts` 里的常量一个都不动;推子帽、ON 按钮、翻页键的尺寸**保持现状**(用户实测认为命中区无需放大,计划里的「不小于 44px」这一条明确不做)。
- **不改 6.3 的分页、滚轮与手指翻页语义**:归属规则、共用累加器、安全区直接翻页、通道条区滚到底再翻、`touchend` 防误按、单指判定,一条都不能变;既有 `mixer-touch` / `mixer-wheel` / `mixer-pages` 三个集成文件的用例只允许增、不允许改意图。
- **推子的既有六条输入路径一字不改**:指针拖帽、双击回 0、键盘步进、精确输入、滚轮、pending 与远端冲突规则;pointerId 过滤只是在已有路径前面加一道「这根手指是不是正在拖的那根」的判断。
- **降级必须静默且绝不出声**:Wake Lock 与 Fullscreen 在不支持或被拒绝时不弹任何提示、不影响任何功能;媒体降级的视频元素必须 `muted`、素材本身没有音频轨——这是一个控制音频台的应用,任何来自浏览器的声音都是事故。
- **安全区(`PageRail`)里仍然不得有任何影响声音的控件**,也不放 Fullscreen 按钮(它只放翻页控件,6.3 的约定)。
- **不加 `user-scalable=no`**(用户决定暂不禁捏合缩放),viewport meta 的内容不变。
- 不改 `docs/development-plan.md` 的任务描述与验收框;`docs/fairlight-ember.md` 只由用户回写。

## 任务范围

七项改动,按下面的顺序做。第 1–2 项是样式,第 3–4 项是触摸输入,第 5–6 项是渐进增强,第 7 项是安装元数据。

### 1. 全局防误触样式与 `dvh`

- `styles.css` 顶部的全局规则:
  - `html, body { overscroll-behavior: none; }`——禁止下拉刷新与滚动链到浏览器外壳;`.mixer-page` 既有的 `overscroll-behavior: contain` 保留。
  - `body { touch-action: manipulation; }`——禁止双击缩放,保留平移与捏合;推子轨道、安全区与拖动把手既有的 `touch-action: none` 保留(后代自己的值更严格即以后代为准)。
  - `body { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }`,并显式恢复可编辑控件:`input, textarea, [contenteditable] { user-select: text; -webkit-user-select: text; }`(安全区页码输入框、推子精确输入、CONNECTION 面板与配置页的 view 名称输入都在内)。
  - `-webkit-tap-highlight-color: transparent` 从只给 `button` 扩到 `button, [role='slider'], label, select, input, a`。
- `100vh` → `100dvh`:上面列出的 4 处全部改;`60vh` 一并改为 `60dvh`(同一个原因:移动浏览器地址栏收起时视口会变)。改完全仓 `grep -n "vh\b" apps/web/src/styles.css` 里不应再有 `vh` 单位(`dvh` 除外)。
- 混音页的 `.mixer-page` 仍然是页内滚动的主体,`touch-action: manipulation` 不影响它的平移;安全区 `touch-action: none` 不变。
- 测试:见第 2 节的样式回归测试,把这些全局规则一起锁住。

### 2. `:hover` 包进 `@media (hover: hover)`,并加样式回归测试

- 上面列出的 26 条 `:hover` 规则,每一条都移进 `@media (hover: hover) { … }`。允许就近合并成若干个媒体查询块(不要求 26 个块),但块要贴着原规则所在的位置,不要把所有悬停样式集中到文件末尾——这个文件按组件分段,悬停态属于它的组件。
- **合写的选择器必须拆开**:`.fader__cap:hover, .fader.is-dragging .fader__cap { … }` 拆成媒体查询内的 `.fader__cap:hover` 与查询外的 `.fader.is-dragging .fader__cap`,声明块复制一份;`.console-back:hover svg`、`.row-menu:hover:has(select:enabled)`、`.channel-checklist label:hover`、`.view-list > button:hover`、`.drag-handle:hover:not(:disabled)`、`.control-lock__options button:hover`、`.order-buttons button:hover:not(:disabled), .palette-control button:hover` 同理——凡与非 hover 选择器(`.is-active`、`:focus-visible`、`[aria-pressed='true']` 之类)合写的,非 hover 的那一半留在外面,视觉不变。`:active` 与 `:focus-visible` 规则一律不动。
- 新建 `apps/web/src/styles.test.ts`(单元测试,读 `styles.css` 源文件做文本扫描,不渲染):
  - 按花括号深度扫描,断言**每一个** `:hover` 出现时都处在某个 `@media (hover: hover)` 块之内(块内允许嵌套普通规则);
  - 断言不存在 `100vh` / `60vh`,且 `100dvh` 至少出现一次;
  - 断言 `overscroll-behavior: none`、`touch-action: manipulation`、`user-select: none`、`-webkit-touch-callout: none` 各至少出现一次,且 `input, textarea, [contenteditable]` 的 `user-select: text` 存在。
  - 这个文件是 CSS 在 jsdom 里唯一能有的回归锁,写清楚注释说明它为什么存在。

### 3. 推子:pointerId 过滤与多推子并行

- `Fader.tsx` 新增 `activePointerIdRef: number | null`:
  - `handlePointerDown`:若 `activePointerIdRef` 非空且与 `event.pointerId` 不同 → `preventDefault()` 后直接返回(**在双击判定之前**,第二根手指落在帽上既不能重置起点,也不能被当成双击跳到 0 dB);否则按原逻辑走,进入拖动时记下 `event.pointerId`。
  - `handlePointerMove` / `finishPointer`(`pointerup` 与 `pointercancel`):`event.pointerId !== activePointerIdRef.current` 时忽略;拖动结束时清空。
  - 双击回 0 的两种判定(`event.detail >= 2` 与 500 ms 内的两次按下)只对**没有活动指针**时的按下生效,语义不变。
- `fader-cap-dragging` 改为模块级计数:`beginCapDrag()` / `endCapDrag()` 维护正在拖动的推子数,从 0 变 1 时加类、从 1 变 0 时摘类;组件卸载时若仍在拖动也要减计数。
- 测试(`Fader.test.tsx` 新增):
  1. 拖动中第二根手指(`pointerId: 2`)在帽上按下并移动:`aria-valuenow` 不受它影响、不跳到 0 dB(分别用 `detail: 2` 与 500 ms 内落下两种双击形态各测一次);它的 `pointerup` 不结束拖动、不 commit;第一根手指继续拖动,松手后恰好一次 `onCommit`、值是第一根手指的值。
  2. 同时渲染两个 `Fader`(不同 `wheelId`),`pointerId: 1` 拖 A、`pointerId: 2` 拖 B、交替移动:各自的 `aria-valuenow` 只跟自己的手指走,各自 commit 一次、值互不串;A 先松手时 `documentElement` 仍有 `fader-cap-dragging`,B 松手后才没有。
  3. 拖动中组件被卸载:计数归零、类被摘掉(既有的 `useEffect` 清理路径)。
- 集成(`mixer-touch.integration.test.tsx` 或新建 `mixer-multitouch.integration.test.tsx`):两个通道条的推子同时被两根手指拖动,`setLevel` 按各自 id 发出、互不串;此时 deck 上的手指翻页监听器因为 `touches.length === 2` 保持沉默,页码不变(既有「只认单指」用例的多推子版本)。

### 4. 手指翻页不从 ON 按钮起手

- 新增约定属性 `data-swipe="none"`:标在**手指翻页永远不起手**的表面上。`OnButton.tsx` 的按钮加上它;推子轨道已由 `[data-wheel="level"]` 排除,不重复标。
- `MixerPage.tsx` 的 `handleTouchStart`:排除条件从 `closest('[data-wheel="level"]')` 改为 `closest('[data-wheel="level"], [data-swipe="none"]')`;电平表、通道名称头、读数、分区标题栏、间隙与安全区照旧可以起手(用户决定只追加排除 ON)。
- 测试(`mixer-touch.integration.test.tsx` 新增):从某通道的 ON 按钮上按下并拖过阈值 → 页码不变;`touchend` 未被 `preventDefault`(它不是翻页手势,不该被拦);既有「does not press what a page-turning drag ends on」用例保持不变且仍绿。

### 5. Screen Wake Lock:原生路径 + 静音视频降级

- 新建 `apps/web/src/features/mixer/use-wake-lock.ts`,只在混音页挂载(`MixerPage` 内调用;配置页不常亮)。签名建议:

  ```ts
  export type WakeLockStatus = 'unsupported' | 'idle' | 'active' | 'denied';
  export interface WakeLockEnvironment {
    wakeLock: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(type: 'release', listener: () => void): void }> } | undefined;
    document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
    media: WakeMediaController; // the fallback, see below
  }
  export function useWakeLock(enabled: boolean, env?: WakeLockEnvironment): WakeLockStatus;
  ```

  `env` 缺省时从 `navigator.wakeLock` / `document` / 真实媒体控制器构造;测试注入假的。
- **原生路径**(`env.wakeLock` 存在):`enabled` 且文档可见时 `request('screen')`;拿到的 sentinel 收到 `release` 事件(系统收回、切后台)时状态回 `idle`;`visibilitychange` 回到 `visible` 时重新申请;`enabled` 变假或卸载时 `release()`。`request` 被拒绝(`NotAllowedError` 等)→ 状态 `denied`,`console.warn` 一次(与偏好 hook 的先例一致),不重试、不提示;后续 `visibilitychange` 再来时仍会再试一次(平板从锁屏回来常见)。
- **媒体降级路径**(`env.wakeLock` 为 `undefined`,即目标平板在 `http://<局域网 IP>` 下的实际情况):
  - 新建 `apps/web/src/lib/wake-media.ts`:导出 `WAKE_MEDIA_SOURCES`(webm 与 mp4 两个 data-URI 字符串)与 `createWakeMediaController(document)`。媒体数据**摘自 nosleep.js 0.12.0(MIT)发布包**(临时目录里 `npm pack nosleep.js@0.12.0` 解开后取其中的 base64 字符串;仓库里的文件头注明来源、版本与 MIT 许可文本链接),不把它装成依赖。若沙箱拿不到这个包,报告如实写明并留下明确的占位说明,不要自造媒体数据。
  - 控制器在混音页外壳内挂一个 `<video muted loop playsinline aria-hidden="true">`(`.wake-media`,`position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none`,**必须在文档内且有几何**,`display: none` 的视频不会被当作可见);`start()` 调 `play()`,`stop()` 调 `pause()`。nosleep.js 发现极短的循环视频在部分设备上 `loop` 不可靠,在 `timeupdate` 里 `currentTime > 0.5` 时手动回到 0——照做。
  - **只在用户交互之后开始播放**(用户决定的触发时机,也是自动播放策略的要求):hook 在 `document` 上监听 `pointerdown` 与 `keydown`(`{ once: false, passive: true }`),`enabled` 且文档可见且尚未播放时调用 `start()`;`visibilitychange` 变 `hidden` 时 `stop()`,回到 `visible` 后等下一次交互再 `start()`(不能在没有手势的时候自动播,会被拒绝)。`play()` 的 promise 被拒绝 → 状态 `denied`,`console.warn` 一次,等下一次交互再试。
  - `enabled` 变假或卸载:`stop()` 并移除元素。
- `MixerPage` 把状态写到 `.mixer-shell` 的 `data-wake-lock` 属性上(值就是 `WakeLockStatus`),供集成测试与浏览器冒烟读取;不在 UI 上显示。
- `vitest.setup.ts`:stub `HTMLMediaElement.prototype.play`(返回 resolved promise)与 `pause`,否则 jsdom 会向虚拟控制台报错。
- 测试:
  - `use-wake-lock.test.tsx`(`renderHook` 或探针组件,注入 `env`):原生可用 → `active`,`visibilitychange` 隐藏后 sentinel 触发 `release` → `idle`,回到可见 → 再次 `request` → `active`;`request` 拒绝 → `denied` 且 `console.warn` 恰好一次;`enabled` 变假 → `release()` 被调用;`wakeLock` 缺失 → 走媒体路径:挂载后视频元素在文档内、未播放,第一次 `pointerdown` 后 `play()` 被调用且状态 `active`,隐藏时 `pause()`,再次可见后不自动播、下一次 `keydown` 才播;`play()` 拒绝 → `denied`。
  - 集成(`mixer.integration.test.tsx` 新增一例):jsdom 没有 `navigator.wakeLock`,所以挂载混音页后 `.mixer-shell[data-wake-lock]` 应为 `idle`、`video.wake-media` 存在且 `muted`,点击任意处后变为 `active`;切到配置页(`CONFIGURE VIEWS`)后视频元素被移除。

### 6. Fullscreen:hook 与页头按钮

- 新建 `apps/web/src/lib/use-fullscreen.ts`:

  ```ts
  export interface FullscreenState { supported: boolean; active: boolean; toggle(): void }
  export function useFullscreen(doc?: Document): FullscreenState;
  ```

  `supported = doc.fullscreenEnabled === true && typeof doc.documentElement.requestFullscreen === 'function'`(不做 `webkit` 前缀回退;iPhone Safari 因此不支持,按钮不渲染);`active` 由 `fullscreenchange` 事件维护;`toggle()` 在非全屏时 `documentElement.requestFullscreen({ navigationUI: 'hide' })`、全屏时 `doc.exitFullscreen()`,两个 promise 被拒绝都只 `console.warn` 一次并保持原状态。
- `MixerPage` 的 `console-brand` 里,在 `CONFIGURE VIEWS` 之后加一个同样式的 `button.console-brand__action`:未全屏时文字 `FULLSCREEN`、全屏时 `EXIT FULLSCREEN`,`aria-pressed={active}`;`supported` 为假时**整个按钮不渲染**。配置页不加(全屏是文档级状态,进入后切到配置页仍是全屏,Esc 或回到混音页退出)。
- 测试:`use-fullscreen.test.tsx` 注入假 `Document`(`fullscreenEnabled`、`requestFullscreen`、`exitFullscreen`、`fullscreenElement`、事件派发)覆盖支持/不支持、进入/退出、拒绝三种;集成(`mixer.integration.test.tsx`):jsdom 无 `fullscreenEnabled` → 页头没有 `FULLSCREEN` 按钮;装上假实现后按钮出现、点击后文字变 `EXIT FULLSCREEN`、再点回来;安全区体检用例的按钮名单不变(按钮在页头,不在安全区)。

### 7. Web app manifest 与 meta

- 新建 `apps/web/public/manifest.webmanifest`:`name: "Fairlight Live Control Desk"`、`short_name: "Control Desk"`、`start_url: "/"`、`scope: "/"`、`display: "fullscreen"`(Android 上安装后连状态栏一起隐藏;不支持的平台自动退到 `standalone`)、`background_color` 与 `theme_color` 都是 `#111318`、`icons` 含 192×192 与 512×512 两个 PNG(`purpose: "any"`)。不锁定 `orientation`(横竖屏都要能用)。
- 图标:`apps/web/public/icon-192.png`、`icon-512.png`,画面与现有 favicon 一致(`#111318` 圆角底 + `#efa928` 的三段推子图形)。用一个放在临时目录的纯 Node 脚本(`zlib` 手写 PNG 编码,不装任何依赖)生成后把 PNG 提交进仓库,脚本本身**不进仓库**,报告里附上它的要点(尺寸、颜色、几何)以便复现。若时间不允许,退而只给 SVG 图标(`sizes: "any"`)并在报告写明。
- `index.html` 的 `<head>` 增加:`<link rel="manifest" href="/manifest.webmanifest">`、`<meta name="mobile-web-app-capable" content="yes">`、`<meta name="apple-mobile-web-app-capable" content="yes">`、`<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`、`<meta name="apple-mobile-web-app-title" content="Control Desk">`、`<link rel="apple-touch-icon" href="/icon-192.png">`。viewport meta **不变**。
- 验证:`pnpm --filter @flwc/web build` 后 `dist/` 里有 manifest 与两个 PNG;`vite preview` 起来后用 Playwright 请求 `/manifest.webmanifest`,断言 200 与 `application/manifest+json`;Lighthouse 不必跑。

### 8. 文档

- `docs/architecture.md` 「前端结构」追加三段,只描述当前状态:「触屏防误触」(全局四条规则、`dvh`、`:hover` 只在 `(hover: hover)` 下生效及其回归测试、`data-swipe="none"` 约定与 ON 不起手)、「多指」(推子按 pointerId 认手指、第二根手指被忽略、多个推子可并行、`fader-cap-dragging` 计数)、「常亮与全屏」(Wake Lock 原生路径与视频降级的触发时机、安全上下文限制与 Chrome 标志、Fullscreen 按钮与不支持时的隐藏、manifest 与 `display: fullscreen`)。「推子拖动」一条补一句 pointerId。
- 不改 `docs/development-plan.md`。

## 测试要求

- 单元测试与被测代码同目录,集成测试放 `apps/web/tests/`;多指用例可以新建 `mixer-multitouch.integration.test.tsx`,不要把 `mixer-touch.integration.test.tsx` 撑得太大。
- 第 1–7 节的测试项全部落地;既有测试只允许增加,断言意图不得删除或改写。
- 覆盖率:`apps/web` ≥ 80%(维持既有门槛);`packages/shared`、`apps/server` 本批次不改。
- 时钟相关测试一律用 `vi.useFakeTimers`(推子双击的 500 ms 窗口、`timeupdate` 回绕),不用真实等待。
- 浏览器冒烟(Playwright,`hasTouch: true, isMobile: true` 的上下文 + 合成电平服务):断言 `getComputedStyle(document.body)` 的 `touchAction === 'manipulation'`、`userSelect === 'none'`,`html` 的 `overscrollBehavior === 'none'`;`matchMedia('(hover: hover)').matches` 为假时,`page.hover()` ON 按钮后其 `border-color` 与静止态相同;桌面上下文(`hasTouch: false`)下悬停后确实变色——两组各截一张图放临时目录;`.mixer-shell[data-wake-lock]` 在 `localhost` 下为 `active`(安全上下文,原生路径);`FULLSCREEN` 按钮存在且点击后 `document.fullscreenElement` 非空(Chromium headless 允许);多指拖两个推子若用 CDP `Input.dispatchTouchEvent` 能做就做,做不了写明。

## 明确不做的事

- 不放大推子帽、ON 按钮、翻页键的命中区(用户实测认为现状可用;计划里的 44px 一条明确取消)。
- 不加 `user-scalable=no`、不拦 `gesturestart`(暂不禁捏合缩放)。
- 不加速度阈值、不改「一次手势只翻一页」以外的翻页节奏——6.3 的共用累加器语义原样保留;不动任何数值常量。
- 不改配置页 DnD 传感器(6.2.1 已定);不改安全区内容;不改 `apps/server`、`packages/shared`、`packages/test-utils`、CONNECTION 面板。
- 不做 6.5:重连集成用例、soak 脚本。
- 不做音频形式的常亮降级;不把 nosleep.js 装成依赖;不新增任何依赖;不改 CI;不改 `docs/development-plan.md`。
- 不做平板顶部状态栏的进一步隐藏方案(APK 封装、adb 之类由用户另行考虑)。

## 验收自查

完成后逐条核对,在本地实际执行并记录结果:

1. 全局样式:四条防误触规则、可编辑控件的恢复、`vh` 清零 — 以 `styles.test.ts` 与浏览器计算样式为证;下拉刷新、双击缩放、长按菜单、文字选中在真机上的实际表现 **移交用户**。
2. `:hover`:26 条全部在 `(hover: hover)` 内、合写选择器拆分后视觉不变 — 以 `styles.test.ts` 与两组冒烟截图为证。
3. 多指:第二根手指不劫持、不触发回 0、不 commit;两个推子并行各自 commit;拖动类计数 — 以单测与集成为证;真机双手推两路 **移交用户**。
4. ON 不起手:从 ON 上拖不翻页、`touchend` 不被拦;既有三条安全性质用例全绿 — 以测试为证。
5. Wake Lock:原生路径的申请/释放/重申请与拒绝分支、媒体路径的交互触发/隐藏暂停/拒绝分支、`data-wake-lock` 属性 — 以测试为证;`localhost` 冒烟为 `active`;**目标平板在 `http://<局域网 IP>` 下走的是媒体路径,能否真的常亮只有真机知道,移交用户**(报告要把 Chrome 标志的操作步骤写清楚,让用户可以对照测原生路径)。
6. Fullscreen:支持/不支持/拒绝三种;按钮只在支持时渲染;不在安全区 — 以测试为证;真机 **移交用户**(iPhone Safari 预期没有按钮)。
7. manifest:构建产物里有 manifest 与图标,`vite preview` 下可取到 — 以冒烟为证;安装行为 **移交用户**(并注明 `http` 下不会真正安装)。
8. 全量质量门:串行 lint → typecheck → test → build 全绿,远端 CI 全绿,lockfile 无 diff。

## 执行报告要求

在 `docs/reports/phase-6-4-report.md` 产出执行报告(简体中文),章节与 `docs/reports/phase-6-3-report.md` 相同:结果总览、验收标准逐条核对(对上述八条)、实现摘要(每节一段;Wake Lock 一节要写清两条路径各在什么条件下生效)、数值初值清单(本批次预期**没有新增数值常量**;若有,逐个列名称、值、含义、文件)、真机验收操作清单(移交用户,分平板与手机两列,含:下拉刷新、双击缩放、长按菜单、文字选中、双手同时推两路推子、第二根手指落在同一推子上、从安全区滑动翻页、从 ON 上滑动不翻页、`FULLSCREEN` 按钮、常亮——分「直接访问」与「开启 Chrome 标志后」两种、添加到主屏幕;**安全约束照抄 6.3 报告第 5 节**,多指验收只在 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个推子上做,做完复原)、交付物清单、依赖清单(应为「无新增依赖,lockfile 无 diff」;摘取的 nosleep.js 媒体数据与临时目录里的 `playwright-core` / `socket.io` 单列并注明未进仓库)、关键决策与偏离、被改写的既有用例清单(预期为空)、遗留问题与移交事项、提交记录。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤、拿不到的媒体数据、测不出来的指标都要写明,不许美化。

## 完成定义

- 七项任务全部落地,测试要求全部满足。
- 本地串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,`pnpm-lock.yaml` 无改动。
- PR 已开,远端 CI 全绿,Bugbot 的每一条 finding 都已修复或已在线程里回复理由,且最后一轮轮询没有新 finding。
- 合成电平服务 + Playwright 冒烟通过,两组悬停截图与计算样式断言结果在报告里;全程没有碰真实 Fairlight,也没有动过 3000 / 5173 两个端口。
- 全部变更已按 Conventional Commits 提交并推送。
- `docs/reports/phase-6-4-report.md` 已产出,真机验收清单可直接交用户在平板与手机上执行。
