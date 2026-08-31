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

- [ ] 全部脚本在 Windows 本机可运行
- [ ] `pnpm build` 产出 server 与 web 构建产物,server 可托管 web 产物启动
- [ ] `pnpm test` 通过(允许仅有冒烟用例),覆盖率统计正常输出
- [ ] CI 在 GitHub 上全绿,覆盖率门槛生效(可用一个故意不达标的临时分支验证会红)

## Phase 2 — Ember+ 树发现

本阶段是后续所有协议层开发的前提,也是转入云端开发前的最后一个必须本地完成的阶段。Ember+ 是自描述协议,没有官方路径文档,**唯一开发依据是本地 Fairlight Live 实际暴露的树**。本阶段产出的 dump 存档与 Mock Provider 必须提交仓库,它们是云端 Agent 唯一的"真机替身"。

交付物:

- 一个独立的树 dump 脚本(`apps/server` 内的工具脚本),连接本地 Fairlight Live,递归展开完整树,输出 JSON(含每个节点的 identifier、description、类型、取值范围、单位、访问权限)
- dump 快照存档到 `docs/tree-dumps/`(带日期),并将结论(各功能节点的路径模式、类型、范围)回写 `docs/fairlight-ember.md`
- Mock Ember+ Provider 测试夹具(`packages/test-utils` 或 `packages/shared` 内),树结构复刻真实 dump,供后续所有自动化测试使用
- 验证读写能力:订阅电平/响度参数收到持续更新;对允许的四个通道之一写入推子值并确认生效后复原

验收标准:

- [ ] dump 覆盖全部所需节点:通道/各类总线的 level、mute、name、meter,`system/loudness` 的 integrated、true-peak、reset
- [ ] 每个所用节点的类型、范围、单位已确认并写入 `docs/fairlight-ember.md`
- [ ] Mock Provider 能被 emberplus-connection 客户端正常连接、订阅、写入
- [ ] 实测未改动任何不允许的通道,未删改任何通道

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

- [ ] 用 Mock Provider 的集成测试覆盖:连接生命周期、断线重连、树变化、控制命令往返、非法命令拒绝(越界 level、未知通道)、配置文件损坏/缺失时的恢复
- [ ] 对本地真实 Fairlight 手动验收:读到全部通道与响度,允许通道的推子可控且数值一致
- [ ] 覆盖率达标

## Phase 4 — 前端混音页 MVP

交付物:

- socket.io 客户端接入:快照/增量/电平帧的状态管理(zustand),断线重连与连接状态提示
- 混音页:按通道类型分区排列(channel / main / sub / aux / mixm / mtx),显示通道名称(不显示编号)
- 推子组件:符合真实调音台直觉(dB 刻度、单位标注、拖动/点击/键盘微调),拖动时本地回显优先、松手后与远端同步
- ON 开关(mute 取反显示,Yamaha 风格)
- 电平表组件:竖表 + dB 读数,峰值保持,颜色分段
- 响度区:integrated(LUFS)与 true-peak(dBTP)读数、正确单位、reset 按钮

验收标准:

- [ ] 组件单测覆盖:推子值换算与钳制、拖动与远端更新冲突、ON/mute 反转逻辑、电平表越界钳制、断线时 UI 降级
- [ ] 对本地真实 Fairlight 手动验收:允许通道推子操作流畅、电平表与软件表现一致、响度读数与软件一致、reset 生效
- [ ] 覆盖率达标

## Phase 5 — Views 配置

交付物:

- View 数据模型(`packages/shared`):view 含名称与通道引用列表(Ember 路径 + 最后已知名称)
- REST API:views CRUD,持久化到 `data/`
- 配置页:创建/重命名/删除 view,从当前树的通道清单中勾选通道,可排序
- 主页面 view 切换;无 view 时默认显示全部通道
- 失配处理:树变化后 view 中缺失的通道渲染为占位(显示最后已知名称与缺失提示),配置页提供一键清理失效引用

验收标准:

- [ ] 集成测试覆盖:views CRUD、view 引用已删除通道、树变化后的失配标记与清理、空 view/空配置
- [ ] 本地手动验收:view 切换流畅,失配占位展示正确
- [ ] 覆盖率达标

## Phase 6 — UX 打磨与健壮性

交付物:

- 视觉打磨:布局、间距、暗色主题、触屏可用性(推子拖动)
- 错误态与空态:Ember 未连接、后端不可达、树为空
- 断线重连的端到端体验(前端自动恢复快照)
- 性能:电平帧渲染优化(避免整页重渲)

验收标准:

- [ ] 本地对真实 Fairlight 长时间运行(≥1 小时)无内存泄漏、无断连不恢复
- [ ] 触屏与鼠标操作均流畅(本地)
- [ ] 覆盖率达标

## Phase 7 — 打包交付

交付物:

- 多阶段 Dockerfile(server 托管 web 产物,`data/` 挂卷),`docker-compose.yml` 示例
- Windows 直接运行方式:`pnpm build` 后 `node apps/server/dist`,提供启动脚本
- README 快速开始补全,文档全面核对与收尾

验收标准:

- [ ] Docker 镜像在 Linux 下运行正常,配置可持久化
- [ ] Windows 本机直接运行正常
- [ ] 文档与实际行为一致
