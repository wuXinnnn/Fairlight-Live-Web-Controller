# 开发计划

按阶段推进,每阶段有明确交付物与验收标准。Phase 3–6 的交付物必须包含对应的单元/集成测试与边界场景用例,覆盖率不达 `docs/conventions.md` 规定的门槛不得进入下一阶段。

## 云端 Agent 开发边界

本项目自 Phase 3 起在 GitHub 上以云端 Agent 形式开发,前提与边界如下:

- **Phase 1–2 必须在本地完成**:Phase 2 需要连接本地真实 Fairlight Live 做树 dump,云端无法访问
- **上云前提**(即 Phase 1–2 的交付物):完整可用的 CI(见 Phase 1)+ 已提交仓库的树 dump 存档与 Mock Ember+ Provider。满足后,云端 Agent 仅凭 Mock Provider 与 CI 即可完成开发、测试与覆盖率验证,无需真机
- **真机手动验收始终是本地步骤**:各阶段验收标准中标注"本地"的条目,由本地在云端 PR 合并前执行;云端 Agent 不得假设自己能连接真实 Fairlight
- 云端开发发现的 Ember+ 树结构疑问,一律留待本地确认后回写 `docs/fairlight-ember.md`,不得猜测

## Phase 1 — 工程脚手架

交付物:

- pnpm workspaces 单仓:`apps/server`、`apps/web`、`packages/shared`
- 各包 TypeScript 严格模式配置(共享 `tsconfig.base.json`)
- ESLint + Prettier 统一配置
- Vitest 配置(含 v8 覆盖率与门槛设置),根目录 `pnpm test` 跑全部包
- 基础脚本:`pnpm dev`(并行启动前后端)、`pnpm build`、`pnpm lint`、`pnpm test`
- `.gitignore`、`data/` 目录约定(运行时配置,不入库)
- **完整可用的 CI**(GitHub Actions,Linux runner):push/PR 触发 lint + typecheck + test(含覆盖率门槛)+ build,任一失败即红。此时测试仅有冒烟用例,但流水线本身必须完整,后续阶段只增加用例、不改流水线结构

验收标准:

- [x] 全部脚本在 Windows 本机可运行
- [x] `pnpm build` 产出 server 与 web 构建产物,server 可托管 web 产物启动
- [x] `pnpm test` 通过(允许仅有冒烟用例),覆盖率统计正常输出
- [x] CI 在 GitHub 上全绿,覆盖率门槛生效(可用一个故意不达标的临时分支验证会红)

## Phase 2 — Ember+ 树发现

本阶段是后续所有协议层开发的前提,也是转入云端开发前的最后一个必须本地完成的阶段。Ember+ 是自描述协议,没有官方路径文档,**唯一开发依据是本地 Fairlight Live 实际暴露的树**。本阶段产出的 dump 存档与 Mock Provider 必须提交仓库,它们是云端 Agent 唯一的"真机替身"。

交付物:

- 一个独立的树 dump 脚本(`apps/server` 内的工具脚本),连接本地 Fairlight Live,递归展开完整树,输出 JSON(含每个节点的 identifier、description、类型、取值范围、单位、访问权限)
- dump 快照存档到 `docs/tree-dumps/`(带日期),并将结论(各功能节点的路径模式、类型、范围)回写 `docs/fairlight-ember.md`
- Mock Ember+ Provider 测试夹具(`packages/test-utils` 或 `packages/shared` 内),树结构复刻真实 dump,供后续所有自动化测试使用
- 验证读写能力:订阅电平/响度参数收到持续更新;对允许的四个通道之一写入推子值并确认生效后复原

验收标准:

- [x] dump 覆盖全部所需节点:通道/各类总线的 level、mute、name、meter,`system/loudness` 的 integrated、true-peak、reset(当前 show 无 `sub`/`mixm`/`mtx` 根节点,其余全部覆盖,见 `docs/fairlight-ember.md`)
- [x] 每个所用节点的类型、范围、单位已确认并写入 `docs/fairlight-ember.md`
- [x] Mock Provider 能被 emberplus-connection 客户端正常连接、订阅、写入
- [x] 实测未改动任何不允许的通道,未删改任何通道

## Phase 3 — 后端核心

交付物:

- `EmberService`:连接管理(连接/断线/自动重连/超时)、订阅、参数写入、function 调用(reset)
- `TreeMapper`:运行时树发现,按 identifier 模式识别通道、总线、响度节点,建立逻辑模型与 Ember 路径映射;树变化时增量更新;无法识别的节点安全忽略并记日志
- `MixerStateStore`:规范化状态仓库(通道列表、level/mute/name、连接状态),变更事件驱动
- `MeterHub`:电平/响度帧聚合,50ms 节流批量广播
- socket.io 网关:快照 + 增量 + 电平帧下行,控制命令(setLevel/setOn/resetLoudness)上行,消息契约用 `packages/shared` 的 zod schema 校验
- REST API:Ember+ 连接配置(GET/PUT)、连接状态查询;JSON 文件持久化到 `data/`
- 结构化日志(pino)

验收标准:

- [x] 用 Mock Provider 的集成测试覆盖:连接生命周期、断线重连、树变化、控制命令往返、非法命令拒绝(越界 level、未知通道)、配置文件损坏/缺失时的恢复
- [x] 对本地真实 Fairlight 手动验收:读到全部通道与响度,允许通道的推子可控且数值一致
- [x] 覆盖率达标

## Phase 4 — 前端混音页 MVP

交付物:

- socket.io 客户端接入:快照/增量/电平帧的状态管理(zustand),断线重连与连接状态提示
- 混音页:按通道类型分区排列(channel / main / sub / aux / mixm / mtx),显示通道名称(不显示编号)
- 推子组件:符合真实调音台直觉(dB 刻度、单位标注、拖动/点击/键盘微调),拖动时本地回显优先、松手后与远端同步
- ON 开关(mute 取反显示,Yamaha 风格)
- 电平表组件:竖表 + dB 读数,峰值保持,颜色分段
- 响度区:integrated(LUFS)与 true-peak(dBTP)读数、正确单位、reset 按钮
- 全站视觉基线:所有页面固定深色主题,不提供深浅色切换;组件具备简短、合理的状态与交互动效,并兼容 reduced-motion
- 固定 UI 文本使用英文;设备或应用运行时带入的通道名称等动态文本保留原文

验收标准:

- [x] 组件单测覆盖:推子值换算与钳制、拖动与远端更新冲突、ON/mute 反转逻辑、电平表越界钳制、断线时 UI 降级
- [x] 页面始终使用深色主题且无主题切换入口;推子、ON、按钮、连接态与通道增删的状态变化有合理动效,直接操作保持跟手
- [x] 对本地真实 Fairlight 手动验收:允许通道推子操作流畅、电平表与软件表现一致、响度读数与软件一致、reset 生效
- [x] 覆盖率达标

## Phase 5 — Views 配置

交付物:

- View 数据模型(`packages/shared`):view 含名称、通道引用列表与命名分组;通道引用以「类型 + 名称」匹配(Fairlight 不提供稳定通道 ID,插入/重排会重新编号),勾选时记录的逻辑 id 只用于同名裁决
- REST API:views CRUD,持久化到 `data/`;旧的 `{ channelId, lastKnownName }` 引用在读取时自动迁移
- 配置页(独立路由 `/views`,支持浏览器前进/后退):创建/重命名/删除 view,从当前树的通道清单中勾选通道,可排序;可创建命名分组、把通道编入分组、整组排序与解散,全部由 `SAVE VIEW` 统一保存
- View 内每个通道可从前端统一 palette 选择颜色;未配置时使用 Input Green、Main Red、Sub Teal、Aux Navy、Mix Minus Lime、Matrix Purple 的类型默认色
- 主页面 view 切换;无 view 时默认显示全部通道;分组在混音页以 `All Channels` 的类型分区样式展示,组名作为分区标题
- 失配处理:树变化后 view 中解析不到的通道渲染为占位(显示引用名称与缺失提示),配置页提供一键清理失效引用

验收标准:

- [x] 集成测试覆盖:views CRUD、通道颜色配置与默认回退、view 引用已删除通道、树变化后的失配标记与清理、空 view/空配置、按名称匹配与分组
- [x] 本地手动验收:view 切换流畅,失配占位展示正确
- [x] 覆盖率达标

## Phase 6 — UX 打磨与健壮性

本阶段拆成五个 PR,按 6.1 → 6.5 顺序推进,6.2 之后另有两个真机验收得出的补充批次 6.2.1 与 6.2.2:每个 PR 独立可合并、独立满足覆盖率门槛;6.4 依赖 6.3 的安全区;6.5 放最后,用于验证前面全部改动。云端 Agent 只能依赖 Mock Provider,所有标注"本地"的验收由本地执行。

### 6.1 连接配置与错误态

交付物:

- 前端连接 API 客户端(`apps/web/src/lib/connection-api.ts`):GET/PUT `/api/v1/connection`,复用 `packages/shared` 的 zod schema 校验请求与响应
- 混音页与配置页头部的连接状态灯可点击,打开 CONNECTION 面板:host、port、当前连接状态、APPLY;Ember 处于已连接状态时 APPLY 需二次确认,文案写明将断开当前设备重连
- 混音页空态按原因分流为三种文案:后端 socket 离线、Ember 未连接(含连接错误与重连中)、树为空;Ember 未连接时提供 CONFIGURE CONNECTION 入口直达面板
- 配置优先级约定(实现在 Phase 7):环境变量只在首次启动且 `data/` 无配置文件时作为种子值写入配置文件,之后一律以配置文件为准,UI 始终可改

验收标准:

- [x] 集成测试覆盖:面板读取与保存、校验失败提示(空 host、越界 port)、已连接时的二次确认、三种空态分流与 CTA
- [x] 本地:修改为正确地址后重连成功;修改为错误地址后空态正确且可从空态入口改回
- [x] 覆盖率达标

### 6.2 配置页 UX

交付物:

- 拖放编排:引入 `@dnd-kit/core` + `@dnd-kit/sortable`(MIT),启用鼠标、触屏、键盘三种传感器(传感器的具体组合见 6.2.1)。语义:拖通道行到任意位置即重排;拖进分组块即编组;拖出分组即脱组;拖分组头即整组移动;空分组保留在列表底部作为投放目标;左侧 AVAILABLE CHANNELS 可直接拖入右侧列表的任意位置或任意分组,勾选方式保留,两种方式并存。`view-order.ts` 新增纯函数 `moveChannelTo`(任意位置移动与编组)与 `insertChannelAt`(从可用通道插入),既有 `moveChannel`/`moveGroup` 的步进语义不变,箭头按钮保留作为键盘与无障碍路径
- 列表位移动效:自写 FLIP hook(`useLayoutEffect` 比对每行移动前后的 rect,用 transform 补间),覆盖箭头移动、编组/脱组、整组移动、勾选加入/移除;目标行与所有因它而位移的行都平滑过渡;兼容 reduced-motion;删除现有 `data-moved` 单行动画。dnd-kit 拖动过程中的让位动画沿用其 sortable 策略,视觉与 FLIP 保持一致
- 未保存改动:纯函数 `isViewDirty(saved, draft)` 做结构比较;脏态提示三处:SAVE VIEW 按钮仅在脏时高亮、按钮旁 UNSAVED 徽标、左侧 view 列表对应项显示圆点;会丢失改动的操作(返回混音页、切换到另一个 view、删除当前 view)弹出应用内确认对话框,提供 DISCARD 与 KEEP EDITING,不使用 `window.confirm`;`lib/router.ts` 增加导航守卫,浏览器后退被守卫拒绝时用 `history.forward()` 回到 `/views`;标签页关闭与刷新用 `beforeunload` 提示

验收标准:

- [x] 单测覆盖:`moveChannelTo`/`insertChannelAt` 的边界(跨分组、进出空分组、首尾位置、原位放下、拖入的通道已在 view 中)、`isViewDirty`、导航守卫的允许/拒绝/后退回退
- [x] 集成测试(键盘传感器):拖放重排、编组与脱组、整组移动、从可用通道拖入;脏态三处提示;三条丢失路径都弹出确认并且 DISCARD/KEEP EDITING 行为正确
- [x] 本地:鼠标与触屏拖放流畅,位移动效无抖动、无闪烁
- [x] 覆盖率达标

### 6.2.1 配置页 UX 补充

6.2 合并后真机验收得出的补充与修正,单独一个 PR,详细执行提示词见 `docs/prompts/phase-6-2-1.md`。

交付物:

- 传感器改为 `MouseSensor` + `TouchSensor` + `KeyboardSensor`:鼠标移动 4px 起拖;触屏长按 250ms 起拖,按住期间移动超过 8px 视为滚动而取消;三个数值都是 `dnd-config.ts` 里的常量,由本地实测微调
- FLIP 覆盖拖动期间的预览重排(占位行移动时因它位移的行平滑过渡)、Esc 回位与折叠/展开;落下时不与 `DragOverlay` 的落下动画叠加;时长改为常量 `FLIP_DURATION_MS`(初值 120ms)与 `DROP_ANIMATION_MS`(初值 150ms),不再挂 `--motion-medium`;切换 view 时跳过一次补间
- 空 view 列表可作为投放目标:列表容器始终渲染,没有任何非空块时在顶部提供覆盖整个空态区域的根级落槽,键盘与鼠标都能把首个通道拖入;只有空分组的 view 也可把通道落为无组行
- 分组可折叠/展开:编辑器 UI 状态,不进 View 模型、不持久化,切换 view 时重置;折叠组仍是投放容器,占位行预览进折叠组时该组自动展开;空分组无折叠按钮
- 分组颜色与通道条颜色模式:`ViewGroup` 增加可选 `color`,通道引用的 `color` 允许 `'group'` 字面量(跟随组色),向后兼容、配置版本不变、旧数据不迁移;无组却为 `'group'` 色的引用由 shared 校验拒绝。通道条调色板为 AUTO / GROUP(仅在组内显示,带当前组色色块)/ 自定义色,组头新增 GROUP COLOR 控件;组色 AUTO 取首个在场成员的类型色。进组时 AUTO 自动变 GROUP、自定义保持;出组(拖出、下拉选 NO GROUP、UNGROUP)时 GROUP 自动变 AUTO、自定义保持;组内移动不变。颜色解析集中在 `channel-colors.ts`,配置页与混音页共用

验收标准:

- [x] 单测覆盖:TouchSensor 长按起拖与超容差取消、FLIP 时长常量与预览重排触发补间、空列表落槽、折叠状态与自动展开、shared schema(组色、`'group'` 带组通过/不带组拒绝、旧形状迁移不受影响)、进出组的颜色转换四个入口、颜色解析、组色变化为脏
- [x] 集成测试:新建 view 后从可用通道拖入首个通道(键盘与鼠标);折叠组的控件可用与拖入自动展开;GROUP 下拉进组后行调色板选中 GROUP、拖出后回到 AUTO、自定义色进出组不变、组头改色后 GROUP 行与混音页分组段标题颜色随之变化、保存体带组色与 `'group'` 色
- [x] 本地:触屏长按起拖手感;拖动中的行补间与落下无叠加;颜色在两个页面显示一致
- [x] 覆盖率达标;`pnpm-lock.yaml` 无改动

### 6.2.2 配置页 UX 补充二

6.2.1 合并后真机验收得出的第二个补充批次,单独一个 PR,详细执行提示词见 `docs/prompts/phase-6-2-2.md`。

交付物:

- FLIP 补间可续接:`use-flip-list.ts` 的测量改为自然位置,即矩形减去元素及其 `data-flip-key` 祖先当前生效的 translate;自然位置没变的行不再被碰,正在跑的补间原样继续(位置、速度、时长天然全部保留);一行在补间中途再次被推动时,从当前视觉位置(上次自然位置 + 当前在途 translate)出发,按 `FLIP_DURATION_MS` 与原缓动重新起一段补间,不回跳。dnd-kit 的 droppable 测量改用同一套无 transform 几何,碰撞检测始终针对预览的最终布局。执行会话先用埋点复现「快速拖过多行时被挤开的行补间播两次」,修复后同一埋点证明每跨一行恰好一次预览提交、一次补间。不引入动画库
- View 数据模型改为有序块:`View.items` 是通道引用与组块的有序数组,组块自带 `channels`,取消 `groupId` 与 `View.groups`/`View.channels`;空组是列表里有位置的实体块,可拖动、可箭头移动、可作落点,通道可落在空组之前或之后。配置版本升为 2,shared 读取时把版本 1 迁移为 2:连续同 `groupId` 的引用合成一个组块,无成员的组按 `groups` 顺序追加在末尾;更早的 `{ channelId, lastKnownName }` 形状迁移保留;服务端回写统一为版本 2。校验只剩组 id 唯一与根级引用不得为 `'group'` 色。混音页与配置页的解析、`view-order.ts` 全部纯函数、脏检测、行键改用新模型,既有语义不变
- 列表空白区域即落点:拖动通道行、AVAILABLE 条目或组头时,列表末尾始终渲染一个占满剩余高度的根级落槽,替代只在空草稿时出现的 `root-slot--fill` 与末组之后的 16px 落槽;落入即追加为列表最后一个无组行,组头则整组移到末尾;末尾是空组时视为落在该空组之后。落槽不再按草稿是否为空判定
- 组色 AUTO 改为成员类型众数:`groupAccent(group)` 无覆盖色时统计组块全部成员的引用类型,取出现最多的类型色,平局取成员里最先出现的类型,无成员按输入通道色,缺失成员按引用类型计入。混音页分组段标题、组头、GRP 行、拖动克隆共用,删除各处的首个在场成员计算

验收标准:

- [ ] 单测覆盖:FLIP 的无 transform 测量、自然位置未变的在途行不被触碰、在途行被再次推动时从当前视觉位置起步;shared 版本 1 → 2 迁移与版本 2 校验;`view-order.ts` 对空组的移动、通道落在空组前后、末尾追加、组块整体移到末尾;`isViewDirty` 对块顺序与空组位置;类型众数与平局
- [ ] 集成测试:快速连续 ArrowDown 每行只补间一次;通道拖到末尾空组之后成为独立行;通道、AVAILABLE 条目与组头落到列表空白区追加到末尾;空组用键盘与鼠标整体移动;读取版本 1 配置后两个页面显示不变、保存体为版本 2;组头 AUTO 色随多数成员类型变化
- [ ] 本地:快速拖过多行无重复补间;末尾空组之后可落通道;拖到空白处即加入;组色众数与预期一致
- [ ] 覆盖率达标;`pnpm-lock.yaml` 无改动

### 6.3 混音页分页

交付物:

- 显式分页布局:用 ResizeObserver 由容器宽度与通道条宽度算出每页通道条数,把当前 view(或 All Channels)的通道条切页;分组允许跨页;TYPE ROWS 开关语义改为"每个分组从新的一页开始";通道条高度撑满视口(100dvh 减去页头与页脚),推子轨道随之拉长;视口高度低于通道条最小高度时降级为页内滚动
- 页头压缩为单行(品牌、连接状态、view 切换、偏好、响度),为通道条让出高度
- 翻页由 `pageIndex` 状态加 transform 过渡驱动,不使用 scroll-snap;翻页入口:实体质感的上/下翻页按钮与页码指示、键盘 PageUp/PageDown、滚轮手势(见下)、6.4 的滑动手势;切换 view 时回到第一页
- 右侧安全区(rail):在粗指针设备上常驻显示,位置固定不随页数变化;单页时翻页按钮置灰、仅显示页码;区内只放页码、翻页按钮与滑动轨道,`touch-action: none`,不得包含任何会影响声音的控件
- 电平表在通道条撑满后高度翻倍:在 Mock Provider 下以 40 通道、20 Hz 帧率实测渲染开销,超出预算时改为 transform 绘制

Fader 滚轮与翻页滚轮共存规则:

- 唯一用滚轮调节推子的表面是推子轨道(标 `data-wheel="level"`);通道条其它区域(名称、ON、电平表、读数)、分区头、间隙与安全区上的滚轮都翻页
- 推子轨道上的滚轮永远不翻页:推子被 CONTROL LOCK 锁定、断线或正在拖动时,滚轮被忽略而不是转为翻页,规则不随模式变化
- Shift + 滚轮在任何位置(包括推子轨道)都翻页,作为逃生口;Shift 下浏览器会把 deltaY 换到 deltaX,取两者中非零者
- 推子滚轮 reducer(纯函数):按 deltaMode 归一化为像素;累计 delta,每约 50px 触发一次 `stepLevelDb`(1 dB,Alt 时 10 dB,与键盘方向键/PageUp 对齐);方向反转清零累计;首次步进调用 `onInteractionStart`,每步 `onValueChange`(沿用 50 ms 节流发送);`onCommit` 不由推子自己计时,而是在整次手势结束时由归属模块回调触发,一次手势只 commit 一次
- 翻页滚轮 reducer(纯函数):累计 deltaY,超过阈值(约 60px)翻一页并进入冷却;冷却期吞掉后续事件,直到 delta 静默 150 ms 且距触发不少于 300 ms 才允许下一次;方向反转清零累计。目标是鼠标一格与触控板一次惯性滑动都恰好翻一页
- 手势归属:新增 `wheel-gesture.ts`(纯函数,时钟注入),记录当前滚轮手势的持有者(`page` 或某个推子的 channel id)与最近事件时间。一次手势从首个事件起、到静默 150 ms 止,期间所有滚轮事件都归首个事件所在表面所有,不因鼠标在滚动过程中移入或移出推子轨道而转移;非持有者收到事件时忽略并为持有者续期;手势静默后归属模块回调持有者宣告手势结束,推子据此 commit
- 归属边界情形:
  - 手势在推子轨道上开始、鼠标中途移出轨道:移出后事件不再作用于该推子;翻页监听器因持有者仍是该推子而吞掉这些事件并续期,不翻页;手势未静默前移回轨道则继续调节同一推子,中间不 commit;手势静默后才 commit 一次
  - 手势在轨道外开始(翻页)、鼠标中途移入推子轨道,或翻页后新页的推子轨道恰好滑到指针下方:推子监听器发现持有者是 `page` 且未过期,忽略并续期,惯性尾巴不会动任何推子;这是翻页后最常见的情形,必须有集成用例
  - 鼠标从一个推子轨道移到另一个:第二个推子发现持有者是别的 channel id,忽略并续期,自始至终不动第二个推子;移回第一个推子则继续调节它;手势静默后第一个推子 commit 一次
  - Shift 只在手势的起始事件上判定归属,滚动中按下或松开 Shift 不转移归属
  - 手势中推子被锁定或断线:推子立即 commit 当前值并结束调节,后续事件忽略但归属续期,直到静默
- 事件接入:React 的 `onWheel` 以 passive 监听,不能 `preventDefault`,两处都用 ref + 原生 `addEventListener('wheel', handler, { passive: false })`;翻页监听器挂在 bay 容器上,先通过 `target.closest('[data-wheel="level"]')` 判断表面,再查询手势归属决定是否处理;两个 reducer 只共享归属模块,互不直接感知
- 上述阈值、步进像素与时间窗口均为初值,实现后由本地真机实测微调

验收标准:

- [ ] 单测覆盖:切页函数(每页数量变化、分组跨页、TYPE ROWS 每组一页、空 view)、两个滚轮 reducer(鼠标一格、触控板惯性序列、方向反转、冷却、Shift 逃生口、锁定时忽略)、手势归属(移出推子轨道后移回恢复调节且只 commit 一次、翻页手势中移入推子、跨推子移动与移回、翻页后指针落在推子上、Shift 中途变化、手势中被锁定)、pageIndex 边界与 view 切换重置
- [ ] 集成测试:按钮与键盘翻页、滚轮在推子轨道上调推子且不翻页、滚轮在其它区域翻页、翻页后惯性尾巴落在新页推子上不动推子、单页时按钮置灰、视口过矮时页内滚动
- [ ] 本地:鼠标滚轮与触控板各翻一页不跳页;推子滚轮跟手;40 通道下电平表无掉帧
- [ ] 覆盖率达标

### 6.4 触屏审计

交付物:

- 全局防误触:`overscroll-behavior: none`(禁止下拉刷新)、`touch-action: manipulation`(禁止双击缩放)、关闭 `user-select` 与 `-webkit-touch-callout`(禁止长按菜单);所有 `:hover` 样式包进 `@media (hover: hover)`;`100vh` 全部改为 `100dvh`
- Fader 按 pointerId 过滤,第二根手指不劫持同一推子;多个推子可同时用多指操作;推子帽与 ON 按钮命中区不小于 44px
- 滑动翻页:只在安全区与非控制表面(通道名称头、分区头、间隙)识别,推子、ON、电平表上绝不起手;需要最小位移与速度阈值,一次手势只翻一页
- 配置页 DnD 的 touch 传感器设置按压延迟与容差,与页面滚动区分
- Screen Wake Lock(混音页保持常亮)与 Fullscreen API 入口(去除浏览器边框),两者都为渐进增强,不支持的浏览器静默降级

验收标准:

- [ ] 单测覆盖:滑动手势 reducer(阈值、速度、起手区域判定)、多指 pointerId 过滤、Wake Lock/Fullscreen 不可用时的降级
- [ ] 本地(平板 + 手机):无下拉刷新、无缩放、无长按菜单;多指同时推两个推子;从安全区滑动翻页,在推子上滑动只动推子;熄屏计时内屏幕保持常亮
- [ ] 覆盖率达标

### 6.5 健壮性

交付物:

- 断线重连端到端:socket 重连后自动恢复快照与电平,增加 Mock Provider 集成用例(socket 断线重连、Ember 断线重连、两者叠加)
- soak 脚本:Mock Provider 持续推送电平帧不少于 1 小时,定时采样前端堆内存并输出报告,用于本地与 CI 手动触发
- 本地真机长时间运行验收

验收标准:

- [ ] 集成测试覆盖三种重连场景,UI 恢复到断线前的状态
- [ ] 本地对真实 Fairlight 长时间运行(≥1 小时)无内存泄漏、无断连不恢复
- [ ] 触屏与鼠标操作均流畅(本地)
- [ ] 覆盖率达标

## Phase 7 — 打包交付

交付物:

- 多阶段 Dockerfile(server 托管 web 产物,`data/` 挂卷),`docker-compose.yml` 示例
- 环境变量 `EMBER_HOST`/`EMBER_PORT`:仅在首次启动且 `data/` 无配置文件时作为种子值写入配置文件,之后以配置文件为准,UI 始终可改
- Windows 直接运行方式:`pnpm build` 后 `node apps/server/dist`,提供启动脚本
- README 快速开始补全,文档全面核对与收尾

验收标准:

- [ ] Docker 镜像在 Linux 下运行正常,配置可持久化
- [ ] Windows 本机直接运行正常
- [ ] 文档与实际行为一致
