# Phase 6.2 执行报告 — 配置页 UX

## 1. 结果总览

Phase 6.2 云端范围已全部完成:配置页引入 dnd-kit 拖放编排(通道行重排、进组/出组、整组移动、空分组投放、从 AVAILABLE CHANNELS 拖入,指针/触屏/键盘三种传感器同时启用),`view-order.ts` 新增 `moveChannelTo` / `insertChannelAt` / `moveGroupTo` 三个纯函数;自写 FLIP hook 取代原有 `data-moved` 单行动画,覆盖箭头移动、编组/脱组、`UNGROUP`、整组移动、勾选加入/移除、`CLEAR INVALID` 与拖放落下;未保存改动保护落地(`isViewDirty` 结构比较、三处脏态提示、四条丢失路径统一走 `pendingAction` 弹出自绘 `UNSAVED CHANGES` 对话框、路由守卫拦截浏览器后退、`beforeunload`)。最终 HEAD 串行 lint / typecheck / test(覆盖率门槛)/ build 全绿,`pnpm dev` + Mock Provider 的 Playwright 浏览器冒烟 11 步全部通过(鼠标拖放五种语义、FLIP、脏态提示、`MIXER` 与浏览器后退弹窗、`KEEP EDITING` / `DISCARD`、键盘拾起/移动/放下/Esc)。数据模型、后端、CI 流水线均未改动。云端无法连接真实 Fairlight,鼠标与触屏手感、位移动效有无抖动闪烁按边界移交用户(第 5 节)。与提示词的偏离有两处(键盘坐标函数、FLIP 在落下时的基线策略),见第 8 节。

## 2. 验收标准逐条核对

| 验收标准 | 结果 | 实际执行与输出摘要 |
| --- | --- | --- |
| 单测覆盖:`moveChannelTo` / `insertChannelAt` / `moveGroupTo` 的边界、`isViewDirty`、导航守卫的允许/拒绝/后退回退 | 通过 | `apps/web/src/features/settings/view-order.test.ts` 新增 4 个 describe(单行↔单行、进组首/中/尾、组内前后、组尾拖出、跨组、进空组、唯一成员离组、原位/越界/未知组返回 null、`groupId` 键不残留、入参不变、连续性不变量 `expectContiguousGroups`;`insertChannelAt` 根首/中/尾、进组、进空组、三字段全等返回 null、同名不同 `channelId` 允许;`moveGroupTo` 首/尾/中、原位、空组、未知组、越界);`view-dirty.test.ts` 6 例(相同、改名、顺序/增删、`groupId` 与 `color` 变化、缺键与 `undefined` 相等、组改名/增删/换序);`lib/router.test.ts` 新增 6 例(无订阅者重读 URL、守卫放行且当前路由不询问、拒绝 `navigate` 时 history 不变且不通知、`popstate` 被拒调用 `history.forward()` 一次且 `useRoute()` 保持 `views`、放行的 `popstate` 更新缓存、置 null 恢复)。另有 `drop-resolver.test.ts`、`dnd-collision.test.ts`、`dnd-ids.test.ts`、`row-keys.test.ts`、`use-flip-list.test.tsx`、`DiscardChangesDialog.test.tsx`。`pnpm --filter @flwc/web test`:34 → 41 个文件、147 → 215 项全部通过。 |
| 集成测试(键盘传感器):拖放重排、编组与脱组、整组移动、从可用通道拖入;脏态三处提示;四条丢失路径都弹出确认并且 DISCARD / KEEP EDITING 行为正确 | 通过 | `apps/web/tests/settings-dnd.integration.test.tsx` 8 例:根重排并保存、单行进组(`GROUP` 下拉值变化、`is-drop-target`)与组内重排、成员拖到组外、组头整组移动、拖进空组、从 AVAILABLE 拖入根与组(勾选框随之勾选、已勾选把手 `disabled`)、Esc 取消与原位放下不改草稿、箭头/下拉/`UNGROUP` 行为不变;每次落下后断言 `SAVE VIEW` 提交的 `channels` 形状。`apps/web/tests/settings-dirty.integration.test.tsx` 5 例:三处提示出现/保存后消失/保存失败保留、四条路径弹窗与正文、`KEEP EDITING`(按钮 / Esc / 背景)保留草稿且未导航/切换/删除/创建、`DISCARD` 分别切换/创建并选中/删除/导航、浏览器后退弹窗且 `history.forward` 被调用并停留在 `VIEW CONFIGURATION`、干净时直接执行、点击已选中 view 不重置草稿、`beforeunload` 的 `defaultPrevented`。 |
| 本地:鼠标与触屏拖放流畅,位移动效无抖动、无闪烁 | 移交用户 | 云端无真机也无真实指针。Playwright 驱动预装 Chromium 完成了鼠标拖放五种语义与 FLIP 的功能性冒烟(见下方记录),动效观感与触屏需用户本地验收,操作清单见第 5 节。 |
| 覆盖率达标 | 通过 | 最终 HEAD `pnpm test`(v8):`apps/web` 语句 97.17% / 分支 92.74% / 函数 98.80% / 行 97.02%(门槛 80%);`apps/server` 92.42% / 85.63% / 96.28% / 92.37%(门槛 80%,未改动);`packages/shared` 100% / 100% / 100% / 100%(门槛 90%,未改动);`packages/test-utils` 93.86% / 90.40% / 100% / 93.86%。未调低任何门槛,未新增覆盖率排除项。 |
| 全量质量门与远端 CI | 通过 | 最终 HEAD 串行 `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm build` 全绿(web 215 项、server 141 项、shared 33 项、test-utils 22 项)。分支推送后 GitHub Actions `CI`(`pnpm install --frozen-lockfile` / lint / typecheck / test / build)在 `24ad698` 上 `success`(run #204,<https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/34144556523>),说明提交的 lockfile 在无代理限制的 runner 上可按 frozen 方式安装。浏览器冒烟记录见下。 |

**端到端冒烟(`pnpm dev` + Mock Provider,Playwright 驱动预装 Chromium,视口 1400×900)**:Mock Provider 以仓库最新树 dump 运行于 `127.0.0.1:9100`(20 个通道),后端通过 `PUT /api/v1/connection` 指向该地址;脚本先用 REST 建一个空 view,在配置页勾选前 5 个通道并保存,然后依次执行。列表内所有 `[data-flip-key]` 元素的内联 `style` 写入由 MutationObserver 记录,用于区分 dnd-kit 让位动画(`translate3d`)与 FLIP 反向补间(`translate(`)。实际记录(云端 UTC):

```text
16:42:26 view has 5 rows: MIC | MIC-REVERB | BASS | Anagram-Wet | Anagram-Dry
16:42:27 1 mouse reorder: MIC-REVERB | MIC | BASS | Anagram-Wet | Anagram-Dry (expected MIC after MIC-REVERB: OK); MIC was dropped over MIC-REVERB.
16:42:27 1 reorder transforms: 49 style writes, 10 FLIP inverse transforms, 24 dnd-kit transforms
16:42:28 2 drag into empty group: members BASS (OK)
16:42:29 3 drag onto member: members BASS | Anagram-Wet, Anagram-Wet group=group-mtrgy28e-2 (OK)
16:42:30 4 drag out of group: MIC-REVERB | Anagram-Wet | MIC | Anagram-Dry | BASS, Anagram-Wet group='' (OK)
16:42:31 5 drag group header: BASS | MIC-REVERB | Anagram-Wet | MIC | Anagram-Dry, first block is group: OK
16:42:32 6 drag available 'PC' above 'MIC-REVERB': BASS | PC | MIC-REVERB | Anagram-Wet | MIC | Anagram-Dry (OK); PC was dropped over MIC-REVERB.
16:42:32 7 arrow move transforms: 15 style writes, 5 FLIP inverse transforms, 0 dnd-kit transforms
16:42:32 7 FLIP keys: channel:Anagram-Dry:channel/5#0, channel:MIC:channel/1#0
16:42:33 8 dirty: save class='primary-button is-dirty', badge=1, dot=1
16:42:33 9 dialog: "Return to the mixer without saving changes to "Smoke"?", focus on 'KEEP EDITING'
16:42:33 9 keep editing: url http://localhost:5173/views, badge still 1
16:42:33 10 back: dialog open, url http://localhost:5173/views, heading VIEW CONFIGURATION
16:42:33 10 discard: url http://localhost:5173/
16:42:34 11 keyboard move: MIC | MIC-REVERB | BASS | Anagram-Wet | Anagram-Dry -> MIC | MIC-REVERB | BASS | Anagram-Dry | Anagram-Wet (OK)
16:42:35 11 escape cancel: unchanged OK
```

**两套动效是否叠加**:按 `style` 写入的时序看,dnd-kit 的 `translate3d` 只出现在拖动过程中,落下那一次提交里 dnd-kit 先把行的 `transform` / `transition` 清空,FLIP 才在同一提交的 layout effect 中写入反向补间,两者不在同一时刻作用于同一元素。以第 1 步为例,落下后只有被拖行 `MIC` 得到 29px 的反向补间(从松手位置滑入新槽位),让位行 `MIC-REVERB` 的残差为 1.39px(dnd-kit 让位量与实际行高的亚像素差),其它行无补间。无法在无头环境判断肉眼是否有抖动,故动效观感移交用户;若真机上落下瞬间有抖动,把 `SettingsPage.tsx` 里传给 `ViewDndContext` 的 `onBeforeDrop={flip.capture}` 改为 `flip.skipNext` 即可让 FLIP 跳过落下那一帧(第 8 节)。

## 3. 实现摘要

- **纯函数定位规则**(`apps/web/src/features/settings/view-order.ts`):`DropTarget` 的 `root.position` 按 `nonEmptyBlocks(view)`(单行 + 非空组块)计数,`group.position` 按 `memberIndices(view, groupId)` 计数。共用的 `placeReference(base, moved, target)` 只在块边界(某块的首个索引或数组末尾)或组内(成员之间或末尾;空组落在数组末尾,即 `viewBlocks` 显示空组的位置)插入,因此同组连续不变量自动成立。`moveChannelTo` 先把源从数组移除得到 `base` 再定位,进组写 `groupId`、出组 `delete` 该键,结果与原数组逐项结构相等(kind/name/channelId/groupId/color)时返回 null,统一覆盖原位放下、同组同槽位等情形;`insertChannelAt` 先按 `kind + name + channelId` 三字段全等拦截已存在引用;`moveGroupTo` 在非空块中找到组块、移出后按 `position` 插回,空组/未知组/越界/等于原下标返回 null,结果经既有 `flatten` 重建。新增导出 `nonEmptyBlocks`、`memberIndices` 供解析层复用;既有七个导出签名与语义未变,既有单测未删改。
- **稳定 key**(`row-keys.ts`):`channelRowKeys(view)` 为每个引用生成 `kind:name:channelId#<出现序号>`,`groupRowKey(id)` 为 `group:<id>`;React key、`data-flip-key` 与 dnd-kit id 同用该值。
- **dnd-kit 结构**:`ViewDndContext.tsx` 承载 `DndContext`(包住 `.view-editor__grid` 两列),`ChannelOrderList.tsx` 的根 `SortableContext` items 为非空块(`channel:<rowKey>` / `group:<id>`,`verticalListSortingStrategy`),`SortableGroupBlock.tsx` 对非空组同时 `useSortable(group:<id>)` 与 `useDroppable(groupzone:<id>)`(两个 id 分开是因为 `useSortable` 已用项 id 注册 droppable),内嵌成员 `SortableContext`;`EmptyGroupBlock` 只 `useDroppable`,不进根 items;`AvailableChannelList.tsx` 每个 label 用 `useDraggable(available:<channelId>)`,已勾选或保存中 `disabled`,把手按钮同时 `disabled`。每个 draggable/droppable 的 `data` 带 `{ kind, label, groupId?, empty? }`(`dnd-ids.ts`),碰撞与播报按 data 判断而不解析 id。`onDragOver` 不改草稿:组块的 `is-drop-target` 直接由 `useDndContext()` 的 `over` 推导。`onDragEnd` 在 `editDraft` 的 updater 内解析:`dragSourceFor` 把 active id 映射回当前草稿(过期 key 返回 null → 无操作),`resolveDropTarget`(`drop-resolver.ts`)把 `over` 解析为 `DropTarget`:同列表内被拖项占据 over 行在原列表中的下标(与 dnd-kit 排序预览一致,上移落前、下移落后);跨列表(含 available)在移除源后的视图中定位,松手点低于 over 行中线(`hint.after`,键盘路径恒为 false)则 +1;`groupzone` 追加到组尾;组头只接受根单行与其它非空组。available 落下前再用 `resolvedByChannelId` 拦一次。
- **拖动呈现、占位预览、拖出移除与边缘滚动**(本机反馈后的修订,见第 11 节):被拖项原位留作占位,跟随指针的是 `DragOverlay` 克隆(`DragOverlayContent.tsx`);跨列表拖动时 `ViewDndContext` 维护预览视图(`drag-preview.ts` 的 `previewFor` 用 `moveChannelTo` / `moveGroupTo` / `insertChannelAt` 生成,`use-drag-preview.ts` 提供给列表),`ChannelOrderList` 按预览视图渲染、AVAILABLE 来源用 `PlaceholderRow`(以拖动自身的 id 注册 sortable)占位;指针离开列表可见区域超过阈值时克隆变红并在松手时移除(`removalFor`);`ListAutoScroller` 自写列表边缘滚动并重测矩形,dnd-kit 自动滚动关闭。
- **碰撞检测与传感器**(`dnd-collision.ts`、`dnd-config.ts`):先按 `isEligibleTarget` 过滤(通道/available 源 → 通道行或组容器;组源 → 根单行或其它组,永远不能进入别的组;被拖项自身的 droppable 始终可落,供 sortable 策略在占位上方时回落到自身)。有指针坐标时用 `pointerWithin`,行优先于所在组容器,只命中容器(组头或空组占位)即视为追加,指针在列表外松手 → `over` 为空 → 不改草稿(超过移除阈值则移除);键盘路径排除非空组容器后用 `closestCenter`。传感器:`PointerSensor(distance: 4)`、`TouchSensor(delay: 250, tolerance: 8)`、`KeyboardSensor(coordinateGetter: viewKeyboardCoordinates)` 三者同时启用;`viewKeyboardCoordinates` 把被拖项中心对齐方向上最近的可落目标中心(见第 8 节偏离说明),来自 AVAILABLE 的项在尚未进入列表时先跳到首/末目标。`saving` 为真时所有 `useSortable` / `useDraggable` `disabled` 且把手 `disabled`。`accessibility.announcements` 与 `screenReaderInstructions` 改为带通道名的英文文案。未使用 `DragOverlay`。
- **FLIP hook**(`use-flip-list.ts`):`useFlipList(containerRef, dependency)` 在 `useLayoutEffect` 中读取容器内全部 `[data-flip-key]` 的 rect 与上次比对,位移 ≥ `FLIP_MIN_SHIFT_PX` 的元素先写反向 `translate`(`transition: none`,强制 reflow),`requestAnimationFrame` 后清 transform 并写 `FLIP_TRANSITION`,`transitionend` 或 `FLIP_CLEANUP_FALLBACK_MS` 兜底移除内联样式;成员行减去所属组块的位移,避免整组移动时双重平移;新出现的元素与首次测量不补间;`window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches` 为真不补间(jsdom 无 `matchMedia` 视为不减少)。hook 挂在 `SettingsPage` 的列表 ref 上,依赖为 `activeDraft`,所有草稿变更走同一套补间。与 dnd-kit 的配合:所有 `useSortable` 传 `animateLayoutChanges: () => false` 关闭其布局动画;`onDragEnd` 提交草稿前调用 `flip.capture()` 把拖动态(含让位 transform 与被拖行的松手位置)记为基线,于是让位行几乎零位移不动,被拖行从松手位置滑入新槽位。`skipNext()` 作为备选保留。
- **脏检测与 `pendingAction`**:`view-dirty.ts` 的 `isViewDirty` 比较 `name`、`channels`(顺序与五个字段,缺键与 `undefined` 相等)、`groups`(顺序、id、name);`SettingsPage` 以 `useMemo` 求 `dirty`,并用 `dirtyRef` 在 effect 中同步最新值供守卫读取。`pendingAction: { navigate, route } | { select, view } | { delete } | { create, name }`:`RETURN TO MIXER`(经 App 的 `navigate('mixer')` → 守卫拒绝 → `navigate` 类)、点击其它 view(`select`;点击已选中项 no-op)、两段式删除的第二次点击(`delete`;干净时直接删)、`ADD`(`create`;干净时直接建)在脏态下只设置 `pendingAction` 并弹窗。`DISCARD`:先 `setPendingAction(null)`、`setDraft(null)`、`dirtyRef.current = false`,再分别 `navigate(route)` / `selectView(view)` / `performDelete(id)` / `performCreate(name)`;`KEEP EDITING`(按钮、Esc、背景 mousedown)关闭并把 `confirmDelete` 复位。三处提示:`SAVE VIEW` 的 `is-dirty`、`<span class="unsaved-badge">UNSAVED</span>`、列表当前项 `data-dirty="true"` + CSS 圆点 + `.visually-hidden` 的 `Unsaved changes`。`beforeunload` 仅在脏态挂在 `window` 上(`preventDefault` + `returnValue = true`),干净或卸载时移除。保存失败(`viewStore.error`)草稿不变,脏态保持。
- **对话框**:`DiscardChangesDialog.tsx` 复用 `useModalDialog({ onClose: onKeepEditing })`,`role="dialog"`、`aria-modal`、`aria-labelledby` → `UNSAVED CHANGES`、`aria-describedby` → 正文(四种文案见组件内 `discardMessage`),按钮 `DISCARD`(utility)与 `KEEP EDITING`(primary,挂载后聚焦);样式复用 `.connection-backdrop` / `.connection-dialog*`,仅加 `.discard-dialog` 宽度与正文样式。**`use-modal-dialog.ts` 已移动**到 `apps/web/src/components/use-modal-dialog.ts`(`git mv`,内容未改),`ConnectionPanel.tsx` 的 import 已更新;CONNECTION 面板行为不变、不做脏检测。
- **路由守卫与缓存路由**(`apps/web/src/lib/router.ts`):模块级 `currentRoute` 缓存「已放行的路由」,`getSnapshot` 返回缓存,无订阅者时从 `location.pathname` 重同步(生产环境等价于 App 挂载前 URL 即真相,测试环境则让每个用例的 `replaceState('/')` 首帧生效);`setNavigationGuard(guard | null)` 单守卫;`navigate` 先比缓存再问守卫,拒绝则不改 history、不通知;`popstate` 改为单个模块级监听器(首个订阅者注册、最后一个退订移除,保证每个事件守卫只跑一次):目标等于缓存只通知,否则问守卫,拒绝时沿来路撤销(见第 11 节:条目序号 + `history.go`),缓存不变,撤销触发的第二次 `popstate` 因目标等于缓存自然收敛。配置页挂载时注册守卫、卸载时置 null;混音页不注册。
- **SettingsPage 拆分**:页面从 724 行降到约 590 行,行/组/清单渲染迁入 `SortableChannelRow` / `SortableGroupBlock` / `ChannelOrderList` / `AvailableChannelList`,`KIND_LABELS` / `PALETTE_LABELS` / `pad` 迁入 `channel-labels.ts`;`MovedMarker`、`data-moved`、`onAnimationEnd` 与 `styles.css` 中 `order-shift-up/down`、`order-flash` 关键帧及选择器已删除。行网格新增把手列,窄屏与容器查询断点同步调整。
- **测试基建**:`apps/web/tests/stub-layout.ts` 覆写 `Element.prototype.getBoundingClientRect`,按 DOM 顺序给 AVAILABLE 条目(x=0)与列表块(x=500)递增 40px 的 rect,组块跨表头与成员,每次调用重算;`apps/web/tests/keyboard-drag.ts` 的 `pickUp`(Space → 等 `aria-pressed` → 让出一个宏任务,因为 dnd-kit 在 `setTimeout` 后才挂 document 的 keydown)与 `press`;`vitest.setup.ts` 增加 `Element.prototype.scrollIntoView = vi.fn()`(dnd-kit 键盘拾起时调用)。dnd-kit 指针分支由 `dnd-collision.test.ts` 用伪造容器覆盖。

## 4. 数值初值清单

| 常量 | 值 | 文件 | 用途 |
| --- | --- | --- | --- |
| `POINTER_ACTIVATION_DISTANCE_PX` | 4 | `apps/web/src/features/settings/dnd-config.ts` | `PointerSensor` 激活距离(CSS px) |
| `TOUCH_ACTIVATION_DELAY_MS` | 250 | 同上 | `TouchSensor` 按压延迟(ms),6.4 调参 |
| `TOUCH_ACTIVATION_TOLERANCE_PX` | 8 | 同上 | `TouchSensor` 按压期间容差(CSS px),6.4 调参 |
| `FLIP_MIN_SHIFT_PX` | 1 | `apps/web/src/features/settings/use-flip-list.ts` | 小于该位移不补间(落下后让位行的亚像素残差约 1.4px 会触发一次极短补间,可调到 2) |
| `FLIP_TRANSITION` | `transform var(--motion-medium) ease-out` | 同上 | FLIP 过渡;`--motion-medium` = 200ms(`styles.css` `:root`),reduced-motion 下为 1ms |
| `FLIP_CLEANUP_FALLBACK_MS` | 600 | 同上 | `transitionend` 未触发时清理内联样式的兜底 |
| `REMOVE_DRAG_THRESHOLD_PX` | 64 | `apps/web/src/features/settings/dnd-config.ts` | 指针离开 CHANNEL ORDER 列表可见区域多远(CSS px)松手即移除 |
| `AUTO_SCROLL_EDGE_PX` | 48 | 同上 | 列表可见区域上下边缘多宽(CSS px)进入自动滚动区 |
| `AUTO_SCROLL_MAX_STEP_PX` | 12 | 同上 | 贴边时每帧最大滚动量(CSS px/帧,约 60 帧/秒) |
| `AUTO_SCROLL_REMEASURE_MS` | 50 | 同上 | 自动滚动中重测各行矩形的最小间隔 |
| `ROOT_SLOT_HEIGHT_PX` | 16 | 同上 | 拖动通道时分组边界处根级落槽(首个分组之前、相邻两组之间、末个分组之后)的命中带高度,覆盖在下方块的顶部 |
| 键盘方向判定阈值 | 0.5 | `apps/web/src/features/settings/dnd-collision.ts`(`viewKeyboardCoordinates`) | 目标中心需比被拖项中心至少高/低 0.5px 才算在该方向上 |
| `STUB_ROW_HEIGHT` / `STUB_ROW_WIDTH` | 40 / 400 | `apps/web/tests/stub-layout.ts` | 仅测试用的 jsdom 布局 stub |

## 5. 真机验收操作清单(移交用户)

**安全约束**:配置页只改 view 配置(`data/config.json` 的 `views`),拖放、勾选、分组与保存不会改动 Fairlight 任何参数;验收过程中不要操作混音页推子;如确需操作,只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子并测后复原;不得切 ON/mute、不得动其它通道、不得删改任何通道。

启动:仓库根目录 `pnpm install --frozen-lockfile`(本地不受 codeload 限制)→ `pnpm dev`(server 3000 + web 5173)→ 浏览器打开 `http://localhost:5173`,确认页头 `MIXER ONLINE`。建议新建一个名为 `DnD Check` 的临时 view 做验收,结束后删除。

鼠标路径(桌面浏览器):

1. `CONFIGURE VIEWS` → 左侧 `NEW VIEW` 输入 `DnD Check` → `ADD`;在 AVAILABLE CHANNELS 勾选 5 个通道 → `SAVE VIEW`。预期:右侧出现 5 行,每行最左有六点把手;`UNSAVED` 徽标在保存后消失。
2. 按住第 1 行把手向下拖过第 2 行后松开。预期:拖动中其它行平滑让位,被拖行半透明;松手后被拖行从松手位置滑入第 2 个槽位,让位行不再二次移动,无跳动、无闪烁。拖动 `GROUP` 下拉、调色板、箭头按钮不应触发拖动。
3. `NEW GROUP` 输入 `Rhythm` → `ADD GROUP`,出现 `ASSIGN CHANNELS BELOW` 的空组;把某一行拖到该占位上松开。预期:该行进入组,组块从底部移到列表相应位置(这一步整块位移由 FLIP 补间),行的 `GROUP` 下拉变为 `Rhythm`。
4. 再拖一行到组内成员之间(把手压在成员行上半部分松开落其前、下半部分落其后),再拖到组头上松开。预期:前者落在指定位置,后者追加到组尾;悬停时组块有琥珀描边(`is-drop-target`)。
5. 把组内某成员拖到组外的根行上松开。预期:脱组,`GROUP` 下拉回到 `NO GROUP`,`UNGROUP` 与箭头按钮仍可用。
6. 按住组头把手把整组拖到列表顶部。预期:整组连同成员一起移动,不能落进另一个组(如有第二个组,拖过去时不应高亮)。
7. 从左侧 AVAILABLE CHANNELS 拖一个未勾选通道的把手到右侧任意位置或组内松开。预期:拖动中右侧列表里出现一条虚线描边的占位行,随指针在行间/组内移动并标出落点,拖进组时组块琥珀高亮;左侧对应条目变暗且 AVAILABLE 列表不再滚动;松手后占位行原地变为正常行,左侧勾选框同步勾选,该条目把手变灰不可拖;拖回左栏松手则无变化(占位消失)。
7a. 让列表以分组开头并放两个相邻的分组。拖动任意通道行(或 AVAILABLE 条目)时,首个分组上方、两组之间与末个分组下方各出现一条琥珀虚线;把指针移到虚线下方约 16px 的带内。预期:占位行出现在该分组边界处(不进组),虚线移到占位行下方;继续停留不抖动;松手后通道以无组行落在该位置。拖动组头时不出现虚线。
7b. 把右侧任意通道行的把手拖到列表外(例如拖到左栏上方)超过约 64px。预期:跟随指针的克隆变红并显示 `DROP TO REMOVE`,松手后该通道从 view 移除、左侧勾选框取消;拖回列表内克隆恢复正常。组头同样操作会移除整组及其成员。拖动过程中两个列表都不应出现横向滚动条。
8. 点箭头按钮上移/下移某行、用 `GROUP` 下拉编组/脱组、点 `UNGROUP`。预期:目标行与因它位移的行都平滑过渡(约 200ms),无闪烁。
9. 任一编辑后:`SAVE VIEW` 变琥珀描边、旁边出现 `UNSAVED`、左侧当前 view 右上角出现琥珀圆点。点页头 `MIXER`。预期:弹出 `UNSAVED CHANGES`,正文 `Return to the mixer without saving changes to "DnD Check"?`,焦点在 `KEEP EDITING`;点 `KEEP EDITING` 留在配置页且草稿不变。
10. 浏览器后退。预期:弹出同一对话框,地址栏停留在 `/views`,页面仍是 VIEW CONFIGURATION;点 `DISCARD` 回到混音页,再进配置页时是已保存的版本。
11. 分别验证:脏态点其它 view → 弹窗(`Switch to ...`);`DELETE VIEW` → `CONFIRM DELETE` → 弹窗(`Delete ...`);`NEW VIEW` 输入名字 `ADD` → 弹窗(`Create ...`);Esc 与点背景等同 `KEEP EDITING`;脏态刷新页面出现浏览器自带的离开提示;干净时以上操作直接执行。
12. 若系统开启「减弱动态效果」,重复第 2、8 步。预期:无补间,直接到位。

手机竖屏路径(通道较多时):

1. view 内放 12 个以上通道,页面滚动到 AVAILABLE 底部与 CHANNEL ORDER 顶部同时可见。从 AVAILABLE 长按一条未勾选通道拖到 CHANNEL ORDER 可见区域的底边停住。预期:克隆始终在手指下方不跳开;AVAILABLE 列表与整页不滚动;CHANNEL ORDER 列表持续向下滚动(越贴边越快,最快约 720px/s),占位行随之出现在滚动到的位置;手指离开边缘区即停止;松手后通道插入在占位处。
2. 在 CHANNEL ORDER 内长按一行拖到列表可见区域的顶边停住。预期:列表向上滚动,一次拖动即可把该行放到任意位置。
3. 记录:`AUTO_SCROLL_EDGE_PX` / `AUTO_SCROLL_MAX_STEP_PX` 的手感(`dnd-config.ts`)。

触屏路径(平板,仅需确认可用,手感调参属 6.4):

1. 长按(约 250ms)行把手直到该行变半透明,再拖到目标位置松开。预期:与鼠标路径相同的落点语义;把手上的触摸不会滚动页面(`touch-action: none`),把手以外的区域仍可滚动列表。
2. 长按组头把手整组移动;从左侧长按可用通道把手拖入右侧。
3. 记录:长按时长是否合适、拖动中列表是否跟着滚动、松手是否有跳动——这些数值(`dnd-config.ts`)留给 6.4 调整,本阶段不动。

键盘路径(桌面浏览器):

1. Tab 到某行把手(焦点环为琥珀色),按 Space 拾起(把手 `aria-pressed`),按 ↓/↑ 逐个目标移动,再按 Space 放下;Esc 取消回原位。预期:与集成测试一致——同列表内互换,跨入组时落在目标成员之前,组头只在根列表移动;屏幕阅读器可读到 `Picked up BASS.` / `BASS is over group Rhythm.` / `BASS was dropped over ...` 之类英文播报。
2. Tab 到左侧未勾选通道的把手,Space 拾起后按 ↓ 直接跳到右侧列表首个目标,再移动后放下。

## 6. 交付物清单

| 路径 | 用途 |
| --- | --- |
| `apps/web/package.json`、`pnpm-lock.yaml` | 新增 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities` |
| `apps/web/src/features/settings/view-order.ts` / `view-order.test.ts` | 新增 `DropTarget`、`nonEmptyBlocks`、`memberIndices`、`moveChannelTo`、`insertChannelAt`、`moveGroupTo` 及单测 |
| `apps/web/src/features/settings/view-dirty.ts` / `view-dirty.test.ts` | `isViewDirty`、`sameChannelReference` |
| `apps/web/src/features/settings/row-keys.ts` / `row-keys.test.ts` | 稳定行 key |
| `apps/web/src/features/settings/dnd-config.ts` | 传感器初值常量 |
| `apps/web/src/features/settings/dnd-ids.ts` / `dnd-ids.test.ts` | dnd-kit id 编解码与 item data 读取 |
| `apps/web/src/features/settings/drop-resolver.ts` / `drop-resolver.test.ts` | `over` → `DropTarget` 解析 |
| `apps/web/src/features/settings/dnd-collision.ts` / `dnd-collision.test.ts` | 可落判定、碰撞检测、键盘坐标函数 |
| `apps/web/src/features/settings/ViewDndContext.tsx` | `DndContext`、传感器、播报、`onDragEnd` |
| `apps/web/src/features/settings/ChannelOrderList.tsx`、`SortableChannelRow.tsx`、`SortableGroupBlock.tsx`、`DragHandle.tsx`、`AvailableChannelList.tsx`、`channel-labels.ts` | 从 `SettingsPage` 拆出的列表、行、组块、把手与左侧清单 |
| `apps/web/src/features/settings/use-flip-list.ts` / `use-flip-list.test.tsx` | FLIP hook |
| `apps/web/src/features/settings/DiscardChangesDialog.tsx` / `DiscardChangesDialog.test.tsx` | 确认对话框与 `PendingAction` 类型 |
| `apps/web/src/features/settings/SettingsPage.tsx` | 脏检测、`pendingAction`、守卫注册、`beforeunload`、组件接线 |
| `apps/web/src/components/use-modal-dialog.ts` | 自 `features/connection/` 移入(内容不变);`ConnectionPanel.tsx` import 更新 |
| `apps/web/src/lib/router.ts` / `router.test.ts` | 导航守卫与缓存路由 |
| `apps/web/src/styles.css` | 把手、拖动态、投放高亮、脏态提示、对话框样式;删除 `data-moved` 动画;行网格加把手列 |
| `apps/web/vitest.setup.ts` | `scrollIntoView` stub |
| `apps/web/tests/stub-layout.ts`、`keyboard-drag.ts` | jsdom 布局 stub 与键盘拖放 helper |
| `apps/web/tests/settings-dnd.integration.test.tsx`、`settings-dirty.integration.test.tsx` | 新增集成测试 |
| `apps/web/tests/views.integration.test.tsx` | 删除 `data-moved` 断言,「重新点击已选中 view 丢弃草稿」改为 `RETURN TO MIXER` → `DISCARD` → `CONFIGURE VIEWS` |
| `docs/architecture.md` | 「通道分组」与「前端结构」补拖放语义、FLIP、脏检测、对话框、路由守卫、`use-modal-dialog.ts` 新位置 |
| `docs/reports/phase-6-2-report.md` | 本报告 |

## 7. 依赖清单与许可确认

| 包 | 版本 | `license` 字段 | 引入理由 |
| --- | --- | --- | --- |
| `@dnd-kit/core` | 6.3.1 | MIT | `DndContext`、传感器、`useDraggable` / `useDroppable`、碰撞检测算法 |
| `@dnd-kit/sortable` | 10.0.0 | MIT | `SortableContext`、`useSortable`、`verticalListSortingStrategy` |
| `@dnd-kit/utilities` | 3.2.2 | MIT | `CSS.Transform` / `CSS.Translate` 序列化 |

许可在安装前经 `pnpm view <pkg> license` 核对,安装后再次核对 `node_modules/@dnd-kit/*/package.json` 的 `license` 字段,均为 `MIT`;传递依赖 `@dnd-kit/accessibility@3.1.1` 同为 MIT。未引入 `@dnd-kit/modifiers`。`git diff` 确认 `pnpm-lock.yaml` 只含这四个包的条目(`importers` 三行 specifier/version、`packages` 与 `snapshots` 各四段),`apps/web/package.json` 只多三行依赖。

云端安装说明:代理仍拒绝 `codeload.github.com`,`emberplus-connection` 依赖的 git-hosted `asn1` tarball 无法下载。本次做法:`pnpm add … --lockfile-only` 先得到只含 dnd-kit 变更的干净 lockfile 并备份;用 `git` 取得 `evs-broadcast/node-asn1@0146823` 打成本地 tarball,临时把 lockfile 中的 asn1 条目改为 `file:` 路径完成 `pnpm install`,随后用备份覆盖回 lockfile;pnpm 11 在跑脚本前会自动校验 node_modules 与 lockfile 并重跑 `pnpm install`,本会话用环境变量 `pnpm_config_verify_deps_before_run=false` 关闭该检查。提交的 lockfile 无任何本地路径。冒烟用的 `playwright-core@1.52.0`(Apache-2.0)与 Mock Provider 启动脚本只在会话临时目录,不进入仓库。

## 8. 关键决策与偏离

- **键盘坐标函数未用 `sortableKeyboardCoordinates`**(偏离提示词第 2 节)。dnd-kit 自带的 getter 用 `closestCorners` 选下一个 droppable 并把被拖项的边缘与目标对齐(同容器下移时对齐底边);当被拖项是组块(表头 + N 行)而目标是单行时,移动后被拖项中心到目标中心的距离与到自身原位置的距离相等(2 名成员)或更远(≥3 名成员),`closestCenter` 会平局或选中自身,整组无法用键盘移动;它也不知道本页的可落规则(会把组头往别的组里送)。改为 `viewKeyboardCoordinates`:只在可落目标中按方向找最近者并把中心对齐,落下后 `closestCenter` 距离为 0、`over` 唯一。键盘路径的其它约定(Tab 到把手、Space/Enter 拾起与放下、方向键移动、Esc 取消)与 dnd-kit 默认一致。
- **键盘路径无法把通道追加到组尾**:键盘落下恒为「落在 over 行之前」(中心对齐时无法区分上下半),要把通道放到某组末尾可先落入组内再用 `Move <name> down` 箭头或 `GROUP` 下拉(下拉本就追加到组尾);指针路径按松手点相对 over 行中线区分前后,组头/空组则追加。
- **FLIP 在拖放落下时采用 `capture()` 基线而不是跳过**:提示词允许「若两套补间叠加抖动则跳过一次测量」。实现选择在 `onDragEnd` 提交草稿前把拖动态 rect 记为基线并关闭 dnd-kit 的 `animateLayoutChanges`,让位行几乎零位移(不补间),被拖行从松手位置滑入新槽位,得到一个自然的落下动画;冒烟按 `style` 写入时序确认两套 transform 不同时作用。若真机观感有抖动,一行改动即可切换到 `skipNext()`。
- **`pointerWithin` 而非 `closestCenter` 用于指针拖动**:指针在列表外松手时 `over` 为空,严格满足「`over` 为空不改草稿」;代价是列表底部空白区域不是投放目标(要落到末尾需压在最后一行的下半部分)。
- **`DragOverlay` 已启用、跨容器做占位预览**(本机反馈后的修订,见第 11 节):原实现让被拖行本身随指针位移,导致容器出现横向滚动条、左栏拖出时被裁切、手机上滚动补偿切换时跳开;现改为克隆跟随指针、原位占位,跨列表拖动用预览视图显示落点。`onDragOver` 仍不改草稿,只改预览视图。
- **路由缓存的重同步策略**:提示词要求缓存首次从 `location.pathname` 初始化;实现额外在「无订阅者」时重读 URL,以便每个测试用例的 `replaceState('/')` 在首帧生效,生产语义不变。
- **`views.integration.test.tsx` 的改写方式**:「重新点击已选中 view 以丢弃草稿」统一改为 `RETURN TO MIXER` → `DISCARD` → `CONFIGURE VIEWS`(配置页卸载重挂,草稿自然清空)。
- **触屏传感器与指针传感器共存的已知行为**:同时启用 `PointerSensor` 与 `TouchSensor` 时,触屏设备上 `pointerdown` 先于 `touchstart`,dnd-kit 会由指针传感器(4px 距离)接管,`TouchSensor` 的 250ms 长按不会生效。本阶段按提示词要求三者同时启用、不改数值,是否改为「Mouse + Touch」或只留 Pointer 由 6.4 触屏审计决定。
- **覆盖率排除项**:无。未调门槛。
- **`use-modal-dialog.ts`**:已移动到 `components/`。

## 9. 遗留问题与移交事项

- **用户需完成第 5 节真机验收**,重点是落下瞬间与箭头移动的动效观感、触屏长按手感。
- **留给 6.4**:touch 传感器延迟/容差调参与页面滚动的区分;上一条提到的 Pointer/Touch 共存行为;把手 `:hover` 样式待包进 `@media (hover: hover)`;`touch-action: none` 目前只在把手上。
- **留给 6.3**:页头压缩不涉及本阶段;`UNSAVED` 徽标与 `SAVE VIEW` 并排,页头压缩时需一并考虑窄屏排布。
- **留给 6.5**:无直接关联;`settings-*.integration.test.tsx` 的 `openSettings` 夹具可复用。
- **可能的后续微调**(不属本阶段):`FLIP_MIN_SHIFT_PX` 可提高到 2 以吞掉落下后让位行 ~1.4px 的亚像素残差;若希望列表底部空白也能作为投放目标,可给 `<ol>` 加一个 `root-end` droppable。
- **建议回写文档**:无踩坑类条目需要写入 `docs/fairlight-ember.md`;本阶段架构变化已写入 `docs/architecture.md`。云端 pnpm 11 的 `verify-deps-before-run` 行为与 asn1 安装手段如后续会话仍会遇到,可考虑记入 `AGENTS.md` 的云端说明(由用户决定)。
- **`docs/development-plan.md` 的 6.2 验收框未勾选**,由用户在真机验收后处理。

## 10. 提交记录

分支 `claude/phase-6-2-execution-a8h4h2`(基于 `5b4be3e docs: add the Phase 6.2 execution prompt`),本阶段新增提交:

```text
24ad698 docs: describe configuration page drag and drop, FLIP and the unsaved-change guard
07017ae feat(web): guard unsaved view edits with a discard dialog
4e46afd feat(web): add a navigation guard to the router
f5fdda8 feat(web): animate configuration list moves with a FLIP hook
08204b0 feat(web): drag and drop channel ordering with dnd-kit
ed27776 feat(web): add drop-target functions for view ordering
efa3805 chore(web): add dnd-kit for configuration page drag and drop
```

本报告作为最后一个 `docs:` 提交追加在其后。远端 CI:`24ad698` 的 run #204 为 `success`(<https://github.com/wuXinnnn/Fairlight-Live-Web-Controller/actions/runs/34144556523>);报告提交会再触发一次仅含文档变更的 run。

## 11. 评审与真机反馈后的修订

PR #15 的 Cursor Bugbot 对 `18d5555` 给出两条 finding,处理如下:

- **Medium:被拒绝的 `popstate` 一律 `history.forward()`,只能撤销「后退」**。成立:配置页 → 混音页 → 后退回配置页,再在脏态下**前进**,`forward()` 撤不回,地址栏停在 `/` 而页面仍是配置页,此时 `KEEP EDITING` 后刷新会直接离开。修复(`apps/web/src/lib/router.ts`):路由模块在每个 history 条目的 `state` 里写入 `{ routeIndex }`(首个订阅者注册时给当前条目补 0,`navigate` push 递增、replace 沿用),`popstate` 被拒绝时按 `history.go(当前序号 - 目标序号)` 沿来路撤销,后退、前进与多步跳转统一;没有序号的条目(非本应用写入)只能来自后退,保留 `history.forward()`。`router.test.ts` 新增前进/后退/两步跳转被拒的 `go` 参数断言与序号跟随放行跳转的用例;`settings-dirty.integration.test.tsx` 的后退用例改为带序号的条目并新增前进被拒的分支。
- **Low:AVAILABLE CHANNELS 的把手在 `<label>` 内,单击把手会切换勾选框**。在预装 Chromium 上用 Playwright 实测(label 内 `<button>` 单击),勾选框**不会**切换,与 HTML 规范一致(label 的激活行为跳过交互式后代);未验证的浏览器无法排除,故把手 `onClick` 加 `preventDefault()` 作为防御,`settings-dnd.integration.test.tsx` 增加「单击把手不改勾选框、不改草稿」断言。

修订后串行 lint / typecheck / test / build 全绿,远端 CI 与 Bugbot 复查在 `178dfe1` 上均 success。

用户本机验证(桌面)后提出三项,手机竖屏验证后又提出两项,处理如下(提交见本节末尾):

- **桌面 1:横向拖动时两个列表容器出现横向滚动条**。原因是被拖行本身带 `translate3d` 位移,超出容器盒子形成可滚动溢出。改为 `DragOverlay`:跟随指针的是 portal 里的克隆(`DragOverlayContent.tsx`),被拖行原位留作占位(`.is-dragging` 虚线描边、低透明度);两个容器 `overflow: hidden auto` 兜底。冒烟中拖动时 `scrollWidth === clientWidth`。
- **桌面 2:AVAILABLE 拖入右侧列表需要占位元素预示落点(进组时保持琥珀高亮)**,并按用户确认扩展到列表内跨组拖动。实现为预览视图:`drag-preview.ts` 的 `previewFor` 用既有纯函数把被拖项放进目标容器,`ViewDndContext` 在 `onDragOver` 检测容器变化时更新预览(同容器内交给 sortable 策略,避免物理重排与策略位移互相叠加),`ChannelOrderList` 按预览视图渲染,AVAILABLE 来源以 `PlaceholderRow`(用拖动自身的 id 注册 sortable,左栏对应条目改为不可拖的静态变体)占位;`onDragEnd` 在预览视图内按同列表语义结算。落点语义随之统一为「占位显示在哪里就落在哪里」:跨入另一列表后继续移动时,被拖项占据 `over` 行的槽位(与同列表一致),集成测试的两处预期相应调整。
- **桌面 3:拖出 CHANNEL ORDER 容器超过阈值即移除**(用户确认通道行与组头都可移除)。`REMOVE_DRAG_THRESHOLD_PX = 64`;指针离开列表可见区域超过阈值时克隆加 `is-removing`(红色、`DROP TO REMOVE`),松手用 `removeChannel` / `removeGroupWithMembers`(新增纯函数,`removeGroup` 语义不变)写入草稿;键盘拖动无指针坐标,不触发。
- **手机 1:从 AVAILABLE 拖到容器边缘会触发 AVAILABLE 滚动,进入列表后不跟手**。根因:dnd-kit 自动滚动只滚动 `over`(无 over 时为 active)节点的可滚动祖先,拖出时滚的是 AVAILABLE;进入列表后祖先切换、原位 transform 的滚动补偿被丢弃,行跳开。处理:`autoScroll={false}` 彻底停用 dnd-kit 自动滚动;`DragOverlay` 的位移不含滚动补偿,天然跟手;拖动期间 AVAILABLE 加 `is-drag-locked`(`overflow-y: hidden`)。
- **手机 2:通道较多时拖到列表边缘不能滚动列表**。新增 `ListAutoScroller.tsx`:拖动期间自行监听 `pointermove` / `touchmove` 记录指针(dnd-kit 事件里的 `delta` 含滚动补偿,列表一滚动就会偏移,首版据此计算曾出现滚 66px 即停的现象),每帧按指针到列表**可见部分**(与视口相交,手机上列表底边常在视口外)上下边缘的距离比例滚动(`AUTO_SCROLL_EDGE_PX = 48`、`AUTO_SCROLL_MAX_STEP_PX = 12`),滚动后按 `AUTO_SCROLL_REMEASURE_MS = 50` 节流调用 `measureDroppableContainers` 重测各行矩形,保证落点判定跟上;只滚动 CHANNEL ORDER 列表,不滚动 AVAILABLE 与页面。

验证:单测新增 `drag-preview.test.ts`、`list-auto-scroll.test.ts`、`ListAutoScroller.test.ts` 与 `view-order.test.ts` 的移除用例;集成测试补占位行/组块高亮/AVAILABLE 锁定断言;jsdom 下 `DragOverlay` 需布局 stub 提供 overlay 容器(dnd-kit 测量的是其唯一子元素)的矩形并 stub `Element.prototype.animate`。Playwright 冒烟(桌面 1400×900):克隆位移与指针一致(误差 <1px)、拖动中两容器无横向溢出、源行为占位、单行拖到组成员上时占位已在组内且组块高亮、AVAILABLE 拖入时列表出现占位行且 AVAILABLE 锁定、通道行与组头拖到左栏后克隆变红并在松手后移除、保存体正确;手机竖屏(390×844,`isMobile` + `hasTouch`,12 行):从 AVAILABLE 拖到列表可见底边停住 0.9s 列表滚动 495px 而 AVAILABLE 与页面不动、克隆位移与指针一致、占位行随滚动出现、离开边缘即停、松手插入在滚动后的位置;列表内行拖到可见顶边列表回滚 505px;两容器 `scrollWidth === clientWidth`。真实触屏手感仍由用户本机确认。

Cursor Bugbot 对 `a26548e` 又给出两条 finding,均在 `ViewDndContext.tsx`,处理如下:

- **Medium:通道被预览进组后,若在组容器(组头/内边距,即 `groupzone`)上松手会忽略占位位置**。成立:`onDragOver` 对同容器不再更新预览(这正是占位保持的机制),但 `onDragEnd` 对预览视图再调 `resolveDropTarget`,`groupzone` 的语义是「追加到组尾」,与占位展示的位置不一致。修复:`drag-preview.ts` 新增纯函数 `settlePreview(preview, activeId, overId, hint)`,当 `over` 是占位所在组的 `groupzone`(或 `over === active`)时直接提交预览视图,`over` 为某一行时仍按该行槽位结算;`finalViewFor` 的预览分支改为调用它。`drag-preview.test.ts` 覆盖四种 over(自身、所在组容器、同组另一行、另一组容器)。Chromium 冒烟:通道从根跳到组中间(占位在位置 1)后移到组头松手,落点 = 占位位置(修复前落到组尾)。
- **Low:落下动画从不播放**。成立:`onDragEnd` 与 dnd-kit 清空 `active` 在同一批更新里清掉拖动态,`DragOverlay` 的 `dropAnimation` prop 同帧变 null,dnd-kit 克隆上一帧 overlay 时 `useDropAnimation` 读到 null 直接返回;且 `DragOverlayContent` 从 `useDndContext().active` 取标签,`active` 为 null 时渲染 null,克隆里无可测量节点。修复:`dropAnimation` 独立为 state,由纯函数 `dropAnimationFor(source, removing)` 决定(通道行/组头 → `defaultDropAnimation`,AVAILABLE 与移除 → null),`onDragEnd` / `onDragCancel` 在清空拖动态前按最终状态写入;`DragOverlayContent` 改为纯 props(`variant`、`label`、`accent`、`detail`),克隆带上一帧 props 渲染。与 FLIP 的配合:dnd-kit 用 `getTransformAgnosticClientRect` 测量目标行,忽略 FLIP 的内联 transform,克隆飞向行的最终位置,动画期间目标行 `opacity: 0`。集成测试在 Space 落下后同步断言 `.drag-overlay` 仍带通道名并随后消失;Chromium 冒烟:同列表落下、进组落下与 Esc 取消时 overlay 容器均有运行中的 `Animation`,约 300ms 后卸载;AVAILABLE 落下与拖出移除无动画。

用户本机验证第三轮提出两项:列表首块是分组时无法把通道条拖到首位;无法精准拖到两个相邻分组之间。根因:通道来源的可落目标只有通道行与组容器,组块本身对通道来源不可落,分组边界处没有任何 droppable 能解析为根级位置,只能借相邻根级单行的上下半区表达。处理:

- **根级落槽(root slot)**。拖动通道行或 AVAILABLE 条目时,在「首块是分组 / 两分组相邻 / 末块是分组」的块边界渲染 `RootSlot`(`slot:<position>` droppable,`ROOT_SLOT_HEIGHT_PX = 16`),命中即经既有预览机制把占位行放到该根级位置(`resolveDropTarget` 对 `slot` 返回 `{ kind: 'root', position }`,`onDragOver` 对落槽不走「同容器不更新预览」的短路)。落槽位置按**去掉被拖通道后的块序列**计算(`rootSlotPositionsFor`),并绘制在它所在块的正前方(占位行之下):首版按渲染视图计算且在流内占位,冒烟暴露两种问题——落槽出现/消失会把列表在静止指针下推移(拾起即误入相邻组);从上方拖来时占位落在指针上方、指针随即落到下方组头而被追加进组,来回震荡。现方案落槽 `li` 零高度、命中带绝对定位覆盖在下方块顶部,不改变布局;占位放入后同一位置的落槽仍画在占位行之下,悬停即解析为同一位置(`moveChannelTo` 返回 null,预览不变),稳定。键盘路径跳过「被拖行已在此」的落槽(`current`),指针路径保留它;组拖动不渲染落槽。
- 验证:单测 `rootSlotPositions`(五种布局与空组)、`slot:` 标识解析、`resolveDropTarget` 的落槽解析、碰撞规则(落槽对通道/AVAILABLE 可落、对组不可落;指针在带内时落槽优先于其覆盖的组头;键盘跳过 current 落槽);集成测试新增「两组之间与首位」用例(键盘:成员 ArrowDown 到两组之间落槽脱组;根行 ArrowUp 进组再 ArrowUp 到首位落槽;AVAILABLE 拾起即落到两组之间的落槽),既有「组内只能重排」用例改为第三次 ArrowUp 到首位落槽脱组。Chromium 冒烟(`[g1(BASS, Anagram-Wet)] [g2(Anagram-Dry)] MIC`):MIC 到首位、到两组之间,组内成员到末组之后,根行到两组之间,AVAILABLE 到首位,均落在落槽处;在落槽与相邻行边界反复采样 DOM 顺序稳定;既有桌面/手机冒烟无回归。
