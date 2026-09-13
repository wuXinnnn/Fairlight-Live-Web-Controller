# Phase 6.3 执行报告 — 混音页分页

## 1. 结果总览

| 项 | 状态 |
| --- | --- |
| 1. 切页纯函数与布局常量 | 完成 |
| 2. 页面骨架:100dvh、单行页头、条带撑满 | 完成 |
| 3. 翻页状态、安全区与键盘 | 完成 |
| 4. 滚轮:归属模块与两个 reducer | 完成 |
| 5. 滚轮接入:推子轨道与分页视口 | 完成 |
| 6. 电平表实测与 transform 改绘 | 完成(云端跳过,由本地会话补做,见第 14 节) |
| 7. 文档 | 完成 |
| 评审后修订(Bugbot 五条 findings + 自查补 1 条) | 完成,见第 10 节 |
| 本地收尾批次(电平表实测与改绘、触控板翻页、浏览器样式实测、通道条定宽与读数区重做) | 完成,见第 14 节 |

云端质量门(串行,全部在本会话实际执行):

```
pnpm install --frozen-lockfile --filter @flwc/web --filter @flwc/shared   成功
eslint .                                                                  0 error
prettier --check .                                                        全部通过
tsc --noEmit (@flwc/web)                                                  0 error
vitest run --coverage (@flwc/web)      55 文件 / 438 用例 全绿
vite build (@flwc/web)                 成功
git diff pnpm-lock.yaml                无改动
```

覆盖率(门槛 80%,未调整、未新增排除项):

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| Statements | 96.75% | **96.92%** |
| Branches | 91.97% | **92.31%** |
| Functions | 99.20% | **99.43%** |
| Lines | 96.70% | **96.89%** |

用例数 327 → 438(净增 111 = 本体 72 + 评审后 9 例回归锁 + 两轮验收反馈 30 例)。本批次新增的 `page-layout.ts`、`pagination.ts`、`use-pager.ts`、`StripPages.tsx`、`PageRail.tsx`、`wheel-delta.ts`、`fader-wheel.ts`、`page-wheel.ts`、`wheel-gesture.ts` 九个文件四项指标全为 100%(v8 报告只列不足 100% 的文件,故它们不在表内);`use-pager-viewport.ts` 分支 87.5%。

**云端安装的实际情况**:与 6.2.2 报告第 1 节不同,本会话 `pnpm install --frozen-lockfile --filter @flwc/web --filter @flwc/shared` **一次成功**(2 of 5 workspace projects,7.8s),`packages/shared` 的 `prepare` 自动构建了 `dist`。因此前端的四道质量门全部在本地真实跑过,不是只靠远端 CI。`apps/server` 与 `packages/test-utils` 本批次未改也未安装。

## 2. 验收标准逐条核对

对照提示词「验收自查」六条:

**1. 切页 — 通过,以单测为证。** `apps/web/src/features/mixer/pagination.test.ts` 七例:每页数量随宽度变化(595px 放 4 条、594px 放 3 条)、表头占宽导致同宽容器少放一条(3 条)、组跨页时第二页带 `continued` 表头、`newPagePerHeaderedSegment` 下每个带表头的段一页而无表头段续排、容器 10px 时每页恰好一条(带不带表头都是)、空输入返回 `[]`、空段被跳过且不吃掉段间距。

**2. 骨架 — 结构与可访问名以测试为证;观感移交用户。** `100dvh`、单行页头、条带撑满都是纯 CSS,jsdom 不求值 CSS,**无法自动断言**。能证明的是既有控件与可访问名一个不少:`mixer.integration.test.tsx` 与 `views.integration.test.tsx` 全绿(改写见第 9 节),`Connection settings` / `Mixer view` / `CONTROL LOCK` 三选项 / `Loudness` / `RESET` / `CONFIGURE VIEWS` / `<name> level` / `<name> on/off` / `<name> meter` / `section.mixer-section[aria-labelledby]` + `header.mixer-section__header > h2 + span` / `article.channel-strip[data-channel-id]` / `data-channel-kind` / `data-view-group-id` / `.mixer-bays` 全部保留。**冒烟截图这一项本会话没有**(第 6 节跳过,浏览器冒烟一并未做)——这是本报告最大的证据缺口,页头单行是否好看、条带是否真的翻倍、翻页动效是否顺,全部**移交用户**。

**3. 翻页 — 通过,以测试为证;页内滚动移交。** `use-pager.test.ts` 五例(钳位、越界步进、view 切换重置、页数缩小钳末页并保持、goTo 钳位);`mixer-pages.integration.test.tsx` 十例:按钮翻页与页码文本、首末页禁用、单页 `1 / 1` 且两键禁用、`PageDown` / `PageUp` 翻页、推子聚焦时 `PageDown` 只走 −10 dB 不翻页、切换 view 回第一页、`TYPE PAGES` 开启后每种类型/每个组一页(页数变化)、安全区内无 slider / switch / radio / `aria-pressed` / RESET 且只有两个翻页键、缩窄视口后页数增加且页码钳位。**视口过矮的页内滚动是纯 CSS,jsdom 断言不了 → 移交用户**(滚轮在这种状态下的让位行为有用例,见下)。

**4. 滚轮 reducer 与归属 — 通过,以测试为证;手感移交用户。** 单测:`wheel-delta.test.ts`(三种 `deltaMode`、Shift 下 x/y 取舍、两轴都动取竖向)、`fader-wheel.test.ts`(鼠标一格 100px 出 2 步、触控板 12px×5 累计 60 出 1 步余 10、方向反转清零、大 delta 一次多步、零位移)、`page-wheel.test.ts`(鼠标一格恰好一页且紧随第二格被冷却吞掉、触控板 30 个递减事件只出一页、冷却结束需**同时**满足静默与最短间隔、方向反转清零、静默后反向再出一页)、`wheel-gesture.test.ts`(`begin` 不换人、`touch` 续期十次不早结束、静默后 `onEnd` 恰好一次且不重复、过期后可被新持有者 `begin`、过期但定时器未跑到时补发 `onEnd`、`reset` 不触发 `onEnd`)。九种归属边界情形在 `apps/web/tests/mixer-wheel.integration.test.tsx` 里一例一条,编号与提示词第 5 节一致。**手感(多少格一页、跟不跟手)移交用户真机调参。**

**5. 电平表 — 云端未做,本地补做完毕。** 云端跳过的经过见第 8 节第 1 条;两种视口的实测数字、改绘与复测见**第 14 节**。结论:提示词给的预算在实测机器上**改绘前就已经过了**(静止页 p95 2.9 / 5.5 ms,>34 ms 帧 0%,长任务 0),但每帧一次布局的成因查清后仍然改了绘,数字与理由都在第 14 节。

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

### 3.6 电平表实测 —— 云端整节未执行,本地补做(见第 14 节)

提示词第 6 节要求在云端起合成电平服务(临时目录装 `socket.io`)+ Playwright 驱动预装 Chromium,在 1920×1080 与 3840×1080 两种视口实测 40 通道 20 Hz 下的帧间隔 p50/p95/最大值、>34 ms 帧占比与长任务次数,超预算则把 `.meter__fill` 改为 `transform: scaleY()` 绘制并重测。

**本会话没有做这一节的任何一步。** 用户在另一会话实测确认云端做不了,决定整节跳过,留给本地 agent 之后新建一个小批次单独做。因此:

- 没有合成电平服务,没有浏览器冒烟,没有截图;
- **两种视口的原始数字本报告一个也没有**;
- `.meter__fill` 的 `clip-path: inset(var(--meter-reveal) 0 0)` 与 `.meter__peak` 的 `bottom` 绘制**保持原样未改**,`Meter.tsx` 与 `Meter.test.tsx` 未动(它们读的都是百分比,条带高度翻倍不影响断言)。

条带高度大约翻倍是这次布局改动的直接后果,电平表的重绘面积随之翻倍,**这个开销在云端会话里没有任何测量数据支撑**。本地会话已经补测并改绘,见第 14 节;本小节保留云端当时的状态记录。

### 3.7 文档

`docs/architecture.md`「通道分组」末尾那句关于混音页渲染与 `TYPE ROWS` 横排的描述改写为分页描述;「前端结构」新增「混音页分页」与「滚轮」两条;「推子拖动」一条补了滚轮路径的 commit 时机。只描述当前状态,不留历史。`docs/development-plan.md` 未改(验收框由用户勾选),`docs/fairlight-ember.md` 未动。

## 4. 数值初值清单

表中标 †  的是**验收反馈后改动或新增的**(见第 13 节),其余全部为提示词给定的初值,一个都没有自行调整,也没有调换单位。

| 名称 | 值 | 含义 | 文件 |
| --- | --- | --- | --- |
| † `STRIP_WIDTH_PX` | 125 | 通道条宽度,也是切页用的值(用户手调,见 14.7) | `apps/web/src/features/mixer/page-layout.ts` |
| † `STRIP_WIDTH_MAX_PX` | 125 | 通道条可被拉宽到的上限;与下限同值,等于关掉拉伸 | 同上 |
| † `SECTION_HEADER_HEIGHT_PX` | 26 | 分区/分组标题栏的高度;栏横跨该段所有条带,**不占宽度**(14.8) | 同上 |
| † `SECTION_HEADER_GAP_PX` | 6 | 标题栏与其下那排条带之间的间距(原为表头与首条的横向间距 1) | 同上 |
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

已知的初值取舍(提示词已点明,原样保留):Firefox 的一格是 `deltaMode` 1、`deltaY` ±3,归一化为 48px,**不足 60px 阈值,翻不了页**。这一条由用户真机调参。(本地收尾批次之后,分页路径改由 `wheel-gestures` 归一化,它的行高是 18 而不是 16,Firefox 的一格在分页路径上变成 54px——仍然不足 60px,结论不变;推子路径仍用 `WHEEL_LINE_HEIGHT_PX` = 16。)

**本地收尾批次没有新增、修改或删除任何数值常量**:上表全部照旧。`reducePageWheel` 多收的 `momentum` 是一个入参而不是数值;惯性判定的门限(衰减比率 0.6–0.96、需要连续 5 个合并采样点)在 `wheel-gestures` 内部,不是本仓库的可调数值。

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
| `apps/web/src/features/mixer/PageRail.tsx` | 右侧安全区(含页码跳转控件) |
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
| `apps/web/tests/mixer-pages.integration.test.tsx` | 分页、翻页、自适应布局与页码跳转二十三例 |
| `apps/web/tests/mixer-wheel.integration.test.tsx` | 滚轮归属、滚动接续与连续翻页十八例 |
| `apps/web/tests/mixer-touch.integration.test.tsx` | 手指翻页八例(验收反馈补) |
| `apps/web/src/lib/page-wheel.trace.test.ts` | 合成触控板轨迹经 `WheelGestures.feedWheel()` 驱动 reducer 的四例(本地收尾补) |
| `docs/reports/phase-6-3-report.md` | 本报告 |

修改:`apps/web/src/features/mixer/MixerPage.tsx`、`TypeRowToggle.tsx`、`TypeRowToggle.test.tsx`、`ChannelStrip.tsx`、`apps/web/src/components/Fader.tsx`、`Fader.test.tsx`、`apps/web/src/styles.css`、`apps/web/vitest.setup.ts`、`apps/web/tests/mixer.integration.test.tsx`、`apps/web/tests/views.integration.test.tsx`、`docs/architecture.md`;本地收尾批次另改 `apps/web/src/components/Meter.tsx`、`Meter.test.tsx`、`apps/web/src/lib/wheel-delta.ts`、`wheel-delta.test.ts`、`apps/web/src/lib/page-wheel.ts`、`page-wheel.test.ts`、`apps/web/tests/mixer-wheel.integration.test.tsx`、`apps/web/package.json`、`pnpm-lock.yaml`。

未改动:`apps/server`、`packages/shared`、`packages/test-utils`、`features/settings/`、CONNECTION 面板、CI 流水线、`docs/development-plan.md`、`docs/fairlight-ember.md`。(`Meter.tsx` / `Meter.test.tsx` / `pnpm-lock.yaml` 在云端会话未改动,本地收尾批次改了,见第 14 节。)

## 7. 依赖清单

云端会话:**无新增依赖,`pnpm-lock.yaml` 无 diff**。

本地收尾批次新增一个依赖:

| 依赖 | 版本 | 许可 | 运行时依赖 | 用途 |
| --- | --- | --- | --- | --- |
| `wheel-gestures` | 2.3.0 | MIT | 无 | 滚轮惯性判定(区分「手指还在推」与「系统在惯性滑行」),顺带归一化单位与轴向 |

`pnpm-lock.yaml` 因此**有 diff**(+9 行,只有这一项),`apps/web/package.json` 多一行。这是对本批次「不新增依赖」硬性约束的一次**有意偏离**,由用户在本地收尾时拍板选择(备选是自研衰减检测);理由与取舍见 14.2。

临时目录(不进仓库):`playwright-core`(驱动本机已装的 Chrome 做实测与截图)。合成电平服务直接复用 `apps/server/node_modules` 里已有的 `socket.io`,没有另外安装。

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

本地收尾批次另改三处,同样只改读法、不动意图:

| 文件 | 用例 | 原断言 | 改为 |
| --- | --- | --- | --- |
| `src/components/Meter.test.tsx` | `reveals a fixed meter gradient by clipping…` → 标题改 `…by sliding it` | `.meter__fill` 的 `--meter-reveal` 为 `50%` | `--meter-ratio` 为 `0.5`,并断言 `.meter__fill-bar` 在场(渐变靠它反向平移保持不动) |
| 同上 | `holds a peak before returning to the current reading` | `.meter__peak` 的内联 `bottom` 为 `95%` / `50%`(3 处) | 同一元素的 `--meter-peak` 为 `0.95` / `0.5` |
| `src/lib/wheel-delta.test.ts` | `pagingDelta` 四例 | 传整个 `WheelEvent` 形状,横轴在 `deltaY === 0` 时一律生效 | 改传 `{ x, y }` 与 `shiftKey`;「Shift 下读横轴」保留,新增「无 Shift 时不读横轴」 |

14.7 又改两处,同样只改读法。两条原本都断言 level 读数**没有**标签,而读数移出推子列之后它必须写出自己的名字:

| 文件 | 用例 | 原断言 | 改为 |
| --- | --- | --- | --- |
| `tests/mixer.integration.test.tsx` | `aligns meter and level readouts and applies channel type colors` | `queryByText('LVL')` 不在文档中;读数文本 `/-12.0\s*dB/` | 读数文本 `/LVL\s*-12.0\s*dB/`,一条断言覆盖原来两条 |
| `src/components/Fader.test.tsx` | `uses the full shortened track without clamping the fader value` | `queryByText('LVL')` 不在文档中 | `getByText('LVL')` 在文档中;同用例的 `-∞` 与滑块位置断言不变 |

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

1. ~~**电平表实测与可能的 transform 改绘**~~ —— 本地收尾批次已完成,见第 14 节。

2. ~~**纯 CSS 的东西本会话一律没有视觉验证。**~~ —— 本地收尾批次已在真实 Chrome 里扫过 16 组视口并逐张看图,见 14.3;仍然**移交用户**的只剩主观观感与真机手感。

3. **Firefox 的鼠标一格翻不了页。** `deltaMode` 1 × 3 行 × 16px = 48px < 60px 阈值。提示词把这列为已知取舍、由真机调参,本会话未动初值。

4. **`TYPE PAGES` 不做偏好迁移。** `localStorage` 键仍是 `flwc.layout.typeRows`,旧的 `true` 会原样继承为新语义(从「每类型一行」变成「每类型一页」)。按提示词要求如此。

5. **`--strip-index` 入场动画在翻页时会重放。** 未挂载的页翻进来时条带重新挂载,`strip-enter` 动画会再跑一次(最多 8 × 25ms = 200ms,与 220ms 的翻页过渡同量级)。这是「只挂载相邻页」的直接后果,观感是否可接受**移交用户**;若不接受,最小的改法是给已经进过场的页加个标记。

6. **`stub-mixer-layout` 与 `stub-resize-observer` 装在全局 setup 里。** 所有渲染混音页的测试都会拿到 350px 的默认视口(正好一个表头 + 两条)。这让分页在既有测试里也是活的,是有意为之;代价是往后写混音页测试时要记得需要别的宽度就调 `resizePager()`。

7. **推子滚轮 × 重挂 × 锁定这一块请重点真机复核。** 评审阶段这一处连报四条(见 10.2–10.5),现在有 13 条集成用例锁着,但它们都跑在 jsdom 里、靠 `resizePager` 人为制造重挂。真机上请特意试:滚一个推子的过程中让通道条重新排布(切 view、改窗口大小、或等设备来一次通道增删),期间再叠加 CONTROL LOCK,确认推子既不会往回跳、也不会卡在 pending(条带边框变虚线即 pending)。

8. ~~**6.4 的接口已经预留但为空**~~:滑动手势已在第二轮验收反馈里接上(见 12.7),`[data-swipe-surface]` 不再是空接口。

9. **`apps/server` 与 `packages/test-utils` 本会话未安装也未运行**(本批次没改它们)。它们由远端 CI 的 `pnpm install --frozen-lockfile` 覆盖。

## 12. 验收反馈后的布局调整

用户在真机上试用 Phase 6.3 后分两轮提了 8 条(第一轮 6 条见 12.1–12.5,第二轮 2 条见 12.6–12.8,其中第一条的滚轮与触摸两半分开记),全部做在同一分支、同一 PR 上。五个手感决策由用户拍板,记在下面各条里。

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
2. 间隙吃不下的才拉宽通道条,上限封顶(**14.7 之后上限与下限同值,这一步恒为 0**);
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

### 12.6 安全区在矮视口下是死的 —— `6079de2`

第二轮验收的第一条:「在安全区域滚轮滚动和触屏、触摸板滑动时,始终直接翻页,在通道条容器区域滚动时保持现状,滚到底再翻页。」

**滚轮那半是 12.4 引入的 scroll chaining 的一个洞。**那条分支只看「当前页是否还有可滚余量」,不看指针在哪,于是把安全区也一起让位了——而安全区下面根本没有可滚的东西,浏览器接过去也无事可做:矮视口下滚轮落在安全区上既滚不动、也翻不了页,**唯一一个允许操作员随便碰的表面变成了死的**。先按 12.4 那两条用例的写法补一条(矮视口、不 `scrollPage`、目标取 `complementary[name="Pages"]`,断言 `defaultPrevented` 与页码),确认红,再加 `!inRail(target)`。顺手把这条分支的两个条件提成 `pageScrolls()` 与 `inRail()` 两个模块级纯函数,12.7 的触摸路径直接读同样这两个。

### 12.7 手指翻页 —— `91400aa`

同一条验收的另一半,也把 6.4 预留的 `[data-swipe-surface]` 填上了(第 11 节第 8 条作废)。第二轮的两个决策都在这里:

- **触摸不引入新的翻页节奏**(用户拍板,原话是「可以使用原本无滚动条时统一的翻页节奏吗」)。可以,而且更好:`reducePageWheel` 的输入本来就是「像素行程」,把 `touchmove` 的逐帧位移喂进**同一个** `pageWheelRef` 即可。首翻 60px、同手势续翻 120px、静默 150ms、冷却 180ms 全部照旧,**没有新增任何常量、没有新增模块**,滚轮与手指也因此共用一份冷却,不会互相抢拍。
- **通道条区的触屏与滚轮对称**(用户拍板):页面可滚时先滚到底,再滑才翻页;页面不溢出就直接翻。安全区照旧永远直接翻。

监听挂在 `.mixer-deck` 上,`touchstart` / `touchmove` 用 passive,`touchend` / `touchcancel` 不用(要 `preventDefault`)。位移取「上一帧 Y − 本帧 Y」,手指上滑 = 滚轮下滚。三条安全性质各有一条用例把关,并逐条摘掉修复确认变红:

1. **落在推子上的手指归推子**(起点命中 `[data-wheel="level"]` 就整段不受理)。推子是 pointer 事件自己拖的,若同时翻页,一次拖动会既改电平又换页。
2. **翻过页的拖动在 `touchend` 上 `preventDefault`**,不让同一个手势顺手按下它松手时压住的东西——安全区的两个翻页键、通道条上的 ON 都在一指宽之内,而 ON 是会出声的。没翻页的点按仍然是点按。
3. **只认单指**:两指按下不翻页,其中一指中途抬起后剩下的那段也不算(否则会拿一个陈旧的起点算出一段很长的行程);单指开始后中途多出一根手指同样立即停。这两个守卫各自有对应的断言,是分别摘掉分别变红验证过的。

### 12.8 页码可以点开输入跳转 —— `8bf5ece`

第二轮的第二条:「页码样式需要调整一下,引导允许点击输入页码直接跳转。」40 路是七页,过去只能一页一页按过去。

`usePager` 本来就有 `goTo()`(带 `clampPageIndex`),`MixerPage` 只是没接,所以这条没有新增任何状态逻辑。形态由用户拍板选了**「点一下变输入框」**而不是常驻输入框:安全区里少一个常驻焦点目标,演出中不容易误触。

`output[aria-label="Page"]` **原样保留**——它是页码的 live region,也是既有用例读文本、等渲染的那个契约点;可点的控件放在它里面,读数态是 `button[aria-label="Jump to page"]`(单页时置灰),按下换成同名的数字输入框、挂载即全选。**失焦也提交**,因为触摸屏弹出的数字键盘没有回车键;Esc 取消。输入只留数字,越界交给 `goTo` 的钳位。

`.page-rail__jump` 无论哪个状态都戴着一圈输入框的边框:触摸屏没有 hover,常驻的字段外观是「这里可以点」的唯一提示。

**这一条有意扩了一次 DOM 契约**:安全区里的按钮从 2 个变成 3 个,「keeps every control that could change the sound out of the rail」那条用例的名单相应改成 `['Previous page', 'Jump to page', 'Next page']`,其余体检项(无 slider / switch / radio、无 `aria-pressed`、`[data-swipe-surface]` 仍在)一项没减——新控件同样过了这套体检,它只改「看哪一页」,不碰任何通道。

### 12.9 本次仍然做不到的验证

纯 CSS 的观感与真机手感,本会话一律无法验证,只有代码层面的把握:

- 纵向翻页的动效、居中与条宽放大的实际观感、header 的实际换行点;
- **触摸板连翻的真实手感**(120px / 180ms 两个数字是推算,不是实测),以及 macOS 惯性尾巴到底会不会多翻;
- **矮视口 scroll chaining 的边界抖动**——用例锁住了「回到边界要重新攒满」,但真机上快速来回滑动是什么感觉不知道;
- 隐藏滚动条后,矮视口下操作员是否还能意识到页面可以往下滚;
- **手指翻页的真实手感**:把滚轮那套阈值原样套到手指行程上是推理,不是实测——60px 一页在一根 72px 宽、很高的安全区上是偏灵敏还是正好,只有真机知道;
- 通道条区「滚到底再滑一次」的触摸边界在真机上会不会抖;
- 页码输入框在触摸屏上够不够好点(它只有约 54px 宽),以及各家软键盘的实际行为(iOS 数字键盘没有回车键,所以留了失焦提交这条路)。

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
| `90a5e88` | `docs: record the layout and paging changes from acceptance`(验收反馈第一轮文档) |
| `6079de2` | `fix(web): always turn a page from the safe rail`(验收反馈 12.6) |
| `91400aa` | `feat(web): turn pages by dragging a finger`(验收反馈 12.7) |
| `8bf5ece` | `feat(web): jump to a page by typing its number`(验收反馈 12.8) |
| `340ae6f` | `docs: record the rail paging and page jump changes`(验收反馈第二轮文档) |
| `4e50f30` | `perf(web): move a meter reading onto the compositor`(本地收尾 14.1) |
| `e914da9` | `fix(web): only read the sideways wheel axis under Shift`(本地收尾 14.2) |
| `0c06a70` | `fix(web): never let a trackpad's coast turn a second page`(本地收尾 14.2) |
| `278c319` | `docs: record the meter measurement and the trackpad fixes`(本地收尾 14 节) |
| `15ddcf9` | `fix(web): keep the wheel detector alive across a change of page count`(本地收尾自查) |
| `c40bc9a` | `fix(web): stop the loudness readings being squeezed into each other`(用户实测 729×596,14.6) |
| `9a62767` | `fix(web): give each channel reading a line of its own`(用户实测,14.7) |
| `da62ddf` | `adjust(web): pin the channel strip to a fixed 125px width`(用户手调,14.7) |
| `69ca70c` | `style(web): make the level field look editable and the meter reading not`(用户复看,14.7) |
| `0816475` | `feat(web): move the level field to the head of the strip`(用户定案,14.7) |
| `c914f1f` | `feat(web): read the floor of a scale as silence, not as a figure`(用户要求,14.7) |
| `bbb2d43` | `feat(web): label a section over its strips instead of beside them`(用户要求,14.8) |

分支 `claude/elegant-meitner-rgmloj`。每个提交后 lint / typecheck / test 都跑过且为绿。

## 14. 本地收尾批次

云端会话结束、两轮验收反馈之后,还剩三件只能在有真实浏览器的本地机器上做的事,在**同一条分支、同一个 PR** 上补做。

**实测环境**:Windows 11,Chrome(已装,经 `playwright-core` 驱动,不下载浏览器),真实 GPU(RTX 4090,已确认不是软件光栅)。被测的是 **`pnpm --filter @flwc/web build` 的生产构建**,不是 dev server。数据源是一个只在会话临时目录里存在的**合成电平服务**(Node + `apps/server/node_modules` 里现成的 `socket.io`,监听 3100,发 40 通道快照与每 50 ms 一帧 `meters:frame`,事件名与形状取自 `packages/shared` 的 schema,另答两个前端启动会打的 REST)。**全程没有启动 `apps/server`、没有连真实 Fairlight**;本机当时正跑着连真机的 `pnpm dev`(3000 / 5173),实测另起端口,没有碰它。

视口用 CDP `Emulation.setDeviceMetricsOverride` 覆写而不是靠窗口大小——本机两块屏都是 1920×1080,3840 宽装不进窗口,所以 **3840×1080 是 `deviceScaleFactor: 0.5` 模拟出来的**(CSS 像素数与真实 4K 台面一致,物理光栅面积是一半)。这一点在读下面的数字时要记住。

### 14.1 电平表实测与 transform 改绘

**先说结论:提示词给的预算,改绘前就已经通过了。** 两种视口、每轮「静止 10 s + 每 2 s 翻一页翻 5 次」:

| 改绘前(1x) | 静止 p50 | 静止 p95 | 最大 | >34 ms 帧占比 | 长任务 | 翻页时每次 >34 ms 的帧 |
| --- | --- | --- | --- | --- | --- | --- |
| 1920×1080(22 条 / 22 表) | 2.8 ms | 2.9 ms | 5.6 ms | 0% | 0 | 0 |
| 3840×1080(40 条 / 40 表) | 2.8 ms | 5.5 ms | 8.4 ms | 0% | 0 | 0 |

预算是静止页 p95 ≤ 20 ms、>34 ms ≤ 1%、长任务 0,翻页每次 ≤ 2 帧超 34 ms——**六项全过**。

但这台机器的 rAF 跑在 **~360 fps**(不是 60;`about:blank` 也是 360,不是被测页面的原因),每帧只有 2.8 ms 的活要干,「p95 ≤ 20 ms」在这里几乎不可能不过,**这条预算在本机没有区分度**。所以另外采了两个与刷新率无关的指标:主线程每秒耗时(CDP `Performance.getMetrics` 差值)与 CPU 降频压力测试。它们立刻显出问题:

| 改绘前 | 主线程 task | script | style | layout | **布局次数** |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 | 382 ms/s | 14.6 | 33.3 | 53.7 | **371.5 次/秒 ≈ 每帧一次** |
| 3840×1080 | 618 ms/s | 19.5 | 51.4 | 92.3 | **351.9 次/秒 ≈ 每帧一次** |

**每帧一次整页布局**,而电平数据每秒只来 20 次。逐项摘除做归因(1x,3840×1080):

| 变体 | task ms/s | layout ms/s | 布局次数/帧 |
| --- | --- | --- | --- |
| 原样 | 633 | 96 | **1.06** |
| 关掉 `.meter__peak` 的过渡 | 541 | 72 | **0.10** |
| 关掉 `.meter__fill` 的过渡 | 454 | 93 | 1.05 |
| 关掉 `.meter__fill` 的辉光 | 609 | 90 | 1.02 |
| 隐藏整个表体 | 140 | 71 | 0.06 |

成因清楚:`.meter__peak` 用 `bottom` 定位加 `transition: bottom`,**`bottom` 是触发布局的属性**,40 个表的峰值几乎一直在补间,于是每帧一次布局(≈92 ms/s);`.meter__fill` 的 `clip-path` 过渡另占 ≈180 ms/s 的样式与绘制。电平表合计占主线程约 78%。

**改绘做了,理由是这个成因而不是预算**(提示词写的是「未超预算则不改」,这里是一次有意偏离,请复核是否认可):

- `.meter__fill` 改成**一扇罩在固定渐变上的窗**:窗按「没有点亮的那部分」`translateY` 向下平移,窗内新增的 `.meter__fill-bar` 向上平移同样的量。两个位移是同一个数的正负两面,所以渐变的分色**在过渡的每一个瞬间**都钉在刻度上。提示词原本写的是 `transform: scaleY()`——那会把渐变一起压扁,−30 dB 的表会在顶端显出红色,与 `.meter__zones` 的刻度线对不上;截图比对确认了平移方案分色正确(−15.6 dB 的条在 70% 处转琥珀、−2.4 dB 的条在 90% 处转红)。
- `.meter__peak` 改成满高容器带着 2px 线一起 `translateY`(`top: -2px` 补掉原来 `bottom` 定位的 2px 差),不再碰布局。
- `Meter.tsx` 只改写入的自定义属性(`--meter-reveal` 百分比 → `--meter-ratio` / `--meter-peak` 两个无单位数),clamp、峰值保持、clipping 逻辑一行未动;`Meter.test.tsx` 的三条断言改读新属性,意图不变。

**改绘后复测**:

| 3840×1080 / 40 通道 | 改绘前 | 改绘后 |
| --- | --- | --- |
| 主线程 task(1x) | 618 ms/s | **455 ms/s**(−26%) |
| 布局次数(1x) | 351.9 次/秒 | **19.9 次/秒**(= 20 Hz 数据帧率,只剩读数文本那一次) |
| 静止 p95(1x) | 5.5 ms | 5.6 ms(两者都远在预算内) |
| CPU 降频 2 倍:帧率 | 142.5 fps | **249.3 fps** |
| CPU 降频 2 倍:每帧主线程 | 5.82 ms | **3.03 ms** |
| CPU 降频 2 倍:p95 | 16.7 ms | 13.9 ms |

1920×1080 同向:主线程 382 → 248 ms/s,布局 371.5 → 19.8 次/秒;降频 2 倍时 749 → 562 ms/s。

**一条如实记下的反例**:CPU 降频 **3 倍**时,3840×1080 上改绘后反而更差(帧率 83.8 → 62 fps,>34 ms 帧占比 0.24% → 10.9%)。这一档两版的主线程都已经打满(927 vs 969 ms/s),饱和之后 fps 只反映每帧成本,测量本身失去区分度;重复三次结果稳定,所以不是噪声,但也没有找到令人满意的解释。降频 6 倍时两版都不可用(>34 ms 帧占比 74–82%)。**1x 与 2x 改绘明显更好,3x 更差,6x 都不行**——这是全部实情。

顺带验证过的两件事:`will-change: transform` 留着是对的(去掉后 3840 的主线程从 455 回到 530 ms/s、布局次数从 19.8 涨到 32.9);对读数文本加 CSS `contain` 想把那 20 次/秒的整页布局局部化,实测**没有收益甚至更差**,因此没有引入。剩下的布局全部来自 40 个读数文本每秒 20 次的更新(把读数隐藏,layout 从 149 降到 1 ms/s),那是产品功能,不动。

### 14.2 触控板翻页的两个根因

用户反馈两条:一次滑动会因惯性翻过多页;双指往下滑动时有时莫名往下翻页。读代码定位到两个各自独立的缺陷,都写了先红后绿的回归锁。

**其一,方向错:横轴被无条件当成翻页行程。** `pagingDelta()` 原本在 `deltaY === 0` 时回落读 `deltaX`。这个回落是为 Shift 准备的(浏览器在 Shift 下把竖向滚动换到 `deltaX`),但代码没有判 `shiftKey`。触控板做竖向滑动时,竖向位移还不够一整像素的那些帧照样会把手在板上的横向漂移报在 `deltaX` 上——这些帧于是按漂移的符号累计成竖向行程,轻则把上滑的累计反复清零(滑不动),重则攒够阈值往反方向翻一页。改法只有一句:横轴**只在 Shift 按下时**才读。

回归锁两条:`wheel-delta.test.ts` 的 `ignores sideways travel without Shift`;`mixer-wheel.integration.test.tsx` 第 5b 例(在页面空白处连发 6 个纯横向滚轮 → 页码不动;带 Shift 的一格 → 翻页)。摘掉修复两条都变红,后者的失败形态正是「上滑手势一页都翻不动」。

**其二,翻过多页:阈值分不出「手指还在推」和「系统在惯性滑行」。** 12.4 把重新武装改成只看冷却、不看静默之后,防惯性全靠「同一手势内续翻要 120 px(首翻的两倍)」。但用力甩一下的惯性尾巴总行程有十来页之多,每个 180 ms 冷却窗口里都轻松凑得满 120 px。用合成轨迹复现:一次用力甩(峰值 80 px/帧、按 0.94 衰减,尾巴总行程 > 10 个阈值)**翻 3 页**,连甩两次**翻 6 页**。

惯性是**形状**不是大小——逐帧衰减,且两轴按同一比率衰减——看单个事件判不出来,要看一串。所以按用户拍板的方案引入 `wheel-gestures`(MIT,零运行时依赖,2026-09-07 仍在维护)读这一串并给出 `isMomentum`,`reducePageWheel` 多收一个 `momentum` 入参:**这次手势已经翻过页之后,标为惯性的行程一律吞掉且不入账**;还没翻过页时不拦(那是甩劲刚到,该给它一页);手指重新按上板时库会取消惯性态,翻页权立刻交还。

没有动任何数值:`PAGE_WHEEL_THRESHOLD_PX` 60、`PAGE_WHEEL_REPEAT_THRESHOLD_PX` 120、`PAGE_WHEEL_QUIET_MS` 150、`PAGE_WHEEL_COOLDOWN_MS` 180 全部照旧。阈值那一层保留作为「手指还在推」时的节奏——**如果真机上觉得持续滑动翻得太慢,把 `PAGE_WHEEL_REPEAT_THRESHOLD_PX` 降到 60 是唯一要动的旋钮**,惯性已经由判定兜住,不再需要它当防线。触摸路径共用同一个 reducer,手指没有 OS 惯性、`momentum` 恒为 false,**行为一字未变**(触屏这轮没测,不引入未经验证的改动)。

接法上的三个决定:`preventWheelAction: false`(拦不拦要由归属、安全区与让位规则决定,不能交给库)、`reverseSign: false`(保持原生符号,`axisDelta[1]` 直接就是 reducer 要的「向下为正」)、跳过 `isEnding` 那次由定时器发出的收尾回调(它没有新的真实事件)。库自己的监听就是 `{ passive: false }`、回调在事件派发中同步执行,所以回调里 `preventDefault` 依然有效。推子的滚轮路径**没有改**,仍走 `wheel-delta.ts`。

接完之后自查出一处必须一并改的地方:分页的滚轮监听原本挂在一个依赖 `nextPage` / `previousPage` 的 effect 里,而这两个回调在**页数变化时会换身份**,于是 effect 重跑、`WheelGestures` 实例被重建。惯性要看一串事件才判得出来,手势中途把检测器换掉就等于忘了「这段行程是甩出去的尾巴」,而忘掉的尾巴又会开始翻页——正是这次要修的那件事。改成监听只按 `deckNode` 挂一次,随渲染变化的东西走一个每次渲染后同步的 ref(与 `Fader` 自己那套滚轮 handler 同一种写法)。这一条没有自动用例把关(jsdom 里造不出「手势中途页数变化」且库在 jsdom 下判不出惯性),靠的是代码推理与真实浏览器复跑那 12 项交互断言。

一处需要点名的差异:库的行高常量是 `16 × 1.125 = 18`,我们的 `WHEEL_LINE_HEIGHT_PX` 是 16。于是 Firefox 的一格(`deltaMode` 1 × 3 行)在分页路径上归一化为 54 px、在推子路径上仍是 48 px,**两者都仍然不足 60 px 的翻页阈值**——第 11 节第 3 条的已知取舍没有改变,只是数字更近了一点。

回归锁:`page-wheel.test.ts` 新增三例(惯性不给第二页、还没翻过页的惯性照给、手指中途按回来立刻恢复翻页);新建 `page-wheel.trace.test.ts`,把合成的触控板轨迹**经 `WheelGestures.feedWheel()` 真的过一遍库**再喂给 reducer,断言「一次甩恰好一页」「甩两次恰好两页」「手指持续推时连翻」「上滑手势不被横向漂移带偏」。逐条验证过摘掉修复即变红。**这些轨迹是按精密触控板的已知特征构造的,不是录制的**——原计划要在用户的笔记本上采真实事件序列,但用户换了机器、那台笔记本不在手边,这一步没做。**真实手感仍然移交用户**。

### 14.3 真实浏览器样式实测

16 组视口(宽 3840→640 各档 × 高 1080→520 各档)逐个截图,并自动检查五类故障。**没有检出任何一类**:

- 横向溢出:`document` 与 `.mixer-bays` 在所有视口下 `scrollWidth == clientWidth`,**横向永远没有滚动条**;
- 满页最后一条被裁(第 10.1 条的回归):所有视口下最后一条的右缘都在页内容盒之内;
- 页头元素互相重叠:两两包围盒无交叠;
- 文字截断:唯一报出来的是 `.control-lock legend`,那是刻意的无障碍隐藏写法(1px + `clip`,可见文字由 `::before` 画),**误报**;
- 安全区不可见:所有视口下都在视口内、宽 72px。

**这一轮的「没检出」后来被证明是不完整的**:用户在 729×596 报出了响度区重叠,见 14.6——那里连同漏检的原因一起记下了。

页头按内容换行的实际档位(12.5 改成无断点之后):**≥1440 一行(48px)**,**1280–800 两行(68px)**,**640 三行(82px)**。都是内容真的放不下才换,换行后条带高度随之减少但布局成立。视口高度 ≤600 时页内出现纵向滚动(`scrollHeight − clientHeight` 为 36–140 px),布局不塌,条带保持 528px 最小高度。

另外在真实 Chrome 里跑了 12 项 jsdom 测不了的交互断言,**全部通过**:鼠标一格恰好一页、翻页过渡真的在动、轨道上的一格只调推子不翻页、Shift 在轨道上翻页、矮视口先滚到底再翻页、安全区在矮视口下照样翻页且不去滚条带、纯横向滚轮不翻页(14.2 那条修复的真实浏览器验证)。

**一条留给用户决定的观感问题**:矮视口(如 1440×520)下条带底部的 MTR 读数与电平读数落在折叠线以下,而滚动条是隐藏的(12.1 的几何取舍),**没有任何「下面还有」的提示**。这是第 12.9 节已经列出的开放问题,不是这次改动引入的;加一个渐隐提示属于设计增补而不是修 bug,没有擅自做,请拍板。

### 14.6 响度区在 700–730 宽被挤到重叠 —— 上面那轮扫描漏掉的

用户实测 729×596 报出响度区样式冲突。复现属实,而且是**两个**缺陷:

1. **两个读数叠在一起**。`.loudness-panel` 是 `display: grid`,同时又是页头的 flex 项,默认 `flex-shrink: 1`,而 ≤800px 的既有规则还给了它 `flex: 1`(`flex-basis: 0`)。于是它拿到的是「这一行剩下多少」而不是「它需要多少」:729 宽时同行的 TYPE PAGES 与 CONTROL LOCK 占掉 403px,剩 326px,而它的内容要约 380px。被压扁的 grid **不会**把内容一起缩小——每个 `.loudness-reading` 保持自己的宽度、溢出分配给它的轨道,于是第一个读数的 `LUFS` 被画到第二个读数的 `TP` 标签上(700 宽时压 5px,729 宽时单位溢出盒子 6px)。
2. **`CONFIRM RESET` 折成两行**。按钮没有 `white-space: nowrap`,进入二段式确认态后文字换行,按钮从 29px 长到 45px,**整个页头从 68px 撑到 84px**,把下面的台面顶下去。

改法两句:`.loudness-panel` 加 `min-width: max-content`(它于是**只能换行、不能被压扁**,与页头「内容真正放不下才换行」的原则一致),`.reset-button` 加 `white-space: nowrap`。

400–1920px 逐档实测:重叠在**所有宽度**下消失(单位回到自己盒内 14px,与下一个标签间距 30px),确认态按钮不再换行,任何宽度都不横向溢出;**页头多出一行的只有原本就在重叠的那两段**(700/729 由 68→89,560 由 82→103),其余宽度一行不变。16 档的完整扫描结果与修复前逐项一致,没有回退。

**为什么上一轮扫描没抓到**,两个原因都记下来:

- 扫描的宽度档是 3840 / 2560 / 1920 / 1600 / 1440 / 1280 / 1024 / 900 / 800 / 640,**700–730 正好落在 800 与 640 之间的空档**;这个缺陷只在响度区「刚好上了共享行、又刚好不够宽」的窄带里出现。
- 页头重叠检测遍历的是 `header.children`,而 `.console-preferences` 是 `display: contents`,**VIEW / TYPE PAGES / CONTROL LOCK 三个真正的 flex 项根本没被量到**,行内几何因此算错。而且响度值当时只有 −22.9 这一种,没试过 −100.0 这类更宽的读数,也没试过 `CONFIRM RESET` 这个更宽的按钮态——**静态一次快照测不出随内容变化的布局**。

这一条**没有自动回归锁**:jsdom 不求值 CSS,现有测试栈断言不了「谁被画到谁上面」。它靠的是浏览器里的实测数字(单位相对自己盒子的溢出量、单位与下一个标签的间距),复核时只能再跑一次浏览器。

### 14.7 通道条定宽 125px,底部读数区重做

用户实测后定了两件事:通道条改用**统一固定宽度**(自适应拉伸下某些视口显得过宽),以及底部那块「电平值 + level 值」重新设计——排布杂乱、level 值与 `dB` 之间的距离会随位数变化、125px 下 level 值还会撞上电平读数的边框。

**定宽**。改的是 `STRIP_WIDTH_MAX_PX`:把上限设成与下限同值(都是 125),`fitPages` 算出的 `growth` 于是恒为 0,`fit.stripWidth` 在任何视口都等于 `STRIP_WIDTH_PX`,余量全部进间隙与居中。`paginate` 与 `page-fit.ts` 一行没改——拉伸这条路还在,只是当前没有量可涨;把上限调高就重新打开。CSS 侧本来就只有一个入口(`.channel-strip` 的 `width` / `min-width` / `flex-basis` 都读 `--strip-width`),没有任何媒体查询覆盖它。

**读数区的三个毛病是同一个结构问题**:两块读数分别待在电平表列(3.25rem)和推子列里,一块读数**最宽只能和它上面那个控件一样宽**。于是——

1. level 值在自己那列里居中,`dB` 贴着固定列的左沿。值一变位数,居中文本的右缘就移动,**两者之间的距离随之变化**;
2. 125px 时推子列只有 43px,而 level 值那个按钮有 `min-width: 2.7rem`(43px)、外面还套着 `overflow: visible`,于是**向左溢出到电平读数的边框上**;
3. 一块有框、一块没框,字号 0.64/0.86rem,一个右对齐一个居中,一个有 `MTR` 标签一个没有——所以看着乱。

改法是把读数从控件列里拿出来:`.channel-strip__controls` 改成三列(电平表井 / 推子轨道 / 刻度)两段式的网格,**两块读数各占一整行、横跨整条通道条**,`.meter` 与 `.fader` 用 `display: contents` 摊平,好让它们的部件落在同一张网格上。两行用同一套三列规则——标签 / 值 / 单位,**只有值那一列是弹性的**:数字向左长进没人要的空白,到 `dB` 的距离就是一个固定的 `margin`,两个 `dB` 也因此站在同一条竖线上。两行共用一条边框,合起来读作一块仪表面板。level 读数不再待在推子下面,所以它像 `MTR` 那样写出自己的名字 `LVL`。

`display: contents` 会让元素本身没有盒子,原来挂在 `.meter` 上的 `opacity`(无电平时变暗)随之失效,已下移到真正要变暗的电平表井与读数上;`.fader` 上的 `position: relative` 与 `transition: opacity` 是没人用的残留(绝对定位的滑块、槽、刻度都以 `.fader__track` / `.fader__scale` 为基准),一并去掉。

**浏览器实测**(1920×1080 / 1280×520 / 729×596,合成 40 通道,2× DPR):

| 量 | 结果 |
| --- | --- |
| 通道条宽度 | 每档视口都是 125.00px |
| 值 → 单位的距离 | MTR 与 LVL 都恒为 4.47px,26 条通道、三档视口**一个数** |
| 两个 `dB` 的横向偏差 | 0.00px |
| 两行之间的缝 | 0.00px(共边框) |
| 读数溢出自己面板 | 最坏 −7.27px(即最紧的一条仍余 7.27px) |
| 读数溢出通道条 | 最坏 −11.39px |
| 推子滑块溢出轨道 | 最坏 −5.12px |
| 文档横向溢出 | 0 |

编辑态(点开 level 值输入框)一并量过,数字与静态态一致。16 档视口的完整扫描重跑:无横向溢出、无页头重叠、末条不被裁、安全区各档可见,`.readout__value` 在任何宽度都不截字;每页条数随定宽上升(1920 由 11 → 13 条,总页数 4)。真实浏览器的 13 项交互断言全部通过。

**可编辑与只读要分得开**(用户复看后补的第一条)。两块读数画法一样,没有任何东西说明其中一块可以点开输入、另一块只是印上去的。改成:LVL 的值格常驻一圈字段边框与下沉底色(`#2f333c` / `#12141a`),悬停时边框提亮、文字转琥珀,输入态换成通道色边框与同色光标,推子被锁定或断线时边框退色、整格淡到 0.45——**这正是安全区页码已经在用的写法**,理由也一样:触摸屏没有 hover,常驻的边框是「可点」的唯一提示。MTR 的值不加盒子,保持面板底色。两者用同一份内边距、MTR 那份带一圈透明边框,所以**数字仍然收在同一条竖线上**(实测偏差 0.00px,两格都没有因为让出内边距而丢字)。四个状态(静止 / 悬停 / 输入 / 锁定)各截了一张 4× DPR 的特写。

**LVL 移到条首,读数的样式由用户定案**(第二条)。用户自己把 MTR 那行的边框与底色去掉、把 LVL 值格静止态的边框注释掉(值格只剩下沉底色),并要求把 LVL 框体移到通道条顶部、电平读数留在底部。位置取「ON 键之下、表体之上」(用户在两种读法里选的这一种),于是一条通道条自上而下读作:**名称 → ON → 电平值 → 表体与推子 → 电平读数**——先是操作员设的,再是台子答的。实现只是把 `.channel-strip__controls` 的行序从 `1fr auto auto` 改成 `auto 1fr auto`,再把三个控件与两块读数各自的 `grid-row` 对上。

改完实测发现两处几何错,都修了:电平表井的 `grid-row` 忘了跟着从 1 改到 2,和 LVL 重叠了 23px;MTR 去掉边框之后它的**内容盒比 LVL 宽了左右各 1px**,三列因此整体偏移,数字与单位对不齐 1px——改成保留边框但设为 `transparent`,外观与用户要的一致,盒模型回到一致。

复测:LVL 与电平表井之间 8.00px、推子轨道与 MTR 之间 22.81px,均为正不重叠;数字右缘偏差 0.00px、两个 `dB` 偏差 0.00px;值→单位距离仍恒为 4.47px。16 档扫描与交互 13 项与上一轮逐项一致。顺带的好处:矮视口下页内滚动时,**可编辑的那块现在在折叠线以上**,落到线下的是只读的电平读数。

**刻度到底就不报数**(第三条)。电平表触底原本印 `-60.0`、响度原本印 `-100.0 LUFS` 与 `-60.0 dBTP`。比刻度底更低的一切在那里读数相同,印出数字等于声称一次没做过的测量;而响度那一对恰好在**开机与 RESET 之后**就停在各自的底,那时它根本还没积分出任何东西。改为:电平表触底读 `-∞`(与推子在自己刻度底的写法一致,同一个 U+221E),响度两项触底各读 `--`。

- `Meter.tsx` 新增导出 `formatMeterDb()`,`value <= METER_DB_MIN` 时返回 `-∞`;
- `LoudnessPanel.tsx` 的 `formatReading()` 在 `value <= minimum` 时返回 `--`(上限钳位不变);
- 两条回归锁:`Meter.test.tsx` 断言 `-60` / `-99` 都读 `-∞` 而 `-59.9` 仍印数字,`LoudnessPanel.test.tsx` 断言 `-100` / `-60` 一起读 `--` 且不再出现 `-100.0` / `-60.0`;
- 浏览器里把合成服务的所有通道钉到 −60 实测:26 条通道的读数全是 `MTR -∞ dB`,页头是 `INT -- LUFS` / `TP -- dBTP`。

> 扫描脚本在每一档都报一条 `clipped: CONTROL LOCK`。查过了,那是 `.control-lock legend`——一个 `1px × 1px` + `clip` 的**只读给读屏器的**标题,`scrollWidth > clientWidth` 是它的正常状态,不是缺陷。脚本的检测口径问题,与本次改动无关。

### 14.8 分区/分组标题改为横跨条带的标题栏

竖排表头站在它那一段的排头,每段因此从页宽里拿走 `SECTION_HEADER_WIDTH_PX`(52)+ 一个条间距。125px 的条宽下这接近半条通道,一页上摆几段就是几份。用户要求把它挪开,给了两种形态(顶上单独一行 / 把组包起来),选了**标题栏**。

**为什么不选包框**:一段经常跨页(24 条 INPUTS 在 1600 宽要占三页),包框意味着闭合,给半段画个框是在说谎;标题栏不承诺闭合,跨页那半段只要在栏里注明就行。另外框的左右边线会重新吃掉宽度,而这次改动的全部意义就是把宽度还回来。

**为什么这是划算的一边**:混音台缺的是宽度,不缺高度——条带无论如何都是一个视口高。把标题从宽度挪到高度,代价是条带矮 32px(972 → 940 @1080),收益是每页多装条带:

| 视口宽 | 改前 每页/总页 | 改后 每页/总页 |
| --- | --- | --- |
| 3840 | 28 / 2 | 29 / 2 |
| 2560 | 18 / 3 | 19 / 3 |
| 1920 | 13 / 4 | **14 / 3** |
| 1280 | 8 / 6 | **9 / 5** |
| 1024 | 6 / 7 | **7 / 6** |
| 900 | 5 / 9 | **6 / 7** |
| 800 | 4 / 10 | **5 / 8** |
| 640 | 3 / 14 | **4 / 10** |

**实现**。标题不再占宽度,所以 `paginate` 与 `fitPages` 的表头项是**删掉**而不是传 0:`PageMetrics.headerWidth`、`PageFitMetrics.headerWidth` / `headerGap`、`PageCounts.headers` 全部移除,`stripCost()` 退化成「前置间距 + 条宽」。`.mixer-section` 从一排 flex 变成两行 grid(`var(--section-header-height)` / `minmax(var(--strip-min-height), 1fr)`),条带装进新的 `.mixer-section__strips`;**没有标题的段也照样占住标题行**,否则同页并排的两段条带起点会差一个栏高。

栏里多了一样竖排表头没地方放的东西:**`CONT`**。计数 `24` 是整段的数,不是本页这几条的数,所以溢到本页的那半段要说明自己是续页——这正是 `paginate` 早就算出来但一直没显示的 `continued`。

**浏览器实测**(1600×1000,四页逐页量):每页所有段的条带起点是**同一个 y**;每条标题栏与它那排条带**同宽同左缘**(偏差 0.00px);`CONT` 只出现在续页的那一段上(第 2、3 页的 INPUTS、第 4 页的 AUX)。16 档视口扫描:无横向溢出、无页头重叠、末条不被裁、安全区各档可见。矮视口的页内滚动阈值随栏高前移(1440×600 由 36 → 53px),这是对的——栏是段的一部分。交互 13 项全过。

**被改写的用例**:`pagination.test.ts` 的「带表头的段少装一条」翻转为「带不带表头装得一样多」,跨页用例的条数随之从 5 改成 6;`page-fit.test.ts` 的「最紧的页说了算」改用 5 条 / 4 条两页来构造(原来靠表头宽度制造紧张),「表头后的间距不替其它间隙买单」整条失去对象,替换为「带标题的页与不带标题的页拿到完全一样的布局」;`stub-mixer-layout.ts` 与三个集成测试里的视口宽度公式去掉表头项。

### 14.4 本地收尾批次的质量门

```
pnpm lint (eslint + prettier)                成功
pnpm --filter @flwc/web typecheck            0 error
pnpm --filter @flwc/web test --coverage      56 文件 / 447 用例 全绿
pnpm --filter @flwc/web build                成功
git diff --stat pnpm-lock.yaml               +9 行(只有 wheel-gestures)
```

覆盖率:Statements 97.05% / Branches 92.47% / Functions 99.15% / Lines 97.02%(门槛 80%,未调整、未新增排除项)。用例 438 → 447(净增 9)。

14.7 的三轮改动之后这一套原样重跑,同样全绿:56 文件 / **449** 用例(净增 2,是刻度底读数的两条回归锁),覆盖率 Statements 96.94% / Branches 92.38% / Functions 99.15% / Lines 96.90%。14.8 之后再跑一次:56 文件 / **450** 用例全绿。

### 14.5 仍然移交用户的事项

1. **触控板真实手感**——14.2 的轨迹是构造的不是录制的。回到那台笔记本后请重点试:用力甩一次是不是恰好一页;持续滑动的节奏跟不跟手(觉得慢就把 `PAGE_WHEEL_REPEAT_THRESHOLD_PX` 降到 60);「双指下滑莫名往下翻页」是否彻底消失。
2. **触屏与真机 40 通道**——触屏路径这轮完全没测(用户另行安排);真机 40 通道盯着电平表看 1 分钟这一条仍然需要在真实 Fairlight 上做。
3. **电平表改绘的认可**——预算本来就过了,改绘是基于「每帧一次布局」的成因做的,并且在 CPU 降频 3 倍这一档有一处未解释的反例(14.1)。要不要保留这次改绘,请拍板。
4. **矮视口的滚动提示**——见 14.3 末尾。
5. **页头在 700–730 宽会多出一行**(14.6 的代价)。那一档原本就是挤到重叠,换行是正确的取舍,但如果你觉得这个宽度下宁可让响度区更紧凑也不要多一行,那是一次设计决定(例如窄行下省掉 `LUFS` / `dBTP` 单位),请拍板。
6. **125px 与新读数区的观感**(14.7)。几何上的三个毛病都有实测数字兜底,但字号(MTR 0.68rem / LVL 0.84rem)、`LVL` 值的点击区(整格约 52 × 21px)和两行合成一块面板的样子是设计判断,请在真机上看一眼;`LVL` 值仍可点开输入精确电平,请顺手试一次。
7. 第 5 节的**安全约束原样继续生效**:滚轮与翻页验收请在台面空白处、安全区与页码上做;确需动推子时只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道,测后复原,不得切 ON/mute、不得动其它通道、不得删改任何通道。
