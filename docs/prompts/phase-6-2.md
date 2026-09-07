# Phase 6.2 执行提示词 — 配置页 UX

> 用法:将本文档全文作为执行会话的任务提示词。执行会话运行在 Cursor 云端环境(配置见 `.cursor/environment.json`),无法访问真实 Fairlight Live。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,真机验收由用户在本地完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(含云端 dev server 的 IPv6 localhost 注意事项、新增依赖的许可要求)
2. `docs/development-plan.md` — Phase 6 总述与 Phase 6.2 交付物、验收标准(本阶段的任务来源),以及「云端 Agent 开发边界」一节;同时浏览 6.1、6.3–6.5,了解本阶段不该越界的内容(尤其 6.4 的触屏审计会接手 touch 传感器的调参)
3. `docs/architecture.md` — 「View 与失配处理」「通道分组」「前端结构」(路由、动效基线、CONNECTION 面板的模态实现)
4. `docs/conventions.md` — 目录结构、命名、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/reports/phase-6-1-report.md` — 6.1 执行报告(第 3 节的 `useModalDialog` 行为、第 6 节的云端安装说明、第 8 节留给 6.2 的事项)
6. `docs/reports/phase-5-report.md` — 配置页工作台与 `viewStore` 的由来

## 代码现状(已确认,直接复用)

- **配置页** `apps/web/src/features/settings/SettingsPage.tsx`(约 720 行):草稿只存本地 state——`selectedId` 选中 view,`draft` 是正在编辑的副本,`activeDraft = draft?.id === selected?.id ? draft : selected`;所有编辑都经 `editDraft(update)` 走 `view-order.ts` 的纯函数;`handleSave` 成功后 `setDraft(copyView(updated))`。**`selectView(view)` 无条件用 `copyView(view)` 覆盖草稿且无任何提示**,点击左侧列表里已选中的那一项也会把草稿重置为已保存版本(现有集成测试 `views.integration.test.tsx` 的 `ungroups in one click, discards unsaved group edits, ...` 正依赖这一行为,本阶段要改写该测试)。`handleCreate` 成功后调用 `selectView(created)`,也会丢弃当前草稿。`handleDelete` 是按钮内两段式(`DELETE VIEW` → `CONFIRM DELETE`),没有对话框。
- **列表渲染**:`viewBlocks(view)` 把 `channels` 切成块——连续同组引用是一个组块(`<li class="view-group" data-view-group-id>`,内含 `<ol class="view-group__members">`),无组引用是单行(`<li class="channel-order-row" data-ordered-channel-id data-ordered-channel-name>`);空分组排在最后并显示 `ASSIGN CHANNELS BELOW`。行内控件:`OrderButtons`(`Move <name> up/down`)、`GROUP` 下拉(`<name> group`)、调色板按钮;组头有 `Group <n> name` 输入框、`OrderButtons`(`Move group <name> up/down`)与 `Ungroup <name>` 按钮。行 key 目前是 `${kind}:${name}:${index}`,**随位置变化**,不能直接用作 FLIP 的稳定标识。
- **既有单行动画**:被移动的行或组块由 `MovedMarker` state 标上 `data-moved="up|down"`,`styles.css` 约第 2186–2230 行的 `order-shift-up/down` 与 `order-flash` 关键帧播一次,`onAnimationEnd` 清除。三个集成测试断言了 `data-moved`(`views.integration.test.tsx` 第 493、512、519、653 行附近),本阶段一并删除或改写。
- **纯函数** `apps/web/src/features/settings/view-order.ts`:`viewBlocks`、`moveChannel(view, index, ±1)`(组内换位或跨过相邻块,空组不可跨)、`moveGroup(view, groupId, ±1)`、`assignGroup(view, index, groupId | undefined)`(加入目标组末尾;脱组时落在原组之后)、`addGroup` / `renameGroup` / `removeGroup`。这些语义**不改**。单测在同目录 `view-order.test.ts`。
- **左侧 AVAILABLE CHANNELS**:`channel-checklist` 里每个通道一个 `<label data-available-channel-id>` + checkbox,`toggleChannel` 通过 `resolveViewChannels` 判断是否已在 view 中,已在则删除引用,否则 `referenceForChannel(channel)` 追加到末尾。`resolvedByChannelId` 给出「已勾选」集合。
- **数据模型**(`packages/shared/src/config.ts`):`ViewChannelRef { kind, name, channelId?, groupId?, color? }`,`View { id, name, channels, groups }`,同组成员在 `channels` 中连续;服务端只校验组 id 唯一与 `groupId` 指向已有组。**本阶段不改 shared 与后端。**
- **路由** `apps/web/src/lib/router.ts`:`Route = 'mixer' | 'views'`,`navigate(route, mode)` 在 `pushState/replaceState` 后手动 `notify()`;`useRoute()` 用 `useSyncExternalStore`,`getSnapshot` 直接读 `window.location.pathname`,`subscribe` 同时监听 `popstate`。`App.tsx` 里配置页的 `onBack={() => navigate('mixer')}`,混音页 `CONFIGURE VIEWS` 调 `navigate('views')`。现有单测 `router.test.ts`、集成测试 `tests/routing.integration.test.tsx`。
- **模态对话框基础** `apps/web/src/features/connection/use-modal-dialog.ts`:`useModalDialog({ onClose })` 返回 `dialogRef` / `onKeyDown` / `reclaimFocus`,负责挂载时聚焦、Tab 环绕、`document` 层监听 Escape、`body.is-modal-open` 锁滚动、卸载时焦点回到触发元素。CONNECTION 面板在 `App` 层渲染一次;本阶段的确认对话框在配置页内渲染,两者不会同时打开。
- **动效基线**:`styles.css` 第 2472 行起的 `@media (prefers-reduced-motion: reduce)` 把 `--motion-fast` / `--motion-medium` 压到 1ms 并对所有元素关闭 animation/transition。jsdom 没有 `window.matchMedia`,FLIP hook 必须容错。
- **测试基建**:`apps/web/tests/` 有 `FakeSocket`、`FakeViewsClient`、`FakeConnectionClient`;`vitest.setup.ts` 每个用例前把路径重置为 `/` 并 mock `window.scrollTo`;覆盖率门槛 80%(行/分支/函数/语句)。jsdom 中所有元素的 `getBoundingClientRect()` 都是 0,dnd-kit 的碰撞检测与 `sortableKeyboardCoordinates` 都依赖 rect,集成测试要为列表行 stub 出按 DOM 顺序递增的 rect(见「测试要求」)。
- **依赖核对结果**(npm registry,2026-09-07):`@dnd-kit/core@6.3.1` MIT、`@dnd-kit/sortable@10.0.0` MIT(peer `@dnd-kit/core ^6.3.0`)、`@dnd-kit/utilities@3.2.2` MIT。安装前请再核对一次 `license` 字段并写入报告。
- **6.1 报告第 8 节**:页头压缩与 `:hover` 媒体查询属 6.3 / 6.4,本阶段不碰;CONNECTION 面板**不做**脏检测,Esc 直接关闭,这是用户在 6.1 review 后的决定。

## 云端执行边界

- 你运行在云端,**无法连接真实 Fairlight Live**。本阶段是纯前端改动,联调用 `pnpm dev` + `packages/test-utils` 的 Mock Ember+ Provider 制造通道清单即可。
- 验收标准中标注「本地」的条目(鼠标与触屏拖放流畅、位移动效无抖动无闪烁)由用户本地执行,你在报告中标注**移交用户**,并给出一份可直接照做的验收操作清单。
- 在独立分支上开发并推送,保持远端 CI(GitHub Actions:lint + typecheck + test + build,`pnpm install --frozen-lockfile`)全绿;不得改动 CI 流水线结构。
- 新增依赖必须通过 `pnpm add` 在 `apps/web` 下安装,`pnpm-lock.yaml` 随之更新并提交。6.1 报告第 6 节记录了云端代理拒绝 `codeload.github.com` 导致 `asn1` tarball 无法下载的问题;若再次遇到,可沿用同样的临时手段完成安装,但**提交的 lockfile 里不得残留任何本地路径改写**,提交前 `git diff pnpm-lock.yaml` 只能包含 dnd-kit 相关条目。
- 云端手动冒烟可用 `pnpm dev`(server 3000 + web 5173):web 端必须用 `http://localhost:5173` 访问(Vite 只监听 IPv6 `::1`,`127.0.0.1:5173` 连不上)。
- 本阶段不改 `packages/shared`,无需重跑 shared build。

## 硬性约束

- 自动化测试(vitest + React Testing Library)一律基于 Mock(FakeSocket / FakeViewsClient / mock fetch),**禁止任何连接真实设备的逻辑与硬编码真机地址**。
- 代码、注释、提交信息、日志与固定 UI 文案用**英文**;仅设备或应用带入的动态文本(通道名、view 名、组名)可保留原文;文档与报告用**简体中文**。
- 允许新增的运行时依赖只有 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`,可选 `@dnd-kit/modifiers`(同为 MIT,只在确需限制拖动轴向时引入)。对话框、徽标、拖动把手全部自绘,复用既有深色 token 与动效基线,不引入其它库,不引入主题切换或浅色样式。
- 数据模型与后端不改:不动 `packages/shared`、`apps/server`,不新增 REST 或 socket 事件。
- `view-order.ts` 既有导出(`viewBlocks`、`moveChannel`、`moveGroup`、`assignGroup`、`addGroup`、`renameGroup`、`removeGroup`)的签名与语义不变,既有单测不得删改(只允许新增)。
- 文档中给出的数值(指针传感器激活距离、touch 传感器按压延迟与容差、FLIP 时长)都是**初值**,由用户真机实测后微调;**你不得自行调整**,只需把用到的值集中成常量并在报告中列出。
- 不使用 `window.confirm` / `alert`;`beforeunload` 是唯一允许交给浏览器的提示。
- 提交遵循 Conventional Commits,按逻辑单元分多次提交(建议:纯函数 → DnD → FLIP → 脏检测与对话框 → 导航守卫 → 文档);不得破坏已有的 lint / typecheck / test / build 全绿与覆盖率门槛(不许为凑覆盖率调低门槛或把源码排除出覆盖率统计)。
- 不改动 `docs/` 下与本阶段无关的文档;`docs/development-plan.md` 的任务描述与验收框不改,只在报告里逐条核对。

## 任务范围

按 `docs/development-plan.md` 的 Phase 6.2 实现配置页的拖放编排、列表位移动效与未保存改动保护。本阶段**不做**混音页分页与页头压缩(6.3)、触屏审计与 touch 传感器调参(6.4)、重连与 soak(6.5),**不给** CONNECTION 面板加脏检测。

### 1. 纯函数(`apps/web/src/features/settings/view-order.ts`)

新增以下导出,全部为纯函数、不修改入参、无效或无变化时返回 `null`(与 `moveChannel` 一致,便于 `editDraft` 原样保留草稿):

```ts
/** Where a dragged channel lands. `position` counts members of the group, or top-level blocks. */
export type DropTarget =
  | { kind: 'group'; groupId: string; position: number }
  | { kind: 'root'; position: number };

/** Moves `view.channels[index]` to `target`, joining or leaving a group as the target implies. */
export function moveChannelTo(view: View, index: number, target: DropTarget): View | null;

/** Inserts a reference that is not yet in the view at `target`; null when an equal reference exists. */
export function insertChannelAt(view: View, reference: ViewChannelRef, target: DropTarget): View | null;

/** Moves a non-empty group block to `position` among the top-level blocks. */
export function moveGroupTo(view: View, groupId: string, position: number): View | null;
```

- `root` 的 `position` 以 `viewBlocks(view)` 中**非空块**的顺序计数(空分组不参与,永远留在底部);`group` 的 `position` 以该组成员顺序计数,`0..members.length`,空分组的 `position` 只能为 `0`。
- `moveChannelTo` 计算目标时先把源引用从数组里拿掉再定位(即 `position` 是「移除源之后」的位置),这样落回原位、同组内前后移动、从单行拖进组、从组拖成单行都只有一种解释;进组时写入 `groupId`,出组时删除该键(不要留 `groupId: undefined`,与 `assignGroup` 一致)。
- `insertChannelAt` 的相等判定:`kind`、`name`、`channelId` 三者全等即视为已存在,返回 `null`;组件层在调用前还会用 `resolvedByChannelId` 拦一次,纯函数只是兜底。
- `moveGroupTo` 对空分组、未知组、越界位置、原位放下返回 `null`。
- 三个函数的结果必须保持「同组成员连续」的不变量;为此在同文件加一个只在测试中使用的辅助断言(或直接在单测里检查 `viewBlocks` 的块数等于 `groups` 中非空组数 + 单行数)。

### 2. 拖放编排(dnd-kit)

- 在 `apps/web/src/features/settings/` 下新增 DnD 相关模块(建议:`dnd-ids.ts` 负责 `channel:<key>` / `group:<id>` / `available:<channelId>` 等 id 编解码与解析,`drop-resolver.ts` 把 dnd-kit 的 `over` 结果解析成 `DropTarget`,组件文件承载 `DndContext`),保持 `SettingsPage.tsx` 不再膨胀——把右侧列表拆成独立组件(如 `ChannelOrderList.tsx`)是允许且推荐的。
- 传感器:`PointerSensor`(`activationConstraint: { distance: 4 }`,初值)、`TouchSensor`(`activationConstraint: { delay: 250, tolerance: 8 }`,初值,6.4 负责调参与和页面滚动的区分)、`KeyboardSensor`(`sortableKeyboardCoordinates`)。三种同时启用。
- 结构:采用 dnd-kit 的多容器模式。根 `SortableContext` 的 items 是顶层块(单行 `channel:<key>` 与组 `group:<id>`);每个非空组内嵌一个 `SortableContext`(成员 `channel:<key>`),组块同时是 `useDroppable` 容器;空分组只作为 `useDroppable` 目标。碰撞检测用 `closestCenter` 或 `pointerWithin` + `closestCenter` 的组合,以 `over` 所在容器判定进组/出组。
- 语义(全部对应到第 1 节的纯函数,`onDragEnd` 时一次性写入草稿,`onDragOver` 只更新视觉,不改草稿):
  - 拖通道行到根列表任意位置 → `moveChannelTo(…, { kind: 'root', position })`,若源在组内即脱组;
  - 拖通道行到某组的成员之间或空组上 → `moveChannelTo(…, { kind: 'group', groupId, position })`;
  - 拖组头 → `moveGroupTo`,整组移动;组头只能落在根列表,不能进入别的组;
  - 从左侧 AVAILABLE CHANNELS 拖一个**未勾选**的通道到右侧任意位置或组 → `insertChannelAt(…, referenceForChannel(channel), target)`;已勾选的通道不可拖(`useDraggable` 的 `disabled`),勾选框行为不变,两种方式并存;
  - 原位放下或 `over` 为空 → 不改草稿。
- 拖动把手:每个通道行与组头各有一个专用把手按钮(`aria-label="Drag <name>"` / `"Drag group <name>"`,`setActivatorNodeRef`),只有把手响应拖动,`GROUP` 下拉、调色板、组名输入框、`UNGROUP` 不受影响;左侧通道的把手同样是 label 内的独立按钮,不与 checkbox 冲突。键盘路径:Tab 到把手,Space/Enter 拾起,方向键移动,Space/Enter 放下,Esc 取消——dnd-kit 默认即如此,保留其 `announcements`/`screenReaderInstructions` 并把文案改为英文且带通道名。
- 拖动中的让位动画沿用 `verticalListSortingStrategy`;被拖行用 `CSS.Transform.toString(transform)` + `transition`,`isDragging` 时加 `is-dragging` 类(半透明、提升 z-index);组块作为投放目标被悬停时加 `is-drop-target` 类。不使用 `DragOverlay`,除非跨容器拖动时视觉明显跳动——如用,须在报告中说明。
- 箭头按钮(`OrderButtons`)与 `GROUP` 下拉保留,行为不变,作为键盘与无障碍的第二条路径。
- `saving` 为真时禁用全部拖动(`DndContext` 不挂传感器或把手 `disabled`)。

### 3. 列表位移动效(FLIP)

- 新增 `apps/web/src/features/settings/use-flip-list.ts`(命名可调):接收列表容器 ref,在每次提交后的 `useLayoutEffect` 里读取所有 `[data-flip-key]` 元素的 rect,与上一次记录比对;位移超过 1px 的元素先设置反向 `transform: translate(dx, dy)`(不带 transition),下一帧清除 transform 并加 `transition: transform var(--motion-medium) ease-out`,结束后移除内联样式。新出现的元素(勾选加入)可只做淡入或不处理,消失的元素(取消勾选)不处理。
- 稳定 key:行的 `data-flip-key` 用 `kind:name:channelId` 加上同名同 id 引用在数组中的出现序号(`#0`、`#1`……)构成,组块用 `group:<id>`;React 的 `key` 同步改为这个稳定值(现有按 index 的 key 一并替换),否则 React 会重建节点、FLIP 无从比对。
- 覆盖场景:箭头移动、`GROUP` 下拉编组/脱组、`UNGROUP` 解散、整组移动、勾选加入/移除、`CLEAR INVALID`、拖放落下——目标行与所有因它位移的行都平滑过渡。拖放落下那一帧由 dnd-kit 负责让位,FLIP 读到的前后 rect 应几乎一致(dnd-kit 的 transform 已计入 rect);若冒烟发现两套补间叠加抖动,在 `onDragEnd` 提交时让 hook 跳过一次测量,并在报告中说明。
- `prefers-reduced-motion: reduce`(用 `window.matchMedia?.(…)`,jsdom 下无 `matchMedia` 视为不减少动效)时 hook 不做任何补间。
- 删除 `MovedMarker` state、`data-moved` 属性、`onAnimationEnd` 处理器与 `styles.css` 中 `order-shift-up/down`、`order-flash` 关键帧及其选择器。

### 4. 未保存改动保护

- 纯函数 `isViewDirty(saved: View, draft: View): boolean` 放在 `apps/web/src/features/settings/view-dirty.ts`:结构比较 `name`、`channels`(顺序、`kind`、`name`、`channelId`、`groupId`、`color`,缺键与 `undefined` 视为相等)、`groups`(顺序、`id`、`name`)。`SettingsPage` 用 `useMemo` 求 `dirty = draft !== null && selected !== null && draft.id === selected.id && isViewDirty(selected, draft)`。
- 三处脏态提示(固定文案英文):
  - `SAVE VIEW` 按钮仅在 `dirty` 时带 `is-dirty` 类高亮(琥珀描边或同类既有强调色),干净时保持现有样式且仍可点击;
  - 按钮旁 `UNSAVED` 徽标(`<span class="unsaved-badge">UNSAVED</span>`),干净时不渲染;
  - 左侧 view 列表中当前项显示圆点(`data-dirty="true"` + 视觉圆点 + 视觉隐藏文本 `Unsaved changes` 供辅助技术读出)。
- 会丢失改动的操作在 `dirty` 时先弹应用内确认对话框,而不是直接执行;四条路径统一走一个 `pendingAction` state:
  1. 返回混音页(页头 `RETURN TO MIXER`,以及浏览器后退,见第 5 节);
  2. 切换到另一个 view(左侧列表点击**其它**项;点击**已选中**项改为无操作,不再重置草稿);
  3. 删除当前 view(两段式保留:干净时 `DELETE VIEW` → `CONFIRM DELETE` 直接删;脏时第二次点击改为弹对话框,`DISCARD` 才执行删除);
  4. `ADD` 新建 view(创建成功后会切换选中,视同切换:脏时先弹对话框,`DISCARD` 后再发创建请求并选中)。
- 对话框 `apps/web/src/features/settings/DiscardChangesDialog.tsx`:复用 `useModalDialog`(可把 `use-modal-dialog.ts` 移到 `apps/web/src/components/` 供两处共用,行为不变,更新 `ConnectionPanel` 的 import);`role="dialog"`、`aria-modal`、`aria-labelledby` 指向标题 `UNSAVED CHANGES`,正文按路径区分(如 `Return to the mixer without saving changes to "<view name>"?`),两个按钮 `DISCARD`(执行待定操作并丢弃草稿)与 `KEEP EDITING`(关闭,初始焦点落在它上面);Esc 与背景点击等同 `KEEP EDITING`。样式复用 CONNECTION 面板的 backdrop 与面板 token。
- `beforeunload`:`dirty` 为真时在 `window` 上注册 `beforeunload` 监听,`event.preventDefault()` 并设置 `event.returnValue`;干净或卸载时移除。
- 保存成功、`DISCARD`、切换到干净状态后徽标与圆点立即消失;保存失败(`viewStore.error`)保持脏态。

### 5. 导航守卫(`apps/web/src/lib/router.ts`)

- 新增 `setNavigationGuard(guard: ((next: Route) => boolean) | null): void`:同一时间只有一个守卫,配置页挂载时注册、卸载时置 `null`。守卫返回 `true` 放行,返回 `false` 拒绝;拒绝时守卫自身负责打开对话框并记录目标路由,路由模块不做任何 UI。
- `navigate(route)` 在改写 history 前先询问守卫,被拒绝则不改 history、不通知。
- 路由模块改为缓存「当前已放行的路由」(模块级变量,首次从 `location.pathname` 初始化),`getSnapshot` 返回该缓存而不是直接读 `location`;`navigate` 的「目标等于当前」判断也改用缓存。
- `popstate`:计算 `routeFromPath(location.pathname)`,与缓存相同则仅通知;不同则询问守卫——放行时更新缓存并通知,拒绝时调用 `window.history.forward()` 回到 `/views`,缓存保持不变,因此 `useRoute()` 始终不会闪到混音页;`forward()` 触发的第二次 `popstate` 因目标等于缓存而自然收敛。
- 对话框 `DISCARD` 后由配置页先清除草稿(或先 `setNavigationGuard(null)`),再调用 `navigate(pendingRoute)`;守卫读取 `dirty` 要用 ref 保存最新值,避免闭包里的过期 state。
- 混音页不注册守卫,`CONFIGURE VIEWS` 行为不变。

### 6. 文档

- `docs/architecture.md`:「通道分组」补上拖放语义与 `moveChannelTo` / `insertChannelAt` / `moveGroupTo`;「前端结构」补上 FLIP hook、脏检测与三处提示、确认对话框、路由守卫与 `beforeunload`(以及 `use-modal-dialog.ts` 若已移动的新位置)。只描述当前状态,不写变更历史。
- 不改 `docs/development-plan.md`。

## 测试要求

- 单元测试与被测代码同目录,集成测试放 `apps/web/tests/`(建议新增 `settings-dnd.integration.test.tsx` 与 `settings-dirty.integration.test.tsx`,不要把 `views.integration.test.tsx` 撑得更长)。
- 纯函数全覆盖(`view-order.test.ts` 新增 describe,`view-dirty.test.ts` 新建):
  - `moveChannelTo`:单行↔单行重排、单行进组(首、中、尾)、组内前后移动、组尾拖到组外、跨组、进空组、原位放下返回 `null`、越界与未知组返回 `null`、脱组后不残留 `groupId` 键、连续性不变量;
  - `insertChannelAt`:插入根列表首/中/尾、插入组、插入空组、已存在(三字段全等)返回 `null`、同名不同 `channelId` 允许插入;
  - `moveGroupTo`:首/尾/中、原位、空组、未知组;
  - `isViewDirty`:相同、改名、顺序变化、`groupId` 变化、`color` 变化、缺键与 `undefined` 视为相等、组改名、组增删。
- FLIP hook 单测(`use-flip-list.test.ts`):stub `getBoundingClientRect` 让元素在重排前后返回不同 rect,断言反向 transform 被设置并在下一帧(用 `vi.useFakeTimers` 或 mock `requestAnimationFrame`)清除;位移小于 1px 不动;reduced-motion 时不设 transform;`matchMedia` 缺失时正常工作。
- 路由单测(`router.test.ts` 新增):守卫放行、守卫拒绝 `navigate` 时 history 不变且不通知、`popstate` 被拒时调用 `history.forward()`(`vi.spyOn(window.history, 'forward')`)且 `useRoute()` 保持 `views`、守卫置 `null` 后恢复默认行为、放行的 `popstate` 更新缓存。
- 集成测试(键盘传感器,`fireEvent.keyDown` 把手:`Space` 拾起、`ArrowDown/ArrowUp` 移动、`Space` 放下、`Escape` 取消):
  - jsdom 中 rect 全为 0,在测试里为 `[data-flip-key]`(及可用通道行)stub `getBoundingClientRect`,按 DOM 顺序返回递增的 `top`(如每行 40px),使 `closestCenter` 与 `sortableKeyboardCoordinates` 能找到相邻目标;把这段 stub 写成 `apps/web/tests/` 下的共享 helper;
  - 用例:通道行重排(断言 `data-ordered-channel-name` 顺序);单行拖进组(`GROUP` 下拉值随之变化);组内成员拖出到根列表;组头整组移动;从 AVAILABLE CHANNELS 拖入根列表与拖入组;已勾选通道的把手为 `disabled`;Esc 取消后草稿不变;每次落下后 `SAVE VIEW` 提交的 `channels` 形状正确(`FakeViewsClient.calls`);箭头按钮与 `GROUP` 下拉在 DnD 引入后行为不变。
  - 脏态:编辑后 `SAVE VIEW` 带 `is-dirty`、`UNSAVED` 出现、列表项 `data-dirty="true"`;保存成功后三者消失;保存失败保持。
  - 丢失路径:`RETURN TO MIXER`、点击另一个 view、`DELETE VIEW` → 第二次点击、`ADD`,四条都弹出对话框;`KEEP EDITING`(按钮、Esc、背景)后草稿保留且未导航/未切换/未删除/未创建;`DISCARD` 后分别完成导航、切换(草稿为目标 view 的副本)、删除、创建并选中;浏览器后退(`pushState('/')` + `popstate`)在脏时弹对话框、`history.forward` 被调用、页面仍是 `VIEW CONFIGURATION`;干净时上述操作直接执行,不弹对话框;点击已选中 view 不重置草稿。
  - `beforeunload`:脏时 `window.dispatchEvent(new Event('beforeunload', { cancelable: true }))` 的 `defaultPrevented` 为真,干净时为假。
- 改写既有测试:删除对 `data-moved` 的断言;把「重新点击已选中 view 以丢弃草稿」改为「点击其它 view / 返回 → `DISCARD`」或改用对应的新路径;其余既有断言保持通过。
- 覆盖率:`apps/web` 行/分支/函数/语句 ≥ 80%,`apps/server`、`packages/shared` 维持既有门槛;dnd-kit 指针路径在 jsdom 不可测,靠键盘路径覆盖共享的 `onDragEnd` / 解析逻辑。

## 明确不做的事

- 不做混音页分页、页头压缩、安全区、滚轮方案(6.3);不做触屏审计与 touch 传感器调参、`:hover` 媒体查询、`100dvh`(6.4);不做重连集成用例与 soak 脚本(6.5)。
- 不给 CONNECTION 面板加脏检测或确认对话框;不改 `useModalDialog` 的行为(允许移动文件位置)。
- 不改 `packages/shared`、`apps/server`、REST 与 socket 契约;不改 View 数据模型,不为通道引用增加稳定 id 字段。
- 不改 `moveChannel` / `moveGroup` / `assignGroup` 的既有语义,不删除箭头按钮与 `GROUP` 下拉。
- 不引入 dnd-kit 之外的运行时依赖,不引入路由库或对话框库;不使用 `window.confirm`。
- 不自行调整文档给出的任何数值初值。
- 不连接、不模拟连接真实 Fairlight;不改 CI 流水线结构(`.github/workflows/ci.yml`)。

## 验收自查

完成后逐条核对 `docs/development-plan.md` Phase 6.2 验收标准,在云端实际执行并记录结果:

1. 单测覆盖:`moveChannelTo` / `insertChannelAt`(以及 `moveGroupTo`)的边界、`isViewDirty`、导航守卫的允许/拒绝/后退回退 — 以测试文件与通过记录为证。
2. 集成测试(键盘传感器):拖放重排、编组与脱组、整组移动、从可用通道拖入;脏态三处提示;三条丢失路径(加 `ADD` 共四条)都弹出确认并且 DISCARD / KEEP EDITING 行为正确 — 以测试文件与通过记录为证。
3. 本地:鼠标与触屏拖放流畅,位移动效无抖动、无闪烁 — **移交用户**,附可照做的验收操作清单。
4. 覆盖率达标 — 附 `apps/web`、`apps/server`、`packages/shared` 覆盖率数字。
5. 全量质量门:串行 lint → typecheck → test(覆盖率门槛)→ build 全绿,远端 CI 全绿;另附一次 `pnpm dev` + Mock Provider 的浏览器冒烟结果(鼠标拖通道行重排 → 拖进组 → 拖出组 → 拖组头 → 从左侧拖入 → 箭头移动观察 FLIP → 编辑后 `UNSAVED` 出现 → 点 `MIXER` 弹对话框 → `KEEP EDITING` → 浏览器后退弹对话框并停留在 `/views` → `DISCARD` 回到混音页;记录是否出现两套动效叠加)。

## 执行报告要求

执行完成后,在 `docs/reports/phase-6-2-report.md` 产出执行报告(简体中文),包含以下章节:

1. **结果总览** — 一段话说明完成状态(全部完成 / 部分完成及原因)。
2. **验收标准逐条核对** — 对上述五条:通过/未通过/移交用户,附实际执行的命令与关键输出摘要。
3. **实现摘要** — 三个纯函数的定位规则;dnd-kit 的容器结构、id 编码、碰撞检测选择、传感器与激活参数;FLIP hook 的测量与 key 策略、与 dnd-kit 落下动画的配合;脏检测与四条丢失路径的 `pendingAction` 流转;路由守卫与缓存路由的实现;`use-modal-dialog.ts` 是否移动。
4. **数值初值清单** — 指针激活距离、touch 延迟与容差、FLIP 时长、位移阈值等全部常量的名称、值与所在文件,供用户微调。
5. **真机验收操作清单(移交用户)** — 启动命令、页面操作步骤与预期结果,覆盖鼠标、触屏(平板)与键盘三条路径。**必须写明安全约束:配置页只改 view 配置(`data/config.json` 的 `views`),拖放与保存不会改动 Fairlight 任何参数;验收过程中不要操作混音页推子;如确需操作,只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道并测后复原;不得切 ON/mute、不得动其它通道、不得删改任何通道。**
6. **交付物清单** — 新增/修改的主要源码、样式与测试文件路径及一句话用途。
7. **依赖清单与许可确认** — 每个新增包的名称、版本、`license` 字段、引入理由;lockfile diff 只含这些条目的确认。
8. **关键决策与偏离** — 与计划/规范/架构文档不一致的地方及理由(含是否使用 `DragOverlay`、FLIP 是否在拖放落下时跳过、覆盖率排除项);没有则明确写"无偏离"。
9. **遗留问题与移交事项** — 留给 6.3–6.5 的事项(至少:touch 传感器调参属 6.4)、建议回写文档的条目、需要用户完成的步骤。
10. **提交记录** — 本阶段新增提交的 `git log --oneline` 输出与分支名。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤都要写明,不许美化。

## 完成定义

- 上述任务范围全部落地,测试要求全部满足。
- 云端串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,分支推送后远端 CI 全绿。
- `pnpm dev` + Mock Provider 浏览器冒烟通过(拖放五种语义、FLIP、脏态提示、四条丢失路径、浏览器后退回退)。
- 全部变更已按 Conventional Commits 提交,lockfile 干净。
- `docs/reports/phase-6-2-report.md` 已产出,真机验收清单可直接交用户执行。
