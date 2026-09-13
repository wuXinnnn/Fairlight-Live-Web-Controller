# Phase 6.3 执行报告 — 混音页分页

## 1. 结果总览

| 项 | 状态 |
| --- | --- |
| 1. 切页纯函数与布局常量 | 完成 |
| 2. 页面骨架:100dvh、单行页头、条带撑满 | 完成 |
| 3. 翻页状态、安全区与键盘 | 完成 |
| 4. 滚轮:归属模块与两个 reducer | 完成 |
| 5. 滚轮接入:推子轨道与分页视口 | 完成 |
| 6. 电平表实测与 transform 改绘 | **整节未做**(用户决定跳过,见第 8 节) |
| 7. 文档 | 完成 |
| 评审后修订(Bugbot 五条 findings + 自查补 1 条) | 完成,见第 10 节 |

云端质量门(串行,全部在本会话实际执行):

```
pnpm install --frozen-lockfile --filter @flwc/web --filter @flwc/shared   成功
eslint .                                                                  0 error
prettier --check .                                                        全部通过
tsc --noEmit (@flwc/web)                                                  0 error
vitest run --coverage (@flwc/web)      54 文件 / 422 用例 全绿
vite build (@flwc/web)                 成功
git diff pnpm-lock.yaml                无改动
```

覆盖率(门槛 80%,未调整、未新增排除项):

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| Statements | 96.75% | **97.02%** |
| Branches | 91.97% | **92.46%** |
| Functions | 99.20% | **99.41%** |
| Lines | 96.70% | **96.98%** |

用例数 327 → 399(净增 72,含评审后补的 9 例回归锁)。本批次新增的 `page-layout.ts`、`pagination.ts`、`use-pager.ts`、`StripPages.tsx`、`PageRail.tsx`、`wheel-delta.ts`、`fader-wheel.ts`、`page-wheel.ts`、`wheel-gesture.ts` 九个文件四项指标全为 100%(v8 报告只列不足 100% 的文件,故它们不在表内);`use-pager-viewport.ts` 分支 87.5%。

**云端安装的实际情况**:与 6.2.2 报告第 1 节不同,本会话 `pnpm install --frozen-lockfile --filter @flwc/web --filter @flwc/shared` **一次成功**(2 of 5 workspace projects,7.8s),`packages/shared` 的 `prepare` 自动构建了 `dist`。因此前端的四道质量门全部在本地真实跑过,不是只靠远端 CI。`apps/server` 与 `packages/test-utils` 本批次未改也未安装。

## 2. 验收标准逐条核对

对照提示词「验收自查」六条:

**1. 切页 — 通过,以单测为证。** `apps/web/src/features/mixer/pagination.test.ts` 七例:每页数量随宽度变化(595px 放 4 条、594px 放 3 条)、表头占宽导致同宽容器少放一条(3 条)、组跨页时第二页带 `continued` 表头、`newPagePerHeaderedSegment` 下每个带表头的段一页而无表头段续排、容器 10px 时每页恰好一条(带不带表头都是)、空输入返回 `[]`、空段被跳过且不吃掉段间距。

**2. 骨架 — 结构与可访问名以测试为证;观感移交用户。** `100dvh`、单行页头、条带撑满都是纯 CSS,jsdom 不求值 CSS,**无法自动断言**。能证明的是既有控件与可访问名一个不少:`mixer.integration.test.tsx` 与 `views.integration.test.tsx` 全绿(改写见第 9 节),`Connection settings` / `Mixer view` / `CONTROL LOCK` 三选项 / `Loudness` / `RESET` / `CONFIGURE VIEWS` / `<name> level` / `<name> on/off` / `<name> meter` / `section.mixer-section[aria-labelledby]` + `header.mixer-section__header > h2 + span` / `article.channel-strip[data-channel-id]` / `data-channel-kind` / `data-view-group-id` / `.mixer-bays` 全部保留。**冒烟截图这一项本会话没有**(第 6 节跳过,浏览器冒烟一并未做)——这是本报告最大的证据缺口,页头单行是否好看、条带是否真的翻倍、翻页动效是否顺,全部**移交用户**。

**3. 翻页 — 通过,以测试为证;页内滚动移交。** `use-pager.test.ts` 五例(钳位、越界步进、view 切换重置、页数缩小钳末页并保持、goTo 钳位);`mixer-pages.integration.test.tsx` 十例:按钮翻页与页码文本、首末页禁用、单页 `1 / 1` 且两键禁用、`PageDown` / `PageUp` 翻页、推子聚焦时 `PageDown` 只走 −10 dB 不翻页、切换 view 回第一页、`TYPE PAGES` 开启后每种类型/每个组一页(页数变化)、安全区内无 slider / switch / radio / `aria-pressed` / RESET 且只有两个翻页键、缩窄视口后页数增加且页码钳位。**视口过矮的页内滚动是纯 CSS,jsdom 断言不了 → 移交用户**(滚轮在这种状态下的让位行为有用例,见下)。

**4. 滚轮 reducer 与归属 — 通过,以测试为证;手感移交用户。** 单测:`wheel-delta.test.ts`(三种 `deltaMode`、Shift 下 x/y 取舍、两轴都动取竖向)、`fader-wheel.test.ts`(鼠标一格 100px 出 2 步、触控板 12px×5 累计 60 出 1 步余 10、方向反转清零、大 delta 一次多步、零位移)、`page-wheel.test.ts`(鼠标一格恰好一页且紧随第二格被冷却吞掉、触控板 30 个递减事件只出一页、冷却结束需**同时**满足静默与最短间隔、方向反转清零、静默后反向再出一页)、`wheel-gesture.test.ts`(`begin` 不换人、`touch` 续期十次不早结束、静默后 `onEnd` 恰好一次且不重复、过期后可被新持有者 `begin`、过期但定时器未跑到时补发 `onEnd`、`reset` 不触发 `onEnd`)。九种归属边界情形在 `apps/web/tests/mixer-wheel.integration.test.tsx` 里一例一条,编号与提示词第 5 节一致。**手感(多少格一页、跟不跟手)移交用户真机调参。**

**5. 电平表 — 未做。** 见第 8 节「关键决策与偏离」。两种视口的帧间隔与长任务数字**本报告没有**,`.meter__fill` 的 `clip-path` 绘制未改。

**6. 全量质量门 — 通过。** 见第 1 节。远端 CI 结果见第 12 节。

## 3. 实现摘要

### 3.1 切页纯函数与布局常量

`apps/web/src/features/mixer/page-layout.ts` 只放七个像素常量,`MixerPage` 把它们作为 CSS 自定义属性写在 `.mixer-shell` 的内联 `style` 上,`styles.css` 对应位置一律改 `var(...)`,TS 与 CSS 由此只有一个真相来源。

`pagination.ts` 的 `paginate()` 是不依赖 DOM 的纯函数,签名与提示词一字不差。代价规则实现为一个私有 `stripCost(metrics, header, segmentOpen, pageUsed)`:页非空时先加段间距(换段)或条间距(同段续条),带表头的段在本页首条再加表头宽与一个条间距,最后加条宽;溢出时开新页并以「页为空」重算代价。溢出判断只在 `used > 0` 时进行,所以容器再窄也不死循环、每页至少一条。

一处需要点名的定义:`continued` 我实现为「**该段在更早的页上已经出过条目**」,不限于带表头的段。提示词的注释写的是「the header repeats a segment that started on an earlier page」,对带表头的段两种定义等价;对无表头的跨页段,我的定义会给出 `continued: true` 而 `header: false`,渲染上没有任何区别(没有表头可重复)。选这个定义是因为它更好说明,JSDoc 已写清。

### 3.2 页面骨架

`.mixer-shell` 从 `min-height: 100vh` 改为 `height: 100dvh`,`.console-header` 去掉 `position: sticky`(外壳已把它钉在第一行)。中间行换成 `div.mixer-deck`(`grid-template-columns: 1fr auto`),左格是分页视口 `.mixer-bays`,右格是安全区——用 `auto` 而不是 `var(--page-rail-width)`,宽度由 `.page-rail` 自己声明,效果相同但让「先有 deck、后有 rail」的提交能各自独立为绿。

页头压缩为单行:`.console-header` 改 `grid-template-columns: auto auto auto auto auto 1fr`、`min-height: 3rem`;`.console-preferences` 改 `display: contents`,于是 `ViewSelector` / `TypeRowToggle` / `ControlLock` 直接成为页头 grid 的格子,分隔线从 `border-bottom` 改为 `border-right`;`.console-brand` 改横排、`h1` 降到 `0.8rem`(与 eyebrow 同级);`.loudness-panel` 两读数与 `RESET` 本来就是一行,只收紧了尺寸并 `justify-self: end`。`.notice` 是 `position: fixed`,`top` 由 `7.3rem` 跟到 `3.8rem`。≤800px 的既有 `@media` 改为把页头切成 `display: flex; flex-wrap: wrap`,同一批格子自然折成两行,不为窄屏另做设计。**组件 DOM 与可访问名一律未改,只改样式与容器。**

`TYPE ROWS` → `TYPE PAGES`:显示文字、两条默认/传入 label 的 `row` → `page`。`localStorage` 键 `flwc.layout.typeRows` 与 hook 名 `useTypeRowsPreference` **不变,不做偏好迁移**(提示词要求),所以旧偏好会原样继承为新语义。

条带撑满:`.mixer-bays` 改 `overflow: hidden auto; padding: 0`;内部 `.mixer-pages` 轨道 `display: flex; height: 100%; transform: translateX(calc(-100% * var(--page-index)))`,`transition: transform var(--page-transition) ease`,`prefers-reduced-motion: reduce` 下 `transition: none`;每页 `.mixer-page` 是 `flex: 0 0 100%; height: 100%; min-height: var(--strip-min-height)` 的 flex 行,内边距从 `.mixer-bays` 移到这里。视口过矮的降级完全由 CSS 得到,没有任何 JS 判定。

段与条带:`.mixer-section` 从 `display: contents` 改为真 flex 容器(含表头与全部条带),`.mixer-section + .mixer-section { margin-left: var(--segment-gap) }` 就是段间距。**删除** `.channel-group-lead`、`.channel-bay`、`.view-row-break`、`.channel-strip.is-after-group` 与全部 `.mixer-bays.is-type-rows …` 规则(横排表头变体一并删,分页下表头永远竖排)。`.mixer-section__header` 与 `.channel-strip` 改 `height: 100%` 并去掉 `min-height: 33rem`;`.channel-strip` 的 grid 行末位改 `minmax(0, 1fr)`,`.channel-strip__controls` 加 `min-height: 0` 与 `grid-template-rows: minmax(0, 1fr)`;`.fader` 与 `.meter` 的 `grid-template-rows` 由 `21rem 2.6rem` 改为 `minmax(0, 1fr) 2.6rem`。`missing-channel-strip__trace` 加 `min-height: 0` 吃掉剩余。`--strip-index` 改为按条带在**本页**内的序号。

### 3.3 翻页状态、安全区与键盘

`use-pager-viewport.ts` 用 **callback ref** 而不是提示词写的 `usePagerViewport(ref)`,这是本批次唯一一处偏离签名的地方,原因是实测的 bug:混音页在空态时整个 deck 不渲染,`useLayoutEffect(..., [ref])` 会对着 `null` 量一次就再也不看,快照到达后宽度永远是 0、每条一页。改成 callback ref 后元素挂载即量。宽度在 ref 回调里直接读 `clientWidth`(不是在 effect 里 `setState`,那会被 `react-hooks/set-state-in-effect` 拦下),之后由 `ResizeObserver` 维护;`ResizeObserver` 不存在时(jsdom)就以挂载那次为准。

`use-pager.ts` 的 `pageIndex` 钳位用「渲染期调整 state」而不是 effect(同上,lint 规则)。语义:页数减少钳到末页**并留在那里**,页数恢复不弹回;`resetKey`(`activeViewId`)变化才回第 0 页。`clampPageIndex` / `nextPageIndex` 导出单测。

`MixerPage` 把 All Channels 的类型段与 view 的 `ViewSegment` 都映射成 `LayoutSegment<StripStub>`。`StripStub` 是 `{ key, render(position) }` 的渲染存根——这样 `paginate` 保持提示词给的泛型签名不变,而未挂载的页根本不会调用 `render`,`Meter` 自然不订阅。表头文案、计数、accent、`data-channel-kind` / `data-view-group-id` 走一张 `Map<segmentKey, SegmentChrome>` 交给 `StripPages`,因为 `PageSegment<T>` 的字段是提示词固定的,带不了额外元数据。

`StripPages.tsx` 只挂载 `|index - pageIndex| <= 1` 的页,其余渲染为同宽空 `.mixer-page` 占位。**未挂载与相邻页都不加 `aria-hidden`**:RTL 的 `getByRole` 会跳过 `aria-hidden` 子树,加了会让相邻页的条带在测试里凭空消失,而它们确实是真实内容。`continued` 的表头照常渲染,`h2` 的 `id` 一律加 `-p<页号>` 后缀(相邻页同时挂载,同一个段可能出现两次,`id` 必须唯一);不加任何 `cont.` 标记,计数仍是该段在场总数。无表头段也包在一个不带 `aria-labelledby` 的 `section.mixer-section` 里,段间距因此对它同样成立。

`PageRail.tsx` 是 `aside.page-rail[aria-label="Pages"]`,自上而下:`button[aria-label="Previous page"]`(自绘 chevron)、`output[aria-label="Page"]`(`2 / 5`)、`button[aria-label="Next page"]`、占满剩余高度的 `div.page-rail__track[data-swipe-surface]`。按钮沿用 `.on-button` 那套 bevel / 内阴影 / `:active` 位移。`touch-action: none; user-select: none`,常驻,不随页数移动。

键盘监听挂在 `window`:`event.defaultPrevented` 为真、或 `event.target` 命中 `[role="slider"], input, select, textarea, [contenteditable]` 时不处理。两道闸都留着——`Fader` 会 `preventDefault`,但一个不 `preventDefault` 的控件也不该被抢键。

### 3.4 滚轮:归属模块与两个 reducer

四个纯模块都在 `apps/web/src/lib/`(`components/Fader` 与 `features/mixer` 都要用,`components` 不得反向依赖 `features`),常量值一律照抄提示词。

两个实现细节值得记:

- `reduceFaderWheel` 返回 `steps` 时对零做了符号保护(`steps === 0 ? 0 : steps * direction`),否则向下滚不足一步会返回 `-0`,`toBe(0)` 判不过。
- `wheelGestureTracker` 单例的时钟写成 `{ now: () => performance.now(), ... }` 而非 `{ now: performance.now }`:后者既丢 `this`,又在模块加载时就绑死了真实实现,`vi.useFakeTimers({ toFake: [..., 'performance'] })` 假不动它。单例会在测试之间串味,所以 `vitest.setup.ts` 的全局 `afterEach` 统一 `wheelGestureTracker.reset()`,不靠各测试文件自觉。
- `begin()` 多一条防线:持有者已过期但它自己的定时器还没跑到时,先补发一次 `onEnd` 再交给新持有者,否则上一位的 commit 会丢。`wheel-gesture.test.ts` 有对应用例。

### 3.5 滚轮接入

`Fader` 新增必填 prop `wheelId`,轨道加 `data-wheel="level"`。监听用原生 `addEventListener('wheel', handler, { passive: false })`(React 的 `onWheel` 是 passive,不能 `preventDefault`),**只注册一次**:随渲染变化的东西(`disabled` / `dragging` / `value` / 三个回调)写进一个每次渲染后同步的 `latest` ref,handler 只读 ref,既不重复订阅也不会拿到陈旧闭包。步进用 `stepLevelDb(latest, dir, event.altKey)`,与键盘方向键 / `PageUp` 完全对齐。整次手势只 `onCommit` 一次,由归属模块的静默回调触发。两条提前 commit 的路径:`useEffect` 监听 `disabled` 由 false 变 true(锁定或断线),以及 `handlePointerDown` 里手落到帽子上时。**推子既有的五条交互一字未改。**

分页监听挂在 `.mixer-deck`(经 `useState` 持有节点,理由同 3.3:空态会把 deck 整个换掉),覆盖分页视口与安全区。表面判定 `target.closest('[data-wheel="level"]')`,归属查询与推子共用同一个单例。**两个监听器只通过 `wheelGestureTracker` 相互感知**,`Fader` 不知道分页,`MixerPage` 不知道推子内部。

冒泡是子先父后,所以 `Fader` 的 handler 一定先于 `.mixer-deck` 的跑,九种情形在这个顺序下自洽:轨道上非 Shift 起手 → Fader 先认领、视口随后在第 2 步吞掉;Shift 起手 → Fader 在第 2 步不认领也不 `preventDefault`,视口在第 3 步认领 `page`。

### 3.6 电平表实测 —— 本节整节未执行

提示词第 6 节要求在云端起合成电平服务(临时目录装 `socket.io`)+ Playwright 驱动预装 Chromium,在 1920×1080 与 3840×1080 两种视口实测 40 通道 20 Hz 下的帧间隔 p50/p95/最大值、>34 ms 帧占比与长任务次数,超预算则把 `.meter__fill` 改为 `transform: scaleY()` 绘制并重测。

**本会话没有做这一节的任何一步。** 用户在另一会话实测确认云端做不了,决定整节跳过,留给本地 agent 之后新建一个小批次单独做。因此:

- 没有合成电平服务,没有浏览器冒烟,没有截图;
- **两种视口的原始数字本报告一个也没有**;
- `.meter__fill` 的 `clip-path: inset(var(--meter-reveal) 0 0)` 与 `.meter__peak` 的 `bottom` 绘制**保持原样未改**,`Meter.tsx` 与 `Meter.test.tsx` 未动(它们读的都是百分比,条带高度翻倍不影响断言)。

条带高度大约翻倍是这次布局改动的直接后果,电平表的重绘面积随之翻倍,**这个开销目前没有任何测量数据支撑**。见第 11 节移交事项。

### 3.7 文档

`docs/architecture.md`「通道分组」末尾那句关于混音页渲染与 `TYPE ROWS` 横排的描述改写为分页描述;「前端结构」新增「混音页分页」与「滚轮」两条;「推子拖动」一条补了滚轮路径的 commit 时机。只描述当前状态,不留历史。`docs/development-plan.md` 未改(验收框由用户勾选),`docs/fairlight-ember.md` 未动。

## 4. 数值初值清单

表中标 †  的是**验收反馈后改动或新增的**(见第 13 节),其余全部为提示词给定的初值,一个都没有自行调整,也没有调换单位。

| 名称 | 值 | 含义 | 文件 |
| --- | --- | --- | --- |
| `STRIP_WIDTH_PX` | 148 | 通道条宽度(原 9.25rem),也是切页用的最窄值 | `apps/web/src/features/mixer/page-layout.ts` |
| † `STRIP_WIDTH_MAX_PX` | 176 | 通道条可被拉宽到的上限 | 同上 |
| `SECTION_HEADER_WIDTH_PX` | 52 | 分区/分组竖排表头宽度(原 3.2rem) | 同上 |
| † `SECTION_HEADER_GAP_PX` | 1 | 表头与其后首条之间的间距,**固定,不参与放大** | 同上 |
| `STRIP_GAP_PX` | 1 | 同段两条通道条之间的间距 | 同上 |
| † `STRIP_GAP_MAX_PX` | 6 | 条间距可开到的上限 | 同上 |
| `SEGMENT_GAP_PX` | 14 | 相邻两段之间的间距(原 0.85rem) | 同上 |
| † `SEGMENT_GAP_MAX_PX` | 28 | 段间距可开到的上限 | 同上 |
| `PAGE_PADDING_X_PX` | 24 | 每页左右各留的内边距(原 1.5rem),**不是**放条带的地方,切页宽度要先减掉它 | 同上 |
| `STRIP_MIN_HEIGHT_PX` | 528 | 页的最小高度(原 33rem),低于它降级为页内滚动 | 同上 |
| † `PAGE_RAIL_WIDTH_PX` | 72 | 右侧安全区宽度(原 56,验收后加宽) | 同上 |
| `PAGE_TRANSITION_MS` | 220 | 翻页 transform 过渡时长 | 同上 |
| `WHEEL_LINE_HEIGHT_PX` | 16 | `deltaMode` 1(行)归一化为像素的系数 | `apps/web/src/lib/wheel-delta.ts` |
| `WHEEL_PAGE_HEIGHT_PX` | 800 | `deltaMode` 2(页)归一化为像素的系数 | 同上 |
| `FADER_WHEEL_STEP_PX` | 50 | 推子滚轮每出一步所需的累计位移 | `apps/web/src/lib/fader-wheel.ts` |
| `PAGE_WHEEL_THRESHOLD_PX` | 60 | 一次手势翻第一页所需的累计位移 | `apps/web/src/lib/page-wheel.ts` |
| † `PAGE_WHEEL_REPEAT_THRESHOLD_PX` | 120 | 同一手势内续翻所需的累计位移 | 同上 |
| † `PAGE_WHEEL_QUIET_MS` | 150 | 判定手势结束的静默时长(语义改为「续翻阈值降回首翻阈值」) | 同上 |
| † `PAGE_WHEEL_COOLDOWN_MS` | 180 | 两次翻页之间的最短间隔(原 300;须小于 `PAGE_TRANSITION_MS`) | 同上 |
| `WHEEL_GESTURE_IDLE_MS` | 150 | 判定一次滚轮手势结束的静默时长 | `apps/web/src/lib/wheel-gesture.ts` |

(`PAGE_PADDING_X_PX` 是评审后补的,见第 10 节;它不是提示词给的初值,而是把原本硬编码在 CSS 里的 `1.5rem` 提出来,让 TS 与 CSS 继续只有一个真相来源。)

另有两个非「初值」性质的内部常量:`MOUNTED_PAGE_RADIUS = 1`(`StripPages.tsx`,当前页前后各挂载几页)与测试夹具 `STUB_PAGER_WIDTH_PX` / `STUB_PAGER_HEIGHT_PX`(`apps/web/tests/stub-mixer-layout.ts`,由 `page-layout.ts` 的常量算出,不是独立数值)。

已知的初值取舍(提示词已点明,原样保留):Firefox 的一格是 `deltaMode` 1、`deltaY` ±3,归一化为 48px,**不足 60px 阈值,翻不了页**。这一条由用户真机调参。

## 5. 真机验收操作清单(移交用户)

**安全约束**:本批次改的是混音页布局与输入方式,分页、翻页、页头与安全区本身不会改动 Fairlight 任何参数;验收过程中不要操作混音页推子;如确需操作,只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子并测后复原;不得切 ON/mute、不得动其它通道、不得删改任何通道。**滚轮验收只在 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个推子上做,做完把它们的电平复原到验收前的值。**

启动:仓库根目录 `pnpm install --frozen-lockfile`(本地不受 codeload 限制)→ `pnpm dev`(server 3000 + web 5173)→ 浏览器打开 `http://localhost:5173`,确认页头 `MIXER ONLINE`。

**0. 先看骨架(不碰任何控件)**

1. 页头应当是**一行**:品牌 + `CONFIGURE VIEWS`、连接状态、VIEW 下拉、`TYPE PAGES`、`CONTROL LOCK`、响度读数与 `RESET` 横向排开,高度约 3rem。
2. 通道条应当**从页头下缘一直撑到页脚上缘**,比改动前高出约一倍,推子轨道随之拉长;电平表同样变长。
3. 右侧应当有常驻的安全区:上箭头、页码(如 `1 / 4`)、下箭头,下面是一片空白轨道。
4. 把浏览器窗口横向拉宽/收窄:每页条数应当跟着变,页码总数跟着变,**横向永远不出现滚动条**。
5. 把窗口高度压到很矮(约 600px 以内):应当出现**纵向**滚动条,布局不塌,条带保持最小高度。

**鼠标路径(桌面浏览器)**

1. 点安全区的下箭头/上箭头:应当一次一页,有平滑的横向滑动动效。首页时上箭头置灰,末页时下箭头置灰。
2. 只有一页时(切到一个只有两三个通道的 view):两个箭头都置灰,页码显示 `1 / 1`。
3. 在**通道条之间的空隙**滚一格鼠标滚轮:应当**恰好翻一页,不跳页**。连滚几格,确认每格一页。
4. 在**通道名称、ON 按钮、电平表、读数、分区表头、安全区**上各滚一格:全部都应当翻页。
5. 在 **BASS 的推子轨道**上滚:推子应当跟着动(一格约 2 dB),**页不翻**;按住 Alt 再滚,一步 10 dB。滚完静默一下,读数稳定即写入生效。**记下原值,测完复原。**
6. 在 BASS 轨道上开始滚,滚动过程中把鼠标移到空隙上继续滚:**推子不再动,页也不翻**;不停手再把鼠标移回轨道:同一个推子继续动。停手后推子只写一次。**测完复原。**
7. 在空隙开始滚翻页,翻页后新页的推子正好滑到指针下方,继续滚:**那个推子一动都不能动**。这一条是最要紧的——它错了就会在演出中误推一路电平。
8. 按住 Shift 在 BASS 轨道上滚:应当**翻页**,推子不动。
9. 把 `CONTROL LOCK` 切到 `FADERS`,在 BASS 轨道上滚:推子不动、**页也不翻**、什么都不发生。切回 `UNLOCKED`。
10. 在 BASS 轨道上滚到一半,不停手把 `CONTROL LOCK` 切到 `FADERS`:推子应当**立刻停在当前值并写入**,之后同一次手势里的滚动既不调推子也不翻页。**测完复原。**

**触控板路径(笔记本)**

1. 在空隙上做一次惯性滑动(两指快速划一下再松开):应当**恰好翻一页**,不能连翻。
2. 慢慢地两指滚动:也应当一页一页地走,不跳。
3. 在 BASS 轨道上两指滑动:推子应当跟手,松手后静默约 150 ms 写入一次。**测完复原。**
4. 惯性还没停时把手指移开轨道:推子应当停住,页不翻。

**键盘路径(桌面浏览器)**

1. 焦点不在任何控件上时按 `PageDown` / `PageUp`:翻页。
2. 用 Tab 把焦点移到 BASS 的推子上再按 `PageDown`:应当是推子 **−10 dB**,**页不翻**。**测完复原(按 `PageUp` 或双击帽子回 0 dB 前先确认原值)。**
3. 焦点在 VIEW 下拉或任何输入框里时按 `PageDown`:不应翻页。

**触屏路径(平板)**

1. 安全区的上下箭头应当好按(实体按键质感,按下有位移),一次一页。
2. 在安全区上下划动:**本批次还没有滑动翻页**(留给 6.4),划不动是预期的,不是 bug。
3. 页面不应当因为触摸安全区而滚动或选中文字。
4. 横屏与竖屏各看一遍:条带撑满、页头一行(窄屏可能折两行,也算正常)。

**电平表(这一条本批次没有任何数据支撑,请重点看)**

1. 让 40 个左右的通道都在推电平,**盯着电平表连续看 1 分钟**:表头跳动应当跟手、不掉帧、不卡顿;翻页过程中也不应当明显卡。
2. 如果肉眼就能看出掉帧或翻页发卡,请记下现象与视口大小——这正是被推迟的那一小批次要解决的问题(把 `.meter__fill` 从 `clip-path` 改为 `transform: scaleY()` 绘制)。

## 6. 交付物清单

新增:

| 文件 | 作用 |
| --- | --- |
| `apps/web/src/features/mixer/page-layout.ts` | 像素常量,TS 与 CSS 的共同真相来源 |
| `apps/web/src/features/mixer/pagination.ts` | `paginate()` 切页纯函数 |
| `apps/web/src/features/mixer/pagination.test.ts` | 切页七例 |
| `apps/web/src/features/mixer/page-fit.ts` | `fitPages()`:排完页之后把余量花成间隙、条宽与居中(验收反馈补) |
| `apps/web/src/features/mixer/page-fit.test.ts` | 自适应布局十一例 |
| `apps/web/src/features/mixer/use-pager-viewport.ts` | 量分页视口宽度(callback ref + ResizeObserver) |
| `apps/web/src/features/mixer/use-pager-viewport.test.tsx` | 挂载即测量、无 ResizeObserver 时的退化 |
| `apps/web/src/features/mixer/use-pager.ts` | `pageIndex` 状态与 `clampPageIndex` / `nextPageIndex` |
| `apps/web/src/features/mixer/use-pager.test.ts` | 钳位、重置、页数增减 |
| `apps/web/src/features/mixer/StripPages.tsx` | 分页轨道与页渲染,只挂载相邻页 |
| `apps/web/src/features/mixer/PageRail.tsx` | 右侧安全区 |
| `apps/web/src/lib/wheel-delta.ts` | `deltaMode` 归一化与 Shift 轴取舍 |
| `apps/web/src/lib/wheel-delta.test.ts` | 同上 |
| `apps/web/src/lib/fader-wheel.ts` | 推子滚轮 reducer |
| `apps/web/src/lib/fader-wheel.test.ts` | 同上 |
| `apps/web/src/lib/page-wheel.ts` | 翻页滚轮 reducer |
| `apps/web/src/lib/page-wheel.test.ts` | 同上 |
| `apps/web/src/lib/wheel-gesture.ts` | 手势归属(纯函数核心 + 注入时钟的包装 + 模块单例) |
| `apps/web/src/lib/wheel-gesture.test.ts` | 同上 |
| `apps/web/tests/stub-resize-observer.ts` | 可控 `ResizeObserver` 双替 |
| `apps/web/tests/stub-mixer-layout.ts` | 分页视口与页的 `clientWidth` / `clientHeight` / `scrollHeight` / `scrollTop`,以及 `resizePager()` / `scrollPage()` |
| `apps/web/tests/mixer-pages.integration.test.tsx` | 分页、翻页与自适应布局十六例 |
| `apps/web/tests/mixer-wheel.integration.test.tsx` | 滚轮归属、滚动接续与连续翻页十七例 |
| `docs/reports/phase-6-3-report.md` | 本报告 |

修改:`apps/web/src/features/mixer/MixerPage.tsx`、`TypeRowToggle.tsx`、`TypeRowToggle.test.tsx`、`ChannelStrip.tsx`、`apps/web/src/components/Fader.tsx`、`Fader.test.tsx`、`apps/web/src/styles.css`、`apps/web/vitest.setup.ts`、`apps/web/tests/mixer.integration.test.tsx`、`apps/web/tests/views.integration.test.tsx`、`docs/architecture.md`。

未改动:`apps/server`、`packages/shared`、`packages/test-utils`、`features/settings/`、CONNECTION 面板、`Meter.tsx` / `Meter.test.tsx`、CI 流水线、`docs/development-plan.md`、`docs/fairlight-ember.md`、`pnpm-lock.yaml`。

## 7. 依赖清单

**无新增依赖,`pnpm-lock.yaml` 无 diff**(`git diff --stat pnpm-lock.yaml` 为空,已核对)。

临时目录里也**没有**装任何东西:提示词第 6 节要求的 `socket.io`(合成电平服务)与 `playwright-core`(冒烟驱动)因该节整节跳过而未安装。`/opt/pw-browsers` 的预装 Chromium 未使用。

## 8. 关键决策与偏离

1. **第 6 节整节跳过(用户决定)。** 用户在另一会话验证云端确实跑不了合成电平服务 + Playwright 实测,决定不在本批次做,留给本地 agent 新建一个小批次。因此电平表的两组帧率数字缺失,`.meter__fill` 的绘制方式保持 `clip-path` 未改,浏览器冒烟与截图一并没有。这是本批次最大的证据缺口,已在第 2、3.6、11 节各记一次。

2. **`usePagerViewport` 的签名从 `usePagerViewport(ref)` 改为返回 callback ref。** 提示词写的是接收一个 ref 参数。实测下来这个形态是错的:混音页在空态时不渲染 deck,`useLayoutEffect(..., [ref])` 对着 `null` 量一次就再也不重跑,快照到达后宽度永远是 0,于是每条通道一页、只挂载前三页,`views.integration.test.tsx` 直接挂掉。改成 callback ref 后元素挂载即量。这是本批次唯一一处偏离提示词给定签名的地方。

3. **`.mixer-deck` 用 `grid-template-columns: 1fr auto` 而不是 `1fr var(--page-rail-width)`。** 宽度改由 `.page-rail` 自己声明,视觉结果相同,好处是「先落 deck、后落 rail」这两个提交都能各自为绿。

4. **`continued` 定义为「该段在更早的页上已出过条目」**,不限于带表头的段。对带表头的段与提示词等价;对无表头的跨页段会是 `true`,但没有表头可重复,渲染无差别。理由与 JSDoc 见 3.1。

5. **`paginate` 的溢出判定用 `accumulated >= 阈值`(达到即触发),`reducePageWheel` 同理。** 提示词写「超过阈值」,取「达到」是为了让触控板 5 × 12px 恰好累计到 60 就翻页,与「一次惯性滑动恰好一页」的目标一致。

6. **`StripPages` 不给任何页加 `aria-hidden`。** 相邻页是真实内容,而 RTL 的 `getByRole` 会跳过 `aria-hidden` 子树,加了会让相邻页的条带在测试里凭空消失。

7. **跨页重复的表头 `id` 加 `-p<页号>` 后缀。** 相邻页同时挂载时同一个段会出现两次,`id` 必须唯一。既有契约约束的是结构(`section[aria-labelledby]` + `h2` + `span`)而不是 id 字符串,既有测试也都按 role + name 定位,没有受影响。

8. **`.console-preferences` 改 `display: contents`** 以让三个偏好成为页头 grid 的格子,由此丢掉了它自己的 `border-right`(改挂到 `.control-lock` 上)。≤800px 时页头改用 `flex-wrap` 而不是继续用 grid 跨列,因为 `display: contents` 的子项没法再靠 `grid-column` 跨列。

9. **两处 lint 规避写法**:`use-pager-viewport` 在 ref 回调里量宽度、`use-pager` 在渲染期调整 `pageIndex`,都是为了避开 `react-hooks/set-state-in-effect`;`usePagerViewport()` 的返回值在调用点解构,是为了避开 React 编译器把整个返回对象当成 ref 而报「Cannot access refs during render」。**没有使用任何 eslint-disable。**

10. **`claim(_state, owner, now)` 的首参未使用**,保留只是为了不动提示词给的签名,加了下划线前缀让 `noUnusedParameters` 放行。

## 9. 被改写的既有用例清单

只改定位方式与夹具,**断言意图全部保留**。

| 文件 | 用例 | 原断言 | 改为 |
| --- | --- | --- | --- |
| `src/features/mixer/TypeRowToggle.test.tsx` | `renders an English switch with the current state` | `getByText('TYPE ROWS')`、可访问名 `Start each channel type on a new row`(2 处) | `TYPE PAGES`、`... on a new page` |
| `tests/mixer.integration.test.tsx` | `places ON above the fader and persists the optional type-row layout` → 标题改 `type-page` | `.mixer-bays` 的 `is-type-rows` class 增删 | 开关的 `aria-checked` 由 `false` 翻到 `true`,`localStorage` 断言不变 |
| 同上 | `aligns meter and level readouts and applies channel type colors` | `[data-channel-kind="channel"] .channel-group-lead` 包含 INPUTS 表头与 BASS 条带 | 改为 `[data-channel-kind="channel"]` 这个 section 本身包含两者 |
| `tests/views.integration.test.tsx` | `switches to ordered view channels…` | `queryByRole('switch', { name: /new row/i })` | `/new page/i` |
| 同上 | 同上 | `.mixer-bays > article h3`(直接子选择器,分页容器插进来后必挂) | `article.channel-strip h3` |
| 同上 | `creates, selects, reorders, colors, renames, and saves a view` | 同上 | 同上 |
| 同上 | `groups channels in the configuration page and renders group sections` | `section.querySelector('.channel-group-lead')` 包含 MAIN 条带 | `section` 本身包含 MAIN 条带 |
| 同上 | 同上 | 开关名 `Start each group on a new row`;`.mixer-bays` 的 `is-type-rows` 增删 | 名称改 `... on a new page`;改断开关的 `aria-checked` 翻转 |
| 同上 | `adds a gap after a group before a loose strip…` | `[data-channel-id]` 上的 `is-after-group` class(4 处) | 先 `resizePager(2000)` 保证一页装得下,再断言三个条带各自 `closest('.mixer-section')` 的异同——组后的散条与组不同段、相邻散条同段 |
| `src/components/Fader.test.tsx` | `renderFader` 夹具、`uses the full shortened track…` | 无 `wheelId` | 补 `wheelId`(必填 prop) |

`tests/settings-groups.integration.test.tsx` 用的是 `article.channel-strip`(后代选择器),未受影响,未改。

## 10. 评审后的修订

PR #18 的远端 CI 一次全绿,但 **Cursor Bugbot 前后报了五条(后三条都是针对上一次修复本身的),核对下来全部成立,全是本批次引入的真 bug**。每条都先写出会红的用例复现,再改,改完确认用例转绿,并逐条验证过「把修复摘掉用例就变红」。

其中 10.2–10.5 是**同一处的四连报**:前三次我都在挪「状态归属」,第四次才看出还有一层是「取得回调」与「有能力兑现回调」之间被提前返回拆开。这四条(以及 10.1)全部落在 jsdom 看不见的地方——页面几何与组件生命周期——我原来的用例都建立在「组件树稳定」的前提上,从没在手势进行中拆过组件、也没在拆过之后再叠加锁定。这是测试方式的缺口,不是五次运气不好。**这一块(推子滚轮 × 重挂 × 锁定)是本批次最需要真机复核的地方**,已写进第 11 节移交事项。

### 10.1(High)页内边距把最后一条通道条切掉

`styles.css` 有全局 `* { box-sizing: border-box }`,而 `.mixer-page` 是 `flex: 0 0 100%` 且 `padding: 0.9rem 1.5rem`,所以它的**内容盒**比分页视口窄 48px。`MixerPage` 却把整个 `clientWidth` 当 `containerWidth` 交给 `paginate`,于是每页最多多塞 48px 的条带,超出部分被 `.mixer-bays` 的 `overflow: hidden` 横向裁掉——**一条通道条会半截露在屏幕外**,恰恰是分页最不该出的问题。这个缺陷从「3.2 页面骨架」落地起就在,本会话的所有测试都没抓到:既有断言比的是页数的相对变化,不是每页装得下几条。

改法:把 `1.5rem` 提为 `PAGE_PADDING_X_PX = 24` 并发布为 `--page-padding-x`,切页宽度改成 `Math.max(0, viewportWidth - 2 * PAGE_PADDING_X_PX)`;`.mixer-page` 的横向内边距改读该变量;≤800px 的 media query 原本把横向内边距压到 0.75rem,会让 TS 与 CSS 再次对不上,改成只覆盖纵向(`padding-block`)。测试夹具 `STUB_PAGER_WIDTH_PX` 与 `mixer-wheel` 的 `PAGE_WIDTH` 同步加上这段内边距。

回归锁:`mixer-pages.integration.test.tsx` 的 `packs a page to its content box, not over it`——视口正好够 6 条时第一页 6 条,少 1px 就只有 5 条。改之前这一例是红的。

### 10.2(Medium)重新挂载的推子会写入过期电平

`wheel-gesture.ts` 的 `begin()` 在已有持有者时直接 `return existing`、**丢弃传入的回调**,而 `Fader` 只在 `owner === null` 时才调 `begin`。于是一次滚轮手势进行中,若该通道条被 React 重新挂载(`mixer:patch` 改动通道顺序,或窗口尺寸变化让它换到另一个 `.mixer-page`——页是按序号做 key 的),新实例发现持有者已经是自己这个 channel id,就走「已持有」分支、永远不再登记。tracker 于是攥着**已卸载实例**的 `commitWheelGesture`:静默时写入旧实例的 `latestValueRef`(操作员已经滚过去、放弃了的值),而屏幕上那个真实的最终值一次都不写。演出中最坏的形态就是它。

改法:同一个 owner 再次 `begin` 时**采纳它传入的回调**(结束手势的必须是还在屏幕上的那个实例);**不同 owner 依然一律不换人**,这条保证「一次手势只属于一个表面」的语义完全没动。`Fader` 相应改为持有者为空**或**已是本推子时都调 `begin`。不需要在卸载时补 commit——每一步 `onValueChange` 都过 `setLocalLevel`,新实例首次出步以 store 当前值起步,数值是连续的。

回归锁:`wheel-gesture.test.ts` 的 `adopts the callback of the same owner beginning again`,以及 `mixer-wheel.integration.test.tsx` 的第 10 例(手势中把视口从三页拉成一页、迫使条带重挂,静默后只有一次 commit 且是新实例的最终值)。两例都验证过:把修复摘掉就变红。

### 10.3(Medium)重新挂载后手势可能一次都不写 —— 10.2 那版修复的续病

Bugbot 在 10.2 的修复上又报了一条,**同样成立,是我自己的修复引入的**。`commitWheelGesture` 在 `wheelActiveRef` 为 false 时直接 return,而新挂载的实例这个 ref 就是 false。于是:旧实例 A 已经出过步(`onInteractionStart` 调过,通道进了 `pendingLevels`,值累到 −22),重挂后新实例 B 在下一个滚轮事件上把回调换成了自己的;**如果那个事件小到不够一步**(触控板惯性的尾巴),B 永远不出步、`wheelActiveRef` 一直是 false,静默时 B 的回调直接 return——**A 的值没人写,B 也没得写,通道就卡在 pending**,不再跟随设备的远端更新。10.2 只是把「写错值」换成了「一次都不写」,后者其实更难察觉。

改法:`Fader` 增加卸载时的收尾 —— 组件卸载时若手势还开着就先 commit。接管手势的新实例本来就无从知道旧实例累到了哪里,让离场的实例自己把话说完最直接;新实例之后若真出了步,静默时再写一次它自己的终值。重挂这种少见情形下会有两次写,但两次写的都是操作员真的经过的电平,最后一次是终值,而 pending 卡死的状态被彻底消掉。10.2 的 re-adopt 仍然需要:没有它,新实例出的步依然没人写。

回归锁:`mixer-wheel.integration.test.tsx` 第 11 例——手势中重挂,再派一个不够一步的尾巴事件,断言仍然恰好多出一次写、值为 −22,且 `await act` 冲掉 ack 的微任务后 `.fader` 不再带 `is-pending`。摘掉修复即变红,已验证。

### 10.4(Medium)卸载即 commit 会把还没结束的手势拽回去 —— 10.3 那版修复的续病,也是**根因所在**

Bugbot 在 10.3 的修复上又报一条,**成立**。卸载时 commit 会走完 `onCommit` → ack → `finishLevelInteraction`:后者清掉 `pendingLevels[id]`,并把期间攒下的 `remoteValue`(设备回声)应用上去。可操作员**根本还没松手**——重挂后的新实例还在继续滚。于是 pending 一清,设备的旧值就盖回本地值,**操作员正在推的推子会往回跳**。

到这里已经是同一处连报三条(10.2 / 10.3 / 10.4),说明前两次都在打补丁而没治根。**根因是:一次滚轮手势的生命周期比组件实例长,但「这次手势是否已经动过东西、动到了哪里」这两样状态却存在实例的 ref 里。** 谁持有真相随着重挂来回变,补丁只是把漏洞从一个位置挪到另一个位置。

治根的改法:把「本次手势是否已经动过东西」这一位状态**移进 `wheelGestureTracker`**(`isActive` / `markActive` / `clearActive`,认领新持有者与手势结束时自动清零)——它本来就是手势的属性,不是组件的属性。于是:

- **卸载时不再 commit**(10.4 消失)。离场实例的回调仍挂在 tracker 上、`wheelActiveRef` 仍为 true,若此后再无事件,静默时由它写出终值、pending 正常清除(10.3 想要的效果照旧成立)。
- 重挂后的新实例在自己第一次处理事件时,若发现「我持有这次手势、但我还没动过、而 tracker 说这次手势已经动过」,就**接管**:把 `wheelActiveRef` 置真、`latestValueRef` 取 store 的当前值(正是前一个实例推到的位置),不重复 `onInteractionStart`。它随后的静默 commit 覆盖整段手势(10.3 消失)。
- 10.2 的 re-adopt 保留:没有它,tracker 手里还是旧实例的回调。

结果是三条一并解决,而且是同一条规则:**一次手势自始至终只写一次,由最后持有它的那个实例写,且绝不在手势还活着的时候写。**

回归锁:`mixer-wheel.integration.test.tsx` 第 12 例——手势中重挂,断言通道仍是 pending、随后设备推来旧值的 patch 也不会把推子拽回去,继续滚仍从 −22 走到 −24,静默后只写一次终值;外加 `wheel-gesture.test.ts` 两例覆盖 active 位的生命周期。第 10、11、12 例都验证过「摘掉对应那半边修复就变红」。

### 10.5(Medium)接管发生在「锁定即返回」之后,被锁的接班人夺走回调却交不了差

10.4 治根之后 Bugbot 又报一条,**仍然成立**,而且仍是同一处——但这次是**次序**问题,不是状态归属问题。handler 里 `begin()`(它会把 tracker 的回调换成本实例的)在前,而接管那段代码在 `disabled / dragging` 的提前返回**之后**。于是:A 推到 −22 → 重挂成 B → CONTROL LOCK 切到 `FADERS`(B 的 disabled effect 触发,但 B 还没接管、`wheelActiveRef` 为 false,空转)→ 随后来一个滚轮事件:B 在 `begin` 里把回调抢了过来,却在接管之前就因为 `disabled` 返回了。静默时 tracker 调的是 B 的回调,B 认为自己没在动 → **什么都不写**,A 的 −22 丢失、通道卡在 pending。

改法只有一句:**把接管挪到 `disabled / dragging` 提前返回之前**。`begin` 既然已经让本实例成为 tracker 要回调的那一个,那么「本实例有能力为这次手势交差」就必须在同一步里成立,不能被后面的任何提前返回跳过。被锁的接班人接管后,静默时照样写出 −22——这本来就是既有规则「手势中被锁定则写出操作员已经到达的值」。全新手势不受影响:`isActive()` 只有在某个实例真的出过步之后才为真,被锁的推子永远出不了步。

回归锁:`mixer-wheel.integration.test.tsx` 第 13 例(重挂 → 上锁 → 一个动不了的滚轮事件 → 静默后仍恰好写一次 −22)。

**这一处一共报了四次(10.2–10.5)**,前三次都是我在补状态归属,第四次才发现即使状态归属对了,「取得回调」与「有能力兑现回调」这两件事仍然可以被一个提前返回拆开。教训记在这里:凡是「抢过某个跨组件的回调」的代码,抢的那一步和「让自己有能力兑现」的那一步之间不允许有任何提前返回。

### 10.6 顺手补上的残留:接班人在收到任何滚轮事件之前就被锁定

10.5 的次序修复解决了 Bugbot 描述的那条端到端路径,但它那句「lock / disconnect / 手落到帽子上都会空转」还剩一个我没覆盖的分支:**接班人挂载后一个滚轮事件都还没收到,就先被锁定(或断线、或被抓住帽子)**。此时它的 `wheelActiveRef` 仍是 false,`commitWheelGesture` 空转。值不会丢——tracker 手里还是离场实例的回调,静默时由它写出——但**写晚了约 150 ms**,如果用户在这 150 ms 内飞快地抓一下帽子再放开,那次拖动的终值可能先落地、旧的 −22 后落地把它盖掉。这条是我自己顺着 Bugbot 的描述查出来的,不在它报的范围内。

改法:`commitWheelGesture` 不再只看本实例的 `wheelActiveRef`,而是先看**这次手势是否还活着**(`isActive()`),再看**是不是本推子持有它**(`sameOwner`);两者都成立时,即便本实例没出过步也照样交差,取 store 的当前值(正是前一个实例推到的位置)。CONTROL LOCK 会同时禁用所有推子,所以「是不是本推子持有」这道判断是必须的,否则别的通道会跟着乱写。

这带来一个新的双写风险:早交差之后,离场实例的回调静默时还会再触发一次。因此同时把 `isActive()` 变成所有 commit 路径的前置条件,并把 tracker 的 `finish()` 调整为**先调回调、后清 active**——于是「谁先交差谁 `clearActive()`,后来的一律空转」,一次手势仍然恰好写一次。

回归锁:`Fader.test.tsx` 的 `commits an inherited gesture when the strip that replaced it is locked`——卸载 A、挂载同 `wheelId` 的 B 并锁定,断言 B 立刻写一次 −18,且推进两倍静默时间后 **A 的 onCommit 一次都没被调用**。

改完的质量门:53 文件 / **399** 用例全绿,覆盖率 Statements **97.03%** / Branches **92.49%** / Functions **99.41%** / Lines **96.99%**,lint / prettier / typecheck / build 全过,lockfile 仍无 diff。(验收反馈的六条改完之后是 **54 文件 / 422 用例**,Statements 96.93% / Branches 92.31% / Functions 99.42% / Lines 96.89%;见第 12 节。)

## 11. 遗留问题与移交事项

1. **电平表实测与可能的 transform 改绘 —— 留给本地新建的小批次。** 40 通道 20 Hz 下两种视口(1920×1080、3840×1080)的帧间隔 p50/p95/最大值、>34 ms 帧占比、长任务次数一个都没测。预算是静止页 p95 ≤ 20 ms、>34 ms 帧占比 ≤ 1%、长任务 0,翻页期间每次允许 ≤ 2 帧超 34 ms。超预算时的改法提示词第 6 节写得很具体(`.meter__fill` 改 `transform: scaleY(var(--meter-ratio))` + `transform-origin: bottom` + `will-change: transform`,`.meter__peak` 改 `translateY`,`Meter.tsx` 只改写入的自定义属性,`Meter.test.tsx` 断言改读新属性)。**条带高度翻倍已经落地,电平表重绘面积随之翻倍,风险敞口是实打实的。**

2. **纯 CSS 的东西本会话一律没有视觉验证。** jsdom 不求值 CSS,本会话又没做浏览器冒烟。页头单行的实际观感、条带是否真撑满、推子轨道拉长后的手感、翻页动效、视口过矮时的页内滚动、安全区按钮的质感——全部只有代码层面的把握,**移交用户**。

3. **Firefox 的鼠标一格翻不了页。** `deltaMode` 1 × 3 行 × 16px = 48px < 60px 阈值。提示词把这列为已知取舍、由真机调参,本会话未动初值。

4. **`TYPE PAGES` 不做偏好迁移。** `localStorage` 键仍是 `flwc.layout.typeRows`,旧的 `true` 会原样继承为新语义(从「每类型一行」变成「每类型一页」)。按提示词要求如此。

5. **`--strip-index` 入场动画在翻页时会重放。** 未挂载的页翻进来时条带重新挂载,`strip-enter` 动画会再跑一次(最多 8 × 25ms = 200ms,与 220ms 的翻页过渡同量级)。这是「只挂载相邻页」的直接后果,观感是否可接受**移交用户**;若不接受,最小的改法是给已经进过场的页加个标记。

6. **`stub-mixer-layout` 与 `stub-resize-observer` 装在全局 setup 里。** 所有渲染混音页的测试都会拿到 350px 的默认视口(正好一个表头 + 两条)。这让分页在既有测试里也是活的,是有意为之;代价是往后写混音页测试时要记得需要别的宽度就调 `resizePager()`。

7. **推子滚轮 × 重挂 × 锁定这一块请重点真机复核。** 评审阶段这一处连报四条(见 10.2–10.5),现在有 13 条集成用例锁着,但它们都跑在 jsdom 里、靠 `resizePager` 人为制造重挂。真机上请特意试:滚一个推子的过程中让通道条重新排布(切 view、改窗口大小、或等设备来一次通道增删),期间再叠加 CONTROL LOCK,确认推子既不会往回跳、也不会卡在 pending(条带边框变虚线即 pending)。

8. **6.4 的接口已经预留但为空**:`div.page-rail__track[data-swipe-surface]` 存在且 `touch-action: none`,里面什么都没有。

9. **`apps/server` 与 `packages/test-utils` 本会话未安装也未运行**(本批次没改它们)。它们由远端 CI 的 `pnpm install --frozen-lockfile` 覆盖。

## 12. 验收反馈后的布局调整

用户在真机上试用 Phase 6.3 后提了 6 条,全部做在同一分支、同一 PR 上。三个手感决策由用户拍板,记在下面各条里。

### 12.1 翻页动画改为纵向 —— `5ec78f5`

`translateX` 改 `translateY`,轨道改列向。安全区的两个箭头本来就是上/下,方向现在才对得上。

**这一条不是改一行 transform 就完的**:原先翻页轴(X)与溢出轴(Y)是分开的,所以页可以用 `min-height` 撑高、由 `.mixer-bays` 纵向滚动。两轴一重合,页若高于视口,轨道总高就不再是「页数 × 视口高」,`translateY(-100% × index)` 会错位。改法是把滚动主体下沉一层:`.mixer-bays` 只裁剪不滚动,页恒为一个视口高,`min-height: var(--strip-min-height)` 移到页内的 `.mixer-section` 上,超出时由**页自己**滚动。

页的滚动条隐藏(`scrollbar-width: none` + `::-webkit-scrollbar`)。这是用户拍板的取舍,理由是几何:滚动条若占宽,会从页的内容盒里扣掉 15px 左右,而分页量的是视口宽度——那正是第 10.1 条「满页最后一条被裁掉」的复发路径。代价是矮视口下少了一个可见的可滚提示,靠滚轮/触摸滑动与安全区页码兜底。

### 12.2 安全区加宽 —— `a8da2f5`

`PAGE_RAIL_WIDTH_PX` 56 → 72,内边距 0.4rem → 0.55rem。安全区里仍然没有任何会影响声音的控件,原有集成用例继续把关。

### 12.3 通道条居中、间隙响应式、条宽自适应 —— `c4b0515`

新增纯函数模块 `page-fit.ts`。**`paginate` 一行没改**:切页继续只用最窄的一套几何,`fitPages` 只在排完页之后把填不满的余量花掉,而且每个数字只增不减——所以它在原理上不可能反过来改动页的切法,也就不可能重演第 10.1 条。

花法(依次):

1. 余量先开间隙,条间距 1→6、段间距 14→28 封顶;
2. 间隙吃不下的才拉宽通道条,148→176 封顶;
3. 还有剩就居中。

条宽取**各页允许量的最小值**作为全局唯一值。用户的口径是「条宽全局统一、间隙允许各页不同」:统一条宽保证翻页时推子不在手下改变宽度,也保证没有一页会溢出(最紧的那页说了算);间隙逐页算,因为各页的表头数与段数本就不同。

不满的页(还塞得下一条通道,即末页或 `TYPE PAGES` 下的短页)不自己居中,而是**左对齐地沿用前一页的间隙与首条位置**,链式向后传递。这是用户明确要的:页内条数奇偶变化时,末页的通道位置不跟着大幅漂移。带一层「装不下就退回本页自算」的保险,正常路径走不到。

标题列与其后首条之间的间隙固定为 1px、不参与放大(用户追加的口径)。实现是给表头一个负的 `margin-inline-end` 抵掉 flex `gap` 的增量,`--section-header-gap` 恒定。

有一条值得记下的性质:**填得满的页,居中量恒为 0**。一页 n 条的间隙容量加拉伸容量约 `5(n-1) + 28n`,n ≥ 5 时就已经超过一条通道的宽度,而满页的余量按定义不足一条——所以余量总被间隙与条宽吃光。居中只在稀疏的页上真正发生(≤4 条,如 `TYPE PAGES` 下只有 2 条的 MAIN 页)。集成用例因此用单通道快照和分组视图来验证,而不是 40 通道台面。

### 12.4 触摸板连续滑动翻不了页 —— `72e8be8`

**用户说的「CD 太长」不是根因。**根因是重新武装的条件:翻页后要求 `quiet && settled`,而连续滑动时 `lastEventAt` 每帧刷新,`quiet` 永远为假——第一页之后**一页都不会再翻**,滑多久都没用。隔一会儿滑一下之所以正常,是因为中间的停顿满足了 `quiet`。只调 CD 修不好这个。

先写复现用例(每 12ms 一个不衰减的事件、连发 80 个,断言 `turns > 1`),确认红,再改:

- 重新武装**只看冷却**,冷却中吞掉且不攒行程,冷却结束从零重新计数;
- 防惯性飞页改由阈值承担:同一手势内(中途没静默过)续翻要 120px,是首翻 60px 的两倍;静默 150ms 后降回 60px。惯性尾巴是衰减的行程,够不到 120px;还在推的手指够得到。原有那条「一次 flick 只翻一页」的衰减用例不改也仍然是绿的。
- `PAGE_WHEEL_COOLDOWN_MS` 300 → 180,略小于 `PAGE_TRANSITION_MS = 220`,下一页在上一页落定前起步。两个常量分居 `lib/` 与 `features/mixer/`,由一条集成断言锁住这层关系(lib 单测不该反向依赖 feature)。

手感的取舍由用户拍板:选了「同一手势内阈值加倍」,而不是「一律 60px」(更跟手但 macOS 惯性可能自己多翻 2-3 页)。

同一提交里,矮视口的滚轮归属按用户选择改为**滚到底再接着翻页**:当前页还有可滚余量时不 `preventDefault`,交给浏览器滚;滚到那个方向的尽头才翻页。滚动期间把翻页累计**清零**,所以回到边界必须重新攒满一个阈值——这是对「边界抖动」的防护,也是这一条唯一有实质风险的地方,真机要重点看。

这里有个自查:第一版的「清零」写完之后我去验证它是不是真的被测到,发现**不是**——原来那条用例里滚动分支在调 reducer 之前就 `return` 了,根本没攒过行程,摘掉清零用例照样绿。真正会出事的顺序是「在页底攒了半程 → 往回滚(走滚动分支)→ 再回到页底」,用例改成这个顺序后,摘掉清零就变红了。

### 12.5 header 换行阈值太小 —— `a47f970`

原来是 6 列 grid,只有 `@media (max-width: 800px)` 才切成换行的 flex;用户在远大于 800px 的宽度上就已经看到顶部元素打架。

没有去换一个更大的 px 值——那只是把同一个 bug 推远。改成**基础规则就是 `display: flex; flex-wrap: wrap`**,断点整个删掉:cell 是标签与读数,需要多宽取决于字体与文本,任何写死的数字都会对某些情况是错的。现在它在内容真正放不下的那一刻换行。`.loudness-panel` 的 `justify-self: end` 换成 `margin-inline-start: auto`。

### 12.6 本次仍然做不到的验证

纯 CSS 的观感与真机手感,本会话一律无法验证,只有代码层面的把握:

- 纵向翻页的动效、居中与条宽放大的实际观感、header 的实际换行点;
- **触摸板连翻的真实手感**(120px / 180ms 两个数字是推算,不是实测),以及 macOS 惯性尾巴到底会不会多翻;
- **矮视口 scroll chaining 的边界抖动**——用例锁住了「回到边界要重新攒满」,但真机上快速来回滑动是什么感觉不知道;
- 隐藏滚动条后,矮视口下操作员是否还能意识到页面可以往下滚。

Phase 6.3 遗留的电平表帧率实测仍未做(第 3.6 节),条带高度翻倍带来的重绘开销至今没有任何测量数据,留给本地小批次。

复核这几条时,第 5 节的安全约束原样继续生效:**连续翻页与 scroll chaining 请在台面空白处、安全区与页码上做,不要落在推子上**;确需动推子时只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道,测后复原,不得切 ON/mute、不得动其它通道、不得删改任何通道。

## 13. 提交记录

| 提交 | 说明 |
| --- | --- |
| `6a217dd` | `feat(web): add mixer page layout constants and the strip pagination function` |
| `0c4c6d0` | `refactor(web): compress the console header to a single row` |
| `9d60ce6` | `feat(web): lay the mixer out as full-height pages` |
| `0cd20d7` | `feat(web): add the page rail and keyboard paging` |
| `6ada62e` | `feat(web): add wheel delta, fader, page and gesture-ownership reducers` |
| `7936cd5` | `feat(web): adjust fader levels with the wheel` |
| `6e5bf4d` | `feat(web): turn mixer pages with the wheel` |
| `b00288c` | `docs: describe mixer pagination and wheel ownership` |
| `66459ef` | `docs: add the Phase 6.3 execution report` |
| `5317bf9` | `fix(web): pack a mixer page to its content box, not over it`(评审后) |
| `c6bb0e0` | `fix(web): let a remounted fader finish its own wheel gesture`(评审后) |
| `bc73bcf` | `docs: record the two post-review fixes in the Phase 6.3 report` |
| `18546b8` | `fix(web): commit a wheel gesture when its strip is torn down`(评审后第三条) |
| `04289f6` | `fix(web): keep gesture state with the gesture, not the strip`(评审后第四条,治根) |
| `1ff5967` | `fix(web): adopt the gesture before declining the event`(评审后第五条) |
| `fd191a5` | `fix(web): settle a gesture from whichever strip holds it`(自查补的残留) |
| `5ec78f5` | `feat(web): turn mixer pages vertically`(验收反馈 12.1) |
| `a8da2f5` | `feat(web): widen the page rail`(验收反馈 12.2) |
| `c4b0515` | `feat(web): centre a page and spend the width it cannot fill`(验收反馈 12.3) |
| `72e8be8` | `fix(web): let a wheel that keeps going keep turning pages`(验收反馈 12.4) |
| `a47f970` | `fix(web): wrap the console header on its content, not on a width`(验收反馈 12.5) |

分支 `claude/elegant-meitner-rgmloj`。每个提交后 lint / typecheck / test 都跑过且为绿。
