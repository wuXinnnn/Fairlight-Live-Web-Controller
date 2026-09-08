# Phase 6.2.1 执行报告 — 配置页 UX 补充

## 1. 结果总览

Phase 6.2.1 云端范围已全部完成:传感器由 `PointerSensor + TouchSensor` 改为 `MouseSensor + TouchSensor`(加 `KeyboardSensor`),触屏长按不再被指针传感器抢走;FLIP 列表下沉到 `ChannelOrderList` 并改为**每次提交测量、按渲染视图补间**,拖动期间占位行移动时被它挤开的行现在有补间,时长改为常量 `FLIP_DURATION_MS`(120ms)与 `DROP_ANIMATION_MS`(150ms),切换 view 跳过一次补间;配置页无条件渲染 CHANNEL ORDER 列表,草稿没有任何有序块时在列表末尾补一个吃掉剩余高度的根级落槽,新建 view 用鼠标或键盘都能拖入首个通道;分组可折叠/展开(编辑器 UI 状态,不入模型、不持久化),折叠组仍是投放容器且被预览进入时立即展开;`ViewGroup` 增加可选 `color`、通道引用的 `color` 增加 `'group'` 字面量,颜色解析集中到 `channel-colors.ts` 的 `groupAccent` / `channelAccent`,配置页与混音页共用,进出组的颜色转换由 `view-order.ts` 的 `colorForMembership` 统一处理。

最终 HEAD 串行 lint / typecheck / test(覆盖率门槛)/ build 全绿,远端 CI 亦全绿:web 273 项、server 142 项、shared 34 项、test-utils 22 项(本容器上并行跑四个包时,Phase 6.2 的一条既有用例会因负载间歇超时,在基线提交上同样复现,详见第 2 节与第 9 节)。`pnpm dev` + Mock Provider 的 Playwright 浏览器冒烟 5 组全部通过(空 view 拖入、拖动中补间与落下不叠加、Esc 回位补间、折叠组拖入自动展开、组色与 GROUP 行及混音页联动)。未新增任何依赖,`pnpm-lock.yaml` 无 diff,CI 流水线未改动。云端无法连接真实 Fairlight,触屏手感、动效观感与颜色观感按边界移交用户(第 5 节)。与提示词的偏离有三处(既有单测的必要更新、键盘拖放收敛的额外改动、`touch-action` 与容差语义的矛盾),见第 8 节。**用户真机验收后又提出三项呈现层面的调整(`GRP` 字样、行始终单行的响应式、Views 栏收窄),已在本分支完成,见第 12 节;第 2、4 节中与之相关的数字以第 12 节为准。**

## 2. 验收标准逐条核对

| 验收标准 | 结果 | 实际执行与输出摘要 |
| --- | --- | --- |
| 1. 传感器:鼠标 4px 起拖、触屏长按起拖且 8px 内抖动容忍、超过即取消 | 通过 | `ViewDndContext.tsx` 用 `MouseSensor({ distance: MOUSE_ACTIVATION_DISTANCE_PX })` 取代 `PointerSensor`,`TouchSensor` 与 `KeyboardSensor` 不变。`apps/web/tests/pointer-drag.ts` 改为 `mouseDown`(把手)/ `mouseMove` / `mouseUp`(document),既有「pointer sensor」describe 改名为「mouse sensor」,两个用例原样通过。新增 `apps/web/tests/touch-drag.ts` 与 `settings-dnd.integration.test.tsx` 的「touch sensor」describe 两例:`touchStart` 后推进 `TOUCH_ACTIVATION_DELAY_MS` 才出现 `.drag-overlay` 并完成一次落点正确的重排;延迟窗口内 `touchMove` 超过 8px 则不出现 overlay、列表顺序不变(两例都读常量,不写死毫秒数)。真机手感 **移交用户**。 |
| 2. 动画:拖动期间占位行移动时其它行有补间;落下无叠加;Esc 回位有补间;时长常量生效;切换 view 不飞行 | 通过 | `use-flip-list.ts` 改为无依赖数组的 `useLayoutEffect`(每次提交刷新基线),仅在 `dependency` 变化时补间;hook 挂在 `ChannelOrderList` 内、依赖为「渲染所用视图 + 折叠集合」,`capture()` / `skipNext()` 经 `useImperativeHandle` 交回 `SettingsPage`。被拖行与 AVAILABLE 占位行带 `data-flip-skip`,跟着指针而不是拖在后面。集成用例断言 `ArrowDown` 后被挤开的行收到 `translate(0px, 40px)` 且被拖行没有,Esc 后收到反向补间;另一例断言切换 view 不产生任何补间。浏览器冒烟见下。观感 **移交用户**。 |
| 3. 空列表:新建 view 后可从 AVAILABLE 拖入首个通道(键盘与鼠标);只有空分组时可落为无组行或落进空组 | 通过 | `SettingsPage` 无条件渲染 `ChannelOrderList`,`THIS VIEW HAS NO CHANNELS` 改为列表内的 `<li class="panel-empty">`。草稿 `nonEmptyBlocks` 为空时列表末尾渲染 `root-slot--fill`(`flex: 1`,吃掉剩余高度)。集成用例:键盘一次、鼠标一次拖入首个通道(文案消失、勾选框勾选、保存体正确);只有空分组的 view 里,拾起后先预览进空组,`ArrowDown` 移到落槽变为无组行,`ArrowUp` 又回到组内。 |
| 4. 折叠:按钮、`aria-expanded`、成员显隐、切换 view 重置、拖入自动展开、折叠态各控件可用 | 通过 | `settings-groups.integration.test.tsx` 6 例:折叠/展开切换 `aria-expanded` 与成员显隐(组头 `<nn> CH` 仍在)、空分组无折叠按钮、切换 view 后回来已展开、折叠态改名/箭头/`UNGROUP` 均可用且 `UNGROUP` 后成员原位显示、折叠组用组头把手整组移动、键盘拖入折叠组时立即展开并在落下后保持展开。 |
| 5. 颜色:schema、纯函数转换、解析、两个页面的显示、保存体 | 通过 | shared `config.test.ts` 新增一例(组色枚举、`'group'` 带组通过、组色不接受 `'group'`、通道色不接受未知键、无组 `'group'` 被拒且写入体同样被拒、旧形状迁移不受影响);`view-order.test.ts` 新增 5 个 describe(`colorForMembership` 六条规则 + 「必返回新对象」、四个入口的进出组转换、`setGroupColor`);`channel-colors.test.ts` 新增两例(组色有/无、`'group'` 有组/无组、lead 缺失);`view-dirty.test.ts` 新增组色变化为脏;`apps/server/src/api/views.test.ts` 新增一例(带组色与 `'group'` 色的 view 写入、读回、落盘且版本仍为 1;无组 `'group'` 色的 PUT 被 400 拒绝且不改已存数据);`settings-groups.integration.test.tsx` 新增 4 例(AUTO→GROUP→自定义→出组、拖出回到 AUTO、组色 AUTO 回落到首个成员类型色、混音页分组段与条带同色)。真机观感 **移交用户**。 |
| 6. 全量质量门:串行 lint → typecheck → test → build 全绿,远端 CI 全绿,lockfile 无 diff | 通过 | 最终 HEAD 串行全绿。覆盖率:`apps/web` 语句 96.52% / 分支 92.13% / 函数 98.68% / 行 96.44%(门槛 80%);`apps/server` 92.51% / 85.77% / 96.28% / 92.46%(门槛 80%);`packages/shared` 100% / 100% / 100% / 100%(门槛 90%);`packages/test-utils` 93.86% / 90.40% / 100% / 93.86%。未调低门槛、未新增排除项。**一处需说明**:在本容器上以完全并行的 `pnpm test`(四个包同时跑)加载较重时,Phase 6.2 的既有用例 `settings-dirty.integration.test.tsx > shows the three dirty indicators…` 会间歇性触发 vitest 的 5s 超时;单独跑 `apps/web` 连续三次全绿(273/273),并且**在本批次的基线提交 `c3ecab3` 上以同样方式复现同一条超时**(245/246),因此与本批次改动无关,见第 9 节。`git diff pnpm-lock.yaml` 为空;远端 GitHub Actions `CI` 在最终提交 `2569b16` 上 `success`(run #223,<https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/34241124725>),说明提交的 lockfile 可在无代理限制的 runner 上按 frozen 方式安装。 |

**端到端冒烟(`pnpm dev` + Mock Provider,Playwright 驱动预装 Chromium,视口 1400×900)**:Mock Provider 以仓库最新树 dump 运行于 `127.0.0.1:9100`,后端通过 `PUT /api/v1/connection` 指向该地址;脚本先用 REST 清空并新建一个空的 `Smoke` view。列表内所有 `[data-flip-key]` 元素的内联 `style` 写入由 MutationObserver 记录,`translate(` 计为 FLIP 反向补间、`translate3d` 计为 dnd-kit 让位动画。实际记录(云端 UTC):

```text
14:51:45 1 empty view renders the list: 1 list(s), 1 notice
14:51:46    overlay present: 1 ; fill slot present: 1 ; slot box: {"y":371.4,"height":458.0} ; list box: {"y":317.8,"height":511.6}
14:51:46 3 empty view drop: preview MIC -> dropped MIC ; notice gone: true ; checkbox checked: true
14:51:47    view now holds MIC,MIC-REVERB,BASS,Anagram-Wet,Anagram-Dry
14:51:48 2 during drag: {"total":33,"flip":8,"dndkit":0,"flipKeys":["MIC-REVERB","BASS"]}
14:51:48 2 on drop:     {"total":12,"flip":0,"dndkit":0,"flipKeys":[]} -> order MIC-REVERB,BASS,MIC,Anagram-Wet,Anagram-Dry
14:51:49 2 on Escape:   {"total":18,"flip":5,"dndkit":0,"flipKeys":["MIC-REVERB","BASS"]} -> order unchanged
14:51:50 4 group holds MIC-REVERB,BASS
14:51:50 5 first member palette: GROUP selected = true
14:51:50 5 group colour drives the GROUP row: #55b978 -> #9b6ac8
14:51:50 4 collapsed: members rendered = 0 ; header still shows count = 02 CH
14:51:51 4 dragged onto the closed header: expanded = true ; preview members MIC,MIC-REVERB,BASS
14:51:51 4 after drop: members MIC,MIC-REVERB,BASS ; still expanded = true
14:51:52 5 saved body: groups [{"name":"Rhythm","color":"purple"}] ; colours [["Anagram-Wet","-","auto"],["Anagram-Dry","-","auto"],["MIC","g","group"],["MIC-REVERB","g","group"],["BASS","g","group"]]
14:51:53 5 mixer group section accent #9b6ac8 ; strips ["#9b6ac8","#9b6ac8","#9b6ac8"]
```

**两套动效是否叠加**:拖动过程中只有 FLIP 的 `translate(` 写入(8 次,落在被占位行挤开的两行上),dnd-kit 的 `translate3d` 为 0——因为 `previewSortingStrategy` 恒返回 `null`、`transition: null`,`useSortable` 的 `transform` 始终是 `null`,React 因此从不写 `style.transform`,FLIP 的直接写入不会被覆盖。**落下那一次提交里 FLIP 与 dnd-kit 的写入都是 0**:预览的 DOM 顺序就是最终顺序,提交后行的位移为零,克隆的落下动画由 `DragOverlay` 单独播放,两者不叠加。因此 `onBeforeDrop = capture()` 予以保留(它此时等价于空操作,作为保险),没有改用 `skipNext()`。Esc 取消记录到 5 次反向补间,行平滑回位。冒烟脚本与 `playwright-core@1.52.0`(Apache-2.0)只在会话临时目录,不进入仓库。

## 3. 实现摘要

- **传感器**(`dnd-config.ts`、`ViewDndContext.tsx`):`POINTER_ACTIVATION_DISTANCE_PX` 更名为 `MOUSE_ACTIVATION_DISTANCE_PX`(值仍为 4),`PointerSensor` 换成 `MouseSensor`,`TouchSensor`(`TOUCH_ACTIVATION_DELAY_MS` / `TOUCH_ACTIVATION_TOLERANCE_PX`)与 `KeyboardSensor` 不变。三个常量的注释补全了含义与单位。窗口级指针追踪同时监听 `mousemove` 与 `pointermove`(以及 `touchmove`):`MouseSensor` 自身监听的是 `mousemove`,而 jsdom 只发 `mousemove` 不发 `pointermove`,只留 `pointermove` 会让 `pointerRef` 在集成测试里冻结在按下点,`dropHintFor` 的中线判定全部失效;两个监听写同一个坐标,幂等。`DragState.pointer` 的判定不变——`getEventCoordinates` 支持 MouseEvent,`MouseSensor` 的 `activatorEvent` 就是原生 `MouseEvent`。把手上的 `touch-action: none` 保留(见第 8 节)。
- **FLIP**(`use-flip-list.ts`、`ChannelOrderList.tsx`、`SettingsPage.tsx`):`useLayoutEffect` 去掉依赖数组,每次提交都测量并刷新基线,再用一个 ref 与 `dependency` 比对决定是否补间——行也会因与重排无关的原因移动(重名标记出现、清单解析完成、`saving` 变化),那些不该被当成重排,也不该留下过期基线。hook 从 `SettingsPage` 移到 `ChannelOrderList`(它才是渲染 `preview?.view ?? props.view` 的组件),依赖是 `useMemo(() => ({ view, collapsedGroupIds }))`,所以每次预览提交、每次草稿提交、每次折叠切换都会补间。`FlipListHandle` 经 `useImperativeHandle(flipRef, () => flip, [flip])` 交回页面,`onBeforeDrop` 调 `capture()`、`selectView` 先调 `skipNext()`。新增 `FLIP_DURATION_MS = 120`,`FLIP_TRANSITION` 直接用它,`FLIP_CLEANUP_FALLBACK_MS` 改为其 3 倍;`DROP_ANIMATION_MS = 150` 放 `dnd-config.ts`,`dropAnimationFor` 返回 `{ ...defaultDropAnimation, duration }`。被拖行(`isDragging`)与 `PlaceholderRow` 带 `data-flip-skip`,FLIP 跳过它们。**dnd-kit 默认就用 `getTransformAgnosticClientRect` 测量 droppable**(`inverseTransform` 只认 `matrix(` / `matrix3d(`,浏览器的 `getComputedStyle().transform` 正是这种形式),所以补间中的反向 transform 不会污染命中矩形,不需要额外的 `measuring` 配置。
- **空列表**(`SettingsPage.tsx`、`ChannelOrderList.tsx`、`RootSlot.tsx`、`styles.css`、`stub-layout.ts`):列表容器始终渲染;空态文案变成列表内的一行,按**渲染视图**判定,占位行一出现就消失。落槽按**草稿**判定是否渲染:若按预览视图判,占位行一出现视图就非空、槽随即卸载、指针落空、`available` 源的预览被清掉、视图又空——逐帧闪烁。落槽不是覆盖式的 16px 命中带而是真正占位的块(`flex: 1 1 auto`,`min-height: 4rem`),排在空组块之下吃掉剩余高度,`viewCollisionDetection` 的「slot 优先」因此不会把空组块吞掉。`.view-channel-list > li { flex: 0 0 auto }` 会盖过它,选择器要写成 `.view-channel-list > .root-slot--fill`(这一条是冒烟发现的,见第 10 节最后一个提交)。下游三条路径无需改动:`resolveDropTarget` 的 slot 分支在无有序块时 `0 > 0` 为假,`placeReference` 落到 `at = base.channels.length`,`keyboardStops` 只排除 `current` 的落槽而空态槽恒为 `false`。
- **折叠**(`SortableGroupBlock.tsx`、`SettingsPage.tsx`、`dnd-ids.ts`、`dnd-collision.ts`):`collapsedGroupIds: ReadonlySet<string>` 放在 `SettingsPage`,`selectView`、`UNGROUP` 与 `discardPending` 都会清理。组头把手之后是自绘 chevron 按钮(`aria-expanded`、展开时 `aria-controls` 指向成员 `<ol>`,可访问名 `Collapse group <name>` / `Expand group <name>`),空分组不渲染该按钮,拖动进行中禁用。折叠时成员**整体不渲染**(而不是 `hidden`:隐藏的行仍会注册零矩形的 droppable,`closestCenter` 会照样瞄准它),内嵌 `SortableContext` 一并跳过;组头保留全部控件,`<nn> CH` 由 `entries` 算出,组块加 `is-collapsed`。`groupzone` 的 `data` 增加**可选**的 `collapsed`(必填会逼着改 `dnd-collision.test.ts` 里 6 处既有字面量),`keyboardStops` 判 `data.empty || data.collapsed === true`。`syncPreview` 解析出 `{ kind: 'group' }` 且该组折叠时调 `onExpandGroup`,展开与预览在同一批提交,占位行不会被渲染进还关着的组;`DroppableRemeasure` 的 trigger 并入折叠集合,因为展开会改变下方所有块的几何而 `previewFor` 可能返回 `null`。
- **键盘拖放的收敛**(`ViewDndContext.tsx`,折叠功能暴露出来的必要修正):每次预览后行会重排,dnd-kit 会带着上一次方向键定下的落点重新做碰撞检测,那些额外的碰撞只是几何在安顿。`DragState` 增加 `step`,一次方向键只产生一次移动,同一步内的后续碰撞被 `syncPreview` 忽略;松手时只有当最后报告的 droppable 与预览所在的列表相同(只能微调位置)才走 `settlePreview`,否则直接提交预览。没有这两条,折叠组一展开,盖在组头上的根级落槽就会在同一步内把行拽回根列表。
- **颜色模型**(`packages/shared/src/config.ts`):`viewGroupSchema` 增加可选 `color: channelPaletteKeySchema`;新增 `viewChannelColorSchema = z.union([channelPaletteKeySchema, z.literal('group')])`,`viewChannelRefObjectSchema.color` 改用它;`checkViewGroups` 增加一条——`color === 'group'` 而 `groupId` 为空时在 `['channels', index, 'color']` 报 `Channel color "group" requires a group`。两个字段都是可选,配置版本仍为 1,旧形状迁移未动,旧数据不迁移。`apps/server` 用的是 shared schema,代码未改。
- **颜色解析与转换**(`channel-colors.ts`、`view-order.ts`):`groupAccent(group, leadKind)` 与 `channelAccent(kind, color, group, leadKind)` 取代了原先散在 `SortableGroupBlock`、`MixerPage.segmentAccent`、`ViewDndContext` overlay 三处的 lead 计算;`leadChannelKind(entries)` 放在 `view-resolver.ts` 供两个页面共用。`groupAccent` 刻意只看成员的**类型色**而不看成员自己的覆盖,否则跟随组色的成员会和组互相引用。`colorForMembership(reference, groupId)` 是唯一的转换点,由 `assignGroup`、`placeReference`(服务 `moveChannelTo` 与 `insertChannelAt`)、`removeGroup` 调用:进组时 `AUTO → 'group'`、出组时 `'group' → AUTO`、自定义色两个方向都保持、组内重排不变。它**永远返回新对象**——`drag-preview.ts` 的 `movedIndex` 用引用相等定位被拖项,返回原对象会让同组重排的预览算出 `-1`。私有的 `withoutGroup` 因此变成冗余,已删除。`view-dirty.ts` 的组比较加上 `color`。
- **颜色 UI**:通道行调色板在 `AUTO` 之后、色块之前插入 `GROUP` 按钮(仅在行属于某个组时渲染,按钮内是当前组色的色块,可访问名 `<name> use group color`);组头新增 `GROUP COLOR` 控件(`AUTO` + 6 色,可访问名 `Group <name> use automatic color` / `Group <name> color <Palette label>`),写入由新的纯函数 `setGroupColor(view, groupId, color?)` 完成。`onSetColor` 的签名扩为 `(index, color?: ViewChannelColor)`。组头 grid 由 7 列扩到 9 列(把手 / 折叠 / `G<nn>` / accent / 组名 / `<nn> CH` / 箭头 / `UNGROUP` / 调色板),窄屏 `@media` 与 `@container` 两处断点同步。`MixerPage.renderViewStrip` 与 `MissingChannelStrip` 接收 `group` 与 `groupLeadKind`,由 `renderViewSegment` 从段里派生;`ChannelOrderList` 用一次遍历建 `Map<groupId, ChannelKind>` 供行、组块共用。
- **测试基建**:新增 `apps/web/tests/touch-drag.ts`(jsdom 没有 `Touch` 构造器,但它的 `TouchEvent` 接受形状相符的普通对象,`getEventCoordinates` 能读出坐标;事件全部派发在把手上,因为 `TouchSensor` 的监听目标就是 `event.target`)与 `apps/web/tests/flip-writes.ts`(MutationObserver 记录 `style` 写入,断言补间时不必和释放反向 transform 的动画帧赛跑)。`stub-layout.ts` 增加空态槽(高 `3 * STUB_ROW_HEIGHT`,排在前面的块之下,中心低于所有 AVAILABLE 行,`ArrowDown` 才够得到)、`panel-empty` 行与折叠组(只有组头高度)三个分支。

## 4. 数值初值清单

| 常量 | 值 | 文件 | 用途 |
| --- | --- | --- | --- |
| `MOUSE_ACTIVATION_DISTANCE_PX` | 4 | `apps/web/src/features/settings/dnd-config.ts` | `MouseSensor` 激活距离(CSS px);由 `POINTER_ACTIVATION_DISTANCE_PX` 更名而来,值未变 |
| `TOUCH_ACTIVATION_DELAY_MS` | **150**(交付初值 250,用户真机调整,见第 10 节) | 同上 | `TouchSensor` 按压延迟(ms) |
| `TOUCH_ACTIVATION_TOLERANCE_PX` | 8 | 同上 | `TouchSensor` 按压期间容差(CSS px),6.4 调参 |
| `DROP_ANIMATION_MS` | **150**(新增) | 同上 | `DragOverlay` 落下动画时长 |
| `FLIP_DURATION_MS` | **120**(新增) | `apps/web/src/features/settings/use-flip-list.ts` | 行位移补间时长;`FLIP_TRANSITION` 直接用它,不再挂 `--motion-medium` |
| `FLIP_CLEANUP_FALLBACK_MS` | `FLIP_DURATION_MS * 3` = 360 | 同上 | `transitionend` 未触发时清理内联样式的兜底(原为写死的 600) |
| `FLIP_MIN_SHIFT_PX` | 1 | 同上 | 小于该位移不补间(未改) |
| `REMOVE_DRAG_THRESHOLD_PX` | 64 | `dnd-config.ts` | 拖出移除阈值(未改) |
| `AUTO_SCROLL_EDGE_PX` / `AUTO_SCROLL_MAX_STEP_PX` / `AUTO_SCROLL_REMEASURE_MS` | 48 / 12 / 50 | 同上 | 列表边缘自动滚动(未改) |
| `ROOT_SLOT_HEIGHT_PX` | 16 | 同上 | 分组边界处覆盖式落槽的命中带高度(未改;空态落槽不用它,改为 `flex: 1` + `min-height: 4rem`) |
| 空态落槽 `min-height` | `4rem` | `apps/web/src/styles.css`(`.view-channel-list > .root-slot--fill`) | 列表很矮时落槽仍有可点面积 |
| 键盘方向判定阈值 | 0.5 | `dnd-collision.ts` | 未改 |
| `STUB_FILL_SLOT_HEIGHT` | `3 * STUB_ROW_HEIGHT` = 120 | `apps/web/tests/stub-layout.ts` | 仅测试用:空态落槽的 stub 高度 |

## 5. 真机验收操作清单(移交用户)

**安全约束**:配置页只改 view 配置(`data/config.json` 的 `views`),拖放、勾选、分组、折叠、改色与保存不会改动 Fairlight 任何参数;验收过程中不要操作混音页推子;如确需操作,只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子并测后复原;不得切 ON/mute、不得动其它通道、不得删改任何通道。

启动:仓库根目录 `pnpm install --frozen-lockfile`(本地不受 codeload 限制)→ `pnpm dev`(server 3000 + web 5173)→ 浏览器打开 `http://localhost:5173`,确认页头 `MIXER ONLINE`。建议新建一个名为 `UX Check` 的临时 view 做验收,结束后删除。

鼠标路径(桌面浏览器):

1. `CONFIGURE VIEWS` → 左侧 `NEW VIEW` 输入 `UX Check` → `ADD`。预期:右侧 CHANNEL ORDER 里出现 `THIS VIEW HAS NO CHANNELS`,但这次它是**列表内的一行**而不是替换整个列表。
2. 从左侧 AVAILABLE CHANNELS 按住一个未勾选通道的把手,拖到右侧列表的空白处松开。预期:一进入列表就出现虚线描边的占位行、空态文案消失;松手后通道成为唯一一行,左侧勾选框同步勾选。**这是 6.2 无法做到的**。
3. 再勾选 4 个通道 → `SAVE VIEW`。按住第 1 行把手向下拖过第 2、3 行。预期:**被占位行挤开的行现在是平滑滑动而不是瞬间换位**,大约 120ms;松手瞬间行不再二次移动,克隆用约 150ms 飞入目标行。若嫌快/慢,`FLIP_DURATION_MS`(`use-flip-list.ts`)与 `DROP_ANIMATION_MS`(`dnd-config.ts`)是两个可调的初值。
4. 重复第 3 步但中途按 Esc。预期:占位消失、被挤开的行平滑回到原位。
5. 在左侧 view 列表里来回点两个 view。预期:两个 view 里名字相同的行**不会横飞**,直接就位。
6. `NEW GROUP` 输入 `Rhythm` → `ADD GROUP`,用 `GROUP` 下拉把两三个通道放进去。预期:进组的行调色板里多出一个 `GROUP` 按钮并自动选中,按钮里的色块是当前组色。
7. 点组头把手右边的箭头折叠该组。预期:成员收起,组头保留把手、`G01`、组名、`<nn> CH`、箭头、`UNGROUP` 与 `GROUP COLOR`;下方各行平滑上移。再点一次展开。
8. 折叠该组,然后从列表里拖一个无组行到折叠的组头上。预期:**组立即展开**并显示占位行落在组首或组尾(按指针在组头上半/下半),松手后落在该处且组保持展开。
9. 折叠该组后分别试:改组名、点箭头整组上下移、按住组头把手整组拖动、点 `UNGROUP`。预期:都照常工作;`UNGROUP` 后成员原位变成无组行并显示出来。
10. 组头 `GROUP COLOR` 里点一个颜色。预期:组头描边、组块左侧竖条,以及所有选了 `GROUP` 的成员行同时变色;选 `AUTO` 则回到「首个在场成员的类型色」。
11. 给某个成员行手动点一个色块。预期:该行不再跟随组色;把它拖出组再拖回来,颜色始终保持。相对地,一个选了 `GROUP` 的行拖出组后应自动回到 `AUTO`。
12. `SAVE VIEW` 后回到混音页并切到该 view。预期:分组段标题的颜色与配置页组色一致,段内跟随组色的通道条同色。
13. 若系统开启「减弱动态效果」,重复第 3、7 步。预期:无补间,直接到位。

触屏路径(平板;**本批次的重点**,手感数值调参仍属 6.4):

1. 用手指在列表空白处上下滑动。预期:页面/列表正常滚动。
2. 手指按在某行把手上**不动**约 `TOUCH_ACTIVATION_DELAY_MS`(当前 150ms)直到该行变半透明,再拖到目标位置松开。预期:能起拖,落点语义与鼠标相同。**6.2 上这一步是做不到的**(指针传感器抢先接管)。
3. 手指按在把手上后**立刻**滑动(超过约 8px)。预期:不起拖。注意:把手上有 `touch-action: none`,所以这一下也不会滚动列表——手势相当于被丢弃(见第 8 节);请记录这是否影响手感。
4. 长按组头把手整组移动;从左侧长按可用通道把手拖入右侧;长按折叠组的组头拖一个通道进去。
5. 记录:按压延迟与 8px 容差是否合适(`dnd-config.ts` 的 `TOUCH_ACTIVATION_DELAY_MS` / `TOUCH_ACTIVATION_TOLERANCE_PX`),留给 6.4 调整。

键盘路径(桌面浏览器):

1. Tab 到某行把手,Space 拾起,↓/↑ 逐个目标移动,Space 放下,Esc 取消。预期:**一次方向键只移动一次**,不会按下后又自己跳到别处;被挤开的行有补间。
2. 折叠一个组,Tab 到某个无组行的把手,Space 拾起后用方向键移到该折叠组。预期:组立即展开、占位行进入组内;再按 Space 落下。
3. 新建一个空 view,Tab 到左侧未勾选通道的把手,Space 拾起,↓ 进入右侧列表,Space 放下。预期:通道成为首行。

## 6. 交付物清单

| 路径 | 用途 |
| --- | --- |
| `packages/shared/src/config.ts` / `config.test.ts` / `index.ts` | `viewChannelColorSchema`、`ViewGroup.color`、`checkViewGroups` 的 `'group'` 校验与新增用例 |
| `apps/server/src/api/views.test.ts` | 组色与 `'group'` 色的写入/读回/落盘,以及无组 `'group'` 被 400 拒绝 |
| `apps/web/src/features/mixer/channel-colors.ts` / `channel-colors.test.ts` | `groupAccent`、`channelAccent` 与用例 |
| `apps/web/src/features/mixer/view-resolver.ts` | 新增 `leadChannelKind` |
| `apps/web/src/features/mixer/MixerPage.tsx`、`MissingChannelStrip.tsx` | 分组段与通道条改用共用解析,接收 `group` 与 `groupLeadKind` |
| `apps/web/src/features/settings/dnd-config.ts` | `MOUSE_ACTIVATION_DISTANCE_PX` 更名、新增 `DROP_ANIMATION_MS` |
| `apps/web/src/features/settings/ViewDndContext.tsx` | `MouseSensor`、`mousemove` 追踪、折叠自动展开、键盘一步一动与落点结算、overlay 颜色 |
| `apps/web/src/features/settings/use-flip-list.ts` | 每次提交测量、按依赖补间、`FLIP_DURATION_MS`、`data-flip-skip` |
| `apps/web/src/features/settings/ChannelOrderList.tsx` | FLIP 挂载点、空态文案与落槽、折叠与颜色的下发、lead kind 映射 |
| `apps/web/src/features/settings/SettingsPage.tsx` | 无条件渲染列表、`collapsedGroupIds`、`flipRef`、`setGroupColor` 接线 |
| `apps/web/src/features/settings/SortableGroupBlock.tsx` | 折叠按钮、折叠渲染、`GROUP COLOR`、`groupzone` 的 `collapsed` |
| `apps/web/src/features/settings/SortableChannelRow.tsx` | `GROUP` 调色板按钮与新的解析 |
| `apps/web/src/features/settings/RootSlot.tsx` | `fill` 变体 |
| `apps/web/src/features/settings/view-order.ts` / `view-order.test.ts` | `colorForMembership`、`setGroupColor`、四个入口接线与用例 |
| `apps/web/src/features/settings/view-dirty.ts` / `view-dirty.test.ts` | 组色纳入脏检测 |
| `apps/web/src/features/settings/dnd-ids.ts`、`dnd-collision.ts` | `groupzone.collapsed` 与 `keyboardStops` |
| `apps/web/src/features/settings/drag-preview.ts` / `drag-preview.test.ts` | `dropAnimationFor` 带时长 |
| `apps/web/src/features/settings/PlaceholderRow.tsx` | `data-flip-skip` |
| `apps/web/src/styles.css` | 折叠按钮、组头 9 列与两处窄屏断点、空态落槽、列表内空态行、组头调色板 |
| `apps/web/tests/pointer-drag.ts` | 改为驱动 `MouseSensor` |
| `apps/web/tests/touch-drag.ts` | 新增:驱动 `TouchSensor` |
| `apps/web/tests/flip-writes.ts` | 新增:记录 FLIP 的 style 写入 |
| `apps/web/tests/stub-layout.ts` | 空态落槽、空态行、折叠组三个布局分支 |
| `apps/web/tests/settings-dnd.integration.test.tsx` | 传感器改名 + 触屏 2 例、FLIP 2 例、空 view 3 例 |
| `apps/web/tests/settings-groups.integration.test.tsx` | 新增:折叠 6 例 + 颜色 4 例(第 12 节再补 `GRP` 字样一条断言) |
| `apps/web/src/features/settings/PaletteControl.tsx` | 第 12 节新增:按钮排与下拉菜单两套形态共用的调色控件 |
| `apps/web/tests/settings-palette.integration.test.tsx` | 第 12 节新增:下拉菜单写入行色与组色 3 例 |
| `docs/architecture.md` | 传感器、FLIP、空态落槽、折叠、键盘收敛、颜色模型与持久化示例 |
| `docs/reports/phase-6-2-1-report.md` | 本报告 |

## 7. 依赖清单与许可确认

**无新增依赖,`pnpm-lock.yaml` 无 diff**(`git diff pnpm-lock.yaml` 为空)。`apps/web/package.json` 未改。

云端安装说明(与 6.2 相同,代理仍拒绝 `codeload.github.com`,实测返回 403):备份 lockfile → `git clone` 取得 `evs-broadcast/node-asn1@0146823` 并 `npm pack` 成本地 tarball → 临时把 lockfile 中的 asn1 条目改为 `file:` 路径完成 `pnpm install` → 用备份覆盖回 lockfile;本会话用 `pnpm_config_verify_deps_before_run=false` 关掉 pnpm 11 在跑脚本前的依赖校验。提交的 lockfile 无任何本地路径,远端 CI 以 `pnpm install --frozen-lockfile` 安装成功即为佐证。冒烟用的 `playwright-core@1.52.0`(Apache-2.0)与 Mock Provider 启动脚本只在会话临时目录,不进入仓库。

## 8. 关键决策与偏离

- **既有单测被更新了 9 处断言**(偏离「`view-order.ts` 既有单测不得删改」)。第 5 节要求的 AUTO → GROUP 转换直接改变了 `assignGroup` / `moveChannelTo` / `insertChannelAt` 的返回值,而既有用例用 `toEqual` 断言完整的引用对象,两条要求在此互斥。处理方式是**只补上新出现的 `color` 字段**,不动任何输入夹具、不删任何用例:`view-order.test.ts` 6 处(新增一个 `joined(name, groupId)` 助手表达「刚进组的引用」)、`drag-preview.test.ts` 1 处、`settings-dnd.integration.test.tsx` 4 处保存体、`settings-groups.integration.test.tsx` 1 处。另外 `drag-preview.test.ts` 的 `dropAnimationFor` 断言由 `toBe(defaultDropAnimation)`(引用相等)改为 `toEqual({ ...defaultDropAnimation, duration: DROP_ANIMATION_MS })`,这是第 2 节「返回带该时长的配置」的必然结果。
- **键盘拖放增加了「一次方向键一次移动」与「同列表才结算」两条规则**(超出提示词范围的必要修正)。折叠组自动展开后,盖在组头上的根级落槽会在同一步内赢下碰撞,把刚进组的行拽回根列表。根因是每次预览后行会重排、dnd-kit 带着上一次方向键的落点重跑碰撞检测,这类「几何在安顿」的碰撞不是新的意图。先尝试过两种更窄的修法——把落槽标成 `current` 让键盘跳过它,以及落下时一律提交预览——前者破坏了「成员向下落到组间落槽以脱组」的既有用例,后者破坏了「行进组后落下要按 over 行细化位置」的既有用例;最终规则两者都保住,全部既有用例通过。
- **FLIP 保留 `capture()` 而不是改用 `skipNext()`**:冒烟记录显示落下那一次提交里 FLIP 与 dnd-kit 的 style 写入都是 0,本来就不叠加,`capture()` 此时等价于空操作,作为保险留下。
- **不需要给 `DndContext` 配 `measuring`**:担心过 FLIP 的反向 transform 污染 droppable 矩形,但 dnd-kit 6.3.1 的 droppable 默认测量就是 `getTransformAgnosticClientRect`,且 `parseTransform` 只认 `matrix(` / `matrix3d(`——浏览器 `getComputedStyle().transform` 正是这种形式(会被正确扣除),jsdom 返回的是内联原文(不匹配,布局 stub 的矩形不受影响)。两边都对,遂不改。
- **空态落槽做成占位块而不是覆盖式命中带**:`viewCollisionDetection` 的「slot 优先」是无条件的,覆盖整个空态区域的落槽会把 `EmptyGroupBlock` 全部吞掉,规格自身要求的「只有空分组时也能落进空组」就无法实现。
- **空态落槽按草稿而非预览视图判定**:按预览判会造成占位行出现 → 槽卸载 → 指针落空 → 预览被清 → 视图又空的逐帧循环。
- **`groupzone` 的 `collapsed` 是可选字段**:`dnd-collision.test.ts` 有 6 处 `groupzone` 字面量,必填会逼着改既有测试。
- **窗口级指针追踪同时留 `mousemove` 与 `pointermove`**:真实浏览器两者都会触发(写同一个坐标,幂等),jsdom 只有 `mousemove`。只留 `pointermove` 会让所有鼠标集成用例的中线判定静默失效。
- **`MouseSensor` 的按键过滤比 `PointerSensor` 宽**:前者只拒绝 `button === 2`(右键),后者要求 `isPrimary && button === 0`,所以中键按下也能起拖。未做额外限制,记录在此。
- **把手上的 `touch-action: none` 与 8px 容差在语义上互相矛盾**:容差的本意是「这是滚动不是拖动」,但 `touch-action: none` 让浏览器根本不会滚动这一下,取消后手势相当于被丢弃。提示词明确要求保留该样式,故未改动,列入第 9 节移交用户判断(属 6.4 触屏审计范围)。
- **`aria-controls` 只在展开时给出**:折叠时成员 `<ol>` 已卸载,指向不存在的 id 会被无障碍检查工具报错。
- **覆盖率排除项**:无。未调门槛。

## 9. 遗留问题与移交事项

- **用户需完成第 5 节真机验收**,重点是触屏长按起拖(本批次的核心修正)、拖动中的行补间观感与 120ms / 150ms 两个时长、颜色在两个页面是否一致。
- **留给 6.4**:`TOUCH_ACTIVATION_DELAY_MS` 已由用户在真机上调为 150(见第 10 节),`TOUCH_ACTIVATION_TOLERANCE_PX` 的调参仍属 6.4;上面提到的 `touch-action: none` 与容差语义矛盾一并在 6.4 处理;把手 `:hover` 样式待包进 `@media (hover: hover)`;新增的 `.group-collapse:hover` 同理。
- **留给 6.3**:组头现在有 9 列(把手、折叠、序号、accent、组名、计数、箭头、`UNGROUP`、`GROUP COLOR`),窄屏排布已同步两处断点,但页头压缩时需一并复核。
- **键盘路径的已知限制**(6.2 已记录,本批次未变):键盘落下恒为「落在 over 行之前」,要把通道放到某组末尾仍需先落入组内再用箭头或 `GROUP` 下拉。
- **旧数据的颜色升级**:已保存的旧 view 里组内没有颜色的引用不做批量迁移,但它**跨组移动或移出组一次后**会按规则升级为 `'group'` / `AUTO`,表现为一次「看起来没动却变脏」的编辑。这是规则作用于它,不是迁移;已在 `docs/architecture.md` 与 `view-order.test.ts` 中写明。
- **一条既有用例在高并发下会超时(非本批次引入)**:`apps/web/tests/settings-dirty.integration.test.tsx` 的 `shows the three dirty indicators until a save succeeds and keeps them when it fails` 在本容器上以 `pnpm test` 同时跑四个包时约 5.0–5.5s 触发 vitest 默认的 5s 超时。证据:(1) `pnpm --filter @flwc/web test` 单独跑连续三次 273/273 全绿;(2) 在本批次基线提交 `c3ecab3` 上执行同一条 `pnpm test`,同一条用例以同样方式失败(245/246);(3) 远端 CI 在 `132cdbd` 与 `2569b16` 两次 `success`。故判定为该用例本身对机器负载敏感,未在本批次中修改它(它属 6.2 且提示词要求既有测试不得删改)。若后续频繁困扰,可给该用例单独放宽 `testTimeout`,由用户决定。
- **建议回写文档**:无踩坑类条目需要写入 `docs/fairlight-ember.md`;本批次架构变化已写入 `docs/architecture.md`。
- **`docs/development-plan.md` 的 6.2 与 6.2.1 验收框未勾选**,由用户在真机验收后处理。

## 10. 评审后的修订

**Cursor Bugbot(`2f399af`,1 条 Low)**:*Collapsed state survives empty groups* —— `collapsedGroupIds` 只在切换 view、`DISCARD` 与 `UNGROUP` 时清理,用 AVAILABLE 勾选框或 `CLEAR INVALID` 把一个折叠中的组清空后,组 id 仍留在集合里;之后再用 `GROUP` 下拉把通道放回该组,组会以折叠态渲染,新成员被卸载、看不见。

已复现并确认属实,且范围比报告的更宽:拖走最后一个成员、`GROUP` 下拉把最后一个成员移走,同样会留下过期 id。修法没有逐个路径打补丁(那需要动五处,且以后每加一条编辑路径都要记得),而是补上通往组内的另一条路:`handleAssignGroup` 在通道进入某个组时先 `expandGroup(groupId)`,与拖放里「占位行预览进折叠组即展开」同一条规则。两条入组路径(下拉、拖放)都保证「放进去的东西看得见」,过期 id 因此再也无法生效——空组本身不显示折叠按钮,所以没有别的控件能让它以折叠态复活。顺带修掉了 Bugbot 没提的一种情形:直接用下拉把通道放进一个折叠的组,原本也会被藏起来。

回归用例 `settings-groups.integration.test.tsx > does not fold a group shut again after it has been emptied and refilled`:折叠 → 用勾选框清空 → 下拉放回一个通道 → 断言成员可见且 `aria-expanded="true"`。移除该修复后用例失败(`[]` vs `['FX']`),加回后通过。

> 中途试过在 `SettingsPage` 用 `useEffect` 把折叠集合按草稿裁剪(「没有成员的组不可折叠」),被 `react-hooks/set-state-in-effect` 拒绝——该规则是对的,这里本来就不需要 effect。最终的入组即展开既符合 lint,也与既有语义一致。

**真机调参(`bb029d9`,用户提交)**:用户在平板上验收后把 `TOUCH_ACTIVATION_DELAY_MS` 由交付初值 250 调整为 **150**,这正是第 5 节第 2、5 步与第 9 节留给真机的那项调参;调整理由由用户掌握,此处只记录结果。`TOUCH_ACTIVATION_TOLERANCE_PX` 维持 8。两个触屏用例读的是常量而非字面量,改值后无需改测试;该 head 上 `ci` ×2 与 Cursor Bugbot 均为 success。第 4 节的表已同步为当前值。

## 11. 提交记录

分支 `claude/phase-6-2-1-4pm0av`(基于 `c3ecab3 docs: add the Phase 6.2.1 follow-up batch and its execution prompt`),本批次新增提交:

```text
2f399af docs: record the pre-existing timeout seen under a parallel test run
4433ea1 docs: add the Phase 6.2.1 execution report
2569b16 fix(web): let the empty-view drop slot take the space the list has left
132cdbd feat: give groups a colour and let channels follow it
d21cd31 feat(web): collapse and expand groups in the view editor
2b0a6a6 feat(web): let an empty view accept the first dragged channel
3170af4 feat(web): animate the settings list during drag previews and speed it up
c796a62 refactor(web): drive settings drag and drop with mouse and touch sensors
```

评审后追加(第 10 节):`fix(web): reveal a group when a channel is assigned into it`,以及用户的真机调参提交 `adjust(web): DnD Touch Delay`。

不含本报告本身,合计 34 个文件、+1626 / −186 行。

## 12. 真机验收后的 UX 调整

用户在平板上验收后提出三项呈现层面的修正,都在本分支上完成,不涉及数据模型、拖放语义与服务端。

### 12.1 `GRP` 字样取代色块

组内通道行的「跟随组色」按钮原先画一个组色色块。组色一旦取自那六个调色板颜色之一,这个色块就与右边某一个完全一样,屏幕上出现两个同色方块,分不出哪个是「跟随」哪个是「选定」。改为显示缩写字样 `GRP`(与 `AUTO` 同样式),颜色本身由行左侧的 accent 条呈现。`aria-label`(`<name> use group color`)与 `title`(`Group <name>`)一字未改,既有 6 处断言原样通过;新增断言:该按钮文本为 `GRP` 且不再渲染色块 `<span>`。

### 12.2 行始终单行 + 两档响应式

`.channel-order` 原来的窄屏规则(`@container (max-width: 44rem)`)本身就是「窄了就把调色板换到第二行」,平板横屏(1024×768)时该列约 31.6rem,必然触发。现改为按代价从小到大让出宽度:

| 档 | 触发 | 让出的东西 |
| --- | --- | --- |
| 1 | 默认 | —— 通道名列 `minmax(7rem, 1fr)`,调色板是按钮排 |
| 2 | 容器 ≤ **42rem** | 去掉通道名列的 7rem 下限(名字本来就带省略号),行内 `gap` 0.65→0.45rem、左右 `padding` 0.7→0.5rem |
| 3 | 容器 ≤ **34rem** | 隐藏 6 个色块改用下拉菜单;隐藏 `GROUP` 下拉前面的字样(`<select>` 自带可访问名) |

两个阈值是**实测**的,不是算出来的:在 Chromium 里把行钉在某一形态上、从 1600px 起每 4px 缩窄视口,记录该形态第一次「高度超过一行或内容溢出行宽」的位置——形态 1 撑到 40.13rem 的列宽,形态 2 撑到 32.71rem;阈值取在其上(42 / 34),保证换挡时上一形态仍然放得下,不会出现两档之间的空隙。

实现按用户选定的方案:按钮排与 `<select>` **两套控件始终都渲染**,由容器查询 `display: none` 只显示一套。浏览器里被 `display: none` 的那套不进无障碍树、也不是栅格项,所以栅格列定义不用为第三档改动;切换不需要 `ResizeObserver`、不引入状态、拖动中不会重排。两处调色板因此抽成共用的 `PaletteControl.tsx`,可访问名仍由调用方构造,菜单另取 `<name> color menu` / `Group <name> color menu` 以免与按钮重名。jsdom 不求值容器查询,两套在测试里都在 DOM 中:既有用例查的是 button 角色,新增的 `settings-palette.integration.test.tsx` 查 `combobox`,互不干扰。

**一并删除**了 `@media (max-width: 800px)` 里 `.channel-order-row` / `.group-control` / `.palette-control` / `.view-group__header` 的四组换行覆写。它们不是无害的残留:视口 <800px 时两列堆叠、`.channel-order` 反而变宽到 46.5rem,新的容器档位都不触发,于是这些规则仍然生效并把行折成 85px(组头 120px)。删掉后由两档统一接管,手机宽度同样单行。

### 12.3 Views 栏流式收窄

`.settings-workbench` 的第一列由 `minmax(17rem, 21rem)` 改为 `minmax(0, clamp(12rem, 20vw, 21rem))`,随视口连续收窄而不需要断点;视口 ≤1200px 时该列已到 15rem 以下,再压缩 `.view-index` 的内边距、`NEW VIEW` 表单外边距与条目行的 `padding` / `gap`(用 `@media` 而非 `@container`——容器查询无法给它所询问的那个容器本身设样式)。实测宽度:1920px → 336px、1366px → 273px、1280px → 256px、1024px → 205px、≤960px → 192px。这一项同时给编辑区让出约 130px,是 12.2 能在平板横屏上做到单行的前提之一。

### 12.4 验证

质量门:`pnpm lint` / `typecheck` / `test` / `build` 串行全绿。测试 web 277(新增 3 项 + 1 条断言)、server 142、shared 34、test-utils 22;覆盖率 web 96.72% / 92.22% / 99.18% / 96.64%,server 92.51% / 85.77%,shared 100%,均未调低门槛、未新增排除项;`git diff pnpm-lock.yaml` 为空。本轮四个包并行的 `pnpm test` 里,第 9 节记录的那条既有超时用例未复现。

浏览器实测(`pnpm dev` + Mock Provider + Playwright 驱动预装 Chromium):

```text
# 视口从 1600px 每 20px 缩到 360px,共 69 个宽度,外加 1366/1180/1024/820/768/390
widths swept: 69 ; wrapping or overflowing: 0
1920x1080  views 336px   order 63.89rem  rows [54] headers [50]  buttons=true  menu=false
1366x1024  views 273.2px order 43.17rem  rows [54] headers [50]  buttons=true  menu=false
1280x800   views 256px   order 40.27rem  rows [54] headers [50]  buttons=true  menu=false
1180x820   views 236px   order 36.89rem  rows [54] headers [50]  buttons=true  menu=false
1024x768   views 204.8px order 31.63rem  rows [54] headers [50]  buttons=false menu=true
768x1024   views 768px   order 46.50rem  rows [54] headers [50]  buttons=true  menu=false
390x844    views 390px   order 22.88rem  rows [54] headers [50]  buttons=false menu=true
```

每一档都只有一套调色控件可见,行高恒为 54px、组头恒为 50px(单行),无横向溢出。第 2 节的五组冒烟在 1400×900 上重跑全部通过;另在 **1024×768** 上重跑一遍拖放相关的部分,确认第三档下几何未受影响:

```text
palette shape: buttons visible = false ; menu visible = true ; every row on one line = true
during drag: {"total":45,"flip":13,"dndkit":0,"flipKeys":["MIC-REVERB","BASS"]} ; one line = true
on drop:     {"total":12,"flip":0,"dndkit":0} -> order MIC-REVERB,BASS,MIC,Anagram-Wet,Anagram-Dry
row menu follows the group: group
group colour through the menu: #55b978 -> #9b6ac8
dragged onto the closed header: expanded = true ; preview members MIC,MIC-REVERB,BASS ; one line = true
saved: groups [["Rhythm","purple"]] ; colours [...,["MIC","g","group"],["MIC-REVERB","g","group"],["BASS","g","group"]]
```

**观感与手感仍由用户在平板上验收**:`GRP` 是否比色块清楚、两个阈值换挡的位置是否合适、下拉菜单在触屏上是否好按、Views 栏收窄后是否仍够用。

### 12.5 本节提交

```text
docs: align the report with the tuned touch delay
feat(web): label the group colour choice GRP instead of a swatch
refactor(web): share one palette control between rows and group headers
feat(web): let the views column narrow with the viewport
feat(web): keep settings rows on one line as the column narrows
```
