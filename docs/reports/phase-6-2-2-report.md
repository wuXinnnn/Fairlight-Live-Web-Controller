# Phase 6.2.2 执行报告 — 配置页 UX 补充二

## 1. 结果总览

五项任务全部落地:FLIP 补间可续接并改用无 transform 几何、View 数据模型改为有序块(配置版本 2,版本 1 读取时迁移)、列表末尾常驻占满式落槽、组色 AUTO 取成员类型众数、文档同步。分 7 个提交推送到 `claude/blissful-mccarthy-6uzsqt`。

**本会话有两项无法执行,必须如实说明**(详见第 9 节):

- **`apps/server` 与 `packages/test-utils` 的依赖装不上**:`emberplus-connection` 依赖的 git 托管 `asn1` tarball 仍被代理以 403 拒绝(`codeload.github.com`)。6.2 报告第 7 节记录的绕行办法(临时把 lockfile 指向本地 tarball)在本会话被沙箱的命令分类器以 *Package Registry Bypass* 拒绝,我没有绕过它。因此 **server 的测试代码已写好但从未在本地运行过**,由远端 CI 验证。
- **浏览器冒烟没有做**:Mock Ember+ Provider 在 `packages/test-utils`,同一条依赖链,装不上;后端也起不来,`pnpm dev` 无法提供通道清单。**所以提示词第 1 节要求的「修复前/修复后埋点对比」这份证据本会话拿不出来**,FLIP 的验证只到单元测试与集成测试为止。

`apps/web` 与 `packages/shared` 的 lint / typecheck / test / build 在本地全绿,`pnpm-lock.yaml` 无任何改动。

## 2. 验收标准逐条核对

| 验收自查 | 结果 | 实际执行与输出 |
| --- | --- | --- |
| 1. FLIP:埋点冒烟修复前后对比;单测覆盖无 transform 测量、在途不被触碰、再次推动从当前视觉位置起步;droppable 矩形为自然位置 | **部分通过** | 单测与集成测试全部落地并通过(见第 3 节)。**埋点冒烟未执行**——依赖装不上,见第 1 节与第 9 节。观感 **移交用户**。 |
| 2. 模型:版本 1 → 2 迁移各分支;空组可移动、通道可落在空组前后;两个页面在版本 2 下正确;服务端读旧文件后写回版本 2 | **通过(server 部分未本地运行)** | `packages/shared` 覆盖率 100%/100%/100%/100%,`migrateAppConfig` 八个分支全覆盖。web 端空组移动/落点的单测与集成用例通过。server 的两个文件(`config-store.test.ts`、`api/views.test.ts`)已按版本 2 改写并新增 v1→v2 用例,但**本地未运行**。 |
| 3. 落槽:通道、AVAILABLE、组头落到空白区都追加到末尾;末尾空组之后可落;键盘可达且 `current` 时跳过 | 通过 | `settings-dnd.integration.test.tsx` 新增 7 例(鼠标 4、键盘 3),全部通过。手感 **移交用户**。 |
| 4. 组色:众数与平局规则;两个页面一致 | 通过 | `channel-colors.test.ts` 覆盖 `dominantChannelKind` 四种情形与 `groupAccent` 五种情形;集成用例断言 1 main + 2 aux → navy、拖出一个 aux 后平局取 main → red,以及混音页分组段同色。观感 **移交用户**。 |
| 5. 全量质量门:串行 lint → typecheck → test → build 全绿,远端 CI 全绿,lockfile 无 diff | **部分通过** | 本地:`eslint .` 与 `prettier --check .` 全绿;`@flwc/shared` 与 `@flwc/web` 的 typecheck / test / build 全绿(web 322 例、shared 42 例)。`apps/server` 与 `packages/test-utils` **本地无法安装依赖,未运行**。`git diff pnpm-lock.yaml` 为空。远端 CI 结果见第 9 节。 |

**覆盖率**(本地可跑的两个包):

- `apps/web`:语句 96.65% / 分支 91.57% / 函数 99.20% / 行 96.59%(门槛 80%)
- `packages/shared`:100% / 100% / 100% / 100%(门槛 90%)

未调低任何门槛,未新增任何覆盖率排除项。

## 3. 实现摘要

### 3.1 FLIP 补间可续接 + dnd-kit 无 transform 测量

新增 `apps/web/src/features/settings/flip-geometry.ts`:`translateOf(transform)` 取平移分量,`ownTranslateOf(element)` 取元素自身的平移,`flipTranslateOf(element)` 取元素及其全部 `[data-flip-key]` 祖先的平移之和,`naturalRect(element)` = `getBoundingClientRect()` 减去后者。

`use-flip-list.ts` 的 `measure()` 改为在**同一次遍历**里取下每个元素的自然矩形与它**自身**当前的平移(必须早于任何 `animate()` 的 cleanup,否则先被处理的元素的 transform 已被擦掉)。随后:自然位移小于 `FLIP_MIN_SHIFT_PX` 的元素**完全不碰**(在途补间继续跑);否则写 `translate(自然位移的反向 + 自身当前平移)`,即从当前视觉位置起步。写入顺序、时长、缓动、cleanup、reduced-motion、`skipNext` / `capture` 一律不变。

`VIEW_MEASURING`(放在 `dnd-config.ts`,与其它 dnd 常量同处,且是模块级常量——dnd-kit 按引用记忆该配置)把 `naturalRect` 交给 `DndContext` 的 `measuring.droppable.measure`。

**修复前后的埋点记录:未取得**(见第 1 节)。本会话能给出的证据是:

- `flip-geometry.test.ts` 8 例:`translateOf` 对 `none` / 空串 / `matrix` / `matrix3d` / `translate*` / 小数与负数 / 不认识的变换;`flipTranslateOf` 对「自身 + 两级 `data-flip-key` 祖先 + 一级无标记祖先」求和;`naturalRect` 的减法。
- `use-flip-list.test.tsx` 新增 2 例:「在途不被触碰」(走到半程后触发一次自然位置不变的提交,断言 `style.cssText` 一字未动且没有新的动画帧);「在途被再次推动」(半程 +20,自然位置再下移 40,断言写入 `translate(0px, -20px)`,下一帧 `transition` 为 `FLIP_TRANSITION`)。
- `settings-dnd.integration.test.tsx` 新增 2 例:连续三次 `ArrowDown` 不等清理,断言每个被跨过的行**恰好一次**非空 `transform` 写入且绝对值不超过 `STUB_ROW_HEIGHT`;以及 `VIEW_MEASURING.droppable.measure` 对一个带 transform 的行返回与无 transform 时相同的矩形。

### 3.2 View 模型改为有序块(配置版本 2)

`packages/shared/src/config.ts`:`viewChannelRefSchema` 去掉 `groupId`;`viewGroupSchema` 自带 `channels`;`viewItemSchema` 是按 `type` 区分的 `z.discriminatedUnion`;`viewObjectSchema` 只剩 `{ id, name, items }`;`checkViewItems` 只校验组 id 唯一与根级引用不得为 `'group'` 色。`migrateAppConfig` 是导出的纯函数,`appConfigSchema = z.preprocess(migrateAppConfig, appConfigObjectSchema)`,版本字面量 2。旧形状 `{ channelId, lastKnownName }` 的迁移从 `viewChannelRefSchema` 的 `preprocess` 搬进 `migrateAppConfig`——这一步是**硬前提**而非顺手整理:`z.preprocess` 产出的不是 `ZodObject`,没有 `.extend`,判别联合就建不起来。新增 `viewChannelRefs(view)` 与 `viewGroups(view)` 两个导出纯函数供两端共用。

`view-order.ts` 整体重写:页面层仍用扁平下标,`locateChannel(view, index)` 换算成 `{ item, member? }`,一个 `moveItemTo` 原语取代原先的 `flatten` + `swapBlocks`。既有语义一律保留(根位置按块计数、组位置按成员计数、进出组颜色转换、`UNGROUP` 原位保留、`insertChannelAt` 三字段查重、原位返回 null)。

### 3.3 列表空白区域即落点

`ChannelOrderList` 在**任何**拖动进行时都在末尾渲染 `fill` 变体落槽,`position` 为去掉被拖块后的块数,`current` 在被拖块本来就是最后一块时为 true。`rootSlotPositionsFor` 不再标末尾位置;原先只在空草稿时出现的 `fillSlot` 与 `slotAfterLast` 路径删除。`fill` 标记进入落槽的 **id**(`slot:fill:<n>`)——`resolveDropTarget` 只拿得到 id,而组只能用这一个落槽。

### 3.4 组色取成员类型众数

`dominantChannelKind(kinds)` 计数取最多、平局取最先出现、空数组 undefined。`groupAccent(group)` 无覆盖色时按组块成员**引用的 `kind`** 统计——缺失成员同样计入,树加载中颜色不抖。删除全部「首个在场成员」计算:`leadChannelKind`、`groupLeadKinds`、`leadKindOf`,以及四处组件的 `leadKind` / `groupLeadKind` props。

### 3.5 文档

`docs/architecture.md` 的「View 与失配处理」模型代码块、「通道分组」的空组/落槽/颜色三处描述、「持久化」示例(版本 2 + 一句迁移说明)、「前端结构」的脏检测、行键与 FLIP/测量一段全部改写。其中「dnd-kit 默认用 `getTransformAgnosticClientRect`,补间中的反向 transform 不会污染命中矩形」一句是 6.2.1 的结论,本批次推翻(见第 8 节)。

## 4. 数值初值清单

**无新增数值。** `FLIP_MIN_SHIFT_PX`、`FLIP_DURATION_MS`、`FLIP_TRANSITION`、`FLIP_CLEANUP_FALLBACK_MS`、`DROP_ANIMATION_MS`、`ROOT_SLOT_HEIGHT_PX`、三个传感器常量与两个自动滚动常量的值一律未动。`.root-slot--fill` 原先写死的 `min-height: 4rem` 被删除,改为由 `RootSlot` 内联 `minHeight: ROOT_SLOT_HEIGHT_PX`——这是把写死的数字换成既有常量,不是新增数值。

## 5. 真机验收操作清单(移交用户)

**安全约束**:配置页只改 view 配置(`data/config.json` 的 `views`),拖放、勾选、分组、折叠、改色与保存不会改动 Fairlight 任何参数;验收过程中不要操作混音页推子;如确需操作,只允许 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry 四个输入通道的推子并测后复原;不得切 ON/mute、不得动其它通道、不得删改任何通道。

启动:仓库根目录 `pnpm install --frozen-lockfile`(本地不受 codeload 限制)→ `pnpm dev`(server 3000 + web 5173)→ 浏览器打开 `http://localhost:5173`,确认页头 `MIXER ONLINE`。

**0. 旧配置迁移(请第一个做,且先备份)**:先把现有的 `data/config.json` 复制一份留底。启动后打开配置页,逐个 view 对照:通道顺序、分组、组内成员、颜色应当**与升级前完全一样**;空分组现在会出现在它原来的位置(版本 1 把它显示在末尾,迁移也放在末尾)。随后随便改一点再 `SAVE VIEW`,用编辑器打开 `data/config.json`,确认顶部 `"version": 2`,且 view 变成 `items` 数组、组块自带 `channels`。**注意这一步不可逆**:写回后就是版本 2,旧版本的程序读不了(留底就是为此)。

鼠标路径(桌面浏览器):

1. 建一个临时 view 做验收,勾 5–6 个通道,`SAVE VIEW`。
2. **快速拖过多行(本批次核心)**:按住第 1 行把手,**快速**拖到第 5、6 行下方再拉回来,反复几次。预期:被挤开的行各自平滑滑动一次,**不再出现「滑一半突然弹回再滑一次」**;拖得再快也不该看到行跳动。这是第 1 节修的问题,请重点看。
3. 把一行拖到列表**下方的空白区域**(最后一行以下、列表框以内)松手。预期:落在最后。以前那里是落空的。
4. 从左侧 AVAILABLE 拖一个未勾选通道到同一片空白区。预期:追加为最后一行,左侧勾选框同步勾上。
5. `NEW GROUP` 建一个组(它出现在列表末尾),**不要**放任何通道进去。用组头的箭头把它上下移动;再按住组头把手整组拖动。预期:都能动——空组现在和别的块一样有位置。
6. 把一个通道拖到那个空组**之后**(空组下方的空白区)。预期:成为独立的无组行,不会被吸进组里。再拖到空组**之前**,预期:成为它上面的一行。
7. 按住某个组的组头把手,拖到列表下方的空白区松手。预期:整组移到末尾。
8. **组色**:建一个组,放进 1 个 main + 2 个 aux。预期:组头与跟随组色的成员行都是 aux 的颜色(navy)。把其中一个 aux 拖出组。预期:变成 main 的颜色(red)——1 比 1 平局时取成员里最先出现的类型。
9. `SAVE VIEW` 回到混音页切到该 view。预期:分组段标题颜色与配置页组头一致。
10. 若系统开启「减弱动态效果」,重复第 2 步。预期:无补间,直接到位。

触屏路径(平板):

1. 手指按在某行把手上不动约 `TOUCH_ACTIVATION_DELAY_MS`(当前 100ms)起拖,拖到列表下方空白区松手。预期:落在最后。
2. 长按组头把手整组拖到空白区;长按空组的把手移动它。
3. 快速拖过多行,看第 2 步那条补间问题在触屏上是否也消失。

键盘路径(桌面浏览器):

1. Tab 到某行把手,Space 拾起,连按 ↓ **快速**跨过多行。预期:每行只被挤开一次,没有重复补间。
2. 列表末尾是一个分组时,从它上面的行 Space 拾起,一路 ↓。预期:能停到「列表末尾」(读屏会念 `the end of the list`),再按 ↓ 不再移动;Space 落下即成为最后一行。
3. 被拖的行本来就是最后一块时按 ↓。预期:不动(那个落槽就是它现在的位置)。

## 6. 交付物清单

| 文件 | 改动 |
| --- | --- |
| `apps/web/src/features/settings/flip-geometry.ts` | 新增:`translateOf` / `ownTranslateOf` / `flipTranslateOf` / `naturalRect` |
| `apps/web/src/features/settings/flip-geometry.test.ts` | 新增:8 例 |
| `apps/web/src/features/settings/use-flip-list.ts` | 测量改自然位置,在途不碰 / 可续接 |
| `apps/web/src/features/settings/dnd-config.ts` | 新增 `VIEW_MEASURING` |
| `apps/web/src/features/settings/ViewDndContext.tsx` | 接 `measuring`;overlay 去掉 `leadKindOf`,改用 `groupOfIndex` / `viewGroups` |
| `packages/shared/src/config.ts` | 模型改 `items`,`migrateAppConfig`,版本 2,`viewChannelRefs` / `viewGroups` |
| `packages/shared/src/views.ts`、`index.ts` | 写入体与导出同步 |
| `apps/web/src/features/settings/view-order.ts` | 整体重写(`locateChannel` / `moveItemTo` / `*At` 变体 / 三个新纯函数) |
| `apps/web/src/features/settings/view-dirty.ts` | 按 `items` 比较,抽出 `sameViewItems` |
| `apps/web/src/features/settings/row-keys.ts`、`drop-resolver.ts`、`drag-preview.ts`、`dnd-collision.ts`、`dnd-ids.ts` | 按新模型改写;`slot` 加 `fill` |
| `apps/web/src/features/settings/ChannelOrderList.tsx` | 块序列直接来自 `viewBlocks`;常驻末尾落槽 |
| `apps/web/src/features/settings/SortableGroupBlock.tsx` | `EmptyGroupBlock` 改为真正的 sortable 项 |
| `apps/web/src/features/settings/SortableChannelRow.tsx`、`SettingsPage.tsx`、`RootSlot.tsx` | 按新模型改写 |
| `apps/web/src/features/mixer/view-resolver.ts`、`channel-colors.ts`、`MixerPage.tsx`、`MissingChannelStrip.tsx` | 按 `items` 解析与切段;众数色;删 `leadChannelKind` |
| `apps/web/src/styles.css` | `.root-slot--fill` 去掉写死的 `min-height` |
| `apps/web/tests/view-fixtures.ts` | 新增:单测与集成共用的 `channelRow` / `channelGroup` / `viewOf` |
| `apps/web/tests/flip-writes.ts` | 只记录 transform 的**变化**(见第 8 节) |
| `apps/web/tests/stub-layout.ts` | 矩形带上在途平移(见第 8 节) |
| `apps/server/src/config/config-store.test.ts`、`src/api/views.test.ts` | 版本 2 夹具 + v1→v2 用例(**本地未运行**) |
| `docs/architecture.md` | 四节改写 |
| `docs/reports/phase-6-2-2-report.md` | 本报告 |

## 7. 依赖清单与许可确认

**无新增依赖,`pnpm-lock.yaml` 无 diff**(`git diff --quiet pnpm-lock.yaml` 通过)。本会话只安装了 `@flwc/web` 与 `@flwc/shared` 两个工作区(`pnpm install --frozen-lockfile --filter @flwc/web --filter @flwc/shared`),未使用 `playwright-core`。

## 8. 关键决策与偏离

- **FLIP 的起点公式取「元素自身的平移」而非提示词写的 `flipTranslateOf`**。提示词第 1 节写 `shift = (上次自然位置 + flipTranslateOf) - 本次自然位置`,同时又保留 `parentShift` 相减。对根级行两者完全等价;对组内成员,`flipTranslateOf` 含祖先组块的平移,与 `parentShift` 相减会**重复计入**——表现就是:拖动一个组块,在它 120ms 补间没跑完时再推一行过去,该组每个成员都会被踢一下,正是本批次要修的问题在下一层复现。故实现取元素自身的平移;`flipTranslateOf`(累计)只用于 `naturalRect`,因为 `getBoundingClientRect` 确实含全部祖先变换。两个函数并排放在 `flip-geometry.ts` 里并注明用途,提示词要求的两条单测断言在两种写法下结果相同。
- **`translateOf` 必须解析 `translate(...)` 系列,不只是 `matrix`**。提示词只列了 `none` / `matrix` / `matrix3d`,但 jsdom 的 `getComputedStyle` 不做计算、原样回读内联值(已用一次性探针确认:写入 `translate(0px, 20px)`,`getComputedStyle` 读回同一字符串)。只认 `matrix` 的话,提示词自己要求的「在途被再次推动」单测会读到 0,写出 `-40px` 而不是 `-20px`。
- **布局 stub 必须把在途平移加回矩形**(`stub-layout.ts`,以及 `use-flip-list.test.tsx` 的 `rectFor`)。两个 mock 原先返回纯布局矩形,而 `naturalRect` 会减去一份 mock 从未加过的平移,于是正在跑的补间被当成布局变化——修复反而成了倒退。提示词只把它当作一种可选的测试手法,实际是必需的。
- **`movedIndex` 的引用相等改为返回落点下标**。`drag-preview.ts` 原先用 `!before.channels.includes(reference)` 靠对象标识定位被拖项,依赖「除被改的引用外一律复用同一对象」这条不变式。改成 `items` 后这条不变式更难守(组块必须重建,但成员数组里的每个对象都得是原件),而且破坏时**完全静默**:`findIndex` 返回 -1,占位行消失,类型检查与既有单测都不报错。改为 `moveChannelToAt` / `insertChannelAtAt` 返回 `{ view, index }`——`placeReference` 本来就知道落点,代价约 20 行,把一条看不见的别名约定换成类型系统能查的返回值。
- **`viewObjectSchema.items` 给了 `.default([])`**(提示词的代码块里没有)。否则 `POST /api/v1/views { name }` 会开始 400,而 `viewObjectSchema.groups` 原本就有 `.default([])`,保留它才能守住「只给名字就能建 view」这条既有行为。
- **`fill` 编进落槽的 id 而不是只放在 droppable 的 `data` 里**。`resolveDropTarget` 只拿得到 id,而「组只能落在末尾那个落槽」这条规则要在它里面判。`DndItemData` 也同时带上 `fill`,`isEligibleTarget` 用它在碰撞层过滤。
- **`removeAt` 刻意不清理被清空的组**。组块留在原位是「空组也是有位置的块」的直接后果,而且 `ChannelOrderList` 的 `remaining` 与 `drop-resolver` 的 `base` 必须数出同一个块数——顺手「整理掉」空组会让两边差一,之后每一次落在该组之后的拖放都会错位一格。已写进 `view-order.test.ts` 的用例。
- **`ChannelOrderList` 的 `isDragged` 判定改写**。原先把「只有一个成员且该成员正被拖」的组也算作被拖块——在旧模型下正确(那个组会从 `nonEmptyBlocks` 消失),在新模型下错误(组会留下来占位)。现在按被拖项本身在块序列里的下标算,`currentPosition` 直接就是那个下标(把块取出再放回原位是空操作)。
- **两处既有断言按规格删除**(已与用户确认):
  1. `view-resolver.test.ts` 原断言「同一个组的非连续成员切成两段(`Rhythm` / `Vocals` / `Rhythm`)」。组自带成员之后这情形结构上不可能出现,断言意图无处安放;替换为「每个组块恰好一段」与「空组不产生段」两条。
  2. `apps/server/src/api/views.test.ts` 原断言「POST 一个旧形状写入体会被迁移」。提示词明确要求 `viewWriteBodySchema` 不再兼容旧写入体。该用例的**读取**一半保留并扩写为 v1→v2 迁移用例,**写入**一半改为断言旧形状被 400 拒绝(意图下移一层:旧形状迁移的断言现在在 `packages/shared/src/config.test.ts` 里,覆盖更细)。
- **`view-order.test.ts` 的 `expectContiguousGroups` 被替换**。它断言「每个组的成员下标连续」,在 `items` 下恒真。替换为 `expectConsistentBlocks`:块给出的下标恰好是 0..n-1 的顺序,且块数等于 `items` 长度——这才是新模型下还能出错的那条不变式。
- **推翻 6.2.1 报告第 8 节的一条结论**。那里写「不需要给 `DndContext` 配 `measuring`,dnd-kit 的 droppable 默认测量就是 `getTransformAgnosticClientRect`」。该结论对**元素自身**的 transform 成立,但组内成员是被所属组块带着走的,祖先的平移它反解不掉。本批次据此加上 `measuring`,并已改写 `docs/architecture.md` 里对应的那句。
- **`flip-writes.ts` 改为只记录 transform 的变化**。补间的一次启动会写 `transition` 与 `transform` 两次样式,rAF 回调又先写 `transition`(此时 transform 还在)再清 transform,于是一次补间在 MutationObserver 里表现为同一个值出现两次。既有用例用 `toContainEqual` 没察觉;本批次要数「每行恰好一次」就必须去重。这不是放宽断言,而是让记录器数的是补间而不是样式写入。
- **`assignGroup` 删掉了「原组已无其它成员则留在原位」的特判**。新模型下不需要:被清空的组块留在原位,出组的行插在它之后,落点与原来一模一样。既有用例的意图(不跳到列表底部)原样保留。
- **两个键盘用例按实际行为改写,而不是按提示词的字面描述**:
  - 「从最后一行 ArrowDown 停在 `the end of the list`」在**平铺列表**里不成立:最后一行自己的下半就是那个边界,末尾落槽只在最后一块是**分组**时才是唯一通路。用例改为在末尾是分组的列表上验证,断言 dnd-kit 的 live region 里出现过 `the end of the list`、再按 ↓ 不再变化。
  - 「空组 + 空列表之间来回」的既有用例:空组现在是块,它上方的边界因此有了自己的落槽,拾起时最近的目标是那个落槽而不是组。用例改为走完整序列(槽上 → 组内 → 末尾槽 → 回组内),意图不变。
- **`settings-groups.integration.test.tsx` 的 mixer 快照加了一个 aux 通道(`aux/2` REV)**,因为「1 main + 2 aux」的众数用例需要两个 aux。

## 9. 被改写的既有用例清单

| 文件 | 用例 | 改写性质 |
| --- | --- | --- |
| `packages/shared/src/config.test.ts` | 全部 9 例 | 夹具改 `items`;「defaults groups to an empty list」→「defaults items to an empty list」;「migrates legacy…references」意图下移为 `migrateAppConfig` 用例;「rejects dangling group references and duplicate group ids」的悬空部分结构上消失,意图下移为迁移用例「groupId 指向不存在的组按无组处理」;`{version:2}` 拒绝 → `{version:3}`。另新增 `migrateAppConfig` 8 例 |
| `apps/web/src/features/settings/view-order.test.ts` | 全部 | 夹具改 `items`;`nonEmptyBlocks` describe → `viewBlocks`;`expectContiguousGroups` → `expectConsistentBlocks`;`colorForMembership` 改新签名;「refuses to move past an empty group block」→「steps over an empty group like any other block」(行为按规格反转);`moveGroup`/`moveGroupTo` 对空组由 null 改为可移动;`rootSlotPositions` 去掉末尾位置;越界位置整体 +1(块数含空组) |
| `apps/web/src/features/settings/view-dirty.test.ts` | 全部 6 例 | 夹具改 `items`;「detects group membership…」改为结构比较;新增「空组移动也算脏」「行变成组」两例 |
| `apps/web/src/features/settings/drop-resolver.test.ts` | 全部 8 例 | 夹具改 `items`;root 位置按全部块计数,末尾位置由 null 改为有效;`group:g3`(空组)由 null 改为可落 |
| `apps/web/src/features/settings/drag-preview.test.ts` | 全部 | 夹具改 `items`;`groupId` 断言改用 `groupOfIndex` |
| `apps/web/src/features/settings/row-keys.test.ts`、`dnd-ids.test.ts`、`dnd-collision.test.ts` | 相关例 | 夹具改 `items`;`slot` 数据加 `fill`;新增 `slot:fill:` 的解析与拒绝 |
| `apps/web/src/features/mixer/view-resolver.test.ts` | 全部 | 夹具改 `items`;segmentation 的非连续同组断言按规格删除(见第 8 节),替换为两条新断言 |
| `apps/web/src/features/mixer/channel-colors.test.ts` | 2 例 | 改写为众数规则;新增 `dominantChannelKind` 一例 |
| `apps/web/src/lib/views-api.test.ts`、`src/store/view-store.test.ts`、`DiscardChangesDialog.test.tsx` | 夹具 | 仅形状 |
| `apps/web/tests/settings-dnd.integration.test.tsx` | 全部 | 夹具改 `items`;`savedChannels()` → `savedItems()`;两个空组相关用例按新行为改写(见第 8 节) |
| `apps/web/tests/settings-groups.integration.test.tsx` | 全部 | 夹具改 `items`;「clears a group colour back to its first present member」→「…to the kind most of its members are」;出组落点由「留在原地」变为「组块之下」 |
| `apps/web/tests/settings-palette.integration.test.tsx`、`settings-dirty…`、`settings-row-controls…`、`views.integration…` | 夹具与保存体断言 | 形状为主;`views.integration` 的「空组箭头禁用」改为「可上移、下移到底禁用」(行为按规格反转) |
| `apps/server/src/config/config-store.test.ts` | `{version:2}` → `{version:3}`;`save` 版本 2;新增 v1→v2 用例 | **本地未运行** |
| `apps/server/src/api/views.test.ts` | 全部 7 例夹具改 `items`;`persisted.version` 1→2;旧写入体由「被迁移」改为「被 400 拒绝」 | **本地未运行** |

## 10. 遗留问题与移交事项

- **`apps/server` / `packages/test-utils` 的依赖在本会话装不上**。`pnpm install --frozen-lockfile` 在 `emberplus-connection` → `asn1`(`https://codeload.github.com/evs-broadcast/node-asn1/tar.gz/0146823…`)上 403。6.2 报告第 7 节的绕行办法(`git clone` 打本地 tarball → 临时改 lockfile → 安装 → 还原 lockfile)在本会话被沙箱分类器判为 *Package Registry Bypass* 并拒绝;我没有尝试绕过。**后果**:server 的两个测试文件从未在本地运行,浏览器冒烟完全没做。如果希望后续云端会话能跑全量,需要用户为该操作放行,或在环境里预置该 tarball。
- **提示词第 1 节要求的「修复前/修复后埋点对比」没有产出**。这是本批次唯一一项完全缺失的验收证据。jsdom 本身也复现不了这个 bug(它不跑 CSS transition,补间的中间态不存在),所以集成测试只能守住「每跨一行恰好一次补间」这条不变式,不能证明修复前会失败。**修复的正确性在本会话只由单元测试与推导支撑,观感与真实计时请在真机上按第 5 节第 2 步重点确认。**
- **不可逆的配置升级**:保存一次之后 `data/config.json` 就是版本 2,旧版本程序读不了。第 5 节第 0 步要求先备份。
- **既有的间歇性超时**(6.2.1 报告第 9 节记录):`settings-dirty.integration.test.tsx` 的 `shows the three dirty indicators…` 在四包并行 `pnpm test` 高负载下会触发 5s 超时。本会话只跑了两个包,未复现;未修改该用例。
- **留给 6.3–6.5 的事项**(本批次未动):触屏容差调参与 `touch-action: none` 的语义矛盾、`:hover` 媒体查询、页头压缩时组头 9 列的复核。
- **无需回写 `docs/fairlight-ember.md`**:本批次没有 Ember+ 踩坑条目。
- **`docs/development-plan.md` 的 6.2.2 验收框**留给用户在真机验收后勾选。

## 11. 提交记录

| 提交 | 说明 |
| --- | --- |
| `a1cdf9b` | `fix(web): keep FLIP tweens resumable and measure droppables naturally` |
| `26f4744` | `feat(shared)!: store a view as ordered items and read version 1 forward` |
| `e2b518a` | `refactor(web): rebuild the view ordering helpers on ordered items` |
| `f069a0a` | `refactor(web): render ordered items on both pages` |
| `1488ec8` | `feat(web): make the empty area below the list a drop target` |
| `905ce5b` | `feat(web): colour a group by the kind most of its members are` |
| `904ba44` | `docs: describe the ordered item model, the end slot and the colour rule` |
| `202a48a` | `fix(shared): keep the group a legacy reference named when migrating it`(远端 CI 发现,见下) |
| `a17706d` | `docs: add the Phase 6.2.2 execution report` |

第一次推送后远端 CI 的 `apps/server` 测试报出一处**真实缺陷**:`migrateLegacyChannelRef` 按已知字段重建引用对象时把 `groupId` 丢掉了,于是版本 1 文件里「旧引用形状 + 归属某个组」的条目迁移后会失去分组。该形状早于分组功能,正常写出的文件不会同时具备两者,但手改过的文件可以。已由 `202a48a` 修复并在 shared 补了用例(覆盖率仍 100%)。**这正是本地装不上 server 依赖所漏掉的那一类问题**,如实记录。

跨包的模型切换使 `26f4744`、`e2b518a`、`f069a0a` 三个中间提交**不能各自独立通过 typecheck**(shared 已换模型而 web 尚未跟上),提交粒度按提示词建议的分段拆分,已与用户确认;只保证推送的 head 全绿。`1488ec8` 之前另有两条集成用例处于已知失败状态(末尾落槽与组色分别由 `1488ec8`、`905ce5b` 修复)。
