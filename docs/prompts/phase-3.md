# Phase 3 执行提示词 — 后端核心

> 用法:将本文档全文作为执行会话的任务提示词。本阶段起转入**云端 Agent** 开发:执行会话运行在 Cursor 云端环境(配置见 `.cursor/environment.json`),无法访问真实 Fairlight Live。执行完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review,真机验收由用户在本地完成。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束
2. `docs/architecture.md` — 架构设计(本阶段的实现蓝图:模块职责、消息契约、REST 路由、持久化格式)
3. `docs/development-plan.md` — Phase 3 交付物与验收标准(本阶段的任务来源),以及「云端 Agent 开发边界」一节
4. `docs/conventions.md` — 目录结构、命名、错误处理、测试边界场景清单、覆盖率门槛、Git 规范
5. `docs/fairlight-ember.md` — 实测确认的 Ember+ 节点路径/类型/范围与踩坑记录(TreeMapper 的识别依据)
6. `docs/reports/phase-2-report.md` — Phase 2 执行报告(Mock Provider 能力、真机树结构摘要、遗留问题)

## 云端执行边界(本阶段与此前的关键差异)

- 你运行在云端,**无法连接真实 Fairlight Live**。唯一的"真机替身"是 `packages/test-utils` 的 Mock Ember+ Provider 与 `docs/tree-dumps/` 的真机 dump 存档。
- Ember+ 树结构一律以 dump 与 `docs/fairlight-ember.md` 的实测记录为准。**开发中遇到 dump 无法回答的树结构疑问,不得猜测**:在执行报告的「遗留问题与移交事项」中列出,留待用户本地用真机确认。
- 验收标准中「对本地真实 Fairlight 手动验收」一条由用户本地执行,你在报告中标注**移交用户**,并给出一份可直接照做的真机验收操作清单(启动命令、REST/socket.io 验证步骤、预期结果)。
- 在独立分支上开发并推送,保持远端 CI(GitHub Actions:lint + typecheck + test + build)全绿;不得改动 CI 流水线结构。

## 硬性约束

- 自动化测试(vitest)一律使用 Mock Provider,**禁止在任何代码或测试中出现连接真实设备的逻辑之外的硬编码真机地址**;运行时连接目标只来自 `data/` 配置文件与 REST 配置 API。
- 代码、注释、提交信息、日志文案用**英文**;文档与报告用**简体中文**。
- 新增依赖必须 MIT 或 MIT 兼容许可,引入前确认 `license` 字段,记入报告。
- 提交遵循 Conventional Commits,按逻辑单元分多次提交;不得破坏已有的 lint / typecheck / test / build 全绿与覆盖率门槛(`apps/server` ≥ 80%,不许为凑覆盖率调低门槛)。
- 除 TreeMapper 外,**任何代码不得接触原始 Ember 路径**(架构关键原则);上层只使用逻辑通道模型(`ChannelRef` / `ChannelState`,见 `docs/architecture.md`)。
- 不改动 `docs/` 下与本阶段无关的文档;`docs/fairlight-ember.md` 仅在有新的实测结论回写需求时由用户操作,你只在报告中提出建议。

## 任务范围

按 `docs/development-plan.md` 的 Phase 3 与 `docs/architecture.md` 实现后端核心。本阶段**不做前端**(Phase 4)、**不做 views CRUD**(Phase 5)。

### 1. EmberService(`apps/server/src/ember/`)

- 连接生命周期:连接、断线检测、自动重连(带退避)、超时处理;只处理原始 Ember 节点,不理解业务含义。
- 树展开、参数订阅、参数写入、function 调用(loudness reset)。
- **已知坑(Phase 2 实测,必须处理)**:`EmberClient.disconnect()` 在有未完成请求时常因 ECONNRESET 挂起,需要超时兜底(参考 `apps/server/src/tools/` 中现有工具的 2s 超时 + `discard()` 做法);部分 `sends/aux` 节点 getDirectory 会挂起,展开必须逐节点容错,单点失败不得毁掉整体。

### 2. TreeMapper(`apps/server/src/ember/`)

- 运行时树发现:遍历实际树,按 identifier 模式识别输入通道(`channel/channelN`)、各类总线(`main` / `aux`,以及 dump 中未出现但计划支持的 `sub` / `mixm` / `mtx`)、响度节点(`system/loudness`),建立"逻辑通道模型 ↔ Ember 路径"映射。
- **当前真机 dump 没有 `sub` / `mixm` / `mtx` 根节点**(取决于 show 配置),TreeMapper 不得假设任何总线类型必然存在;识别逻辑按模式匹配编写,能匹配则纳入,不能匹配则跳过。
- 树变化(通道增删、改名)时增量更新映射并发出事件;无法识别的节点安全忽略并记日志。
- 注意根节点索引从 0 开始(`system` 为 0);Ember 参数元数据不含单位字段,dB/LUFS/dBTP 是项目约定。

### 3. MixerStateStore(`apps/server/src/state/`)

- 规范化业务状态:通道清单(id、kind、name、levelDb、muted)、响度读数、Ember 连接状态;事件驱动,是 socket.io 网关的唯一数据源。

### 4. MeterHub(`apps/server/src/state/`)

- 电平/响度更新的聚合与 **50ms 节流**,批量成帧后交网关广播,与状态增量通道分离。
- Mock Provider 提供了 `pushParameter` 测试钩子,可从测试主动推送 meter/响度流式更新,以此测试节流与聚合行为。

### 5. socket.io 网关(`apps/server/src/ws/`)

- 事件契约定义在 `packages/shared`,zod 校验,事件名与负载严格按 `docs/architecture.md` 的表格:下行 `mixer:snapshot` / `mixer:patch` / `meters:frame` / `system:status`,上行 `control:set-level` / `control:set-on` / `control:reset-loudness`(均带 ack 回执)。
- 电平帧用 volatile emit(可丢帧);快照在连接建立、重连、树结构变化后下发;`control:set-on` 在网关内翻转为 mute 写入。
- 非法命令(越界 level、未知通道 id、schema 不符)拒绝并通过 ack 返回错误,不得使进程崩溃。

### 6. REST API 与持久化(`apps/server/src/api/`、`apps/server/src/config/`)

- `GET /api/v1/connection`(读取 host/port 与连接状态)、`PUT /api/v1/connection`(更新并触发重连)、`GET /api/v1/health`。
- 持久化到 `data/config.json`:zod 校验、原子写入(临时文件 + rename)、文件损坏或缺失时回退默认配置并告警,不崩溃。统一错误响应 `{ error: { code, message } }`。
- `config.json` 的 schema 按 `docs/architecture.md` 定义(含 `views` 字段以保持格式向前兼容,但本阶段不实现 views API)。

### 7. 结构化日志

- 引入 pino(确认 MIT 许可),分层记录:协议错误、校验错误、业务错误;禁止吞错。

## 测试要求

- 集成测试基于 Mock Provider(`packages/test-utils`),放 `apps/server/tests/`;单元测试与被测代码同目录。
- 必须覆盖 `docs/conventions.md` 的后端边界场景清单:Ember 断线/重连/超时、树变化(通道增删)、非法控制命令(越界 level、未知通道)、配置文件损坏/缺失、并发写入。
- 另需覆盖 Phase 3 验收标准点名的场景:连接生命周期、控制命令往返(socket.io 客户端 → 网关 → Ember 写入 → 状态更新 → 增量下发)。
- Mock 测试沿用 Phase 2 惯例:绑定 `127.0.0.1` 临时端口,禁止绑定 9000。
- 覆盖率:`apps/server` 行/分支/函数 ≥ 80%,`packages/shared` ≥ 90%(新增消息契约代码计入)。

## 明确不做的事

- 不实现前端(Phase 4)、views CRUD 与配置页(Phase 5)。
- 不改 CI 流水线结构(`.github/workflows/ci.yml`)。
- 不连接、不模拟连接真实 Fairlight;不硬编码真机地址。
- 不改动 `docs/` 下与本阶段无关的文档。

## 验收自查

完成后逐条核对 `docs/development-plan.md` Phase 3 验收标准,在云端实际执行并记录结果:

1. Mock Provider 集成测试覆盖:连接生命周期、断线重连、树变化、控制命令往返、非法命令拒绝、配置文件损坏/缺失恢复 — 以测试文件与通过记录为证。
2. 对本地真实 Fairlight 手动验收 — **移交用户**,附可照做的验收操作清单。
3. 覆盖率达标 — 附各包覆盖率数字。
4. 全量质量门:串行 lint → typecheck → test(覆盖率门槛)→ build 全绿,远端 CI 全绿。

## 执行报告要求

执行完成后,在 `docs/reports/phase-3-report.md` 产出执行报告(简体中文),包含以下章节:

1. **结果总览** — 一段话说明完成状态(全部完成 / 部分完成及原因)。
2. **验收标准逐条核对** — 对上述四条:通过/未通过/移交用户,附实际执行的命令与关键输出摘要。
3. **模块实现摘要** — EmberService / TreeMapper / MixerStateStore / MeterHub / 网关 / REST 各自的关键设计点(重连退避策略、disconnect 兜底、节流实现、树变化增量更新方式),以及与 `docs/architecture.md` 不一致之处。
4. **真机验收操作清单(移交用户)** — 启动命令、配置步骤、逐项验证步骤与预期结果(读到全部通道与响度、允许通道推子可控且数值一致)。
5. **交付物清单** — 新增/修改的主要源码与测试文件路径及一句话用途。
6. **依赖清单与许可确认** — 新增 npm 依赖的名称、版本、许可证。
7. **关键决策与偏离** — 与计划/规范/架构文档不一致的地方及理由(含覆盖率排除项);没有则明确写"无偏离"。
8. **遗留问题与移交事项** — dump 无法回答的树结构疑问、建议回写 `docs/fairlight-ember.md` 的条目、需要用户完成的步骤。
9. **提交记录** — 本阶段新增提交的 `git log --oneline` 输出与分支名。

报告必须如实反映实际执行结果:测试失败、覆盖率缺口、跳过的步骤都要写明,不许美化。

## 完成定义

- 上述任务范围全部落地,测试要求全部满足。
- 云端串行 lint / typecheck / test / build 全绿,覆盖率门槛达标,分支推送后远端 CI 全绿。
- 全部变更已按 Conventional Commits 提交。
- `docs/reports/phase-3-report.md` 已产出,真机验收清单可直接交用户执行。
