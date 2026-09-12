# Phase 6.3 执行提示词 — 混音页分页

> 用法:将本文档全文作为执行会话的任务提示词。执行会话运行在 Cursor 云端环境(配置见 `.cursor/environment.json`),无法访问真实 Fairlight Live。任务来源是 `docs/development-plan.md` 的 6.3 一节(含「Fader 滚轮与翻页滚轮共存规则」),细节以本文档为准;两者冲突时以本文档为准并在报告里指出。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,真机验收由用户在本地完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(含云端 dev server 的 IPv6 localhost 注意事项、新增依赖的许可要求)
2. `docs/development-plan.md` — Phase 6 总述、6.3 一节全文(交付物、共存规则、归属边界情形、验收标准),以及「云端 Agent 开发边界」;同时浏览 6.4 与 6.5,了解不该越界的内容(滑动手势、`:hover` 媒体查询、`100vh` 全量替换、Wake Lock、重连与 soak 都不属于本批次)
3. `docs/architecture.md` — 「前端结构」(混音页空态、推子拖动、动效基线)、「通道分组」里关于混音页渲染分组段与 `TYPE ROWS` 的描述、「前后端通信」的 `meters:frame`(50 ms 节流,即 20 Hz)
4. `docs/conventions.md` — 目录结构、命名、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/reports/phase-6-2-2-report.md` — 上一批次执行报告,重点第 1 节(云端装不上 `apps/server` 依赖的经过)、第 5 节(真机验收清单的写法与安全约束)、第 11 节(遗留:留给 6.3 的事项);以及 `docs/reports/phase-6-2-report.md` 第 7 节(`codeload.github.com` 受限时的安装绕行办法)与 `docs/reports/phase-6-2-1-report.md` 第 2 节「端到端冒烟」一段(Playwright 冒烟的做法)
6. `docs/prompts/phase-6-2-2.md` — 上一批次的提示词,本批次沿用其「硬性约束」与「云端执行边界」

## 代码现状(已确认,直接复用)

- **混音页**(`apps/web/src/features/mixer/`):`MixerPage.tsx` 持有全部页面逻辑——从 `mixerStore` 取通道、从 `viewStore` 取 `views` / `activeViewId`,`resolveViewChannels` + `segmentViewChannels`(`view-resolver.ts`)把当前 view 切成 `ViewSegment[]`(`{ group: ViewGroup | undefined, entries: ResolvedViewChannel[] }`,组段带 `group`,无组连续段 `group` 为 undefined,空组不产生段);All Channels 模式按 `CHANNEL_KINDS` 顺序每种类型一个 `section`。渲染结构:`main.mixer-shell` > `header.console-header` + `div.mixer-bays[.is-view-mode][.is-type-rows]` + `footer.console-footer`;每段是 `section.mixer-section[aria-labelledby][data-channel-kind | data-view-group-id]`,内含 `div.channel-group-lead`(竖排 `header.mixer-section__header`(`h2` 段名 + `span` 在场计数,零填充两位)+ 首个通道条)与 `div.channel-bay`(其余通道条),两者 `display: contents`,目的只是让 flex-wrap 换行时表头与首条不分离;无组段在 `TYPE ROWS` 下用 `span.view-row-break` 强制换行,紧跟组段的首个无组条带加 `is-after-group`(左边距)。通道条 `ChannelStrip.tsx`(`article.channel-strip[data-channel-id]`,`--strip-index` 驱动入场动画延迟)与 `MissingChannelStrip.tsx`;`useChannelPresence` 给移除的通道 `CHANNEL_EXIT_MS`(180 ms)的退场动画。
- **页头**:`console-header` 是 `position: sticky` 的四列 grid(`minmax(12rem, 1fr) auto auto minmax(25rem, auto)`),`min-height: 6.5rem`:`console-brand`(eyebrow `FAIRLIGHT LIVE` + `h1` `CONTROL DESK` + `CONFIGURE VIEWS` 按钮,竖排)、`ConnectionStatus`(状态灯按钮,可访问名 `Connection settings`,含 `role="status"` 区与 `role="alert"` 通知)、`console-preferences`(竖排三行:`ViewSelector`(`select[aria-label="Mixer view"]`)、`TypeRowToggle`(`TYPE ROWS` 字样 + `role="switch"`,All Channels 或 view 含组时才渲染)、`ControlLock`(`fieldset` + `legend` `CONTROL LOCK` + 三个 `role="radio"` 按钮 `UNLOCKED` / `FADERS` / `ALL`))、`LoudnessPanel`(`section[aria-label="Loudness"]`,`INT` / `TP` 两个读数与 `RESET` 二段式按钮)。≤800px 时 `@media` 把它折成两行。`TYPE ROWS` 偏好存 `localStorage` 键 `flwc.layout.typeRows`(`use-type-row-preference.ts`),CONTROL LOCK 偏好在 `use-control-lock-preference.ts`。
- **通道条尺寸**(`styles.css`):`.channel-strip` 固定 `width: 9.25rem`、`min-height: 33rem`,grid 行 `auto auto 1fr`(名称头 4.15rem、ON 按钮、`channel-strip__controls`);`.channel-strip__controls` 是 `3.25rem 1fr` 两列(电平表 + 推子);`.fader` 与 `.meter` 都是固定 grid 行 `21rem 2.6rem`(轨道/表体 + 读数);`.fader__track` 高 `calc(100% - 1.85rem)`、`touch-action: none`,推子帽 `bottom` 按 `levelDbToRatio` 定位;`.meter__fill` 用 `clip-path: inset(var(--meter-reveal) 0 0)` 露出固定渐变(`transition: clip-path 45ms linear`),`.meter__peak` 用 `bottom`(`transition: bottom 60ms linear`),`is-clipping` 时整条变红闪烁。分区表头 `.mixer-section__header` 宽 `3.2rem`、`min-height: 33rem`、竖排文字;非首段表头 `margin-left: 0.85rem`;`.mixer-bays` 是 `flex-wrap: wrap`,`column-gap: 1px; row-gap: 0.9rem`,`padding: 1.6rem 1.5rem 2.5rem`。`.mixer-shell` 是 `min-height: 100vh` 的 `auto 1fr auto` 三行 grid。根字号未改(16px)。
- **推子**(`apps/web/src/components/Fader.tsx`):props `label / value / disabled / pending / onInteractionStart / onValueChange / onCommit`;指针拖帽(`setPointerCapture`,超过 `CAP_DRAG_THRESHOLD_PX` 才 `onInteractionStart`)、双击回 0 dB、键盘(方向键 ±1 dB,`PageUp` / `PageDown` ±10 dB,`Home` / `End`,`stepLevelDb` 在 `lib/fader-scale.ts`)、读数点击进入精确输入;键盘与精确输入都是「start → change → commit」三连调。`ChannelStrip` 把 `onValueChange` 按 `LEVEL_SEND_INTERVAL_MS`(50 ms)节流发 `setLevel`,`onCommit` 发最终值并 `finishLevelInteraction`;`onInteractionStart` → `beginLevelInteraction`(进入 pending,远端更新不覆盖本地)。`faderDisabled = !controlsAvailable || exiting || lockMode !== 'unlocked'`。**推子没有任何滚轮处理**,全仓也没有 `wheel` 监听与 `ResizeObserver` 使用。
- **电平**:`meterStore`(`store/meter-store.ts`)独立于 `mixerStore`,`Meter` 组件按 id 订阅,`applyMetersFrame` 每帧更新;服务端 `MeterHub` 的 `METER_FRAME_MS` 为 50。
- **测试基建**:`apps/web/tests/mixer.integration.test.tsx`(`FakeSocket` + `App`,用 `serverEmit` 推快照/补丁/电平帧;10 例,其中 `places ON above the fader and persists the optional type-row layout` 断言 `.mixer-bays` 的 `is-type-rows` class)、`views.integration.test.tsx`(多处用 `.mixer-bays > article h3`、`.channel-group-lead`、`is-after-group`、`is-type-rows` 断言混音页布局)、`Fader.test.tsx`(15 例,直接渲染 `Fader`)、`Meter.test.tsx`(4 例)、`TypeRowToggle.test.tsx`(断言 `TYPE ROWS` 字样)。`vitest.setup.ts` stub 了 `scrollTo`、`scrollIntoView`、`Element.prototype.animate`;**没有 `ResizeObserver` stub**,jsdom 也不提供。RTL 的 `fireEvent.wheel` 会构造带 `deltaY` / `deltaMode` / `shiftKey` / `altKey` 的原生 `WheelEvent`,原生 `addEventListener` 能收到。覆盖率门槛 80%,当前 web 约 96%。
- **文档**:`docs/architecture.md` 「通道分组」末尾「混音页按同样的连续段渲染……含分组的 View 也支持 `TYPE ROWS` 横排布局」与「前端结构」的混音页描述在本批次后不再成立,要改写;`docs/development-plan.md` 6.3 的验收框由用户勾选。

## 云端执行边界

- 你运行在云端,**无法连接真实 Fairlight Live**。本批次是纯前端改动(`apps/web`),不改 `apps/server` 与 `packages/shared`。
- 验收标准中标注「本地」的条目由用户本地执行,你在报告中标注**移交用户**,并给出可直接照做的验收操作清单。
- 在独立分支上开发并推送,保持远端 CI(GitHub Actions:lint + typecheck + test + build,`pnpm install --frozen-lockfile`)全绿;不得改动 CI 流水线结构。
- **本批次不新增依赖**,`pnpm-lock.yaml` 不应有改动。
- 云端安装:先按 6.2 报告第 7 节的办法尝试装齐四个包;若沙箱仍拒绝(6.2.2 报告第 1 节的情形),退而只装 `@flwc/web` 与 `@flwc/shared`(`pnpm install --frozen-lockfile --filter @flwc/web --filter @flwc/shared`),并按第 6 节的「合成电平服务」做浏览器冒烟与性能实测——本批次的冒烟**不依赖** `apps/server` 与 Mock Ember+ Provider,因此不得再以「装不上依赖」为由跳过冒烟。
- 云端手动冒烟用 `pnpm --filter @flwc/web dev`:web 端必须用 `http://localhost:5173` 访问(Vite 只监听 IPv6 `::1`);Vite 会把 `/socket.io` 代理到 `127.0.0.1:3000`,合成电平服务就监听这个端口。

## 硬性约束

- `docs/prompts/phase-6-2-2.md` 的「硬性约束」全部沿用:自动化测试一律基于 Mock 或夹具;代码、注释、提交信息、固定 UI 文案英文,文档与报告简体中文;不改 CI;不调低覆盖率门槛、不新增覆盖率排除项;按逻辑单元分多次提交(建议:布局常量与切页纯函数 → 页面骨架、100dvh 与页头压缩 → 翻页状态、安全区与键盘 → 滚轮归属与两个 reducer → 推子滚轮接入 → 翻页滚轮接入 → 电平表实测(与可能的 transform 改绘)→ 文档)。
- **既有可访问名与 DOM 契约不变**:`Connection settings`、`Mixer view`、`Start each channel type on a new page` / `Start each group on a new page`(见第 2 节,原文案的 `row` 改为 `page`)、`CONTROL LOCK` 与三个选项、`Loudness` 与 `RESET`、`CONFIGURE VIEWS`、`<name> level` 滑块、`<name> on/off`、`<name> meter`、`section.mixer-section[aria-labelledby]` + `header.mixer-section__header > h2 + span`、`article.channel-strip[data-channel-id]`、`data-channel-kind` / `data-view-group-id`、`.mixer-bays` 容器名。既有用例因布局改动必须改写的地方(`is-type-rows`、`is-after-group`、`.channel-group-lead`、`.mixer-bays > article`)只允许改断言的定位方式,**断言意图保留**;报告列出被改写的用例清单。
- **推子的既有交互一字不改**:指针拖帽、双击回 0、键盘步进、精确输入、pending 与远端冲突规则、`onCommit` 语义;滚轮是新增的第五条输入路径,复用同一组回调。
- **安全区里不得有任何影响声音的控件**:`PageRail` 内没有滑块、ON、RESET 或任何会发 `control:*` 事件的元素,用集成测试断言。
- 文档给出的数值都是**初值**,你不得自行调整,也不得调换单位;新增的数值一律做成导出常量,集中在第 1 节与第 4 节指定的文件里,并在报告的「数值初值清单」逐个列出(名称、值、含义、所在文件)。
- 不改 `docs/development-plan.md` 的任务描述与验收框;`docs/fairlight-ember.md` 只由用户回写。

## 任务范围

六项改动,按下面的顺序做。第 1–3 项是分页布局,第 4–5 项是滚轮,第 6 项是实测;第 4 项独立于分页,第 5 项依赖第 3 项的页面状态。

### 1. 切页纯函数与布局常量

- 新建 `apps/web/src/features/mixer/page-layout.ts`,只放导出常量(px,单位写进名字):
  - `STRIP_WIDTH_PX = 148`(即现在的 9.25rem)、`SECTION_HEADER_WIDTH_PX = 52`(3.2rem)、`STRIP_GAP_PX = 1`(条带之间)、`SEGMENT_GAP_PX = 14`(相邻两段之间,即现在的 0.85rem)、`STRIP_MIN_HEIGHT_PX = 528`(33rem,低于它就降级为页内滚动)、`PAGE_RAIL_WIDTH_PX = 56`、`PAGE_TRANSITION_MS = 220`。
  - 这些常量通过 `.mixer-shell` 的内联 `style` 写成 CSS 自定义属性(`--strip-width` / `--section-header-width` / `--strip-gap` / `--segment-gap` / `--strip-min-height` / `--page-rail-width` / `--page-transition`),`styles.css` 里对应位置一律改用 `var(...)`,不再各写一份数字;TS 与 CSS 由此只有一个真相来源。
- 新建 `apps/web/src/features/mixer/pagination.ts`(纯函数,不依赖 DOM):

  ```ts
  export interface PageMetrics {
    containerWidth: number; // content-box width of the pager viewport
    stripWidth: number;
    headerWidth: number;
    stripGap: number;
    segmentGap: number;
  }
  export interface LayoutSegment<T> {
    key: string;
    header: boolean; // true: type section or group, rendered with the vertical header
    entries: T[];
  }
  export interface PageSegment<T> extends LayoutSegment<T> {
    continued: boolean; // the header repeats a segment that started on an earlier page
  }
  export interface StripPage<T> {
    segments: PageSegment<T>[];
  }
  export function paginate<T>(
    segments: readonly LayoutSegment<T>[],
    metrics: PageMetrics,
    options: { newPagePerHeaderedSegment: boolean },
  ): StripPage<T>[];
  ```

  规则:贪心逐段逐条填充。一条通道条在当前页的代价:页非空则先加 `segmentGap`(换段)或 `stripGap`(同段续条);段带表头且是该段在本页的第一条则再加 `headerWidth + stripGap`;最后加 `stripWidth`。代价超过剩余宽度就开新页,带表头的段跨页时新页上重复表头并标 `continued: true`;`newPagePerHeaderedSegment` 为 true 时每个带表头的段(All Channels 下的每种类型、view 下的每个组)都从新页开始,无表头的段照常续排。**每页至少放一条**(容器比一条还窄也不能死循环);空段不产生任何输出;没有任何条目时返回 `[]`,调用方按 `Math.max(1, pages.length)` 得页数。

- 测试(`pagination.test.ts`):每页数量随容器宽度变化(恰好放下 N 条、差 1px 放不下第 N 条)、表头占宽导致同宽容器下带头段少放一条、组跨页时第二页带 `continued` 表头、`newPagePerHeaderedSegment` 下每组一页而无组段续排、容器比一条还窄时每页恰好一条、空输入返回 `[]`、空段被跳过。

### 2. 页面骨架:100dvh、单行页头、条带撑满

- **外壳**:`.mixer-shell` 改为 `height: 100dvh`(不是 `min-height`),grid 仍是 `auto 1fr auto` 三行;中间行是新的 `div.mixer-deck`(`display: grid; grid-template-columns: 1fr var(--page-rail-width); min-height: 0`),左格是分页视口(`.mixer-bays`,改语义为 pager viewport)、右格是第 3 节的安全区;第 5 节的翻页滚轮监听挂在 `.mixer-deck` 上,安全区上的滚轮因此也翻页。`console-header` 去掉 `position: sticky`(外壳已经把它钉在第一行)。**本批次只在混音页用 `100dvh`**,`body` / 配置页的 `100vh` 留给 6.4。
- **页头压缩为单行**:`console-header` 改为单行 grid(建议 `auto auto auto auto auto 1fr`,顺序:品牌、连接状态、view 选择、TYPE PAGES 开关、CONTROL LOCK、响度),`min-height: 3rem`,不再有 `6.5rem`。`console-brand` 改为横排(eyebrow 与 `h1` 同一行,`h1` 字号降到与 eyebrow 同级,`CONFIGURE VIEWS` 仍是文字按钮);`console-preferences` 由竖排三行改为横排三格;`ControlLock` 的 `legend` 与选项同一行;`LoudnessPanel` 的两个读数与 `RESET` 同一行。≤800px 的既有 `@media` 允许页头折成两行(条带高度随之减少,布局仍然成立),不必为窄屏另做设计。组件的 DOM 与可访问名一律不变,只改样式与容器。
- **`TYPE ROWS` 改为 `TYPE PAGES`**:开关语义已变为「每个分区 / 分组从新的一页开始」,`TypeRowToggle` 显示文字改为 `TYPE PAGES`,默认 `label` 改为 `Start each channel type on a new page`,`MixerPage` 传入的 view 文案改为 `Start each group on a new page`;`localStorage` 键 `flwc.layout.typeRows` 与 hook 名不变(不做偏好迁移),`TypeRowToggle.test.tsx` 的字样断言随之改。
- **条带撑满**:`.mixer-bays` 变为 `overflow: hidden auto; padding: 0`(横向永远不滚,纵向只在降级时滚);内部一个 `.mixer-pages` 轨道(`display: flex; height: 100%; transform: translateX(calc(-100% * var(--page-index)))`,`transition: transform var(--page-transition) ease`,`prefers-reduced-motion: reduce` 下 `transition: none`);每页 `.mixer-page` 是 `flex: 0 0 100%; height: 100%; min-height: var(--strip-min-height); display: flex; align-items: stretch; padding: 0.9rem 1.5rem`,页内段与段之间用 `margin-left: var(--segment-gap)`、条带之间 `column-gap: var(--strip-gap)`。**视口高度不足时的降级完全由 CSS 得到**:页高被 `min-height` 撑到 `STRIP_MIN_HEIGHT_PX`,`.mixer-bays` 出现纵向滚动条,不需要任何 JS 判定。
- **段与条带**:分页后一页内不再换行,`.mixer-section` 改为真正的 flex 容器(`display: flex; gap: var(--strip-gap)`,含表头与全部条带),删除 `channel-group-lead` / `channel-bay` 这对 `display: contents` 包装、`view-row-break`、`is-after-group` 与全部 `.mixer-bays.is-type-rows …` 规则(横排表头变体一并删除,分页下表头永远竖排)。`.mixer-section__header` 与 `.channel-strip` 改为 `height: 100%`,去掉 `min-height: 33rem`;`.channel-strip` grid 行仍 `auto auto 1fr`,`.channel-strip__controls` 加 `min-height: 0` 并让唯一一行 `1fr`;`.fader` 与 `.meter` 的 grid 行改为 `minmax(0, 1fr) 2.6rem`,轨道与表体随之拉长,`fader__scale` / `fader__track` / `meter__well` 已按百分比取高,不需要改。`MissingChannelStrip` 同样撑满(`missing-channel-strip__body` 保持固定高,`trace` 吃掉剩余)。
- **入场序号 `--strip-index`**:入场动画延迟按条带在**本页**内的序号计算,不再按全局序号。
- 测试:集成用例断言页头单行的结构不需要(jsdom 不算布局),但要断言所有既有控件仍在且可访问名不变(把 `mixer.integration.test.tsx` 与 `views.integration.test.tsx` 里按旧布局 class 定位的断言改为按 `section` / `article` / 可访问名定位);`TypeRowToggle.test.tsx` 改字样。

### 3. 翻页状态、安全区与键盘

- **容器测量**:新建 `apps/web/src/features/mixer/use-pager-viewport.ts`:`usePagerViewport(ref)` 用 `ResizeObserver` 观察 `.mixer-bays`,返回 `contentRect.width`(内容盒宽度);首次挂载时同步读一次 `clientWidth` 以免首帧 0 宽;`ResizeObserver` 不存在时(jsdom)退化为只读一次。测试基建:新建 `apps/web/tests/stub-resize-observer.ts`,提供可控的 `ResizeObserver` 双替(记录被观察元素,`resizeTo(element, width, height)` 触发回调),在 `vitest.setup.ts` 安装;混音页的布局 stub(新建 `apps/web/tests/stub-mixer-layout.ts`,与配置页的 `stub-layout.ts` 分开)给 `.mixer-bays` 的 `clientWidth` / `clientHeight` / `scrollHeight` 可控的默认值,默认宽度让「一个表头 + 两条通道条」正好一页。
- **页面状态**:新建 `apps/web/src/features/mixer/use-pager.ts`:`usePager(pageCount, resetKey)` 返回 `{ pageIndex, next(), previous(), goTo(index) }`;`pageIndex` 始终钳在 `[0, pageCount - 1]`(页数缩小时钳到末页,页数增大时保持);`resetKey`(传 `activeViewId`)变化时回到 0;`TYPE PAGES` 切换与窗口尺寸变化只钳位不重置。纯函数 `clampPageIndex(index, pageCount)` 与 `nextPageIndex(index, pageCount, direction)` 导出并单测。
- **页面渲染**:`MixerPage` 把 All Channels 的类型段与 view 的 `ViewSegment` 都映射成 `LayoutSegment`(类型段与组段 `header: true`,无组段 `header: false`),经 `paginate` 得到页,再逐页渲染既有的段 / 条带(建议把轨道与页的渲染抽成 `StripPages.tsx`,`MixerPage` 只负责取数据与状态;`renderViewStrip` 逻辑原样搬迁)。**只挂载当前页与其前后各一页**,其它页渲染为同宽的空 `.mixer-page`,以控制离屏 `Meter` 订阅数量。`continued` 的表头照常渲染(同一个 `h2` 文案,`id` 加页号后缀避免重复;不加任何 `cont.` 标记),计数仍显示该段在场总数。`--page-index` 写在 `.mixer-pages` 的内联样式上。空态(`EmptyConsole`)时不渲染轨道与安全区,与现在一样占满中间行。
- **安全区**(`PageRail.tsx`,`aside.page-rail[aria-label="Pages"]`):固定宽 `var(--page-rail-width)`,占满 `.mixer-deck` 右格,`touch-action: none; user-select: none`,背景与页头同系;自上而下:`button[aria-label="Previous page"]`(向上箭头)、`output[aria-label="Page"]`(文本 `2 / 5`,单页 `1 / 1`)、`button[aria-label="Next page"]`(向下箭头)、然后一个占满剩余高度的 `div.page-rail__track[data-swipe-surface]`(空,留给 6.4 的滑动手势,本批次只保证它存在且 `touch-action: none`)。按钮做成实体按键质感(与 ON 按钮同一套 bevel / 内阴影语汇,按下有位移),首页时 `Previous page` 禁用、末页时 `Next page` 禁用,单页两者都禁用但页码照常显示;安全区**在两种指针设备上都常驻**(粗指针设备上不得被任何方式隐藏或折叠;细指针设备上同样显示,不做悬停显隐),位置固定不随页数变化。
- **键盘**:`MixerPage` 挂载时在 `window` 上监听 `keydown`:`PageDown` → 下一页、`PageUp` → 上一页;`event.defaultPrevented` 为 true,或 `event.target` 命中 `[role="slider"], input, select, textarea, [contenteditable]` 时不处理(推子聚焦时的 `PageUp` / `PageDown` 仍是 ±10 dB,由 `Fader` 自己处理并 `preventDefault`,React 的根监听先于 `window` 监听执行,所以 `defaultPrevented` 可靠);处理时 `preventDefault`。
- 测试:`use-pager.test.ts`(钳位、view 切换重置、页数缩小钳到末页、页数增大保持);集成用例(`mixer.integration.test.tsx`):40 通道快照 + 布局 stub 下按钮翻页与页码文本、首末页禁用、`PageDown` / `PageUp` 翻页、推子聚焦时 `PageDown` 只调推子不翻页、单页时两按钮禁用且页码 `1 / 1`、切换 view 回到第一页、`TYPE PAGES` 开启后每组一页(页数变化)、安全区内没有 `slider` / `button[aria-pressed]` / `RESET`、`resizeTo` 缩窄容器后页数增加且 `pageIndex` 钳位。视口过矮的页内滚动是纯 CSS,jsdom 无法断言,列入移交。

### 4. 滚轮:归属模块与两个 reducer(纯函数)

全部放在 `apps/web/src/lib/`(`components/Fader` 与 `features/mixer` 都要用,`components` 不得反向依赖 `features`)。

- `wheel-delta.ts`:`normalizeWheelDelta(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>): { x: number; y: number }` — `deltaMode` 0 原样,1(行)乘 `WHEEL_LINE_HEIGHT_PX = 16`,2(页)乘 `WHEEL_PAGE_HEIGHT_PX = 800`;`pagingDelta(event): number` — Shift 按下时浏览器会把竖向滚动换到 `deltaX`,取归一化后 `y` 与 `x` 中非零者(两者都非零取 `y`)。
- `fader-wheel.ts`(推子滚轮 reducer):

  ```ts
  export const FADER_WHEEL_STEP_PX = 50;
  export interface FaderWheelState { accumulated: number; direction: -1 | 0 | 1 }
  export const INITIAL_FADER_WHEEL_STATE: FaderWheelState;
  export function reduceFaderWheel(
    state: FaderWheelState,
    input: { deltaY: number }, // already normalised to px
  ): { state: FaderWheelState; steps: number }; // steps signed: +1 raises the level
  ```

  规则:滚轮向上(`deltaY < 0`)是抬推子;方向与 `state.direction` 相反时先清零累计;累计达到每 `FADER_WHEEL_STEP_PX` 出一步,一次事件可出多步(150px 出 3 步),余数保留;调用方在 `coarse`(Alt)时每步走 `stepLevelDb(value, dir, true)`(10 dB),否则 1 dB,与键盘方向键 / `PageUp` 完全对齐。reducer 不知道当前 dB 值,只出步数。

- `page-wheel.ts`(翻页滚轮 reducer):

  ```ts
  export const PAGE_WHEEL_THRESHOLD_PX = 60;
  export const PAGE_WHEEL_QUIET_MS = 150;
  export const PAGE_WHEEL_COOLDOWN_MS = 300;
  export interface PageWheelState {
    accumulated: number;
    direction: -1 | 0 | 1;
    lastEventAt: number;      // ms
    triggeredAt: number | null; // ms, null when not cooling down
  }
  export function reducePageWheel(
    state: PageWheelState,
    input: { delta: number; now: number }, // delta from pagingDelta()
  ): { state: PageWheelState; page: -1 | 0 | 1 };
  ```

  规则:向下滚(`delta > 0`)是下一页;方向反转清零累计;累计绝对值超过阈值即出一页并进入冷却(记 `triggeredAt`,累计清零);冷却中收到事件:若距上一事件 ≥ `PAGE_WHEEL_QUIET_MS` **且** 距触发 ≥ `PAGE_WHEEL_COOLDOWN_MS` 则冷却结束、该事件按新手势开始累计,否则吞掉(只更新 `lastEventAt`)。目标:鼠标一格(按 Chrome 计,`deltaMode` 0、`deltaY` ±100;Firefox 是 `deltaMode` 1、`deltaY` ±3,经归一化为 48px,不够一页——这是已知的初值取舍,由用户真机调参)与触控板一次惯性滑动(20–40 个 `deltaY` 递减的事件,间隔 8–16 ms)都恰好一页。

- `wheel-gesture.ts`(手势归属,纯函数核心 + 一个薄的有状态包装):

  ```ts
  export const WHEEL_GESTURE_IDLE_MS = 150;
  export type WheelOwner = 'page' | { fader: string }; // fader: channel id
  export interface WheelGestureState { owner: WheelOwner | null; lastEventAt: number }
  export function currentOwner(state, now): WheelOwner | null;   // null when idle past WHEEL_GESTURE_IDLE_MS
  export function claim(state, owner, now): WheelGestureState;    // only valid when currentOwner is null
  export function extend(state, now): WheelGestureState;          // refresh lastEventAt, owner unchanged
  export function sameOwner(a: WheelOwner | null, b: WheelOwner | null): boolean;

  export interface WheelGestureTracker {
    begin(owner: WheelOwner, onEnd: () => void): WheelOwner; // returns the effective owner (existing or newly claimed)
    touch(): void;                                            // extend + reschedule the end timer
    owner(): WheelOwner | null;
    reset(): void;                                            // tests only
  }
  export function createWheelGestureTracker(clock: {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  }): WheelGestureTracker;
  export const wheelGestureTracker: WheelGestureTracker; // module singleton on performance.now / window timers
  ```

  语义:一次手势从首个事件起、到静默 `WHEEL_GESTURE_IDLE_MS` 止,期间所有滚轮事件都归首个事件所在表面所有;`begin` 在有未过期持有者时直接返回该持有者(不换人),否则登记新持有者与它的 `onEnd`;每次 `touch` 顺延结束计时;静默后调用持有者的 `onEnd` 一次并清空。推子的 `onEnd` 就是 commit;`page` 的 `onEnd` 为空操作。

- 测试:`wheel-delta.test.ts`(三种 `deltaMode`、Shift 下的 `x` / `y` 取舍);`fader-wheel.test.ts`(鼠标一格 100px 出 2 步、触控板 12px × 5 累计到 60 出 1 步余 10、方向反转清零、Alt 走粗步、大 delta 一次多步);`page-wheel.test.ts`(鼠标一格 100px 恰好一页且紧随的第二格在冷却内被吞、触控板惯性序列 30 个递减事件只出一页、冷却结束需同时满足静默与最短间隔、方向反转清零、静默后再滚再出一页);`wheel-gesture.test.ts`(`begin` 不换人、`touch` 续期、静默后 `onEnd` 恰好一次、过期后可被新持有者 `begin`、注入时钟推进)。

### 5. 滚轮接入:推子轨道与分页视口

- **推子**(`Fader.tsx`):新增必填 prop `wheelId: string`(`ChannelStrip` 传 `channel.id`;`Fader.test.tsx` 夹具补一个固定值),轨道 `div.fader__track` 加 `data-wheel="level"`。`useEffect` 在 `trackRef.current` 上 `addEventListener('wheel', handler, { passive: false })`,卸载时移除。handler 逻辑(按顺序):
  1. `owner = wheelGestureTracker.owner()`。有持有者且不是本推子(`page` 或别的 channel id)→ `tracker.touch()`,`preventDefault()`,返回:惯性尾巴不动本推子,也不让翻页。
  2. 没有持有者且 `event.shiftKey` → 不认领、不 `preventDefault`,返回(让事件冒泡到分页视口去翻页;Shift 只在起始事件判定)。
  3. 没有持有者 → `tracker.begin({ fader: wheelId }, onGestureEnd)`;之后与「持有者是本推子」合流。
  4. 持有者是本推子:`preventDefault()`,`tracker.touch()`;若 `disabled` 或正在指针拖动 → 忽略(不出步,归属已续期);否则 `reduceFaderWheel` 出步:首次出步(本手势内 `wheelActiveRef` 由 false 变 true)先 `onInteractionStart()`,每一步按 `stepLevelDb(latest, dir, coarse)` 算新值并 `onValueChange(next)`(沿用 `ChannelStrip` 的 50 ms 节流发送),`latestValueRef` 跟进。
  - `onGestureEnd`(静默回调):若本手势内出过步 → `onCommit(latestValueRef.current)`,清 `wheelActiveRef` 与 reducer 状态;一次手势只 commit 一次。
  - 手势中被锁定或断线(`disabled` 由 false 变 true,`useEffect` 监听):若 `wheelActiveRef` 为 true → 立即 `onCommit(latest)` 并清 `wheelActiveRef`;归属不动,后续事件走第 4 步的「忽略」分支续期到静默。
  - 指针拖动开始时若滚轮手势正在调节同一推子,先按上一条 commit 一次,再进入拖动。
  - 步数的 dB 起点用 `latestValueRef.current`(手势内连续步进不等远端回包),手势开始时把它设为当前 `value`。
- **分页视口**(`StripPages` 或 `MixerPage` 持有 `.mixer-deck` 的 ref,监听挂在它上面,覆盖分页视口与安全区):同样原生 `addEventListener('wheel', handler, { passive: false })`。handler 逻辑:
  1. `surface = target.closest('[data-wheel="level"]') !== null ? 'level' : 'page'`。
  2. `owner = tracker.owner()`。有持有者且不是 `page` → `tracker.touch()`,`preventDefault()`,返回(推子手势移出轨道后的事件被吞掉,不翻页)。
  3. 没有持有者:`surface === 'level'` 且非 Shift → 返回(推子自己处理或忽略,视口永远不接管轨道上的非 Shift 滚轮);否则 `tracker.begin('page', noop)`。
  4. 持有者是 `page`(含刚认领):若 `.mixer-bays` 当前可纵向滚动(`scrollHeight > clientHeight`,即视口过矮的降级态)且 `surface === 'page'` 且非 Shift → `tracker.touch()` 后返回且**不** `preventDefault`,让浏览器滚页;否则 `preventDefault()`,`tracker.touch()`,`reducePageWheel({ delta: pagingDelta(event), now })`,`page` 非零时 `next()` / `previous()`。
  - 两个监听器只通过 `wheelGestureTracker` 相互感知;`Fader` 不知道分页,`StripPages` 不知道推子内部。
- **归属边界情形逐条落成测试**(`apps/web/tests/mixer-wheel.integration.test.tsx`,新文件;用 `vi.useFakeTimers({ toFake: [...默认, 'performance'] })` 推进时钟,`fireEvent.wheel` 派发):
  1. 轨道上滚三格 → 推子 `aria-valuenow` 走 3 步、不翻页、`setLevel` 只在节流点发;静默 150 ms 后 `setLevel` 最终值恰好一次(commit)。
  2. 轨道上开始、移出轨道(在 `.mixer-page` 空白处派发)继续滚 → 推子不再动、页也不翻;静默前移回轨道再滚 → 同一推子继续动、中间没有 commit;静默后 commit 一次。
  3. 空白处开始翻页、手势中把事件派到某推子轨道 → 推子不动、页码按翻页 reducer 变化(或被冷却吞掉);**翻页后新页的推子轨道恰好在指针下方**:翻到第二页后紧接着向第二页某推子轨道派发惯性尾巴(递减序列)→ 该推子 `aria-valuenow` 不变。
  4. 推子 A 轨道上开始、事件派到推子 B 轨道 → B 始终不动;派回 A → A 继续动;静默后只有 A 收到一次 commit。
  5. Shift + 轨道上滚(起始事件) → 翻页、推子不动;非 Shift 在轨道上开始后中途按住 Shift → 仍调推子;Shift 开始的翻页手势中途松开 Shift → 仍翻页。
  6. 轨道上滚动中把 CONTROL LOCK 切到 `FADERS`(或 `socket.disconnect()`)→ 立即 commit 当前值;之后同手势的事件既不调推子也不翻页;静默后没有第二次 commit。
  7. 推子被锁定 / 断线时在轨道上开始滚 → 不翻页、推子不动、没有 `setLevel`。
  8. 其它表面(名称头、ON、电平表、读数、分区头、安全区)各派一次超过阈值的滚轮 → 都翻页。
  9. 视口过矮(布局 stub 让 `.mixer-bays` 的 `scrollHeight > clientHeight`)时空白处滚轮不翻页、不 `preventDefault`;轨道上滚轮仍调推子。
- `Fader.test.tsx` 新增:滚轮出步与 Alt 粗步、`disabled` 下忽略但 `preventDefault`、`wheelId` 必填。

### 6. 电平表实测与(必要时的)transform 改绘

- **合成电平服务**(不进仓库,放会话临时目录):一个 Node 脚本用 `socket.io`(MIT,安装到临时目录)在 `127.0.0.1:3000` 起 socket.io 服务,`connect` 后发 `mixer:snapshot`(40 个通道:24 个 `channel`、2 个 `main`、4 个 `sub`、6 个 `aux`、2 个 `mixm`、2 个 `mtx`,名称各异,`connection: 'connected'`)与 `system:status`,随后每 50 ms 发一帧 `meters:frame`(40 个 `[id, meterDb]`,值在 −60 到 0 之间按正弦加噪声变化,并让约 10% 的帧有若干通道到 0 dB 以触发 clipping 分支),`control:*` 一律回 `{ ok: true }`。事件名与 payload 形状以 `packages/shared` 的 schema 为准(`SOCKET_EVENTS`、`mixerSnapshotSchema`、`metersFrameSchema`),脚本里直接 `import` 已构建的 `@flwc/shared`。`pnpm --filter @flwc/web dev` 的代理会把页面的 `/socket.io` 送到它。**若四个包都装得上**,也可以改用 Mock Ember+ Provider + `apps/server`(6.2.1 报告第 2 节的做法),但 40 通道的树需要自行扩充 dump,合成服务更直接;两种任选,报告写明用的哪种。
- **测量**(Playwright 驱动预装 Chromium,`playwright-core` 只装在临时目录):视口 1920×1080(约 12 条一页,含前后页约 36 个 `Meter` 挂载)与 3840×1080(全部 40 条在两页内)各测一轮;每轮先停在第 1 页 10 s,再每 2 s 翻一页翻 5 次。指标用页内脚本采:`requestAnimationFrame` 时间戳序列算帧间隔的 p50 / p95 / 最大值与 >34 ms 的帧占比;`PerformanceObserver({ entryTypes: ['longtask'] })` 计 ≥50 ms 长任务次数。**预算**:静止页 p95 帧间隔 ≤ 20 ms、>34 ms 帧占比 ≤ 1%、长任务 0;翻页期间允许每次翻页 ≤ 2 帧超过 34 ms。原始数字进报告。
- **超出预算时**改为 transform 绘制:`.meter__fill` 改为 `transform: scaleY(var(--meter-ratio)); transform-origin: bottom`(`will-change: transform`),`transition: transform 45ms linear`;`.meter__peak` 改为 `transform: translateY(...)`(表体高度按百分比,用 `calc((1 - ratio) * 100%)` 配合 `top: 0; height: 2px` 的定位实现,或把峰值线放进一个 `height: 100%` 的容器里 `translateY`)。`Meter.tsx` 只改写入的自定义属性(`--meter-ratio`),`clamp` / 峰值保持 / clipping 逻辑不变,`Meter.test.tsx` 的断言改读新属性,意图不变。改绘后**重测一遍**,两组数字都进报告。未超出预算则**不改**,报告写明。
- 冒烟顺带确认(截图进临时目录,报告只写结论):1920×1080 下条带高度约为原来的两倍、推子轨道随之拉长、页头一行、翻页动效、安全区按钮与页码、鼠标滚轮一格一页、触控板(Playwright 用 `mouse.wheel` 连发递减序列模拟)一次惯性一页、视口 1280×600 时出现纵向滚动而布局不塌。

### 7. 文档

- `docs/architecture.md`:「通道分组」末尾关于混音页渲染与 `TYPE ROWS` 的句子改为分页描述;「前端结构」新增一段「混音页分页」(切页规则、常量与 CSS 变量的单一来源、100dvh 与降级滚动、翻页入口、安全区、只挂载相邻页)与一段「滚轮」(两个 reducer、归属模块、边界情形要点、`data-wheel="level"` 约定、原生非 passive 监听);「推子拖动」一条补一句滚轮路径的 commit 时机。只描述当前状态。
- 不改 `docs/development-plan.md`。

## 测试要求

- 单元测试与被测代码同目录,集成测试放 `apps/web/tests/`;滚轮归属的九种情形集中在新文件 `mixer-wheel.integration.test.tsx`,分页相关进 `mixer.integration.test.tsx`(或新建 `mixer-pages.integration.test.tsx`,不要再把 `views.integration.test.tsx` 撑大)。
- 第 1–6 节的测试项全部落地;既有测试只允许因布局改动改写定位方式与夹具,断言意图不得删除。
- 覆盖率:`apps/web` ≥ 80%(维持既有门槛);`packages/shared`、`apps/server` 本批次不改。
- 时钟相关测试一律用注入时钟或 `vi.useFakeTimers`,不用真实等待。

## 明确不做的事

- 不做 6.4 的任何内容:滑动翻页手势(本批次只留 `data-swipe-surface` 的空轨道)、`overscroll-behavior` / `touch-action: manipulation` / `user-select` 全局样式、`:hover` 包 `@media (hover: hover)`、`body` 与配置页的 `100vh → 100dvh`、多指 `pointerId` 过滤、44px 命中区、Wake Lock / Fullscreen。
- 不做 6.5:重连集成用例、soak 脚本。
- 不用 `scroll-snap`;不引入动画库或手势库;不改 `apps/server`、`packages/shared`、`packages/test-utils`;不改配置页(`features/settings/`)与 CONNECTION 面板。
- 不改任何数值初值;不改推子既有的五条交互;不给安全区加任何影响声音的控件。
- 不新增依赖;不改 CI;不改 `docs/development-plan.md`。

## 验收自查

完成后逐条核对,在云端实际执行并记录结果:

1. 切页:每页数量随宽度变化、组跨页带 `continued` 表头、`TYPE PAGES` 每组一页、空 view、每页至少一条 — 以单测为证。
2. 骨架:混音页 `100dvh`、页头单行、条带撑满、既有控件与可访问名齐全 — 以集成测试 + 冒烟截图为证;观感 **移交用户**。
3. 翻页:按钮、页码、首末页禁用、`PageUp` / `PageDown`、推子聚焦时不翻页、切换 view 回第一页、页数变化钳位、安全区无声音控件 — 以测试为证;视口过矮的页内滚动 — 冒烟为证。
4. 滚轮 reducer 与归属:鼠标一格、触控板惯性、方向反转、冷却、Shift、锁定、九种归属情形各恰好对应至少一条用例 — 以测试为证;手感 **移交用户**。
5. 电平表:两种视口的帧间隔与长任务数字进报告;超预算则改绘并重测 — 以数字为证;40 通道真机无掉帧 **移交用户**。
6. 全量质量门:串行 lint → typecheck → test → build 全绿,远端 CI 全绿,lockfile 无 diff。

## 执行报告要求

在 `docs/reports/phase-6-3-report.md` 产出执行报告(简体中文),章节与 `docs/reports/phase-6-2-2-report.md` 相同:结果总览、验收标准逐条核对(对上述六条)、实现摘要(每节一段;第 6 节附两种视口的原始数字与是否改绘)、数值初值清单(本批次新增的全部常量,逐个列名称、值、含义、文件)、真机验收操作清单(移交用户,含鼠标滚轮、触控板、键盘、触屏四条路径,以及「40 通道下盯着电平表看 1 分钟」这一条;**安全约束照抄 6.2.2 报告第 5 节**,并加一句:滚轮验收只在 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个推子上做,做完复原)、交付物清单、依赖清单(应为「无新增依赖,lockfile 无 diff」,临时目录里装的 `socket.io` / `playwright-core` 单列并注明未进仓库)、关键决策与偏离、被改写的既有用例清单、遗留问题与移交事项、提交记录。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤、测不出来的指标都要写明,不许美化。

## 完成定义

- 六项任务全部落地,测试要求全部满足。
- 云端串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,分支推送后远端 CI 全绿,`pnpm-lock.yaml` 无改动。
- 合成电平服务(或 Mock Provider)+ 浏览器冒烟通过,电平表两组实测数字在报告里。
- 全部变更已按 Conventional Commits 提交。
- `docs/reports/phase-6-3-report.md` 已产出,真机验收清单可直接交用户执行。
