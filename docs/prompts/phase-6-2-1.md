# Phase 6.2.1 执行提示词 — 配置页 UX 补充

> 用法:将本文档全文作为执行会话的任务提示词。执行会话运行在 Cursor 云端环境(配置见 `.cursor/environment.json`),无法访问真实 Fairlight Live。本批次是 Phase 6.2 合并后由用户真机验收得出的补充与修正,任务来源是 `docs/development-plan.md` 的 6.2.1 一节,细节以本文档为准。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,真机验收由用户在本地完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(含云端 dev server 的 IPv6 localhost 注意事项、新增依赖的许可要求)
2. `docs/development-plan.md` — Phase 6 总述、6.2 一节与 6.2.1 一节(本批次的交付物与验收标准),以及「云端 Agent 开发边界」;同时浏览 6.3–6.5,了解不该越界的内容
3. `docs/architecture.md` — 「View 与失配处理」「通道分组」「前端结构」(拖放语义、预览视图、FLIP、脏检测的当前描述)
4. `docs/conventions.md` — 目录结构、命名、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/reports/phase-6-2-report.md` — 6.2 执行报告,重点第 3 节(实现摘要)、第 4 节(数值初值)、第 8 节(偏离与传感器共存问题)、第 11 节(四轮真机反馈后的演变)
6. `docs/prompts/phase-6-2.md` — 6.2 的提示词,本批次沿用其全部硬性约束

## 代码现状(已确认,直接复用)

- **配置页拆分后的文件**(全部在 `apps/web/src/features/settings/`):`SettingsPage.tsx`(状态、草稿、保存、脏检测、`pendingAction`)、`ViewDndContext.tsx`(`DndContext`、传感器、预览同步、落点结算、`DragOverlay`)、`ChannelOrderList.tsx`(根 `SortableContext`、根级落槽、占位行)、`SortableChannelRow.tsx`、`SortableGroupBlock.tsx`(含 `EmptyGroupBlock` 与 `GroupHeader`)、`AvailableChannelList.tsx`、`DragHandle.tsx`、`DragOverlayContent.tsx`、`PlaceholderRow.tsx`、`RootSlot.tsx`、`ListAutoScroller.tsx`、`DroppableRemeasure.tsx`、`DiscardChangesDialog.tsx`;纯函数与配置:`view-order.ts`、`view-dirty.ts`、`row-keys.ts`、`dnd-ids.ts`、`dnd-collision.ts`、`drop-resolver.ts`、`drag-preview.ts`、`list-auto-scroll.ts`、`dnd-config.ts`、`channel-labels.ts`;hook:`use-flip-list.ts`、`use-drag-preview.ts`。
- **传感器**(`ViewDndContext.tsx` 约第 140 行):`PointerSensor({ distance: POINTER_ACTIVATION_DISTANCE_PX })`、`TouchSensor({ delay: TOUCH_ACTIVATION_DELAY_MS, tolerance: TOUCH_ACTIVATION_TOLERANCE_PX })`、`KeyboardSensor` 三者同时启用,常量在 `dnd-config.ts`(4 / 250 / 8)。**已知问题**:触屏上同一次按压先触发 `pointerdown` 再触发 `touchstart`,两个传感器同时等待,手指一动过 4px 指针传感器就接管,250ms 长按几乎永远轮不到。`DragState.pointer` 由 `eventPoint(activatorEvent)`(`drag-preview.ts`,基于 `@dnd-kit/utilities` 的 `getEventCoordinates`,支持 MouseEvent / TouchEvent / PointerEvent)是否返回坐标决定;窗口级 `pointermove` / `touchmove` 监听只在 `pointer` 为真时挂载。测试 helper `apps/web/tests/pointer-drag.ts` 用 `pointerDown` / `pointerMove` / `pointerUp` 驱动指针传感器,`settings-dnd.integration.test.tsx` 的「pointer sensor」describe 依赖它。
- **FLIP**(`use-flip-list.ts`):`useFlipList(containerRef, dependency)` 只在 `dependency` 变化时的 `useLayoutEffect` 里测量与补间;`SettingsPage.tsx` 以 `activeDraft` 作依赖。拖动期间 `ChannelOrderList` 按预览视图(`preview?.view ?? props.view`)渲染,`activeDraft` 不变,**因此占位行移动时其它行是瞬间换位,没有动画**。过渡用 `FLIP_TRANSITION = 'transform var(--motion-medium) ease-out'`,`--motion-medium` 在 `styles.css` `:root` 为 200ms,reduced-motion 下为 1ms;`FLIP_MIN_SHIFT_PX = 1`、`FLIP_CLEANUP_FALLBACK_MS = 600`。`onDragEnd` 提交草稿前调用 `flip.capture()` 记基线;`skipNext()` 已实现但未使用。`DragOverlay` 的落下动画用 dnd-kit 的 `defaultDropAnimation`(250ms),由 `dropAnimationFor(source, removing)` 决定是否播放。所有 `useSortable` 传 `animateLayoutChanges: () => false` 与 `transition: null`。切换 view 时 FLIP 会把两个 view 里 key 相同的行从旧位置补间到新位置(观感问题,顺带修正)。
- **组块**(`SortableGroupBlock.tsx`):`GroupHeader` 含把手、`G<nn>` 序号、组名输入(`Group <n> name`)、`<nn> CH` 计数、`OrderButtons`、`UNGROUP`;成员 `<ol class="view-group__members">` 内嵌 `SortableContext`;组块同时是 `useSortable(group:<id>)` 与 `useDroppable(groupzone:<id>)`,`data` 为 `{ kind: 'groupzone', label, groupId, empty }`。`dnd-collision.ts` 的 `keyboardStops` 只把 `empty` 的 `groupzone` 当键盘停靠点。组块没有折叠能力。
- **颜色**:调色板键 `CHANNEL_PALETTE_KEYS`(`packages/shared/src/config.ts`,6 色)与 `channelPaletteKeySchema`;`ViewChannelRef.color?: ChannelPaletteKey`,`ViewGroup { id, name }` 没有颜色字段。解析函数在 `apps/web/src/features/mixer/channel-colors.ts`:`channelTypeColor(kind)`、`channelColor(kind, color?)`。**组的颜色目前由首个在场成员的解析色决定**:配置页 `SortableGroupBlock.tsx` 的 `groupAccent(entries)`、混音页 `MixerPage.tsx` 的 `segmentAccent(segment)`、拖动克隆 `ViewDndContext.tsx` 的 overlay 分支,三处各写一遍。行的调色板控件在 `SortableChannelRow.tsx`(`AUTO` + 6 个色块,可访问名 `<name> use default color` / `<name> color <Palette label>`),`PALETTE_LABELS` 在 `channel-labels.ts`。混音页条带用 `channelColor(item.channel.kind, reference.color)`(`MixerPage.tsx` 约第 149 行),缺失占位 `MissingChannelStrip.tsx` 同样。进组/出组的纯函数:`assignGroup`、`moveChannelTo`、`insertChannelAt`、`removeGroup`(UNGROUP,成员原位留作无组)、`removeGroupWithMembers`,都在 `view-order.ts`,进组写 `groupId`、出组 `delete` 该键,**都不碰 `color`**。`view-dirty.ts` 的 `sameChannelReference` 比较五个字段,组只比较 `id` 与 `name`。服务端对 view 的校验只有 shared 的 `checkViewGroups`(组 id 唯一、`groupId` 指向已有组),`apps/server` 没有自己的 view 业务逻辑;`data/config.json` 版本为 1,`viewChannelRefSchema` 带旧形状迁移的 `preprocess`。
- **空列表**(`SettingsPage.tsx` 约第 579 行):`activeDraft.channels.length === 0 && activeDraft.groups.length === 0` 时渲染 `<p class="panel-empty">THIS VIEW HAS NO CHANNELS</p>`,**不渲染 `ChannelOrderList`**,于是没有 `<ol>`、`listRef` 为 null、没有任何 droppable,从 AVAILABLE CHANNELS 拖出的通道无处可落(`ListAutoScroller` 也因 `list === null` 直接停止)。只有空分组、没有通道时列表会渲染,但根级落槽按非空块计算(`rootSlotPositionsFor([])` 为空),此时只能落进空组,不能落为无组行。既有测试断言 `THIS VIEW HAS NO CHANNELS` 文本存在(`views.integration.test.tsx`),文案要保留。
- **测试基建**:`apps/web/tests/stub-layout.ts`(jsdom 布局 stub,按 DOM 顺序给行、组块、落槽、overlay 合成 rect)、`keyboard-drag.ts`(`pickUp` / `press`)、`pointer-drag.ts`;`vitest.setup.ts` stub 了 `scrollIntoView` 与 `Element.prototype.animate`。覆盖率门槛 80%,当前 web 约 96%。
- **文档**:`docs/architecture.md` 的「通道分组」与「前端结构」描述了 6.2 的最终形态,其中「行的补间由 FLIP 列表负责」一句与拖动期间的实际行为不符(见上),本批次实现后即为真。

## 云端执行边界

- 你运行在云端,**无法连接真实 Fairlight Live**。本批次是前端为主、shared 少量改动,联调用 `pnpm dev` + `packages/test-utils` 的 Mock Ember+ Provider 制造通道清单即可。
- 验收标准中标注「本地」的条目由用户本地执行,你在报告中标注**移交用户**,并给出可直接照做的验收操作清单。
- 在独立分支上开发并推送,保持远端 CI(GitHub Actions:lint + typecheck + test + build,`pnpm install --frozen-lockfile`)全绿;不得改动 CI 流水线结构。
- **本批次不新增依赖**,`pnpm-lock.yaml` 不应有改动;若云端安装仍受 `codeload.github.com` 限制,按 6.2 报告第 7 节的办法处理,提交前确认 lockfile 无 diff。
- 改动 `packages/shared` 后需重跑 `pnpm --filter @flwc/shared build`,其它包才能拿到新类型。
- 云端手动冒烟可用 `pnpm dev`:web 端必须用 `http://localhost:5173` 访问(Vite 只监听 IPv6 `::1`)。

## 硬性约束

- `docs/prompts/phase-6-2.md` 的「硬性约束」全部沿用:自动化测试一律基于 Mock;代码、注释、提交信息、固定 UI 文案英文,文档与报告简体中文;不用 `window.confirm`;不改 CI;不调低覆盖率门槛、不新增覆盖率排除项;按逻辑单元分多次提交(建议:传感器 → FLIP → 空列表 → 折叠 → 颜色模型(shared)→ 颜色 UI → 文档)。
- 数据模型改动只限第 5 节写明的两个字段,向后兼容,不提升配置版本,不改旧形状迁移逻辑;`apps/server` 除测试外不应需要改动。
- 既有纯函数的签名不变;`view-order.ts` 既有单测不得删改(只允许新增)。
- 文档给出的数值都是**初值**,你不得自行调整;新增的数值一律做成常量并在报告中列出。
- 不改 `docs/development-plan.md` 的任务描述与验收框(用户自行维护,只在报告里逐条核对);`docs/fairlight-ember.md` 只由用户回写。

## 任务范围

六项改动,按下面的顺序做,每项独立可测。

### 1. 传感器改为 `MouseSensor + TouchSensor`

- `ViewDndContext.tsx` 用 `MouseSensor` 与 `TouchSensor` 替换 `PointerSensor`,`KeyboardSensor` 不变。`MouseSensor` 的 `activationConstraint: { distance }`,常量由 `POINTER_ACTIVATION_DISTANCE_PX` 改名为 `MOUSE_ACTIVATION_DISTANCE_PX`(值 4 不变);`TouchSensor` 沿用 `TOUCH_ACTIVATION_DELAY_MS`(250)与 `TOUCH_ACTIVATION_TOLERANCE_PX`(8),这两个常量已存在,保持导出供用户微调,注释写明含义与单位。
- 目的:触屏上由 `TouchSensor` 独占,长按 250ms 才起拖,按住期间移动超过 8px 视为滚动而取消;鼠标由 `MouseSensor` 独占,移动 4px 起拖。两者不再抢同一次按压。
- `DragState.pointer` 的判定、窗口级 `pointermove` / `touchmove` 监听、`ListAutoScroller` 与拖出移除逻辑不变(鼠标事件同样会触发 `pointermove`,`eventPoint` 对 MouseEvent / TouchEvent 都返回坐标)。把手上的 `touch-action: none` 保留。
- 测试:`apps/web/tests/pointer-drag.ts` 改为派发 `mouseDown`(把手)/ `mouseMove` / `mouseUp`(document)驱动 `MouseSensor`,既有「pointer sensor」用例改名为「mouse sensor」并全部保持通过;新增一个 `TouchSensor` 集成用例(`vi.useFakeTimers`):`touchStart` 把手后推进 250ms 起拖(`.drag-overlay` 出现),另一次在 250ms 内 `touchMove` 超过 8px 则不起拖且列表可继续处理为滚动(不出现 overlay)。
- 更新 `docs/architecture.md` 「通道分组」里「指针、触屏、键盘三种传感器」的表述为鼠标、触屏、键盘,并说明各自的激活条件。

### 2. 拖动过程中的行位移动画,并整体加快

- 让 FLIP 覆盖拖动期间的预览重排:占位行每次移动,因它位移的行都要平滑过渡。做法建议:把 `useFlipList` 改为在列表组件的**每次提交**后测量(`useLayoutEffect` 不带依赖,或以「渲染所用的视图 + 折叠状态」作依赖),hook 挂在 `ChannelOrderList` 内部,`capture` / `skipNext` 通过 ref 或 context 暴露给 `ViewDndContext` 与 `SettingsPage`。测量本身只是每行一次 `getBoundingClientRect`,每次提交都跑可以接受。
- 落下时不得出现两套补间叠加:克隆由 `DragOverlay` 飞向目标行,行本身应零位移;保留 `capture()` 或改用 `skipNext()` 都可以,以冒烟记录为准并写进报告。Esc 取消时预览消失、行回到原位,这一步也应有 FLIP 补间。
- 速度:新增常量 `FLIP_DURATION_MS`(初值 **120**)放在 `use-flip-list.ts`,`FLIP_TRANSITION` 改为直接使用该时长(不再引用 `--motion-medium`),reduced-motion 下仍完全不补间;`FLIP_CLEANUP_FALLBACK_MS` 相应改为 `FLIP_DURATION_MS` 的若干倍(建议 3 倍),避免写死。`DragOverlay` 的落下动画同样做成常量 `DROP_ANIMATION_MS`(初值 **150**,放 `dnd-config.ts`),`dropAnimationFor` 返回带该时长的配置(`{ ...defaultDropAnimation, duration }`)。这些都是初值,由用户真机微调。
- 顺带修正:切换 view(`selectView`)时调用 `skipNext()`,避免两个 view 里 key 相同的行在切换时「飞」过去。
- 测试:`use-flip-list.test.tsx` 的时长断言改为读常量;新增用例证明列表组件在预览视图变化(不改草稿)的提交后会写入反向 transform——可在 `settings-dnd.integration.test.tsx` 的键盘用例里,在 `ArrowDown` 后同步断言被位移行的内联 `style.transform` 非空(布局 stub 已能给出不同 rect),再等一帧后清空;切换 view 不产生 transform。

### 3. 空列表可作为投放目标

- `SettingsPage.tsx` 无论草稿是否为空都渲染 `ChannelOrderList`(`<ol>` 与 `listRef` 始终存在);`THIS VIEW HAS NO CHANNELS` 文案改为在列表内部渲染(如一个非 sortable 的 `<li class="panel-empty">`),文案与既有测试保持一致。
- 当视图**没有任何非空块**时(没有通道,或只有空分组),`ChannelOrderList` 在列表顶部渲染一个位置为 0 的根级落槽,并让它的命中带覆盖整个空态区域(而不是 `ROOT_SLOT_HEIGHT_PX`),这样从 AVAILABLE 拖入的通道可以预览为首个无组行并落下;有空分组时仍可落进空分组。`rootSlotPositionsFor` 的既有语义不变,只在「非空块为空」时补这个槽;键盘路径同样可达(`viewKeyboardCoordinates` 对来自 AVAILABLE 的项跳到首个目标即为它)。
- 布局 stub(`tests/stub-layout.ts`)给这个空态槽一个覆盖列表可见区域的 rect。
- 测试:集成用例「新建 view 后从 AVAILABLE 拖入首个通道」(键盘与鼠标各一次,落下后 `THIS VIEW HAS NO CHANNELS` 消失、勾选框勾选、保存体正确);「只有空分组的 view 可以把通道落为无组行,也可以落进空分组」。

### 4. 分组可折叠与展开

- 折叠状态是**编辑器的 UI 状态**,不进 View 模型、不持久化:`collapsedGroupIds: Set<string>` 放在 `SettingsPage`(或 `ChannelOrderList` 的 state,以能在切换 view 时重置为准),切换 view 时清空。
- `GroupHeader` 在把手之后加一个折叠按钮(自绘 chevron,`aria-expanded`、`aria-controls` 指向成员列表 id,可访问名 `Collapse group <name>` / `Expand group <name>`);空分组不显示该按钮。折叠时不渲染成员 `<ol>`,组头保留全部控件(把手、序号、组名、`<nn> CH`、箭头、`UNGROUP`),`<nn> CH` 就是折叠态的成员数提示;组块加 `is-collapsed` 类。
- 与拖放的关系:
  - 折叠的组仍是投放容器:通道行或 AVAILABLE 条目拖到折叠组头上,按既有组块中线规则落为组首或组尾;**一旦占位行被预览进某个折叠的组,该组立即展开并从折叠集合中移除**(拖动结束后保持展开),用户能看到落点。
  - 折叠组的成员不渲染,自然不是 sortable 项与键盘停靠点;`groupzone` 的 `data` 增加 `collapsed: boolean`,`keyboardStops` 把 `empty || collapsed` 的 `groupzone` 当作停靠点,键盘路径才能进入折叠组(进入即展开)。
  - 组头把手拖动整组、根级落槽、拖出移除、自动滚动都不受折叠影响。
- 折叠/展开引起的下方行位移由 FLIP 补间(第 2 节改为每次提交测量后自动覆盖);不做高度过渡动画。
- `UNGROUP` 折叠的组:成员按既有语义原位变为无组行并显示出来。
- 测试:折叠按钮的 `aria-expanded` 与成员显隐、切换 view 重置、折叠组的箭头/改名/`UNGROUP` 仍可用、拖入折叠组自动展开(键盘路径:`keyboardStops` 含折叠组)、折叠时组头把手整组移动。

### 5. 分组颜色与通道条的 AUTO / GROUP / 自定义

数据模型(`packages/shared/src/config.ts`,向后兼容,配置版本仍为 1):

```ts
// ViewGroup 增加可选颜色
export const viewGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  color: channelPaletteKeySchema.optional(),
});

// 通道引用的 color 允许 'group' 字面量:跟随所属组的颜色
export const viewChannelColorSchema = z.union([channelPaletteKeySchema, z.literal('group')]);
export type ViewChannelColor = z.infer<typeof viewChannelColorSchema>;
// viewChannelRefObjectSchema.color: viewChannelColorSchema.optional()
```

- `checkViewGroups` 增加一条:`color === 'group'` 而 `groupId` 为空的引用报错(`path: ['channels', index, 'color']`,message 形如 `Channel color "group" requires a group`)。旧形状迁移与其它校验不变;`packages/shared` 覆盖率维持 ≥ 90%。`apps/server` 的 views 路由用的是 shared schema,应无需改动,只补一个集成用例证明带组颜色与 `'group'` 色的 view 能写入并读回、无组却 `'group'` 色的 body 被 400 拒绝。
- 颜色解析集中到 `apps/web/src/features/mixer/channel-colors.ts`,两个页面共用,删除三处各自的 lead 计算:
  - `groupAccent(group: ViewGroup, leadKind: ChannelKind | undefined): string` — `group.color` 有值取该色;否则取**首个在场成员的类型色**(`channelTypeColor(leadKind)`,忽略成员自己的覆盖,避免与 `'group'` 互相引用),没有成员时为 `channelTypeColor('channel')`。
  - `channelAccent(kind: ChannelKind, color: ViewChannelColor | undefined, group: ViewGroup | undefined, leadKind?: ChannelKind): string` — `color === 'group'` 且 `group` 存在时取 `groupAccent`;`'group'` 但组不存在(理论上不会出现)按 AUTO 处理;其余同现有 `channelColor`。
  - 使用点:配置页行、组块、空组块、拖动克隆(通道行与组头两种)、占位行不变(它没有组色以外的信息,可用组色);混音页 `segmentAccent`、`renderViewStrip` 的条带、`MissingChannelStrip`。
- 颜色随进组/出组的自动转换,做成 `view-order.ts` 里一个纯函数 `colorForMembership(reference, groupId | undefined): ViewChannelRef`,由 `assignGroup`、`moveChannelTo`、`insertChannelAt`、`removeGroup`(UNGROUP)统一调用,规则:
  - 进入某个组(从无组进入,或从别的组移入):`color` 为 `undefined`(AUTO)→ 变为 `'group'`;`'group'` 保持;自定义色保持。
  - 离开组变为无组行(拖出、`GROUP` 下拉选 `NO GROUP`、`UNGROUP`):`'group'` → 删除 `color` 键(AUTO);自定义色保持。
  - 组内移动(同组重排)不改颜色。
  - `removeGroupWithMembers`(拖出移除整组)与勾选追加不涉及。
  - 已保存的旧 view 里、组内 `color` 为 `undefined` 的引用**不做迁移**,继续按 AUTO 显示;用户可手动改为 GROUP。
- 行的调色板控件(`SortableChannelRow.tsx`):在 `AUTO` 之后增加 `GROUP` 按钮,**只在行属于某个组时渲染**,按钮内显示一个当前组色的色块,可访问名 `<name> use group color`;选中态规则同现有(`is-selected`)。选 `GROUP` 写入 `color: 'group'`,选 `AUTO` 删除 `color`,选色块写入该键。
- 组头调色板(`GroupHeader`):新增 `GROUP COLOR` 控件,`AUTO`(可访问名 `Group <name> use automatic color`)+ 6 个色块(`Group <name> color <Palette label>`),写入 `group.color`;`renameGroup` 旁新增纯函数 `setGroupColor(view, groupId, color | undefined)`。组头、组块左侧 accent 与混音页分组段标题都用 `groupAccent`。折叠态(第 4 节)组头仍可改色。
- `view-dirty.ts`:组的比较加上 `color`;`sameChannelReference` 已按字符串比较 `color`,无需改。
- `DragOverlayContent` 的 accent 同样走新解析。`ViewDndContext` 的 overlay 分支删除自己的 lead 计算。
- 文档:`docs/architecture.md` 「View 与失配处理」的模型代码块加 `color?: ChannelPaletteKey | 'group'` 与 `groups[].color?`,「通道分组」补一段颜色规则(AUTO / GROUP / 自定义、进出组的自动转换、组色 AUTO 的取法),「持久化」示例加一个组色与 `'group'` 色的例子。
- 测试:shared 的 schema 用例(组色枚举、`'group'` 带组通过、不带组被拒、旧形状迁移不受影响);`view-order.test.ts` 对四个入口各覆盖 AUTO → GROUP、自定义保持、GROUP → AUTO、组内移动不变、跨组移动保持 `'group'`;`channel-colors` 的解析用例(组色有/无、`'group'` 有组/无组、lead 缺失);`view-dirty` 组色变化为脏;集成:`GROUP` 下拉进组后行调色板 `GROUP` 选中、拖出后回到 `AUTO`、自定义色进出组不变、组头改色后 GROUP 行与混音页分组段标题颜色随之变化(断言 `--channel-row-accent` / `--channel-accent`)、保存体带 `color: 'group'` 与组 `color`。

### 6. 文档

- `docs/architecture.md` 按第 1、2、4、5 节更新,只描述当前状态。
- 不改 `docs/development-plan.md`。

## 测试要求

- 单元测试与被测代码同目录,集成测试放 `apps/web/tests/`;新增集成用例优先放进 `settings-dnd.integration.test.tsx` / `settings-dirty.integration.test.tsx`,颜色与折叠可新建 `settings-groups.integration.test.tsx`,不要再把 `views.integration.test.tsx` 撑大。
- 上述各节的测试项全部落地;既有测试除第 1 节说明的 helper 改名外不得删改。
- 覆盖率:`apps/web` ≥ 80%,`packages/shared` ≥ 90%,`apps/server` ≥ 80%,全部维持既有门槛。

## 明确不做的事

- 不做 6.3–6.5 的任何内容(分页、页头压缩、`:hover` 媒体查询、`100dvh`、touch 数值调参、重连、soak)。
- 不持久化折叠状态;不给混音页加折叠。
- 不迁移旧 view 的颜色数据;不提升配置版本;不改旧形状迁移。
- 不引入新依赖;不改 CI;不改 `docs/development-plan.md`;不自行调整任何数值初值。
- 不改 CONNECTION 面板。

## 验收自查

完成后逐条核对,在云端实际执行并记录结果:

1. 传感器:鼠标 4px 起拖、触屏 250ms 长按起拖且 8px 内抖动容忍、超过即取消 — 以测试为证;真机手感 **移交用户**。
2. 动画:拖动期间占位行移动时其它行有补间;落下无叠加;Esc 回位有补间;时长常量生效;切换 view 不飞行 — 测试 + 冒烟记录(沿用 6.2 报告的 MutationObserver 记 style 写入的办法);观感 **移交用户**。
3. 空列表:新建 view 后可从 AVAILABLE 拖入首个通道(键盘与鼠标);只有空分组时可落为无组行或落进空组 — 以测试为证。
4. 折叠:按钮、`aria-expanded`、成员显隐、切换 view 重置、拖入自动展开、折叠态各控件可用 — 以测试为证。
5. 颜色:schema、纯函数转换、解析、两个页面的显示、保存体 — 以测试为证;真机观感 **移交用户**。
6. 全量质量门:串行 lint → typecheck → test → build 全绿,远端 CI 全绿,lockfile 无 diff。

## 执行报告要求

在 `docs/reports/phase-6-2-1-report.md` 产出执行报告(简体中文),章节与 `docs/reports/phase-6-2-report.md` 相同:结果总览、验收标准逐条核对(对上述六条)、实现摘要(每节一段)、数值初值清单(含新增的 `MOUSE_ACTIVATION_DISTANCE_PX`、`FLIP_DURATION_MS`、`DROP_ANIMATION_MS` 与沿用的 touch 常量)、真机验收操作清单(移交用户,含鼠标、触屏、键盘三条路径;**安全约束照抄 6.2 报告第 5 节**)、交付物清单、依赖清单(应为「无新增依赖,lockfile 无 diff」)、关键决策与偏离、遗留问题与移交事项(至少:touch 数值调参仍属 6.4)、提交记录。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤都要写明,不许美化。

## 完成定义

- 六项任务全部落地,测试要求全部满足。
- 云端串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,分支推送后远端 CI 全绿,`pnpm-lock.yaml` 无改动。
- `pnpm dev` + Mock Provider 浏览器冒烟通过(鼠标拖动中的行补间、空 view 拖入、折叠组拖入自动展开、组色与 GROUP 行联动、混音页分组段颜色)。
- 全部变更已按 Conventional Commits 提交。
- `docs/reports/phase-6-2-1-report.md` 已产出,真机验收清单可直接交用户执行。
