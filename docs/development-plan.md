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

6.2 合并后真机验收得出的补充与修正,单独一个 PR,详细执行提示词只保存于本地(`docs/prompts/phase-6-2-1.md`,不入仓库)。

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

6.2.1 合并后真机验收得出的第二个补充批次,单独一个 PR,详细执行提示词只保存于本地(`docs/prompts/phase-6-2-2.md`,不入仓库)。

交付物:

- FLIP 补间可续接:`use-flip-list.ts` 的测量改为自然位置,即矩形减去元素及其 `data-flip-key` 祖先当前生效的 translate;自然位置没变的行不再被碰,正在跑的补间原样继续(位置、速度、时长天然全部保留);一行在补间中途再次被推动时,从当前视觉位置(上次自然位置 + 当前在途 translate)出发,按 `FLIP_DURATION_MS` 与原缓动重新起一段补间,不回跳。dnd-kit 的 droppable 测量改用同一套无 transform 几何,碰撞检测始终针对预览的最终布局。执行会话先用埋点复现「快速拖过多行时被挤开的行补间播两次」,修复后同一埋点证明每跨一行恰好一次预览提交、一次补间。不引入动画库
- View 数据模型改为有序块:`View.items` 是通道引用与组块的有序数组,组块自带 `channels`,取消 `groupId` 与 `View.groups`/`View.channels`;空组是列表里有位置的实体块,可拖动、可箭头移动、可作落点,通道可落在空组之前或之后。配置版本升为 2,shared 读取时把版本 1 迁移为 2:连续同 `groupId` 的引用合成一个组块,无成员的组按 `groups` 顺序追加在末尾;更早的 `{ channelId, lastKnownName }` 形状迁移保留;服务端回写统一为版本 2。校验只剩组 id 唯一与根级引用不得为 `'group'` 色。混音页与配置页的解析、`view-order.ts` 全部纯函数、脏检测、行键改用新模型,既有语义不变
- 列表空白区域即落点:拖动通道行、AVAILABLE 条目或组头时,列表末尾始终渲染一个占满剩余高度的根级落槽,替代只在空草稿时出现的 `root-slot--fill` 与末组之后的 16px 落槽;落入即追加为列表最后一个无组行,组头则整组移到末尾;末尾是空组时视为落在该空组之后。落槽不再按草稿是否为空判定
- 组色 AUTO 改为成员类型众数:`groupAccent(group)` 无覆盖色时统计组块全部成员的引用类型,取出现最多的类型色,平局取成员里最先出现的类型,无成员按输入通道色,缺失成员按引用类型计入。混音页分组段标题、组头、GRP 行、拖动克隆共用,删除各处的首个在场成员计算

验收标准:

- [x] 单测覆盖:FLIP 的无 transform 测量、自然位置未变的在途行不被触碰、在途行被再次推动时从当前视觉位置起步;shared 版本 1 → 2 迁移与版本 2 校验;`view-order.ts` 对空组的移动、通道落在空组前后、末尾追加、组块整体移到末尾;`isViewDirty` 对块顺序与空组位置;类型众数与平局
- [x] 集成测试:快速连续 ArrowDown 每行只补间一次;通道拖到末尾空组之后成为独立行;通道、AVAILABLE 条目与组头落到列表空白区追加到末尾;空组用键盘与鼠标整体移动;读取版本 1 配置后两个页面显示不变、保存体为版本 2;组头 AUTO 色随多数成员类型变化
- [x] 本地:快速拖过多行无重复补间;末尾空组之后可落通道;拖到空白处即加入;组色众数与预期一致
- [x] 覆盖率达标;`pnpm-lock.yaml` 无改动

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

- [x] 单测覆盖:切页函数(每页数量变化、分组跨页、TYPE ROWS 每组一页、空 view)、两个滚轮 reducer(鼠标一格、触控板惯性序列、方向反转、冷却、Shift 逃生口、锁定时忽略)、手势归属(移出推子轨道后移回恢复调节且只 commit 一次、翻页手势中移入推子、跨推子移动与移回、翻页后指针落在推子上、Shift 中途变化、手势中被锁定)、pageIndex 边界与 view 切换重置
- [x] 集成测试:按钮与键盘翻页、滚轮在推子轨道上调推子且不翻页、滚轮在其它区域翻页、翻页后惯性尾巴落在新页推子上不动推子、单页时按钮置灰、视口过矮时页内滚动
- [ ] 本地:鼠标滚轮与触控板各翻一页不跳页;推子滚轮跟手;40 通道下电平表无掉帧(鼠标、推子滚轮与电平表已验收;触控板翻页待笔记本到手后复测)
- [x] 覆盖率达标

### 6.4 触屏审计

详细执行提示词只保存于本地(`docs/prompts/phase-6-4.md`,不入仓库)。手指翻页已在 6.3 落地(与滚轮共用同一套翻页节奏,安全区直接翻、通道条区滚到底再翻,翻过页的手势不误按松手处的控件),配置页 DnD 的 touch 传感器已在 6.2.1 定值,这两项本批次只做真机复核。

交付物:

- 全局防误触:`overscroll-behavior: none`(禁止下拉刷新)、`touch-action: manipulation`(禁止双击缩放,暂不禁捏合)、关闭 `user-select` 与 `-webkit-touch-callout`(禁止长按菜单,可编辑控件显式恢复);所有 `:hover` 样式包进 `@media (hover: hover)`,合写的选择器拆开;`vh` 全部改为 `dvh`;一个读取 `styles.css` 源文本的回归测试把这些规则锁住
- Fader 按 pointerId 过滤:第二根手指落在同一推子上既不重置起点、不触发双击回 0,也不结束或 commit 第一根手指的拖动;多个推子可同时用多指操作,全局拖动光标类改为计数;命中区尺寸维持现状(用户实测无需放大)
- 手指翻页不从 ON 按钮起手(新增 `data-swipe="none"` 约定),推子轨道照旧排除;电平表、名称头、分区标题栏、间隙与安全区照旧可以起手
- Screen Wake Lock(混音页保持常亮):只在 Fairlight Live 在线(socket 已连且 Ember `connected`)时持有,离线即放手,回来后自动接管;原生 API 可用时申请并在回到可见时重申请;不可用时(局域网 `http` 不是安全上下文,项目不做 HTTPS)降级为铺满视口、完全透明、`pointer-events: none` 的静音视频循环(素材摘自 nosleep.js,带一条数字静音的音频轨,`muted` 是第一道防线),静音媒体不受自动播放策略约束,因此不等用户交互即自行播放、隐藏时暂停、回到可见自行恢复,`pointerdown` / `keydown` 只作引擎拒绝自动播放时的兜底;两条路径都静默降级、绝不出声。视频必须铺满视口是真机实测得出的:Chrome for Android 对静音视频的屏幕锁有可见面积门槛,1×1 px 与 160px 方块都拿不到锁
- Fullscreen API 入口:安全区底部与翻页键同尺寸的图标键(`Enter full screen` / `Exit full screen`),不支持的浏览器不渲染;它只动浏览器边框,安全区「不放影响声音的控件」的底线不变,从它上面滑动翻页不会进入全屏
- Web app manifest(`display: fullscreen`、192/512 图标)与 Apple web app meta;viewport 不加 `user-scalable=no`。`http` 下不会真正安装,留着无害。平板顶部状态栏的进一步隐藏方案另行考虑

验收标准:

- [x] 单测覆盖:样式回归(`:hover` 全在媒体查询内、无 `vh`、全局规则在场、`.wake-media` 几何)、多指 pointerId 过滤与两个推子并行、ON 上起手不翻页、Wake Lock 原生/媒体两条路径的申请、释放、重申请、拒绝与在途播放被暂停追上、Fairlight Live 离线放手与回来自动恢复、Fullscreen 支持/不支持/拒绝、从全屏键上滑动翻页不进全屏
- [x] 本地(平板 + 手机):无下拉刷新、无双击缩放、无长按菜单、无文字选中;双手同时推两路推子,第二根手指落在同一推子上无效;从安全区滑动翻页,从 ON 上滑动不翻页,在推子上滑动只动推子;不碰屏幕也保持常亮,关掉电脑后放手,开机后自行接管;全屏键生效,iPhone Safari 上不渲染
- [x] 覆盖率达标;`pnpm-lock.yaml` 无改动

### 6.5 健壮性

详细执行提示词只保存于本地(`docs/prompts/phase-6-5.md`,不入仓库)。重连链路本身在 Phase 3 与 6.1 已就位(Ember 退避重连、重连后即使树没变也补发 connected 快照、每个新 socket 连接补发快照与状态),本批次补齐它的端到端用例、修一处离线命令的缺陷,并交付 soak 工具。

交付物:

- 后端重连集成用例(Mock Provider + 真 socket.io-client):Ember Provider 掉线后在同一端口回来,服务端自行重连、补发 connected 快照、电平帧与写入恢复、`lastError` 清空;socket 传输层断开(`conn.close(true)`,客户端会自动重连的那种断法)后客户端收到新快照;两者叠加的两种先后顺序终态一致;服务端整体重启后客户端连上新实例并最终拿到 connected 快照;连续多轮断连后一次参数变化只产生一条 patch、监听器数不变;Ember 断线期间的控制命令以 `PROTOCOL` 回执失败
- 前端重连集成用例(FakeSocket):socket 重连后当前页、view、CONTROL LOCK 保持,条带 DOM 节点不重挂,电平帧与常亮恢复;拖动中掉线时松手不发命令、电平回到基线;Ember 掉线时条带不重挂;叠加两种顺序;服务端重启形态的 `connecting` 空快照不清掉已加载的清单
- 离线命令不排队:socket.io-client 会把断线期间的 emit 缓冲到重连后补发,推子拖动中掉线、松手时的 `set-level` 会在 UI 已回滚之后发到 Fairlight Live。`emitWithAck` 在 socket 未连接时立即以 `OFFLINE` 回执失败、不 emit;浏览器包装层用 `socket.timeout(ACK_TIMEOUT_MS)` 发控制命令,超时即从发送缓冲里移除、重连后不补发。不做「重连后重放」
- soak 工具(`apps/server/src/tools/soak.ts`,`pnpm --filter @flwc/server soak`,零依赖):按最新树 dump 起 Mock Provider 与真实 server 托管生产构建,以 20 Hz 给全部通道喂电平,自写极简 CDP 客户端(Node 22 的 `WebSocket`)驱动 headless Chrome,每 30 s 先 `collectGarbage` 再采 JS 堆、DOM 节点数、事件监听数、布局次数与服务端内存、句柄数、监听器数,每 5 s 翻一页,每 10 min 交替做一次 Ember 断连与 socket 断连并要求 30 s 内回到 `MIXER ONLINE`;输出 `samples.json` 与 `report.md`,判定(热身 10 min 后首个 10 min 窗口对末尾 10 min 窗口:JS 堆增长 ≤ 10 MiB 且 ≤ 20%、DOM 节点与监听数漂移 ≤ 5%、服务端堆增长 ≤ 20 MiB、每次断连都恢复)失败即非零退出;样本不足两个窗口时为 `inconclusive`。另有附着模式 `--url`:不起任何服务、只开浏览器采样与翻页、永不发控制命令,供用户对真实 Fairlight Live做一小时验收。阈值与节奏全部是导出常量与命令行参数,初值由本地实测后调
- `.github/workflows/soak.yml`:`workflow_dispatch` 手动触发,输入分钟数,用 runner 自带的 Chrome,报告上传为 artifact;`ci.yml` 不改
- 本地真机长时间运行验收(附着模式一小时 + 平板照常使用一小时并拔一次线)

验收标准:

- [x] 后端 7 条与前端 6 条重连用例全绿,UI 恢复到断线前的状态(页码、view、锁定、条带节点);离线命令单测锁住不排队
- [x] 60 分钟 soak 实跑判定 `pass`,结果表在执行报告里;`soak.yml` 短跑成功一次(合并前 `workflow_dispatch` 对 PR 分支不可用,用临时的 push 触发器在 runner 上跑过一次后移除)
- [x] 本地对真实 Fairlight 长时间运行(≥1 小时)无内存泄漏、无断连不恢复(附着模式 60 分钟判定 `pass`;平板照常使用一小时并拔线一次,自行恢复)
- [x] 触屏与鼠标操作均流畅(本地)
- [x] 覆盖率达标;`pnpm-lock.yaml` 无改动;覆盖率排除只多 `src/tools/soak.ts` 一项

## Phase 7 — 打包交付

最终发布形态是三态:**控制台脚本直接启动**、**Docker 部署**、**桌面安装包**(先 Windows,macOS / Linux 待有设备后另开批次)。拆成两个 PR:7.1 交付前两态并为桌面壳铺好服务端合同;7.2 交付桌面壳。每个 PR 独立可合并、独立满足覆盖率门槛。

### 7.1 服务端收尾、控制台启动与 Docker

详细执行提示词只保存于本地(`docs/prompts/phase-7-1.md`,不入仓库)。

交付物:

- 进程生命周期:`SIGINT` / `SIGTERM` 走 `app.close()` 优雅退出(超时 `SHUTDOWN_TIMEOUT_MS` 后强制退出);`FLWC_EXIT_ON_STDIN_CLOSE=1` 时 stdin 关闭即退出,供桌面壳与进程管理器做进程边界
- 环境变量:`EMBER_HOST` / `EMBER_PORT` 仅在配置文件不存在时作为种子写入配置文件,之后以文件为准,UI 始终可改;`FLWC_DATA_DIR` / `FLWC_WEB_ROOT` 覆盖数据目录与 web 产物目录,默认值不变;`HOST` / `PORT` 维持现状
- Mock Provider 命令行工具(`pnpm --filter @flwc/server mock-provider --port <p> [--meters]`),供本地验证与没有 Fairlight Live 时演示
- 控制台启动脚本 `start.cmd` / `start.sh`:检查 Node 版本与构建产物,读仓库根的 `.env`(Node `--env-file`,模板 `.env.example`,shell 变量优先于文件),没人指定 host 时补 `0.0.0.0`,前台运行
- 多阶段 `Dockerfile`(`node:22-alpine`,运行阶段只含生产依赖,非 root,`HEALTHCHECK`,`/app/data` 挂卷)、`.dockerignore`、`docker-compose.yml`(拉取 GHCR 镜像,命名卷)、`scripts/docker-smoke.sh`(健康、种子写入、PUT 后重启仍保留、`docker stop` 时长)
- `.github/workflows/docker.yml`:PR 构建 + 冒烟;`main` 推 `:main`;标签 `v*` 推 `:vX.Y.Z` / `:latest`(amd64 + arm64)并把 `docker save` 的离线镜像包挂到 Release;`ci.yml` 不改
- README 按三态重写快速开始与配置表;`AGENTS.md`、`architecture.md`、`conventions.md` 全面核对与实际行为一致

验收标准:

- [x] 单测与集成用例覆盖:优雅退出与 stdin 守护、种子值(缺失 / 存在 / 损坏 / 只读)、路径环境变量、种子写入后 PUT 覆盖并跨重启保留
- [x] Docker 镜像在 Linux 下运行正常(本机 Docker Desktop 与 CI 冒烟各通过一次),配置可持久化;GHCR 拉取验证过一次(合并后 `main` 首次推送成功,包自动为 public;标签 `v0.1.0` 推出 `:v0.1.0` / `:latest`,Release 附 `flwc-v0.1.0-linux-amd64.tar.gz`,远程拉取部署成功)
- [x] 本地:`start.cmd` 启动、平板访问、CONNECTION 面板指向真实 Fairlight Live、Ctrl+C 退出;`docker compose` 指向真实 Fairlight Live并跨 `restart` / `down && up` 保留配置
- [x] 文档与实际行为一致(报告附逐行核对清单)
- [x] 覆盖率达标;`pnpm-lock.yaml` 无改动;覆盖率排除只多 `src/tools/mock-provider.ts` 一项

### 7.2 桌面启动器(Tauri,Windows)

详细执行提示词只保存于本地(`docs/prompts/phase-7-2.md`,不入仓库)。桌面壳是 Bitfocus Companion 式的「小设置窗口 + 托盘」启动器:后端跑在它的子进程里,混音页仍在浏览器里打开。选 Tauri 而不是 Electron 是为了体积与将来的 macOS 适配;窗口 UI 不嵌混音页。**本批次只交付 Windows 安装包**,代码保持可移植(平台差异走 `#[cfg]` 或 Tauri 插件);macOS / Linux 的构建与验证待有设备后另开批次。

交付物:

- `apps/desktop/`(`@flwc/desktop`):Tauri 2 壳(`src-tauri/`)+ React 窗口前端(与 `apps/web` 同一套工具链);安装包**自带 Node 运行时**(官方二进制作为 sidecar,构建时下载校验、不入库)与铺平的服务端及 web 产物(资源目录),目标机器不需要 Node 与 pnpm
- 窗口:状态与地址(含局域网地址,可复制)、端口、是否允许局域网访问、Apply 重启、`Start with Windows` / `Start at login`、`Start hidden in the tray`、`Open in browser` / `Hide to tray` / `Exit`、后端日志尾部;关闭按钮 = 隐藏到托盘;托盘菜单 `Open in browser` / `Show window` / `Exit`;单实例
- 进程模型:子进程环境按 7.1 合同(`HOST` / `PORT` / `FLWC_WEB_ROOT` / `FLWC_DATA_DIR` / `FLWC_EXIT_ON_STDIN_CLOSE`),数据在系统应用数据目录;就绪由健康检查判定;启动器以任何方式消失时子进程经 stdin 守护自行退出,不写平台专属保活
- `.github/workflows/desktop.yml`:`windows-latest` 构建 NSIS 安装包(按用户安装),PR 上传 artifact,标签挂到与 `docker.yml` 共用的 Release;矩阵结构预留其它平台;`ci.yml` 不改,`apps/desktop` 的根脚本部分只涉及窗口前端
- README「Desktop app」一节、`architecture.md` 部署一节、`conventions.md` 与 `AGENTS.md` 目录结构

验收标准:

- [x] Rust 单测(设置、局域网地址选择、子进程状态机)、clippy、fmt 全绿;窗口前端(view-model 与组件)覆盖率达标;`ci.yml` 在 ubuntu 上继续全绿
- [x] Windows 安装包在开发机实装:无控制台窗口、托盘与窗口全部控件可用、改端口重启、关闭即隐藏、单实例、结束启动器后后端自行退出、`Exit` 干净、卸载无残留
- [x] `desktop.yml` 在 PR 上全绿且 artifact 可下载
- [x] 本地:安装后平板按窗口地址打开、CONNECTION 面板指向真实 Fairlight Live、`Start with Windows` 注销重登生效(自启项不带参数,登录后显不显示窗口由 `Start hidden in the tray` 决定)、关机重启不残留
- [x] 合并后打第一个标签,Release 上同时出现镜像包与 Windows 安装包,GHCR 包为 public(`v0.2.0`:`flwc-v0.2.0-linux-amd64.tar.gz` 与 `Fairlight.Live.Web.Controller_0.2.0_x64-setup.exe`;arm64 镜像改为原生构建 JS 阶段后发布成功)

## Phase 8 — 现场问题修复

Phase 7 交付后在实际部署中发现的问题,每个问题一个独立批次、独立 PR。

### 8.1 Ember+ 多后端连接稳定性

详细执行提示词只保存于本地(`docs/prompts/phase-8-1.md`,不入仓库)。现场同时跑多个后端(服务器 Docker 版、开发机、桌面版)连同一台 Fairlight Live 时,出现「有时少读通道、有时连不上」。2026-09-19 对真实设备的只读测量确认了根因:Fairlight 的 Ember+ provider 每约 500 ms 只 accept 一条连接、backlog 只有两三个位置,且收到 FIN 后永不关闭它那一端(CLOSE_WAIT 与进程句柄逐会话累积,只有重启 Fairlight 才清);而我们的总线目录探测每 2 秒新开一条连接,一个后端一小时留下 1800 个死会话并占掉四分之一的 accept 能力,两三个后端就把它占满。少读通道则来自首轮展开对每个命名条带只给 400 ms、失败只重试一次,以及探测连接在目录分包到齐前就列表。

交付物:

- 探测节流:周期探测 2 s → 60 s,另加事件触发探测(目录更新插入新孩子、发现幽灵孩子、发现不完整条带),两次探测最小间隔 5 s,触发合并;探测连接以 RST 关闭而不是 FIN;探测等 200 ms 尾包后再列表
- 首轮展开:命名条带的 GetDirectory 超时 400 ms → 2 s,幽灵孩子维持 400 ms;不完整条带按 300 ms / 1 s / 3 s / 10 s / 30 s 退避持续重试;探测也补不完整的已知条带
- 连接失败原因区分:记录底层 socket 错误(如 `ECONNREFUSED`),无应答时文案说明 provider 可能忙;重连延迟加 ±30% 抖动
- Mock Provider 新增可选项复现 Fairlight 的两种行为(accept 间隔、FIN 后不关闭),两个后端连同一 Mock 的集成用例作为验收核心
- 环境变量 `FLWC_EMBER_PROBE_INTERVAL_MS`(0 关闭)与 `FLWC_EMBER_STRIP_TIMEOUT_MS`,在 `.env.example`、compose、README、architecture 四处同步
- `docs/fairlight-ember.md` 踩坑记录第 12 条记录实测事实

验收标准:

- [ ] Mock 上两个后端同时启动都连上且条带数等于 dump;运行 3 分钟 Mock 的半关闭会话计数为 0;新增条带在 65 s 内出现、紧接着的第二个在 6 s 内出现
- [ ] 连接失败时 `lastError` 区分 `ECONNREFUSED` 与「no answer」;`FLWC_EMBER_PROBE_INTERVAL_MS=0` 时全程无探测
- [ ] 本地:重启 Fairlight Live 后,服务器 Docker 版与本机 `start.cmd` 同时连接,两边读全 20 个条带,`Get-NetTCPConnection -LocalPort 9000` 的 CLOSE_WAIT 不再增长、Established 恒为 2;新建再删除一个输入通道两边一分钟内跟上
- [ ] 覆盖率达标;`pnpm-lock.yaml` 无改动;覆盖率排除无新增
