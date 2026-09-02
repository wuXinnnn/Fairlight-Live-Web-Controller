# Phase 5 执行报告 — Views 配置

## 1. 结果总览

Phase 5 云端范围已全部完成,并在后续一批调整中收敛为当前形态:共享层的 View 通道引用改为「类型 + 名称」匹配(Fairlight Live 不提供稳定通道 ID,插入/重排会重新编号),旧的 `{ channelId, lastKnownName }` 数据在读取时原地迁移;View 新增命名分组,配置页以「块」结构编辑分组,混音页以 `All Channels` 的类型分区样式展示组名;配置页拥有独立路由 `/views`(浏览器前进/后退可用,生产环境由 Fastify 提供 SPA 回退),页头改为次级页面的返回按钮,页面改为视口内工作台并修复了整页滚动条;后端确认 Ember+ S101 keepalive 由 `emberplus-connection` 自动维持并加了守护测试。最终 HEAD 的 lint / typecheck / test(覆盖率门槛)/ build 全绿,Mock Ember+ Provider 浏览器端到端冒烟通过。云端未连接真实 Fairlight,真机手动验收按边界移交用户。

## 2. 验收标准逐条核对

| 验收标准 | 结果 | 实际执行与输出摘要 |
| --- | --- | --- |
| views CRUD 与持久化 | 通过 | `apps/server/src/api/views.test.ts` 覆盖创建、列表、更新、删除、服务端 UUID、404、非法名称/颜色/类型/悬空 `groupId`/重复组 id 的 400、并发创建、持久化往返、旧形状引用在读取与写入时的迁移、损坏配置恢复。 |
| 颜色配置与默认回退 | 通过 | shared 校验六个 palette key 且 `color` 可选;web 单元与集成测试覆盖六类默认色、自定义覆盖、清除回退和非法 key 拒绝。 |
| 按名称匹配、失配、树变化与主动清理 | 通过 | `view-resolver.test.ts` 覆盖两遍认领、同名优先 id、单次认领、改名不回退 id、重复名集合、连续段切分;集成测试覆盖通道重新编号后 View 仍命中、改名后转为占位、patch 移除后延迟切换为占位、二次确认清理只移除失效引用并保留分组;首个已连接快照到达前保持等待态且禁止清理;已加载后保留缓存清单穿越 status-only reconnect 和空的非 connected socket handshake。 |
| 通道分组 | 通过 | `view-order.test.ts` 覆盖块切分、组内/跨块移动、整组移动、空组阻挡、分配到组尾、解散原位保留、增删改组;集成测试覆盖建组(空名报错)、分配、组内与整组上下移动及 `data-moved` 动效标记、改名、保存 PUT 含 `groups`/`groupId` 且顺序连续、单击解散、未保存时切换 View 丢弃草稿、`DUPLICATE NAME` 标注、混音页组标题/计数/组内占位、含分组 View 的 `TYPE ROWS`。 |
| 路由与页面壳 | 通过 | `router.test.ts` 与 `routing.integration.test.tsx` 覆盖 `/views` 直达、`CONFIGURE VIEWS` 推入历史、popstate 前进/后退、返回按钮、路由切换 `scrollTo(0, 0)`;`app.test.ts` 覆盖 `GET /views` 返回 SPA shell、`/api` 未命中与非 GET 仍 404。 |
| Ember+ keepalive | 通过 | `apps/server/src/ember/keepalive.test.ts`:连接 Mock Provider 后库布防 10 s 的 keepalive 定时器,手动触发一次请求后 700 ms 内未断线;对不应答的裸 TCP server 触发后约 500 ms 收到 `disconnected`。 |
| 空 View、空配置、激活态与排序 | 通过 | 零 View 时 `All Channels` 正常显示;零通道 View 显示独立空态;激活 id 写入 `localStorage`,无效或已删除 id 回退全部通道;View 模式严格按持久化引用顺序渲染。 |
| 覆盖率达标 | 通过 | `packages/shared`:语句/分支/函数/行 100%;`apps/server`:语句 92.93%、分支 83.36%、函数 97.23%、行 92.95%;`apps/web`:语句 95.97%、分支 90.15%、函数 97.64%、行 95.71%。 |
| 全量质量门 | 通过 | 在最终 HEAD 串行执行 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` 全绿。shared 29、test-utils 22、server 108、web 105,共 264 项测试通过;Vite 生产构建成功。 |
| Mock Provider 端到端冒烟 | 通过 | Mock Provider 运行于 `127.0.0.1:9100`,`GET /api/v1/connection` 返回 `connected`;Playwright(预装 Chromium)在 1280×800 与 1920×1080 下验证 `/views` 无整页滚动条、混音页超过一屏仍可整页滚动、分组配置页与混音页组分区/`TYPE ROWS` 渲染正确;生产构建下 `GET /views` 返回 `index.html`,`GET /api/v1/nope` 返回 404 JSON。全过程未触碰 ON 或推子。 |
| 本地真实 Fairlight 手动验收 | 移交用户 | 云端无真机访问能力。操作清单见第 4 节。 |

## 3. 实现摘要

- **通道引用模型**:`viewChannelRefSchema` 输出 `{ kind, name, channelId?, groupId?, color? }`。`kind + name`(`name` 为通道 `name` 参数,与节点 `description` 相同)是匹配键,trim 后精确、大小写敏感;`channelId` 是勾选时的逻辑 id,只在多个实时通道同名时用于优先裁决。`z.preprocess` 只在输入同时含字符串 `channelId` 与 `lastKnownName` 且无 `name` 时迁移旧形状,其它输入原样交给对象 schema 报错;不提升配置 `version`。`viewObjectSchema` 是未加校验的对象形状,`viewSchema` 与 `viewWriteBodySchema`(`omit({ id })`)各自用同一个 `checkViewGroups` 做 `superRefine`,避免 zod 4 在 `.omit` 时丢失校验。
- **解析器**(`apps/web/src/features/mixer/view-resolver.ts`,混音页与配置页共用):第一遍认领 `kind + name + channelId` 全同的通道,第二遍为剩余引用认领第一个未认领的同 `kind + name` 通道,每个实时通道至多被认领一次;名称不匹配时不回退到 id。`duplicateChannelNames` 供配置页标注 `DUPLICATE NAME`;`segmentViewChannels` 把解析结果按连续同组切成段。
- **REST CRUD**:`GET/POST /api/v1/views` 与 `PUT/DELETE /api/v1/views/:id` 全部经 shared zod schema 校验。id 使用 Node `crypto.randomUUID()`,未知 id 返回 `NOT_FOUND`,非法负载(空名、非法颜色/类型、悬空 `groupId`、重复组 id)返回 `VALIDATION`;服务端不检查通道当前是否存在,不强制组成员连续,也不自动清理或改写 View。旧形状 body 被接受并以新形状回写。
- **持久化**:复用 Phase 3 `ConfigStore.update()`,与 Ember endpoint 共存于 `data/config.json`,保持串行更新和临时文件 rename 原子写入;旧文件加载后回写即完成迁移。
- **viewStore**:封装列表加载与 CRUD 状态,保存错误可见;激活 View 仅作为浏览器偏好保存于 `flwc.views.activeId.v1`,不会写入后端配置。
- **配置工作台**:保持 01 VIEWS / 02 AVAILABLE CHANNELS / 03 CHANNEL ORDER & COLOR 三块结构。03 区新增 `NEW GROUP` 工具条;列表以块结构渲染:组块(可编辑名称、在场成员数、整块上下移动、单击 `UNGROUP` 解散且成员原位保留)与无组单行;每行新增 `GROUP` 下拉(`NO GROUP` | 各组),选定后移动到目标组块末尾;`UP`/`DN` 改为箭头图标按钮(`OrderButtons`),成员在组内移动、无组行跨过相邻块、空组块不可被越过;被移动的行或组块用 `data-moved` 播放一次 `translateY` 回位 + 琥珀底色的短动效。所有分组操作只改本地草稿,由 `SAVE VIEW` 统一保存,误操作不保存即可放弃。失配项显示引用名称,二次确认后才清理且清理不删组;同名实时通道标注 `DUPLICATE NAME`。窄列(容器查询 ≤ 44rem)把调色板换到第二行。
- **混音页**:始终提供 `All Channels`。全部通道模式保留 Phase 4 类型分区和 `TYPE ROWS`;View 模式按连续段渲染:同组段复用 `mixer-section` 标记(竖排组名 + 在场计数,组头色取组内第一个在场成员的解析色),无组引用平铺;含分组的 View 显示 `TYPE ROWS`(文案 "Start each group on a new row"),横排模式下无组条带另起一行。推子、ON、meter、控制锁行为不变。
- **失配占位**:解析不到实时通道的引用使用同尺寸条带、引用名称、`MISSING` 与 `CHANNEL REFERENCE UNAVAILABLE`,不渲染 ON、推子或 meter;刚从清单消失的通道沿用退场动效。`channelInventoryLoaded` 仅由已连接快照首次置为有效,缓存清单穿越 status-only reconnect 与空的非 connected handshake 的规则不变。
- **路由与页面壳**:`lib/router.ts` 用 history API 自绘(`useSyncExternalStore` + `popstate` + 内部监听器,因 `pushState` 不触发 `popstate`),`/` 混音页、`/views` 配置页,未知路径回退混音页;两页互斥挂载,路由变化时 `scrollTo(0, 0)`,`history.scrollRestoration = 'manual'`。Fastify 在托管静态产物时对非 `/api` 的 GET 未命中返回 `index.html`。配置页页头为 `[返回按钮][面包屑 eyebrow + 标题][连接状态]`,返回按钮是内联 SVG 左箭头 + `MIXER` 小字,可访问名仍为 `RETURN TO MIXER`。
- **滚动根因与修复**:Playwright 实测两种视口下 `document.scrollHeight` 恒为 1116 px、`body` 却与视口等高,溢出来自 `.channel-checklist input { position: absolute }`——视觉隐藏的复选框没有定位祖先,逃出了清单的 `overflow: auto` 裁剪区并把文档滚动区撑大,通道越多越明显。修复为 `label { position: relative }`;同时把配置页改为视口内工作台(`height: 100vh; overflow: hidden`,两列各自滚动,清单以 flex 填满剩余高度并内部滚动),800px 以下恢复整页滚动。
- **Ember+ keepalive**:`emberplus-connection@0.3.1` 的 `S101Client` 在 TCP 连上时 `startKeepAlive()`:每 10 s 发 KeepAliveRequest、自动应答 Provider 的请求、500 ms 无应答即 `handleClose()`,以 `disconnected` 进入 `EmberService` 的退避重连。间隔与窗口是库内部常量,没有公开配置项,因此后端不新增开关;在客户端工厂处加注释并用守护测试锁定该行为。
- **视觉一致性**:新控件继续复用 Phase 4 的石墨 surface、琥珀交互、Barlow Condensed/IBM Plex Mono、锐利边框、短动效与 reduced-motion;单通道颜色继续通过 `--channel-accent` 注入,meter 信号色不受 View palette 影响。未引入浅色主题、第二套 token、UI 库、路由库、图标库或拖拽库。

## 4. 真机验收操作清单(移交用户)

开发机连接真实 Fairlight Live 时,只允许拖动 **MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry** 四个输入通道的推子并在测试后复原。不得切换任何 ON/mute,不得操作其它通道或参数,不得删改任何真机通道。

1. 在仓库根目录运行 `pnpm install`,再运行 `pnpm dev`。
2. 通过既有 connection REST 配置真实 Ember host/port,等待 `GET /api/v1/connection` 返回 `connected`。
3. 仅用 `http://localhost:5173` 打开前端。
4. 确认默认 `All Channels` 显示当前完整通道树。点击 `CONFIGURE VIEWS`,地址栏应变为 `/views`;按浏览器后退回到混音页、前进再回到配置页;直接刷新 `/views` 应仍是配置页。
5. 创建一个测试 View,仅勾选应用内 View 引用,例如 MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry;调整顺序与 palette、改名并保存。此类操作只写应用配置,不写 Fairlight,可放心操作。
6. 在 `NEW GROUP` 输入名称并 `ADD GROUP`,用每行的 `GROUP` 下拉把两个通道编入该组,用箭头按钮在组内与整组移动,确认行有短动效;改组名后 `SAVE VIEW`。单击 `UNGROUP` 后不保存、重新点选该 View,确认分组恢复。
7. 返回主页切换测试 View,确认组名以类型分区样式显示、计数正确、无组通道平铺、切换无整页闪烁;打开 `TYPE ROWS` 确认组段横排。
8. 配置页一屏能放下所有容器时不应出现整页滚动条;通道多时只有清单内部滚动。
9. 刷新页面,确认激活 View 恢复;删除激活 View 后确认自动回退 `All Channels`。
10. **名称匹配验收(只读操作)**:如当前 show 允许,在 Fairlight 内把一个不在允许清单里的通道拖动到 View 引用通道之前以改变编号(这是 Fairlight 侧的顺序调整,不删改通道;如不确定是否安全则跳过),回到混音页确认 View 仍命中同名通道;复原顺序。
11. 如需确认现有推子行为未回归,只能选上述四个允许通道之一,记录原值、小幅移动后立即精确复原。不得点击 ON。
12. **失配验收必须使用 Mock Provider 或已有的自然失配配置。不得为制造 MISSING 状态而删除、改名、重排或断开真实 Fairlight 通道。** 在 Mock 环境删除/改名快照通道后,确认占位显示引用名称,其它条带仍正常;在配置页二次确认清理后只移除失效引用且分组保留。
13. 长时间(≥10 分钟)不操作后确认连接状态仍为 `MIXER ONLINE`;若日志周期性出现 `ember socket disconnected`,记录间隔(约 10 s 一次通常指向 keepalive 的 500 ms 应答窗口)。

## 5. 交付物清单

| 路径 | 用途 |
| --- | --- |
| `packages/shared/src/config.ts` | palette key、`kind + name` 通道引用(含旧形状迁移)、分组模型与组完整性校验 |
| `packages/shared/src/views.ts` | views REST 共享请求/响应 schema(与 `viewSchema` 共用组校验) |
| `apps/server/src/api/views.ts` | views CRUD 路由、校验和统一错误响应 |
| `apps/server/src/runtime.ts` | 原子化 views 列表/创建/更新/删除能力 |
| `apps/server/src/app.ts` | REST 注册与静态托管;非 `/api` GET 未命中返回 SPA shell |
| `apps/server/src/ember/ember-service.ts` | Ember+ 连接生命周期;客户端工厂处说明库管理的 keepalive |
| `apps/server/src/api/views.test.ts`、`apps/server/src/app.test.ts`、`apps/server/src/ember/keepalive.test.ts` | CRUD/迁移/组校验、SPA 回退、keepalive 守护测试 |
| `apps/web/src/lib/router.ts` | history API 路由与 `useRoute` |
| `apps/web/src/lib/ids.ts` | 非安全上下文可用的本地 id 生成(组 id) |
| `apps/web/src/lib/views-api.ts` | 浏览器 views REST client 与响应校验 |
| `apps/web/src/lib/socket.ts` | Socket 事件绑定;仅在接受 inventory 快照时重播 meter seed |
| `apps/web/src/store/view-store.ts` | views 状态、错误与激活偏好持久化 |
| `apps/web/src/store/mixer-store.ts` | 通道 inventory、连接态与空握手缓存保留规则 |
| `apps/web/src/features/mixer/view-resolver.ts` | 按 `kind + name` 解析引用、重复名检测、连续段切分 |
| `apps/web/src/features/settings/view-order.ts` | 块结构、组内/跨块/整组移动、分组分配与增删改组的纯函数 |
| `apps/web/src/features/settings/OrderButtons.tsx` | 箭头图标排序按钮 |
| `apps/web/src/features/settings/SettingsPage.tsx` | View 配置工作台(分组块、分组下拉、返回按钮页头) |
| `apps/web/src/features/mixer/ViewSelector.tsx` | 主页 View 切换控件 |
| `apps/web/src/features/mixer/MissingChannelStrip.tsx` | 无交互失配占位条带 |
| `apps/web/src/features/mixer/MixerPage.tsx` | All/View 两种布局、组段渲染与顺序投影 |
| `apps/web/src/features/mixer/TypeRowToggle.tsx` | `TYPE ROWS` 开关(可定制可访问文案) |
| `apps/web/src/features/mixer/channel-colors.ts` | shared palette key 到 CSS 色值及默认回退 |
| `apps/web/src/App.tsx` | 路由驱动的页面挂载与滚动重置 |
| `apps/web/src/styles.css` | 配置页视口内工作台、返回按钮、组块/排序动效/分组下拉与混音页组段样式 |
| `apps/web/src/features/mixer/view-resolver.test.ts`、`apps/web/src/features/settings/view-order.test.ts`、`apps/web/src/lib/router.test.ts`、`apps/web/src/lib/ids.test.ts` | 解析器、排序/分组、路由、id 单元测试 |
| `apps/web/src/store/view-store.test.ts`、`apps/web/src/store/mixer-store.test.ts`、`apps/web/src/lib/socket.test.ts`、`apps/web/src/lib/views-api.test.ts` | 前端状态、inventory 生命周期、Socket 快照与 REST client 单元测试 |
| `apps/web/tests/views.integration.test.tsx`、`apps/web/tests/routing.integration.test.tsx` | View 用户流程、名称匹配、分组、失配、清理、空态、重连、路由与滚动集成测试 |

## 6. 依赖清单与许可确认

本阶段未新增 npm 依赖,继续使用项目既有 MIT/MIT 兼容依赖。排序使用箭头按钮自绘,路由用 history API 自绘,图标为内联 SVG,不引入路由库、UI 组件库、图标库或拖拽库。云端冒烟用的 `playwright-core` 只安装在会话临时目录,不进入仓库。

## 7. 关键决策与偏离

- `docs/development-plan.md` 早先的「Ember 路径 + 最后已知名称」按架构原则实现为逻辑通道模型;当前进一步以 `kind + name` 为匹配键,`channelId` 降级为同名裁决用的最后已知 id。原因:Fairlight Live 不暴露稳定通道 ID,插入或调整次序会重新编号,任何基于 identifier 的键都会错位。名称不匹配时不回退到 id,宁可显示 MISSING 也不控制错误的推子。
- 旧持久化形状在 schema 层原地迁移而不提升 `version`,旧 `config.json` 可直接加载并在下次写入时转为新形状。
- 组 id 由前端 `createLocalId()` 生成而不是 `crypto.randomUUID()`:后者在浏览器里只存在于安全上下文,本应用是明文 HTTP 局域网部署。服务端只校验组 id 唯一与 `groupId` 指向已存在的组。
- 同组成员在 `channels` 数组中保持连续由编辑器维护,服务端不强制;混音页与配置页都按连续段解释,外部编辑造成的不连续会渲染为多个同名段。
- 分组操作与其它编辑一样只改本地草稿,`UNGROUP` 单击生效不做二次确认;删除 View 与清理失效引用仍保留二次确认。
- 配置页不再复制 CONTROL DESK 的页头结构,而是以返回按钮 + 面包屑表明次级页面身份。
- keepalive 由库自动维持且无公开配置项,后端不新增开关;若真机验证证明 500 ms 应答窗口过紧,后续再考虑在客户端工厂覆盖实例字段或向上游提 PR。
- 没有覆盖率排除项,未降低任何门槛;未修改 socket 契约或 CI 结构。

## 8. 遗留问题与移交事项

- 用户需按第 4 节完成真实 Fairlight 的 View 切换、分组展示、路由与名称匹配验收;云端 Mock 结果不能替代真机网络与实际 show 验证。
- 长期方案:等待 BMD 为通道提供稳定 GUID;在此之前可考虑在配置页增加「重新关联」操作,把 MISSING 引用指向一个当前通道,避免改名后重新勾选。
- keepalive 的 500 ms 应答窗口需要真机长时间运行观察(Phase 6 的 ≥1 小时验收可一并覆盖)。
- Phase 6 继续负责触屏专项、深度视觉细节和长时间性能验证。

## 9. 提交记录

原始 Phase 5 分支:`cursor/phase5-views-config-b83a`(已合并为 `b2ad49b feat: add Phase 5 views configuration (#5)`)。

本批调整分支:`claude/custom-view-features-styling-2bpe04`。以下记录截至本报告落盘前,不包含承载报告与文档同步的提交。

```text
ca0138a style(web): keep wrapped order rows inside the channel list
ac7fc0f feat(web): route the view configuration page and rework its shell
17a3035 feat(web): match view channels by name and add channel groups
0054e90 test(server): guard the library-managed Ember+ keepalive
8377d03 feat(server): serve the SPA shell for client routes
f0d6723 test(server): cover kind and name view references and group validation
c38685a feat(shared): match view channels by kind and name, add groups
```
