# Phase 6.2.2 执行提示词 — 配置页 UX 补充二

> 用法:将本文档全文作为执行会话的任务提示词。执行会话运行在 Cursor 云端环境(配置见 `.cursor/environment.json`),无法访问真实 Fairlight Live。本批次是 Phase 6.2.1 合并后由用户真机验收得出的第二个补充批次,任务来源是 `docs/development-plan.md` 的 6.2.2 一节,细节以本文档为准。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,真机验收由用户在本地完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束(含云端 dev server 的 IPv6 localhost 注意事项、新增依赖的许可要求)
2. `docs/development-plan.md` — Phase 6 总述、6.2 / 6.2.1 / 6.2.2 三节(本批次的交付物与验收标准),以及「云端 Agent 开发边界」;同时浏览 6.3–6.5,了解不该越界的内容
3. `docs/architecture.md` — 「View 与失配处理」「通道分组」「持久化」「前端结构」(数据模型、拖放语义、预览视图、FLIP、根级落槽、颜色规则的当前描述,本批次要改写其中大半)
4. `docs/conventions.md` — 目录结构、命名、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/reports/phase-6-2-1-report.md` — 6.2.1 执行报告,重点第 3 节(实现摘要)、第 5 节(真机验收清单与安全约束)、第 8 节(偏离)、第 9 节(遗留)、第 12 节(真机反馈后的呈现调整)
6. `docs/prompts/phase-6-2-1.md` — 6.2.1 的提示词,本批次沿用其全部硬性约束

## 代码现状(已确认,直接复用)

- **配置页文件**(全部在 `apps/web/src/features/settings/`):`SettingsPage.tsx`(状态、草稿、保存、脏检测、`pendingAction`、`toggleChannel` / `handleCleanup` / `setChannelColor` 三处直接改 `source.channels`)、`ViewDndContext.tsx`(`DndContext`、传感器、预览同步、落点结算、`DragOverlay`,overlay 分支有一份 `leadKindOf`)、`ChannelOrderList.tsx`(根 `SortableContext`、根级落槽、占位行、`groupLeadKinds`、只在空草稿时渲染的 `fillSlot`)、`SortableChannelRow.tsx`(接 `group` 与 `groupLeadKind`)、`SortableGroupBlock.tsx`(`SortableGroupBlock` 与 `EmptyGroupBlock`,后者只是 `useDroppable` 容器、把手是占位、`OrderButtons` 对空组无效)、`RootSlot.tsx`(`fill` 变体)、`PlaceholderRow.tsx`、`DragOverlayContent.tsx`、`DroppableRemeasure.tsx`、`ListAutoScroller.tsx`;纯函数与配置:`view-order.ts`(`viewBlocks` / `nonEmptyBlocks` / `rootSlotPositionsFor` / `memberIndices` / `moveChannel` / `moveGroup` / `colorForMembership` / `assignGroup` / `addGroup` / `renameGroup` / `removeGroup` / `setGroupColor` / `moveChannelTo` / `insertChannelAt` / `moveGroupTo` / `removeChannel` / `removeGroupWithMembers`)、`view-dirty.ts`、`row-keys.ts`、`dnd-ids.ts`、`dnd-collision.ts`、`drop-resolver.ts`、`drag-preview.ts`、`dnd-config.ts`;hook:`use-flip-list.ts`、`use-drag-preview.ts`。
- **数据模型**(`packages/shared/src/config.ts`):`View { id, name, channels: ViewChannelRef[], groups: ViewGroup[] }`,`ViewChannelRef { kind, name, channelId?, groupId?, color?: ChannelPaletteKey | 'group' }`,`ViewGroup { id, name, color? }`;`viewChannelRefSchema` 是带旧形状 `{ channelId, lastKnownName }` 迁移的 `z.preprocess`;`checkViewGroups` 校验组 id 唯一、`groupId` 指向已有组、`'group'` 色必须有 `groupId`;`appConfigSchema.version` 为 `z.literal(1)`,`defaultAppConfig()` 版本 1。`packages/shared/src/views.ts` 的 `viewWriteBodySchema = viewObjectSchema.omit({ id }).superRefine(checkViewGroups)`。**非空组的位置由成员在 `channels` 里的位置推出,空组没有位置**:`viewBlocks` 把空组追加在全部通道之后,`nonEmptyBlocks` 把它们滤掉,`moveGroup` / `moveGroupTo` / `swapBlocks` 对空组返回 null,根位置按非空块计数,所以通道永远落不到空组之后。
- **服务端**:`ConfigStore`(`apps/server/src/config/config-store.ts`)读文件后用 `appConfigSchema.safeParse`,失败则回退默认;`save` / `update` 都经 `appConfigSchema.parse` 后原子写入。views 路由(`apps/server/src/api/views.ts`)只用 shared 的 `viewWriteBodySchema` / `viewSchema`,没有自己的 view 业务逻辑。`config-store.test.ts` 有一条「`{ version: 2 }` 校验失败回退默认」的用例,本批次升版本后要改写。
- **混音页**(`apps/web/src/features/mixer/`):`view-resolver.ts` 的 `resolveViewChannels(view, channels)` 按 `view.channels` 的下标解析,返回带 `index` 的条目;`segmentViewChannels(view, entries)` 按 `groupId` 连续段切分;`leadChannelKind(entries)` 取首个在场成员的类型。`MixerPage.tsx` 的 `segmentAccent` 与 `renderViewStrip` 把 `group` 与 `leadKind` 传给条带,`MissingChannelStrip.tsx` 接 `group` 与 `groupLeadKind`。`channel-colors.ts`:`groupAccent(group, leadKind)`、`channelAccent(kind, color, group, leadKind)`。
- **FLIP**(`use-flip-list.ts`):每次提交的 `useLayoutEffect` 里 `measure()` 用 `getBoundingClientRect` 量所有 `[data-flip-key]`,存入 `lastRects`;`dependency` 变化时用上次矩形减本次矩形得位移,`animate()` 先调用上一次的 cleanup(把 `transition` / `transform` 清空),再写反向 `transform`、强制 reflow、下一帧起 `FLIP_TRANSITION`。**已知缺陷,即本批次第 1 项的根因**:`getBoundingClientRect` 包含正在补间中的 transform。快速拖动时行 X 被挤开的 `FLIP_DURATION_MS`(120ms)补间还没跑完,下一次预览提交就到了:hook 把上次的自然位置当 before、把这次含半程 transform 的位置当 after,算出一个并不存在的位移,于是 cleanup 先把行瞬间拉回自然位置,再套反向 transform,行从半程位置跳到另一侧再滑回来,肉眼看就是又被挤了一次。嵌套处理(`parentShift`)与 `data-flip-skip` 逻辑本身没问题。
- **dnd-kit 测量**:`DndContext` 没有传 `measuring`,droppable 用 dnd-kit 默认的 `getClientRect`,同样包含 transform;`DroppableRemeasure` 在每次预览视图变化后的 `useLayoutEffect` 里 `measureDroppableContainers([])` 全量重测,此时被挤开的行还带着反向 transform 停在旧位置,碰撞检测拿到的是旧几何;`ListAutoScroller` 滚动时也节流重测。`@dnd-kit/core` 导出的 `getClientRect(node, { ignoreTransform: true })` 只反解节点自身的 transform,不管祖先,**不要直接用它**(组成员行的祖先组块也会被 FLIP 平移)。
- **根级落槽**(`ChannelOrderList.tsx` + `RootSlot.tsx`):拖通道或 AVAILABLE 条目时,按去掉被拖通道后的非空块序列 `rootSlotPositionsFor(remaining)` 在「首个组之前、相邻两组之间、末组之后」渲染零高度落槽,命中带 `ROOT_SLOT_HEIGHT_PX`(16)覆盖下方块顶部;草稿一个有序块都没有时另渲染 `fill` 变体(`root-slot--fill`,`flex: 1 1 auto; min-height: 4rem`,吃掉列表剩余高度),且按**草稿**而非预览判定。`isEligibleTarget` 对 `group` 来源不接受 `slot`,`resolveDropTarget` 对 `group` 来源命中 slot 返回 null,组拖动时不渲染任何落槽。`.view-channel-list` 是 `flex: 1` 的 `<ol>`,行数不足时列表内部就有空白区域,但没有任何 droppable 覆盖它。
- **测试基建**:`apps/web/tests/stub-layout.ts`(jsdom 布局 stub:按 DOM 顺序给 AVAILABLE 条目、行、组块、落槽、`root-slot--fill`、overlay 合成矩形;`STUB_ROW_HEIGHT` 40)、`keyboard-drag.ts`(`pickUp` / `press`)、`pointer-drag.ts`(`mouseDown` / `mouseMove` / `mouseUp`)、`touch-drag.ts`;`vitest.setup.ts` stub 了 `scrollIntoView` 与 `Element.prototype.animate`。集成测试:`settings-dnd.integration.test.tsx`、`settings-dirty.integration.test.tsx`、`settings-groups.integration.test.tsx`、`settings-palette.integration.test.tsx`、`settings-row-controls.integration.test.tsx`、`views.integration.test.tsx`;view 夹具散布在这些文件与 `view-order.test.ts`、`drop-resolver.test.ts`、`drag-preview.test.ts`、`view-dirty.test.ts`、`row-keys.test.ts`、`view-resolver.test.ts`、`views-api.test.ts`、`view-store.test.ts`、`apps/server/src/api/views.test.ts`、`packages/shared/src/config.test.ts`。覆盖率门槛 80%,当前 web 约 96%。
- **文档**:`docs/architecture.md` 的「View 与失配处理」模型代码块、「通道分组」里关于空组留在底部、根级落槽、`fill` 落槽按草稿判定、`groupAccent(group, leadKind)` 取首个在场成员的描述,以及「持久化」的版本 1 示例,在本批次实现后都不再成立,要改写。

## 云端执行边界

- 你运行在云端,**无法连接真实 Fairlight Live**。本批次是前端为主、shared 与服务端测试少量改动,联调用 `pnpm dev` + `packages/test-utils` 的 Mock Ember+ Provider 制造通道清单即可。
- 验收标准中标注「本地」的条目由用户本地执行,你在报告中标注**移交用户**,并给出可直接照做的验收操作清单。
- 在独立分支上开发并推送,保持远端 CI(GitHub Actions:lint + typecheck + test + build,`pnpm install --frozen-lockfile`)全绿;不得改动 CI 流水线结构。
- **本批次不新增依赖**,`pnpm-lock.yaml` 不应有改动;若云端安装仍受 `codeload.github.com` 限制,按 6.2 报告第 7 节的办法处理,提交前确认 lockfile 无 diff。
- 改动 `packages/shared` 后需重跑 `pnpm --filter @flwc/shared build`,其它包才能拿到新类型。
- 云端手动冒烟可用 `pnpm dev`:web 端必须用 `http://localhost:5173` 访问(Vite 只监听 IPv6 `::1`)。

## 硬性约束

- `docs/prompts/phase-6-2.md` 与 `docs/prompts/phase-6-2-1.md` 的「硬性约束」全部沿用:自动化测试一律基于 Mock;代码、注释、提交信息、固定 UI 文案英文,文档与报告简体中文;不用 `window.confirm`;不改 CI;不调低覆盖率门槛、不新增覆盖率排除项;按逻辑单元分多次提交(建议:FLIP 几何与测量 → shared 模型与迁移 → server 测试 → web 纯函数 → web 组件 → 空白落槽 → 组色众数 → 文档)。
- 数据模型改动只限第 2 节写明的形状;配置版本升为 2,版本 1(含更早的引用形状)在 shared 读取时迁移;`apps/server` 除测试外不应需要改动业务代码。
- 既有纯函数的**语义**不变(根位置按块计数、组位置按成员计数、进出组颜色转换、`UNGROUP` 原位保留、`insertChannelAt` 的三字段查重、`moveChannelTo` 原位返回 null);签名允许因模型改动而变,第 2 节写明的以文档为准。既有测试因模型改动必须重写夹具,但**每条既有用例的断言意图都要保留**,不得借机删掉用例;报告里列出被改写的用例清单。
- 文档给出的数值都是**初值**,你不得自行调整;新增的数值一律做成常量并在报告中列出。
- 不改 `docs/development-plan.md` 的任务描述与验收框(用户自行维护,只在报告里逐条核对);`docs/fairlight-ember.md` 只由用户回写。

## 任务范围

五项改动,按下面的顺序做,每项独立可测。第 1 项与其余三项独立;第 3、4 项依赖第 2 项。

### 1. FLIP 补间可续接(在途行不被触碰,再次推动时从当前位置起步),dnd-kit 测量改用无 transform 几何

**先复现,再修,再用同一埋点证明。** 用 `pnpm dev` + Mock Provider(至少 6 个通道勾进一个 view)做 Playwright 冒烟(做法沿用 6.2.1 报告第 2 节「端到端冒烟」一段:`playwright-core` 只装在会话临时目录,不进仓库):

- 埋点:对 CHANNEL ORDER 列表挂 `MutationObserver`(`attributes: true, attributeFilter: ['style'], subtree: true`),记录每个 `data-flip-key` 行每次 `style.transform` 被写入非空 `translate(...)` 的时刻与值;同时记录 `childList` 变动次数作为预览提交次数的近似(或临时在 `ChannelOrderList` 里打 `console.debug` 计数,冒烟结束后删掉)。
- 操作:`mouseDown` 第 1 行把手,以每 8ms 一步、每步 20px 的节奏连续 `mouseMove` 到第 6 行下方,再 `mouseUp`;总时长必须明显短于「行数 × `FLIP_DURATION_MS`」,否则复现不了。
- 修复前的预期记录:至少有一行在一次被跨越里收到两次非零 `transform` 写入,或出现绝对值超过一行高度的 translate;把原始记录节选进报告。修复后同一脚本:每个被跨越的行**恰好一次**预览提交、恰好一次非零 `transform` 写入,且没有超过一行高度的值。

实现:

- 新建纯函数模块 `apps/web/src/features/settings/flip-geometry.ts`:
  - `translateOf(transform: string): { x: number; y: number }` — 解析 `getComputedStyle(el).transform` 的取值:`none` / 空串为 0;`matrix(a, b, c, d, e, f)` 取 `e, f`;`matrix3d(...)` 取第 13、14 个分量。只需要平移分量,FLIP 只写 `translate`。
  - `flipTranslateOf(element: Element): { x: number; y: number }` — 元素自身及其所有带 `data-flip-key` 的祖先当前生效的平移之和(逐级读 `getComputedStyle(...).transform`,用 `translateOf`)。祖先只认 `[data-flip-key]`,因为只有它们会被 FLIP 平移;`data-flip-skip` 的行没有 transform,结果自然为 0。
  - `naturalRect(element: Element): ClientRect` — `getBoundingClientRect()` 减去 `flipTranslateOf`,即元素没有任何 FLIP 平移时的布局位置(`top/left/right/bottom` 都减,`width/height` 不变)。返回值形状与 `@dnd-kit/core` 的 `ClientRect` 一致,便于直接作 `measuring.droppable.measure`。
- `use-flip-list.ts`:
  - `measure()` 与 `capture()` 改存**自然位置**(`naturalRect`)。
  - 每次依赖变化时,每个元素的位移改为 `delta = 本次自然位置 - 上次自然位置`(嵌套的 `parentShift` 相减逻辑保留,父块与子行各自算自己的 `delta`,相对父块),然后分两种情况:
    1. `|delta| < FLIP_MIN_SHIFT_PX`:**什么都不做**,不写任何样式;正在补间中的行就让它的 transition 继续跑。这是重复播放的直接修复:被误碰的行自然位置本来就没变。
    2. `|delta| ≥ FLIP_MIN_SHIFT_PX`:起一段新补间,起点是**当前视觉位置**:`shift = (上次自然位置 + 该元素当前在途平移 flipTranslateOf) - 本次自然位置`。不在补间中的行在途平移为 0,结果与现在完全相同;在途的行则从它此刻所在的位置出发,不回跳。写入顺序与现在一样:cleanup 上一段、`transition: none` + 反向 transform、强制 reflow、下一帧起 `FLIP_TRANSITION`;时长与缓动仍是 `FLIP_DURATION_MS` 与 `ease-out`,不继承上一段的速度或剩余时长。
  - `FLIP_MIN_SHIFT_PX`、`FLIP_DURATION_MS`、`FLIP_TRANSITION`、`FLIP_CLEANUP_FALLBACK_MS`、reduced-motion、`skipNext`、`capture` 都不变。
- `ViewDndContext.tsx`:`DndContext` 增加 `measuring={{ droppable: { measure: naturalRect } }}`(`strategy` 保持默认),让 `DroppableRemeasure`、`ListAutoScroller` 与 dnd-kit 自己的重测都拿到无 FLIP 平移的矩形,碰撞检测始终针对预览的最终布局。`draggable` 与 `dragOverlay` 的测量不改。
- 测试:
  - `flip-geometry.test.ts`:`translateOf` 对 `none` / 空串 / `matrix` / `matrix3d` / 带小数与负数;`flipTranslateOf` 对「自身 + 两级 `data-flip-key` 祖先 + 一级无标记祖先」的求和;`naturalRect` 减法。jsdom 的 `getComputedStyle` 会回读内联 `style.transform`,用内联样式即可构造。
  - `use-flip-list.test.tsx`:新增两例。「在途不被触碰」:第一次依赖变化让某行位移 40px 并写入反向 transform;不等它清理,给该行内联 `transform: translate(0px, 20px)` 模拟走到半程,再触发一次**该行自然位置不变**的依赖变化,断言该行的 `style` 没有任何写入(spy `style.setProperty` 或比较 `cssText`)。「在途被再次推动」:同样走到半程后触发一次自然位置又下移 40px 的变化,断言写入的 transform 为 `translate(0px, -20px)`(当前视觉位置 20 减 delta 40),下一帧 `transition` 为 `FLIP_TRANSITION`。
  - `settings-dnd.integration.test.tsx`:键盘用例里连续三次 `ArrowDown` 不等待补间清理,用 `MutationObserver` 或对 `style` 的 spy 统计,每个被跨过的行恰好一次非空 `transform` 写入,且绝对值不超过 `STUB_ROW_HEIGHT`;另一例断言 dnd-kit 的 droppable 矩形在提交后立即等于自然位置(可在 `DndContext` 的 `onDragOver` 里读 `over.rect`,或通过布局 stub 给带 transform 的行一个偏移矩形来验证 `measuring.droppable.measure` 生效)。

### 2. View 数据模型改为有序块(配置版本 2)

**新模型**(`packages/shared/src/config.ts`,类型名以此为准):

```ts
// 通道引用:不再有 groupId,所属由它在 items 里的位置决定
export const viewChannelRefSchema = z.object({
  kind: channelKindSchema,
  name: z.string().trim().min(1),
  channelId: z.string().min(1).optional(),
  color: viewChannelColorSchema.optional(), // 'group' only inside a group block
});
export type ViewChannelRef = z.infer<typeof viewChannelRefSchema>;

// 组块:自带成员,成员可以为空
export const viewGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  color: channelPaletteKeySchema.optional(),
  channels: z.array(viewChannelRefSchema),
});
export type ViewGroup = z.infer<typeof viewGroupSchema>;

// 有序块:根级通道引用或组块,按 type 区分
export const viewItemSchema = z.discriminatedUnion('type', [
  viewChannelRefSchema.extend({ type: z.literal('channel') }),
  viewGroupSchema.extend({ type: z.literal('group') }),
]);
export type ViewItem = z.infer<typeof viewItemSchema>;
export type ViewChannelItem = Extract<ViewItem, { type: 'channel' }>;
export type ViewGroupItem = Extract<ViewItem, { type: 'group' }>;

export const viewObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  items: z.array(viewItemSchema),
});
// checkViewItems:组 id 唯一;根级通道引用的 color 不得为 'group'
export const viewSchema = viewObjectSchema.superRefine(checkViewItems);

export const appConfigSchema = z.preprocess(migrateAppConfig, appConfigObjectSchema); // version: z.literal(2)
```

- **迁移**(`migrateAppConfig`,放在 shared,纯函数并导出以便单测):输入 `version === 1` 的对象时,把每个 view 的 `channels + groups` 转成 `items`:先把每个引用过一遍既有的 `migrateLegacyChannelRef`(旧形状 `{ channelId, lastKnownName }` 的迁移逻辑从 `viewChannelRefSchema` 的 `preprocess` 挪到这里,语义不变);然后按顺序遍历引用,`groupId` 为空的成为 `{ type: 'channel', ...ref }`,连续同 `groupId` 的合成一个 `{ type: 'group', ...group, channels: [...] }`(组的 `id` / `name` / `color` 取自 `groups`;`groupId` 指向不存在的组时该引用按无组处理,并从引用上删掉 `groupId`);没有任何成员的组按 `groups` 数组顺序追加在 `items` 末尾;引用上的 `groupId` 键去掉。输出 `version: 2`。版本 2 的输入原样返回;其它版本原样返回交给 schema 拒绝。迁移只在读取时发生,`ConfigStore.load` 经 `safeParse` 拿到的就是版本 2,下一次 `save` / `update` 自然写回版本 2,服务端业务代码不需要改。`defaultAppConfig()` 版本 2。
- `packages/shared/src/views.ts`:`viewWriteBodySchema = viewObjectSchema.omit({ id: true }).superRefine(checkViewItems)`,只接受版本 2 形状(web 由同一服务端托管,不需要兼容旧写入体)。
- shared 新增两个导出的纯函数供两端共用:`viewChannelRefs(view: Pick<View, 'items'>): ViewChannelRef[]`(按显示顺序扁平化全部引用,根级与组内一起)与 `viewGroups(view): ViewGroup[]`(按出现顺序的组块)。
- **web 的定位约定**:页面层继续用「扁平下标」标识一行(`ResolvedViewChannel.index`、行键、`DragSource.index`、各 handler 的 `index` 参数都不变),`view-order.ts` 内部用 `locateChannel(view, index): { item: number; member?: number } | null` 换算成块路径。`DropTarget` 形状不变:`root.position` 按 **全部块**(含空组)计数,`group.position` 按成员计数。
- `view-order.ts`(签名以此为准,语义与现在一致):
  - `viewBlocks(view): ViewBlock[]` — 直接由 `items` 得出,组块带扁平 `indices`(空组为 `[]`),**不再把空组挪到末尾**;删除 `nonEmptyBlocks`,所有需要块序列的地方改用 `viewBlocks`。
  - `rootSlotPositionsFor(blocks)` — 仍只标「首个组之前、相邻两组之间」的边界(空组也是组);**不再**在末尾追加位置,末尾由第 3 节的常驻落槽负责。`rootSlotPositions(view)` 同步。
  - `memberIndices(view, groupId)`、`groupOfIndex(view, index): ViewGroup | undefined`(新增,取代各处 `view.groups.find(... reference.groupId)`)。
  - `moveChannel(view, index, direction)`、`moveGroup(view, groupId, direction)`、`moveGroupTo(view, groupId, position)` — 空组与非空组同等对待,`swapBlocks` 不再拒绝空组。
  - `colorForMembership(reference, from: string | undefined, to: string | undefined): ViewChannelRef` — 引用不再自带 `groupId`,由调用方传入来源与目标组 id,规则不变(进组 AUTO → `'group'`,出组 `'group'` → AUTO,自定义保持,同组不变)。
  - `assignGroup(view, index, groupId | undefined)`、`addGroup(view, group)`(在 `items` 末尾追加一个空组块)、`renameGroup`、`setGroupColor`、`removeGroup(view, groupId)`(`UNGROUP`:组块原位替换为其成员的根级引用,经 `colorForMembership` 出组)、`removeGroupWithMembers`、`removeChannel(view, index)`、`moveChannelTo(view, index, target)`、`insertChannelAt(view, reference, target)`。
  - 新增 `setChannelColor(view, index, color | undefined)`、`removeChannels(view, indices: ReadonlySet<number>)`、`appendChannel(view, reference)`,让 `SettingsPage` 的 `setChannelColor` / `handleCleanup` / `toggleChannel` 不再直接操作数组。
- `view-dirty.ts`:按 `items` 结构比较——长度、每项 `type`;通道项比较 `kind` / `name` / `channelId` / `color`;组项比较 `id` / `name` / `color` 与成员逐个 `sameChannelReference`。空组的位置变化也是脏。
- `row-keys.ts`:`channelRowKeys(view)` 基于 `viewChannelRefs(view)`。`drop-resolver.ts` / `drag-preview.ts` / `dnd-collision.ts`:`knownGroupId` → `groupOfIndex`,`restBlocks` 用 `viewBlocks`;其它逻辑不变。
- `ChannelOrderList.tsx`:块序列直接来自 `viewBlocks`,空组块在它所在的位置渲染;`EmptyGroupBlock` 改为**真正的 sortable 项**(`useSortable(group:<id>)` + `useDroppable(groupzone:<id>, { empty: true })`,把手可拖、`OrderButtons` 可用、无折叠按钮、不可作为其它组的成员容器以外的目标),根 `SortableContext` 的 `items` 包含空组;`groupLeadKinds` 删除(见第 4 节)。`rootSlotPositionsFor` 的输入是去掉被拖块后的**全部块**。
- `SettingsPage.tsx`:`toggleChannel` / `handleCleanup` / `setChannelColor` 改调纯函数;保存体与脏检测用新模型;其余不变。`ViewDndContext.tsx` 的 overlay 分支用 `groupOfIndex`。
- 混音页:`resolveViewChannels(view, channels)` 输入改为 `viewChannelRefs(view)`(`index` 仍是扁平下标);`segmentViewChannels(view, entries)` 改为按 `items` 切段:每个组块一段(空组不产生段)、连续根级引用一段;`MixerPage.tsx` / `MissingChannelStrip.tsx` 只传 `group`(第 4 节删 `leadKind`)。混音页对空组的处理不变:不渲染。
- 服务端:`views.test.ts`、`config-store.test.ts` 夹具改为版本 2;新增用例:读取一个版本 1 文件(含两个有成员的组、一个空组、一个 `groupId` 悬空的引用、一个旧形状引用)后 `snapshot` 为版本 2 且 `items` 顺序正确,随后 `update` 写回的文件是版本 2;`{ version: 3 }` 回退默认(替换现有的 `{ version: 2 }` 用例);写入体带 `type: 'group'` 空组通过、根级 `color: 'group'` 被 400 拒绝。
- 测试(shared):`config.test.ts` 覆盖 `migrateAppConfig`(连续同组合成、非连续同组拆成两个块、空组追加、悬空 `groupId`、旧形状、`'group'` 色保留、版本 2 原样、未知版本原样)、`checkViewItems`(组 id 重复、根级 `'group'` 色)、`viewChannelRefs` / `viewGroups`;shared 覆盖率维持 ≥ 90%。
- 测试(web):`view-order.test.ts` 夹具改写,补充:空组在中间时 `viewBlocks` 位置正确;`moveGroup` / `moveGroupTo` 对空组可移动;`moveChannelTo` 落到 `root` 位置等于空组前与空组后;`insertChannelAt` 同上;`removeGroup` 对空组只删块;`addGroup` 追加在末尾;`setChannelColor` / `removeChannels` / `appendChannel`;`colorForMembership` 新签名下四个方向。`view-dirty.test.ts`:空组位置变化为脏、成员颜色变化为脏。`drop-resolver.test.ts` / `drag-preview.test.ts` / `row-keys.test.ts` / `view-resolver.test.ts` / `views-api.test.ts` / `view-store.test.ts` 与全部集成测试夹具改写,断言意图保留。新增集成用例:空组用键盘(`pickUp` 组头 + `ArrowUp`)与鼠标整体移动到两行之间;通道用鼠标落到末尾空组**之后**成为独立行(依赖第 3 节)与落到空组**之前**;混音页在版本 2 view(含空组)下分组段与无组条带渲染正确。

### 3. 列表空白区域即落点:末尾常驻的占满式根级落槽

- `ChannelOrderList.tsx`:只要有拖动在进行(来源为通道行、AVAILABLE 条目或组头),就在列表末尾渲染一个 `fill` 变体的 `RootSlot`,`position` 为「去掉被拖块后的全部块数」(通道来源用 `remaining.length`,组来源用去掉该组块后的块数),`label` 为 `the end of the list`,`current` 在被拖块本来就是最后一个块时为 true(指针悬停不动,键盘跳过)。删除只在空草稿时渲染的 `fillSlot` 及其 `emptyDraft` 判定,删除 `slotAfterLast` 路径(末组之后的 16px 落槽);「首个组之前、相邻两组之间」的零高度落槽不变。落槽始终渲染,占位行出现与否都不影响它,6.2.1 里「按草稿判定否则逐帧卸载」的问题随之消失。
- `dnd-ids.ts`:`slot` 的 `DndItemData` 增加 `fill: boolean`;`dnd-collision.ts` 的 `isEligibleTarget('group', candidate)` 对 `candidate.kind === 'slot' && candidate.fill` 返回 true(其它落槽对组仍不可用);`keyboardStops` 规则不变(`current` 的槽跳过)。
- `drop-resolver.ts`:`over.kind === 'slot'` 且来源为 `group` 时,若该槽是 `fill` 则返回 `{ kind: 'root', position: over.position }`(即 `moveGroupTo` 到末尾),否则仍 null;通道与 AVAILABLE 来源的逻辑不变。`drag-preview.ts` 的 `previewFor` 对组来源 + root 目标已经走 `moveGroupTo`,无需改。
- 样式:`.view-channel-list > .root-slot--fill` 保持 `flex: 1 1 auto`,`min-height` 改为引用 `ROOT_SLOT_HEIGHT_PX`(通过内联 `style` 或 CSS 变量,二选一,不要再写死 `4rem`),列表溢出滚动时它只剩这个最小高度、仍可命中;虚线指示保持在槽的顶边,`is-over` 高亮不变。列表 `<ol>` 的 `min-height` / `flex: 1` 不变,空白区域就是它的剩余高度;`REMOVE_DRAG_THRESHOLD_PX` 以列表矩形为界的拖出移除不变,落槽在列表内部,两者不冲突。
- `RootSlot.tsx` 的 `fill` 变体 `data-root-slot-fill` 属性保留,布局 stub(`stub-layout.ts`)对 `root-slot--fill` 已给三行高的矩形,沿用。
- 语义确认(写进测试):末尾是空组时,落入常驻落槽即落在该空组**之后**,成为独立的无组行;末尾是非空组时同理落在组之后;末尾是无组行时等价于该行下半的落点。
- 测试:集成用例(鼠标)通道行拖到最后一个块下方明显远于一行高度、但仍在列表矩形内的位置松手 → 成为最后一行;AVAILABLE 条目同样位置 → 追加为末尾无组行且勾选框勾选;组头同样位置 → 整组移到末尾;末尾是空组时通道落在空组之后(与第 2 节共用一例即可)。键盘:从最后一行 `ArrowDown` 停在 `the end of the list`(读 `aria-live` 公告)且再 `ArrowDown` 不动;被拖行已是最后一块时该槽为 `current`,`ArrowDown` 不停在它上面。拖动结束后落槽消失。

### 4. 组色 AUTO 取成员类型众数

- `channel-colors.ts`:
  - 新增纯函数 `dominantChannelKind(kinds: readonly ChannelKind[]): ChannelKind | undefined` — 计数取最多者;平局取在 `kinds` 里**最先出现**的那个;空数组返回 undefined。
  - `groupAccent(group: ViewGroup | undefined): string` — `group.color` 有值取该色;否则 `channelTypeColor(dominantChannelKind(group.channels.map((c) => c.kind)) ?? 'channel')`。成员按**引用**的 `kind` 计,缺失成员同样计入(树未加载时颜色不抖);成员自己的覆盖色仍然忽略。
  - `channelAccent(kind, color, group)` — 去掉 `leadKind` 参数,其余不变。
- 删除全部「首个在场成员」计算:`view-resolver.ts` 的 `leadChannelKind`、`ChannelOrderList.tsx` 的 `groupLeadKinds`、`ViewDndContext.tsx` 的 `leadKindOf`、`SortableChannelRow` / `SortableGroupBlock` / `MissingChannelStrip` / `MixerPage` 的 `leadKind` / `groupLeadKind` 参数与 props。使用点不变:配置页行、组块、空组块、拖动克隆(行与组头)、混音页 `segmentAccent`、条带、缺失占位。
- 测试:`channel-colors.test.ts` 覆盖 `dominantChannelKind`(单一、多数、平局取先出现、空)与 `groupAccent`(覆盖色优先、众数、全缺失成员仍按类型计、无成员按输入色);集成:一个组含 1 个 main + 2 个 aux 时组头与 GRP 行的 `--channel-row-accent` 为 navy、混音页分组段 `--channel-accent` 同色;再把一个 aux 拖出组后变为 red(1 main + 1 aux 平局,main 先出现)。

### 5. 文档

- `docs/architecture.md` 按第 1–4 节更新,只描述当前状态:「View 与失配处理」的模型代码块换成 `items` 形状;「通道分组」删掉空组留在底部、`fill` 落槽按草稿判定、末组之后的落槽等描述,写明空组是有位置的块、末尾常驻落槽、组拖到空白区、FLIP 的自然位置测量与 dnd-kit `measuring`、`groupAccent(group)` 众数规则;「持久化」示例改为版本 2 并写一句版本 1 读取时迁移;「前端结构」若提到 `channels` / `groups` 一并改。
- 不改 `docs/development-plan.md`。

## 测试要求

- 单元测试与被测代码同目录,集成测试放 `apps/web/tests/`;新增集成用例按主题放进既有文件(拖放与落槽进 `settings-dnd.integration.test.tsx`,颜色进 `settings-palette.integration.test.tsx` 或 `settings-groups.integration.test.tsx`),不要再把 `views.integration.test.tsx` 撑大。
- 上述各节的测试项全部落地;既有测试只允许因模型改动改写夹具与断言的数据形状,断言意图不得删除。
- 覆盖率:`apps/web` ≥ 80%,`packages/shared` ≥ 90%,`apps/server` ≥ 80%,全部维持既有门槛。

## 明确不做的事

- 不引入 Motion、react-flip-toolkit、auto-animate 或任何动画库;不改 `FLIP_DURATION_MS` / `DROP_ANIMATION_MS` / `ROOT_SLOT_HEIGHT_PX` 等数值;不改补间模型(仍是 CSS transition + `ease-out`,不做速度或剩余时长的继承,不用 rAF 逐帧写 transform)。
- 不做 6.3–6.5 的任何内容(分页、页头压缩、`:hover` 媒体查询、`100dvh`、touch 数值调参、重连、soak)。
- 不给混音页渲染空组;不持久化折叠状态。
- 不让 `viewWriteBodySchema` 兼容版本 1 写入体;不改旧形状引用的迁移语义(只是搬到 `migrateAppConfig` 里)。
- 不引入新依赖;不改 CI;不改 `docs/development-plan.md`;不改 CONNECTION 面板。

## 验收自查

完成后逐条核对,在云端实际执行并记录结果:

1. FLIP:埋点冒烟修复前能复现、修复后每跨一行恰好一次提交与一次补间;单测覆盖无 transform 测量、在途不被触碰、再次推动时从当前视觉位置起步;droppable 矩形为自然位置 — 以测试与冒烟记录为证;观感 **移交用户**。
2. 模型:版本 1 → 2 迁移各分支;空组可移动、通道可落在空组前后;混音页与配置页在版本 2 下显示正确;服务端读旧文件后写回版本 2 — 以测试为证。
3. 落槽:通道、AVAILABLE、组头落到空白区都追加到末尾;末尾空组之后可落;键盘可达且 `current` 时跳过 — 以测试为证;手感 **移交用户**。
4. 组色:众数与平局规则;两个页面一致 — 以测试为证;观感 **移交用户**。
5. 全量质量门:串行 lint → typecheck → test → build 全绿,远端 CI 全绿,lockfile 无 diff。

## 执行报告要求

在 `docs/reports/phase-6-2-2-report.md` 产出执行报告(简体中文),章节与 `docs/reports/phase-6-2-1-report.md` 相同:结果总览、验收标准逐条核对(对上述五条)、实现摘要(每节一段,FLIP 一节附修复前后的埋点记录节选)、数值初值清单(本批次应为「无新增数值」,若有则列出)、真机验收操作清单(移交用户,含鼠标、触屏、键盘三条路径,并包含「用旧的 `data/config.json` 启动后 view 显示不变、保存一次后文件变为版本 2」这一条;**安全约束照抄 6.2.1 报告第 5 节**)、交付物清单、依赖清单(应为「无新增依赖,lockfile 无 diff」)、关键决策与偏离、被改写的既有用例清单、遗留问题与移交事项、提交记录。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤、复现不出的现象都要写明,不许美化。

## 完成定义

- 五项任务全部落地,测试要求全部满足。
- 云端串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,分支推送后远端 CI 全绿,`pnpm-lock.yaml` 无改动。
- `pnpm dev` + Mock Provider 浏览器冒烟通过(快速拖过多行的埋点对比、通道落到末尾空组之后、三种来源落到空白区、空组整体拖动、组色众数、用版本 1 配置文件启动后自动迁移)。
- 全部变更已按 Conventional Commits 提交。
- `docs/reports/phase-6-2-2-report.md` 已产出,真机验收清单可直接交用户执行。
