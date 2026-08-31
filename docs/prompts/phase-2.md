# Phase 2 执行提示词 — Ember+ 树发现

> 用法:将本文档全文作为执行会话的任务提示词。执行会话完成后必须产出执行报告(见「执行报告要求」),报告将交由另一会话 review。

---

## 前置阅读(开始工作前必须完成)

按顺序阅读以下文件,理解项目全貌与约束:

1. `AGENTS.md` — 项目说明与关键约束
2. `docs/fairlight-ember.md` — Fairlight Ember+ 参考与踩坑记录(本阶段的核心依据与回写目标)
3. `docs/development-plan.md` — Phase 2 交付物与验收标准(本阶段的任务来源)
4. `docs/conventions.md` — 目录结构、命名、测试、Git 规范
5. `docs/architecture.md` — 架构设计(了解 Mock Provider 与 TreeMapper 在后续阶段的位置)

## 为什么这个阶段重要

Ember+ 是自描述协议,没有官方路径文档;官方手册附录的路径表面向 OSC,与 Ember+ 树不一致,**不得作为编码依据**。本阶段产出的树 dump 存档与 Mock Provider 是后续所有协议层开发(Phase 3+,云端 Agent 无法访问真机)唯一的"真机替身"。dump 不完整或 Mock 失真,后续阶段全部返工。

## 硬性约束(安全红线,违反会造成真实损失)

开发机连接的是**真实运行中的 Fairlight Live**:

- 只允许改动 **MIC-REVERB、BASS、Anagram-Wet、Anagram-Dry** 四个输入通道的**推子(level)**;禁止删改任何通道,禁止改动其它通道的任何参数(包括这四个通道的 mute 等非推子参数)。
- 写入前必须先读取并记录当前值;写入后读回确认;测试完成后复原到原值并再次读回确认。全过程(通道、参数路径、原值、写入值、复原值、时间)记入执行报告。
- **首次对真机写入前,必须向用户说明将改动哪个通道、写什么值,得到确认后才执行。** 读取与订阅是只读操作,不需要确认。
- 自动化测试(vitest)一律使用 Mock Provider,**禁止在任何测试代码中连接真实设备**。真机只通过手动运行的工具脚本访问。
- 代码、注释、提交信息、日志文案用**英文**;文档与报告用**简体中文**。
- 新增依赖必须 MIT 或 MIT 兼容许可,引入前确认 `license` 字段(`emberplus-connection` 为 Sofie/NRK 出品,预期 MIT,仍需实际确认)。
- 提交遵循 Conventional Commits,按逻辑单元分多次提交;不得破坏 Phase 1 已就位的 lint / typecheck / test / build 全绿与覆盖率门槛。

## 前提确认(开工前向用户获取)

1. Fairlight Live 的 Ember+ **host 与 port**(Show settings 中配置,或经 Bonjour `_ember._tcp` 发现)。
2. 确认当前设备状态允许对四个允许通道之一做小幅推子改动(演出/录音进行中时不做写入验证)。

## 任务范围

按 `docs/development-plan.md` 的 Phase 2 执行。本阶段**不实现** EmberService / TreeMapper 等后端业务模块(那是 Phase 3),只做树发现、存档、Mock 与读写验证。

### 1. 树 dump 脚本(`apps/server` 内的工具脚本)

- 用 `emberplus-connection`(仅此一个新的运行时依赖方向,client 与 server 能力都在这个包里)连接 Fairlight,**递归展开完整树**,输出 JSON。
- host/port 由命令行参数传入,不硬编码;提供 `package.json` script 方便调用(如 `pnpm --filter @flwc/server dump-tree -- --host <ip> --port <port>`)。
- 每个节点须包含:路径(number path 与 identifier path 两种)、identifier、description、节点类型(Node/Parameter/Function/Matrix)、参数类型、当前值、取值范围(min/max)、单位、访问权限(read/write)、streamIdentifier(如有)、factor/enumeration 等元数据(如有)。
- 脚本是手动运行的只读工具,注意超时与部分节点展开失败的容错:失败节点记录错误原因后继续,不要让单点失败毁掉整次 dump。
- 覆盖率处理:把可离线测试的纯逻辑(树遍历序列化、节点元数据提取)与连接入口分离,纯逻辑用 Mock Provider 写单测;仅含连接与 CLI 解析的入口文件如无法有意义地测试,可在 vitest 覆盖率配置中显式排除,并在报告中说明。**不许为凑覆盖率调低门槛。**

### 2. dump 存档与文档回写

- dump 快照存档到 `docs/tree-dumps/`,文件名带日期(如 `fairlight-live-2026-08-31.json`);若原始 dump 过大,可另存一份仅含所需子树的精简版,但完整版必须入库。
- 分析 dump,把所有所需节点的**实际路径模式、类型、取值范围、单位、访问权限**回写 `docs/fairlight-ember.md`(更新"已实测确认的节点"表格,移除已确认项的"待确认"状态)。所需节点:
  - 输入通道与各类总线(main / sub / aux / mixm / mtx)的 level、mute、name、meter
  - `system/loudness` 下的 integrated、true-peak、reset(function)
- 发现与文档预期不符的地方(路径、类型、单位、索引起点等),写入 `docs/fairlight-ember.md` 的踩坑记录章节。**不确定的结构不要猜,一切以 dump 为准**;dump 后仍无法确认的疑问,在报告中列出留待用户核实。

### 3. Mock Ember+ Provider(`packages/test-utils`)

- 基于 `emberplus-connection` 的 server 端能力实现 Mock Provider,树结构**复刻真实 dump**(至少覆盖上述全部所需节点;建议从入库的 dump JSON 生成树,保证与真机一致)。
- 必须支持:客户端连接、getDirectory 递归展开、参数订阅、参数写入(写入后向订阅者推送新值)、function 调用(reset)。
- 提供测试钩子:能从测试代码主动推送参数值变化(模拟 meter / 响度的持续流式更新),这是 Phase 3 MeterHub 测试的前提。
- 附带集成测试:用 `emberplus-connection` 客户端连接 Mock Provider,验证连接、展开、订阅收到更新、写入生效、function 调用可达。这些测试同时是"Mock 可被客户端正常使用"的验收证据。
- `packages/test-utils` 补充 vitest 覆盖率门槛(对齐 `packages/shared` 的 90%,如实际不可达在报告中说明理由)。

### 4. 真机读写验证(手动工具脚本,不进自动化测试)

- **订阅验证**:订阅至少一个 meter 参数与 `system/loudness/integrated`,确认收到持续更新(记录收到的帧率/间隔与样例值)。
- **写入验证**:按上面安全红线的流程,对四个允许通道**之一**的推子写入一个小幅变化(如 ±1 dB),读回确认生效,复原,再读回确认。
- 验证逻辑可以并入 dump 脚本或单独小脚本,以简单直接为准。

## 明确不做的事

- 不实现 EmberService、TreeMapper、MixerStateStore、MeterHub、socket.io 网关(Phase 3)。
- 不改 CI 流水线结构。
- 不推送 GitHub(由用户完成)。
- 不改动 `docs/` 下与本阶段无关的文档(`docs/fairlight-ember.md`、`docs/tree-dumps/`、执行报告除外)。

## 验收自查

完成后逐条核对 `docs/development-plan.md` Phase 2 验收标准,在本机实际执行并记录结果:

1. dump 覆盖全部所需节点:通道/各类总线的 level、mute、name、meter,`system/loudness` 的 integrated、true-peak、reset — 对照 dump 文件逐类确认,缺失的说明原因。
2. 每个所用节点的类型、范围、单位已确认并写入 `docs/fairlight-ember.md`。
3. Mock Provider 能被 emberplus-connection 客户端正常连接、订阅、写入 — 以集成测试通过为证。
4. 实测未改动任何不允许的通道、未删改任何通道 — 以写入验证记录(仅一个允许通道、已复原)为证。
5. Phase 1 的全部质量门依然全绿:本机串行 lint → typecheck → test(覆盖率门槛)→ build。

## 执行报告要求

执行完成后,在 `docs/reports/phase-2-report.md` 产出执行报告(简体中文),包含以下章节:

1. **结果总览** — 一段话说明完成状态(全部完成 / 部分完成及原因)。
2. **验收标准逐条核对** — 对上述五条:通过/未通过/移交用户,附实际执行的命令与关键输出摘要。
3. **真机操作记录** — 连接参数(host/port)、订阅验证的观测数据(更新间隔、样例值)、写入验证的完整流水(通道、路径、原值、写入值、读回值、复原确认、时间),以及"未触碰任何其它通道/参数"的明确声明。
4. **树结构发现摘要** — 树的顶层组织、各类通道/总线的路径模式、参数类型与范围要点、与预期不符之处(已写入踩坑记录的列出条目)。
5. **交付物清单** — dump 脚本、dump 存档文件、Mock Provider、测试文件的路径与一句话用途。
6. **依赖清单与许可确认** — 新增 npm 依赖的名称、版本、许可证。
7. **关键决策与偏离** — 与计划/规范不一致的地方及理由(含覆盖率排除项);没有则明确写"无偏离"。
8. **遗留问题与移交事项** — 无法确认的树结构疑问、需要用户完成的步骤。
9. **提交记录** — 本阶段新增提交的 `git log --oneline` 输出。

报告必须如实反映实际执行结果:连接失败、dump 缺失节点、测试失败、跳过的步骤都要写明,不许美化。

## 完成定义

- 上述任务范围全部落地:dump 存档已入库、`docs/fairlight-ember.md` 已回写、Mock Provider 及其集成测试就位、真机读写验证完成且已复原。
- 本机 lint / typecheck / test / build 串行全绿,覆盖率门槛达标。
- 全部变更已按 Conventional Commits 提交到本地 git。
- `docs/reports/phase-2-report.md` 已产出。
